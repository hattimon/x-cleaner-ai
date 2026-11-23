import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ModelChoice, Evaluation } from '../shared/contracts.js';
import type { Config } from './config.js';
import { AppError } from './config.js';
import { audit, json, lock, reserveUsage } from './db.js';
import type { Callback, Pending } from './oauth.js';
import { secureEquals, Vault } from './security.js';
import { aiAssessmentSchema, reconcile } from './classification.js';
import type { ClassificationInput } from './classification.js';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const registrationClientId = 'dynamic_agent_client';
const usageScope = 'chatgpt.tokens.use.direct';
const chatScopes = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', usageScope];
const jwks = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'), { timeoutDuration: 5000 });
const chatTokens = z.object({
  access_token: z.string().min(10).max(20000), refresh_token: z.string().min(10).max(20000).optional(),
  id_token: z.string().min(10).max(20000).optional(), scope: z.string().optional(),
  expires_in: z.number().int().positive(), token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
});
type ChatTokens = z.infer<typeof chatTokens>;
type VerifyIdentity = (id: string, client: string, nonce: string) => Promise<{ sub: string; label: string | null }>;
const modelCatalog = z.object({ models: z.array(z.object({ slug: z.string().max(100), display_name: z.string(), visibility: z.string() })) });
const providerError = z.object({ error: z.object({ code: z.string().nullable().optional(), param: z.string().nullable().optional() }) });
const usageSchema = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() });

export const chatCallback = (config: Config) => config.SIWC_CALLBACK_ORIGIN + '/api/integrations/chatgpt/callback';
export function chatAuthorization(config: Config, host: string, attempt: Pending & { state: string; challenge: string }) {
  const url = new URL(issuer + '/api/accounts/authorize');
  url.search = new URLSearchParams({
    client_id: attempt.clientId || registrationClientId, ext_agent_host_id: host,
    ...(attempt.clientId ? {} : { agent_name_hint: 'X-Cleaner AI' }),
    response_type: 'code', redirect_uri: chatCallback(config), scope: chatScopes.join(' '), resource,
    state: attempt.state, nonce: attempt.nonce, code_challenge: attempt.challenge, code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function verifyIdentity(token: string, client: string, nonce: string) {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: client, requiredClaims: ['sub', 'exp', 'nonce', 'iat'] });
    if (!payload.sub || typeof payload.nonce !== 'string' || !secureEquals(payload.nonce, nonce)) throw new Error('identity mismatch');
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== client) throw new Error('authorized party mismatch');
    return { sub: payload.sub, label: typeof payload.name === 'string' ? payload.name.slice(0, 100) : typeof payload.email === 'string' ? payload.email.slice(0, 250) : null };
  } catch {
    throw new AppError(401, 'chat_identity', 'Nie udało się zweryfikować tożsamości przekazanej przez ChatGPT.');
  }
}

function chatFailure(status: number, payload: unknown) {
  const parsed = providerError.safeParse(payload);
  const param = parsed.success ? parsed.data.error.param : null;
  const code = parsed.success ? parsed.data.error.code : null;
  if (status === 429) return new AppError(429, 'chat_limit', 'Osiągnięto limit planu ChatGPT. Spróbuj po odnowieniu limitu.');
  if (status === 401) return new AppError(401, 'chat_reauthorize', 'Połącz ponownie konto ChatGPT.');
  if (status === 402 || status === 403) return new AppError(status, 'chat_plan_unavailable', 'Plan lub uprawnienia konta nie udostępniły tej operacji.');
  if (status === 400 && (/^text(?:\.format)?(?:\.|$)/.test(param ?? '') || code === 'unsupported_response_format')) {
    return new AppError(422, 'chat_format_unsupported', 'Model nie obsługuje deklaracji schematu odpowiedzi.');
  }
  return new AppError(status >= 500 ? 503 : 422, 'chat_api', 'ChatGPT nie ukończył operacji. Sprawdź dostępność modelu i uprawnienia.');
}

async function safeFetch(fetcher: typeof fetch, url: string, init: RequestInit = {}, timeout = 10000) {
  let response: Response;
  try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeout), redirect: 'error' }); }
  catch { throw new AppError(503, 'chat_network', 'Połączenie z oficjalnym API ChatGPT jest niedostępne.'); }
  if (!response.ok) throw chatFailure(response.status, await response.json().catch(() => null));
  return response;
}

function form(params: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) };
}

async function exchange(fetcher: typeof fetch, params: Record<string, string>) {
  const response = await safeFetch(fetcher, issuer + '/api/accounts/oauth/token', form({ ...params, resource }));
  const result = chatTokens.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new AppError(502, 'chat_token_format', 'ChatGPT zwrócił niepełne dane uwierzytelnienia.');
  return result.data;
}

