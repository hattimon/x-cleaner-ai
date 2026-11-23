import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ApiProvider, Evaluation } from '../shared/contracts.js';
import { apiProviders } from '../shared/contracts.js';
import { AppError } from './config.js';
import type { Config } from './config.js';
import { audit, json, ownedAccount, reserveUsage, settingsOf } from './db.js';
import { aiAssessmentSchema, reconcile } from './classification.js';
import type { ClassificationInput } from './classification.js';
import { classificationMaterial, readPrompt } from './ai-providers.js';
import type { AIProvider, ChatGPTPlanProvider } from './ai-providers.js';

const endpoints = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
};
const part = z.object({ text: z.string().optional() });
const parseOpenAi = z.object({ output: z.array(z.object({ content: z.array(part).optional() })) });
const parseClaude = z.object({ content: z.array(part) });
const parseGemini = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(part) }).optional() })) });
const modelName = z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/);

export function apiRequest(provider: ApiProvider, key: string, model: string, prompt: string, schema: object, input: string) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'openai') return {
    url: endpoints.openai, headers: { ...headers, Authorization: 'Bearer ' + key },
    body: { model, instructions: prompt, input: [{ role: 'user', content: input }], store: false, max_output_tokens: 1200,
      text: { format: { type: 'json_schema', name: 'x_cleaner_result', strict: true, schema } } },
  };
  if (provider === 'anthropic') return {
    url: endpoints.anthropic, headers: { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: { model, system: prompt, max_tokens: 1200, messages: [{ role: 'user', content: input }],
      output_config: { format: { type: 'json_schema', schema } } },
  };
  return {
    url: endpoints.gemini + encodeURIComponent(model) + ':generateContent', headers: { ...headers, 'x-goog-api-key': key },
    body: { systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { maxOutputTokens: 1200, responseMimeType: 'application/json', responseJsonSchema: schema } },
  };
}

function extract(provider: ApiProvider, body: unknown) {
  if (provider === 'openai') return parseOpenAi.safeParse(body).data?.output.flatMap(item => item.content ?? []).map(item => item.text).join('');
  if (provider === 'anthropic') return parseClaude.safeParse(body).data?.content.map(item => item.text).join('');
  return parseGemini.safeParse(body).data?.candidates[0]?.content?.parts.map(item => item.text).join('');
}

export class AiProviders implements AIProvider {
  private keys: Record<ApiProvider, string>;
  constructor(private db: PrismaClient, cfg: Config, private chat: ChatGPTPlanProvider, private fetcher = fetch) {
    this.keys = { openai: cfg.OPENAI_API_KEY, anthropic: cfg.ANTHROPIC_API_KEY, gemini: cfg.GEMINI_API_KEY };
  }
  statuses() {
    return { openai: Boolean(this.keys.openai), anthropic: Boolean(this.keys.anthropic), gemini: Boolean(this.keys.gemini) };
  }
  async structured<T extends z.ZodType>(userId: string, accountId: string, name: 'classification' | 'assistant', schema: T, input: unknown): Promise<z.infer<T>> {
    const settings = settingsOf(await ownedAccount(this.db, userId, accountId));
    if (settings.aiProvider === 'chatgpt') return this.chat.structured(userId, accountId, settings.aiModel, name, schema, input);
    const provider = apiProviders.find(key => key === settings.aiProvider);
    if (!provider || !settings.aiPaidConsent || !this.keys[provider]) {
      throw new AppError(403, 'ai_not_enabled', 'Skonfiguruj klucz API i wyraź zgodę na rozliczane wywołania w Ustawieniach.');
    }
    const model = modelName.parse(settings.aiModel);
    const { $schema: _meta, ...wire } = z.toJSONSchema(schema);
    const prompt = await readPrompt(name) + (name === 'assistant' && (input as { language?: string })?.language === 'en' ? '\nRespond in English.' : '');
    const request = apiRequest(provider, this.keys[provider], model, prompt, wire, JSON.stringify(input));
    await reserveUsage(this.db, accountId, 'ai');
    let response: Response;
    try {
      response = await this.fetcher(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body),
        redirect: 'error', signal: AbortSignal.timeout(45000) });
    } catch { throw new AppError(503, 'ai_network', 'Połączenie z dostawcą AI jest niedostępne.'); }
    if (!response.ok) throw new AppError(response.status === 429 ? 429 : 502, 'ai_api', 'Dostawca AI odrzucił żądanie. Sprawdź klucz, dostępność modelu i limity.');
    let value: unknown;
    try { value = JSON.parse(extract(provider, await response.json()) ?? 'null'); }
    catch { value = null; }
    const valid = schema.safeParse(value);
    if (!valid.success) throw new AppError(502, 'ai_output', 'Dostawca AI nie zwrócił wyniku zgodnego ze schematem.');
    await audit(this.db, userId, accountId, 'ai.' + name, 'Przetworzono odpowiedź z API dostawcy AI.', json({ provider, model }));
    return valid.data;
  }
  async classify(userId: string, accountId: string, model: string, rules: Evaluation, input: ClassificationInput, minimumConfidence?: number) {
    const settings = settingsOf(await ownedAccount(this.db, userId, accountId));
    if (settings.aiProvider === 'manual') return rules;
    if (settings.aiProvider === 'chatgpt') return this.chat.classify(userId, accountId, settings.aiModel, rules, input, minimumConfidence);
    const assessed = await this.structured(userId, accountId, 'classification', aiAssessmentSchema, classificationMaterial(rules, input));
    return reconcile(rules, assessed, input.posts, settings.aiProvider, model, input.live, minimumConfidence);
  }
}