export async function collectSse(response: Response) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new AppError(502, 'chat_stream', 'ChatGPT nie zwrócił strumienia odpowiedzi.');
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let text = '';
  let complete = false;
  let usage: z.infer<typeof usageSchema> | undefined;
  try {
    while (!complete) {
      const item = await reader.read();
      buffer += item.done ? decoder.decode() : decoder.decode(item.value, { stream: true });
      if (item.done && buffer.trim()) buffer += '\n\n';
      if (buffer.length > 512000) throw new AppError(502, 'chat_stream', 'Odpowiedź ChatGPT przekroczyła limit aplikacji.');
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event;
        try { event = JSON.parse(data); } catch { throw new AppError(502, 'chat_stream', 'Niepoprawny format strumienia ChatGPT.'); }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
        if (text.length > 32000) throw new AppError(502, 'chat_stream', 'Odpowiedź ChatGPT przekroczyła limit aplikacji.');
        if (event.type === 'response.completed') {
          complete = true;
          const parsed = usageSchema.safeParse(event.response?.usage);
          if (parsed.success) usage = parsed.data;
        }
        if (['error', 'response.failed', 'response.incomplete', 'response.refusal.done'].includes(event.type)) {
          const error = event.response?.error ?? event.error ?? event;
          const limited = /rate.limit|usage.limit|quota/i.test(String(error?.code));
          throw chatFailure(limited ? 429 : 422, { error });
        }
      }
      if (item.done) break;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'chat_stream_interrupted', 'Przerwano strumień odpowiedzi ChatGPT.');
  } finally { await reader.cancel().catch(() => {}); }
  if (!complete || !text.trim()) throw new AppError(502, 'chat_stream_incomplete', 'ChatGPT nie ukończył odpowiedzi.');
  return { text, usage };
}

const prompt = new Map<string, Promise<string>>();
export function readPrompt(name: 'classification' | 'assistant') {
  const current = prompt.get(name);
  if (current) return current;
  const location = new URL('../../prompts/' + name + '-v1.md', import.meta.url);
  const value = readFile(location, 'utf8').catch(() => readFile(new URL('../prompts/' + name + '-v1.md', import.meta.url), 'utf8'));
  prompt.set(name, value);
  return value;
}

export interface AIProvider {
  classify(userId: string, accountId: string, model: string, rules: Evaluation, input: ClassificationInput, minimumConfidence?: number): Promise<Evaluation>;
}
export function classificationMaterial(rules: Evaluation, input: ClassificationInput) {
  return {
    signals: {
      activity: rules.activity, spam: rules.spam_score, quality: rules.quality_score, completeness: rules.data_completeness,
      signals: rules.evidence.map(({ kind, postId }) => ({ kind, postId })),
    },
    sample: input.posts.map(({ id, kind }) => ({ id, kind })),
  };
}

// Reguły są wspólne dla pracy bez sieci i dla wstępnej oceny przed użyciem modelu.
export class ManualReviewProvider implements AIProvider {
  async classify(_userId: string, _accountId: string, _model: string, rules: Evaluation) { return rules; }
}

export class ChatGPTPlanProvider implements AIProvider {
  constructor(private db: PrismaClient, private config: Config, private vault: Vault,
    private fetcher: typeof fetch = fetch, private verify: VerifyIdentity = verifyIdentity) {}

  async hostId() {
    const host = await this.db.hostIdentity.upsert({
      where: { key: 'chatgpt' }, update: {}, create: { key: 'chatgpt', hostId: randomUUID() },
    });
    return host.hostId;
  }
  get callbackAvailable() {
    return ['localhost', '127.0.0.1'].includes(new URL(this.config.PUBLIC_ORIGIN).hostname)
      && (new URL(this.config.PUBLIC_ORIGIN).port || '80') === (new URL(this.config.SIWC_CALLBACK_ORIGIN).port || '80')
      && this.config.PUBLIC_ORIGIN.startsWith('http:');
  }
  requireEnabled() {
    if (!this.config.ENABLE_CHATGPT_PLAN) throw new AppError(403, 'chat_disabled', 'Włącz integrację ChatGPT Plan Usage w konfiguracji serwera.');
  }
  async connect(userId: string, result: Callback, pending: Pending) {
    this.requireEnabled();
    if (result.error || !result.code) throw new AppError(400, 'chat_consent', 'Autoryzacja ChatGPT została przerwana.');
    const clientId = pending.clientId ?? result.client_id;
    if (!clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (result.client_id && result.client_id !== clientId)) {
      throw new AppError(400, 'chat_client', 'OpenAI nie zwrócił oczekiwanej rejestracji klienta.');
    }
    const tokens = await exchange(this.fetcher, {
      grant_type: 'authorization_code', client_id: clientId, code: result.code, code_verifier: pending.verifier, redirect_uri: chatCallback(this.config),
    });
    if (!tokens.id_token) throw new AppError(401, 'chat_identity', 'ChatGPT nie zwrócił tokena OIDC.');
    const identity = await this.verify(tokens.id_token, clientId, pending.nonce);
    if (pending.subject && pending.subject !== identity.sub) throw new AppError(401, 'chat_identity', 'Wybrano inne konto ChatGPT.');
    const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    const data = {
      subject: identity.sub, clientId, displayName: identity.label, scopes,
      encrypted: this.vault.seal(tokens, 'chat:' + userId + ':' + clientId),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      errorCode: scopes.includes(usageScope) && scopes.includes('resource.invoke') ? null : 'chat_no_scope',
    };
    await this.db.$transaction(async tx => {
      await lock(tx, 'chat:' + userId);
      const existing = await tx.chatConnection.findUnique({ where: { userId } });
      if (existing && (existing.clientId !== clientId || existing.subject !== identity.sub)) {
        throw new AppError(409, 'chat_identity', 'Połączenie należy do innej zweryfikowanej rejestracji.');
      }
      await tx.chatConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      await audit(tx, userId, null, 'chat.connected', data.errorCode ? 'Połączono konto ChatGPT. Uprawnienie do planu jest niedostępne.' : 'Połączono konto ChatGPT z uprawnieniem do korzystania z planu.');
    });
  }
  async status(userId: string) {
    const row = await this.db.chatConnection.findUnique({ where: { userId } });
    const enabled = this.config.ENABLE_CHATGPT_PLAN;
    return {
      enabled, connected: enabled && Boolean(row?.encrypted) && row?.errorCode !== 'chat_reauthorize',
      callbackAvailable: this.callbackAvailable, displayName: row?.displayName ?? null, scopes: row?.scopes ?? [],
      planUsage: enabled && Boolean(row?.encrypted) && row?.errorCode !== 'chat_reauthorize' && row?.scopes.includes(usageScope) === true && row.scopes.includes('resource.invoke'),
      error: row?.errorCode ?? null, lastUsage: row?.lastUsage ?? null,
    };
  }
  async access(userId: string) {
    this.requireEnabled();
    const outcome = await this.db.$transaction(async tx => {
      await lock(tx, 'chat:' + userId);
      const row = await tx.chatConnection.findUnique({ where: { userId } });
      if (!row?.encrypted || row.errorCode === 'chat_reauthorize') return { failure: 'chat_reauthorize' as const };
      if (![usageScope, 'resource.invoke'].every(scope => row.scopes.includes(scope))) return { failure: 'chat_no_scope' as const };
      const context = 'chat:' + userId + ':' + row.clientId;
      const tokens = this.vault.open<ChatTokens>(row.encrypted, context);
      if (row.expiresAt.getTime() > Date.now() + 90000) return { token: tokens.access_token, encrypted: row.encrypted };
      try {
        if (!tokens.refresh_token) throw new AppError(401, 'chat_reauthorize', 'Brak tokena odświeżania.');
        const next = await exchange(this.fetcher, { grant_type: 'refresh_token', client_id: row.clientId, refresh_token: tokens.refresh_token });
        const scopes = next.scope ? next.scope.split(/\s+/) : row.scopes;
        const failure = ![usageScope, 'resource.invoke'].every(scope => scopes.includes(scope));
        const encrypted = this.vault.seal({ ...next, refresh_token: next.refresh_token ?? tokens.refresh_token, id_token: next.id_token ?? tokens.id_token }, context);
        await tx.chatConnection.update({
          where: { userId }, data: { encrypted, scopes, expiresAt: new Date(Date.now() + next.expires_in * 1000), errorCode: failure ? 'chat_no_scope' : null },
        });
        return failure ? { failure: 'chat_no_scope' as const } : { token: next.access_token, encrypted };
      } catch (error) {
        if (!(error instanceof AppError) || error.status === 429 || error.status >= 500) throw error;
        await tx.chatConnection.update({ where: { userId }, data: { errorCode: 'chat_reauthorize' } });
        return { failure: 'chat_reauthorize' as const };
      }
    }, { timeout: 15000 });
    if (outcome.failure === 'chat_no_scope') throw new AppError(403, outcome.failure, 'Udziel uprawnienia do korzystania z planu ChatGPT.');
    if (outcome.failure) throw new AppError(401, outcome.failure, 'Połącz ponownie konto ChatGPT.');
    return outcome;
  }
  private async recordFailure(userId: string, encrypted: string, error: unknown) {
    if (error instanceof AppError && ['chat_limit', 'chat_reauthorize', 'chat_plan_unavailable'].includes(error.code)) {
      await this.db.chatConnection.updateMany({ where: { userId, encrypted }, data: { errorCode: error.code } });
    }
  }
  async listModels(userId: string): Promise<ModelChoice[]> {
    const { token, encrypted } = await this.access(userId);
    try {
      const response = await safeFetch(this.fetcher, resource + '/models', { headers: { Authorization: 'Bearer ' + token } });
      const catalog = modelCatalog.safeParse(await response.json().catch(() => null));
      if (!catalog.success) throw new AppError(502, 'chat_models', 'ChatGPT nie udostępnił katalogu modeli dla tego konta.');
      await this.db.chatConnection.updateMany({ where: { userId, encrypted }, data: { errorCode: null } });
      return catalog.data.models.filter(model => model.visibility === 'list').map(model => ({ id: model.slug, label: model.display_name }));
    } catch (error) { await this.recordFailure(userId, encrypted, error); throw error; }
  }
  async disconnect(userId: string, forget = false) {
    const row = await this.db.$transaction(async tx => {
      await lock(tx, 'chat:' + userId);
      const row = await tx.chatConnection.findUnique({ where: { userId } });
      if (!row) return null;
      if (forget) await tx.chatConnection.delete({ where: { userId } });
      else await tx.chatConnection.update({ where: { userId }, data: { encrypted: null, scopes: [], errorCode: null } });
      await tx.oAuthAttempt.deleteMany({ where: { userId, provider: 'chatgpt' } });
      await audit(tx, userId, null, 'chat.disconnected', 'Zakończono lokalną sesję ChatGPT.');
      return row;
    });
    if (!row?.encrypted) return { revoked: true };
    const tokens = this.vault.open<ChatTokens>(row.encrypted, 'chat:' + userId + ':' + row.clientId);
    if (!tokens.refresh_token) return { revoked: false };
    try {
      const discovery = await safeFetch(this.fetcher, issuer + '/.well-known/openid-configuration');
      const { revocation_endpoint: revocation } = z.object({ revocation_endpoint: z.url() }).parse(await discovery.json());
      const endpoint = new URL(revocation);
      if (endpoint.origin !== issuer || endpoint.username || endpoint.password) return { revoked: false };
      await safeFetch(this.fetcher, endpoint.href, form({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: row.clientId }));
      return { revoked: true };
    } catch { return { revoked: false }; }
  }
  async structured<T extends z.ZodType>(userId: string, accountId: string, model: string, name: 'classification' | 'assistant', schema: T, payload: unknown): Promise<z.infer<T>> {
    if (!model) throw new AppError(400, 'chat_model', 'Wybierz model z katalogu ChatGPT.');
    const { token, encrypted } = await this.access(userId);
    const { $schema: _meta, ...wireSchema } = z.toJSONSchema(schema);
    const instructions = await readPrompt(name) + (name === 'assistant' && (payload as { language?: string })?.language === 'en' ? '\nRespond in English.' : '');
    const send = async (withSchema: boolean) => {
      await reserveUsage(this.db, accountId, 'ai');
      const response = await safeFetch(this.fetcher, resource + '/responses', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, store: false, stream: true,
          instructions: withSchema ? instructions : instructions + '\nZwróć czysty JSON bez Markdown. Schemat: ' + JSON.stringify(wireSchema),
          input: [{ role: 'user', content: JSON.stringify(payload) }],
          ...(withSchema ? { text: { format: { type: 'json_schema', name, strict: true, schema: wireSchema } } } : {}),
        }),
      }, 45000);
      return collectSse(response);
    };
    try {
      const answer = await send(true).catch(error => {
        if (error instanceof AppError && error.code === 'chat_format_unsupported') return send(false);
        throw error;
      });
      await this.db.chatConnection.updateMany({
        where: { userId, encrypted }, data: { errorCode: null, lastUsage: json({ model, at: new Date().toISOString(), mode: 'chatgpt_plan', ...(answer.usage ?? {}) }) },
      });
      let parsed: unknown;
      try { parsed = JSON.parse(answer.text); } catch { parsed = null; }
      const validated = schema.safeParse(parsed);
      if (!validated.success) throw new AppError(502, 'chat_invalid_output', 'Model nie zwrócił ważnego wyniku zgodnego ze schematem.');
      await audit(this.db, userId, accountId, 'ai.' + name, 'Przetworzono odpowiedź ChatGPT Plan Usage.', json({ provider: 'chatgpt', model }));
      return validated.data;
    } catch (error) { await this.recordFailure(userId, encrypted, error); throw error; }
  }
  async classify(userId: string, accountId: string, model: string, rules: Evaluation, input: ClassificationInput, minimumConfidence?: number) {
    const output = await this.structured(userId, accountId, model, 'classification', aiAssessmentSchema, classificationMaterial(rules, input));
    return reconcile(rules, output, input.posts, 'chatgpt', model, input.live, minimumConfidence);
  }
}
