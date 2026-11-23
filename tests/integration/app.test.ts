import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeApp } from '../../server/app.js';
import { ChatGPTPlanProvider, ManualReviewProvider } from '../../server/ai-providers.js';
import { readConfig, AppError } from '../../server/config.js';
import { Scanner } from '../../server/scanner.js';
import { Cleanup } from '../../server/cleanup.js';
import { makeMcp } from '../../server/mcp.js';
import { opaque, Vault } from '../../server/security.js';
import { settingsSchema } from '../../shared/contracts.js';
import { json } from '../../server/db.js';
import { ensureOwner } from '../../server/local-account.js';
import type { XProfile, XProvider } from '../../server/x-provider.js';
import { archiveFiles, examples } from '../fixtures.js';

const url = process.env.TEST_DATABASE_URL ?? '';
if (!/^postgresql:\/\/xcleaner:.+@127\.0\.0\.1:55432\/xcleaner\?schema=xc_integration_[a-f0-9]+$/.test(url)) throw new Error('Wymagana izolowana baza testowa.');
const db = new PrismaClient({ datasourceUrl: url });
const origin = 'http://localhost:3182';
const cfg = readConfig({
  DATABASE_URL: url, TOKEN_KEY: opaque(), PUBLIC_ORIGIN: origin,
  X_CLIENT_ID: 'unit-test-client', X_ENABLE_WRITE: 'true', ENABLE_CHATGPT_PLAN: 'true',
  MCP_ENABLED: 'true', SIWC_CALLBACK_ORIGIN: 'http://127.0.0.1:3182',
});
const xToken = 'internal-x-access-token-for-fixture';
const refreshToken = 'internal-x-refresh-token-fixture';
const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
  const target = new URL(String(input));
  if (target.pathname === '/2/oauth2/token') return Response.json({
    access_token: xToken, refresh_token: refreshToken, expires_in: 7200, token_type: 'bearer',
    scope: 'tweet.read users.read follows.read follows.write offline.access',
  });
  if (target.pathname === '/2/users/me') return Response.json({
    data: { id: '393929', name: 'Konto LIVE testowe', username: 'live_test', public_metrics: { following_count: 6, followers_count: 9 } },
  });
  throw new Error('Unexpected test request: ' + target.pathname);
});
let app: Awaited<ReturnType<typeof makeApp>>['app'];
let headers: Record<string, string>;
let id: string;
let archiveId: string;
let liveId: string;
let mcpToken: string;
let profileCandidateId: string;

beforeAll(async () => {
  const result = await makeApp(db, cfg, fetcher, false);
  app = result.app;
});
afterAll(async () => { await app?.close(); await db.$disconnect(); });

describe.sequential('lokalny backend, integracje i uprawnienia', () => {
  it('tworzy jednorazowe poświadczenia i chroni sesje, CSRF, zmianę hasła oraz próby logowania', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/api/accounts')).statusCode).toBe(401);
    const [first, second] = await Promise.all([ensureOwner(db), ensureOwner(db)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const loginBody = (first ?? second)!;
    expect(loginBody.username).toMatch(/^admin-[a-f0-9]{8}$/);
    expect(loginBody.password.length).toBeGreaterThan(24);
    expect((await app.inject({ method: 'POST', url: '/api/session/login', headers: { origin: 'https://illegal.test' }, payload: loginBody })).statusCode).toBe(403);
    const initial = await app.inject({ method: 'POST', url: '/api/session/login', headers: { origin }, payload: loginBody });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().user.initialPassword).toBe(true);
    const cookie = initial.cookies[0];
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    id = initial.json().user.id;
    headers = { cookie: cookie.name + '=' + cookie.value, origin, 'x-csrf-token': initial.json().csrf };
    expect((await app.inject({ method: 'POST', url: '/api/accounts/archive', headers: { cookie: headers.cookie, origin }, payload: archiveFiles() })).statusCode).toBe(403);
    const newPassword = opaque();
    const rotated = await app.inject({ method: 'POST', url: '/api/session/password', headers, payload: { currentPassword: loginBody.password, newPassword } });
    expect(rotated.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/accounts', headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/session/login', headers: { origin }, payload: loginBody })).statusCode).toBe(401);
    const returning = await app.inject({ method: 'POST', url: '/api/session/login', headers: { origin }, payload: { ...loginBody, password: newPassword } });
    expect(returning.statusCode).toBe(200);
    expect(returning.json().user.initialPassword).toBe(false);
    const nextCookie = returning.cookies[0];
    headers = { cookie: nextCookie.name + '=' + nextCookie.value, origin, 'x-csrf-token': returning.json().csrf };
    for (let i = 0; i < 6; i++) await app.inject({
      method: 'POST', remoteAddress: '192.0.2.1', url: '/api/session/login', headers: { origin }, payload: { username: 'wrong-user', password: newPassword },
    });
    const limited = await app.inject({ method: 'POST', remoteAddress: '192.0.2.1', url: '/api/session/login', headers: { origin }, payload: { username: 'wrong-user', password: newPassword } });
    expect(limited.statusCode).toBe(429);
    const row = await db.localUser.findUniqueOrThrow({ where: { id } });
    expect(row.passwordHash).not.toContain(newPassword);
  });

  it('importuje archiwum, zaznacza wszystkie strony i eksportuje rzeczywiste identyfikatory z pliku', async () => {
    const req = await app.inject({ method: 'POST', url: '/api/accounts/archive', headers, payload: archiveFiles() });
    expect(req.statusCode).toBe(200);
    archiveId = req.json().id;
    const base = '/api/accounts/' + archiveId;
    const page = await app.inject({ url: base + '/profiles?page=3&pageSize=10', headers });
    expect(page.json()).toMatchObject({ page: 3, total: 24 });
    expect(page.json().items).toHaveLength(4);
    const ids = (await app.inject({ url: base + '/profiles/selection?page=3&pageSize=10', headers })).json().ids;
    expect(ids).toHaveLength(24);
    const decision = await app.inject({ method: 'POST', url: base + '/profiles/preferences', headers, payload: { ids, preference: 'REVIEW' } });
    expect(decision.json().count).toBe(24);
    expect((await app.inject({ url: base + '/profiles?view=review', headers })).json().total).toBe(24);
    const report = await app.inject({ url: base + '/report/csv', headers });
    expect(report.statusCode).toBe(200);
    expect(report.headers['content-type']).toContain('text/csv');
    expect(report.body).toContain('700023');
    expect((await app.inject({ url: base + '/report/json', headers })).json().profiles).toHaveLength(24);
    const preview = await app.inject({ method: 'POST', url: base + '/cleanup', headers, payload: { ids } });
    expect(preview.json().code).toBe('archive_read_only');
  });

  it('izoluje konta i zwraca stan niedostępnego LIVE bez wywołania X', async () => {
    const different = await db.localUser.create({ data: { slot: false, username: 'different-owner', passwordHash: 'fixture' } });
    const account = await db.xAccount.create({ data: { userId: different.id, xId: '400', mode: 'ARCHIVE', username: 'test', name: 'Inny właściciel', scopes: [] } });
    expect((await app.inject({ url: '/api/accounts/' + account.id + '/dashboard', headers })).statusCode).toBe(404);
    const noAuth = await db.xAccount.create({ data: { userId: id, xId: '401', mode: 'LIVE', username: 'unlinked', name: 'Bez OAuth', scopes: [] } });
    const state = await app.inject({ method: 'POST', url: '/api/accounts/' + noAuth.id + '/scans', headers, payload: {} });
    expect(state.json().code).toBe('x_disconnected');
    expect((await app.inject({ url: '/api/integrations?accountId=' + noAuth.id, headers })).json().x.operations.every((op: { status: string }) => op.status === 'missing')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sprawdza OAuth X state i zapisuje tokeny tylko zaszyfrowane w bazie', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/integrations/x/start', headers, payload: { acceptCosts: true } });
    const target = new URL(start.json().url);
    expect(target.searchParams.get('scope')).toContain('follows.write');
    const stale = await app.inject({ url: '/api/integrations/x/callback?code=mock-code&state=' + opaque(), headers });
    expect(stale.headers.location).toContain('oauth_state');
    expect(fetcher).not.toHaveBeenCalled();
    const callback = '/api/integrations/x/callback?code=mock-code&state=' + target.searchParams.get('state');
    const completed = await app.inject({ url: callback, headers });
    expect(completed.headers.location).toContain('x_connected');
    expect((await app.inject({ url: callback, headers })).headers.location).toContain('oauth_state');
    const stored = await db.xAccount.findFirstOrThrow({ where: { xId: '393929', userId: id } });
    liveId = stored.id;
    expect(stored.encrypted).not.toContain(xToken);
    expect(stored.encrypted).not.toContain(refreshToken);
    const body = (await app.inject({ url: '/api/accounts', headers })).body;
    expect(body).not.toContain(xToken);
    expect(body).not.toContain(stored.encrypted);
  });

  it('używa loopbacku ChatGPT, sprawdza state, jednorazowość i powiązanie z sesją', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/integrations/chatgpt/start', headers, payload: {} });
    const begin = new URL(start.json().url);
    expect(begin.searchParams.get('client_id')).toBe('dynamic_agent_client');
    const cb = '/api/integrations/chatgpt/callback?error=access_denied&state=' + begin.searchParams.get('state');
    expect((await app.inject({ url: cb, headers: { host: 'localhost:3182' } })).statusCode).toBe(400);
    const received = await app.inject({ url: cb, headers: { host: '127.0.0.1:3182' } });
    const receipt = new URL(received.headers.location!).searchParams.get('complete');
    expect(receipt).toBeTruthy();
    expect((await app.inject({ url: cb, headers: { host: '127.0.0.1:3182' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/integrations/chatgpt/finish', payload: { receipt } })).statusCode).toBe(401);
    const declined = await app.inject({ method: 'POST', url: '/api/integrations/chatgpt/finish', headers, payload: { receipt } });
    expect(declined.json().code).toBe('chat_consent');
    expect((await app.inject({ method: 'POST', url: '/api/integrations/chatgpt/finish', headers, payload: { receipt } })).json().code).toBe('oauth_state');
  });

  it('obsługuje katalog modeli, grant, SSE i zużycie ChatGPT w kontrakcie API', async () => {
    const data = {
      token_type: 'bearer', access_token: opaque(), refresh_token: opaque(),
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', expires_in: 3600, id_token: opaque(),
    };
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(data))
      .mockResolvedValueOnce(Response.json({ models: [
        { slug: 'test-model', display_name: 'Model testowy', visibility: 'list' }, { slug: 'hidden', display_name: 'Ukryty', visibility: 'hidden' },
      ] }))
      .mockResolvedValueOnce(new Response([
        { type: 'response.output_text.delta', delta: JSON.stringify({ spam: 90, quality: 21, confidence: 91, constructive: false, postIds: ['100'], rationale: 'Powtarzalna próbka.' }) },
        { type: 'response.completed', response: { usage: { input_tokens: 17, output_tokens: 11 } } },
      ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const verify = vi.fn(async () => ({ sub: 'test-sub', label: 'Użytkownik testowy' }));
    const provider = new ChatGPTPlanProvider(db, cfg, new Vault(cfg.TOKEN_KEY), mock, verify);
    const state = opaque();
    await provider.connect(id, { state, code: 'single-test-code', client_id: 'oaiapp_issued_client' }, { verifier: 'pkce', nonce: 'oidc-nonce' });
    expect(verify).toHaveBeenCalledWith(data.id_token, 'oaiapp_issued_client', 'oidc-nonce');
    expect(new URLSearchParams(String(mock.mock.calls[0][1]?.body)).get('client_id')).toBe('oaiapp_issued_client');
    expect(await provider.listModels(id)).toEqual([{ id: 'test-model', label: 'Model testowy' }]);
    const { classify } = await import('../../server/classification.js');
    const rule = classify(examples.spam, settingsSchema.parse({}));
    expect(await provider.classify(id, archiveId, 'test-model', rule, examples.spam)).toMatchObject({ provider: 'chatgpt', model: 'test-model', aiStatus: 'evaluated' });
    const payload = JSON.parse(String(mock.mock.calls[2][1]?.body));
    expect(payload).toMatchObject({ store: false, stream: true, model: 'test-model' });
    expect(JSON.stringify(payload)).not.toContain(examples.spam.posts[0].text);
    const status = await provider.status(id);
    expect(status.lastUsage).toMatchObject({ input_tokens: 17, output_tokens: 11 });
    expect(JSON.stringify(status)).not.toContain(data.access_token);
  });

  it('wznawia od kursora, szanuje rate limit, zapisuje ślady analiz i używa cache', async () => {
    const fixtures = ['spam', 'critique', 'unavailable', 'cryptoSpam', 'dormant', 'replies'] as const;
    const profiles: XProfile[] = fixtures.map((key, index) => ({
      xId: String(50000 + index), username: key.toLowerCase(), name: key, bio: '', website: null,
      avatarUrl: null, openedAt: null, followers: null, follows: null, private: false, verified: false,
    }));
    const provider: XProvider = {
      following: vi.fn<XProvider['following']>().mockResolvedValueOnce({ profiles: profiles.slice(0, 3), next: 'second-page' })
        .mockRejectedValueOnce(new AppError(429, 'x_rate_limit', 'Limit X', new Date(Date.now() + 3 * 60000)))
        .mockResolvedValueOnce({ profiles: profiles.slice(3), next: null })
        .mockResolvedValue({ profiles, next: null }),
      timeline: vi.fn<XProvider['timeline']>().mockImplementation(async id => ({
        posts: examples[fixtures[Number(id) - 50000]].posts, partial: false,
      })),
      write: vi.fn<XProvider['write']>(),
    };
    await db.xAccount.update({ where: { id: liveId }, data: { settings: json(settingsSchema.parse({ whitelist: ['cryptospam'], liveReadsEnabled: true })) } });
    const create = () => new Scanner(db, () => provider, async () => {}, new ManualReviewProvider());
    const first = create();
    const [job, same] = await Promise.all([first.start(id, liveId, 'MANUAL'), first.start(id, liveId, 'MANUAL')]);
    expect(job?.id).toBe(same?.id);
    await first.tick();
    expect(await db.scanJob.findUnique({ where: { id: job!.id } })).toMatchObject({ cursor: 'second-page', pages: 1, seen: 3 });
    expect((await first.control(id, liveId, job!.id, 'pause')).state).toBe('PAUSED');
    expect(await first.tick()).toBe(false);
    await first.control(id, liveId, job!.id, 'resume');
    const restarted = create();
    await restarted.tick();
    expect(await db.scanJob.findUnique({ where: { id: job!.id } })).toMatchObject({ state: 'WAITING', cursor: 'second-page', attempts: 1 });
    expect(await restarted.tick()).toBe(false);
    await db.scanJob.update({ where: { id: job!.id }, data: { availableAt: new Date(0) } });
    await restarted.tick();
    await db.scanJob.update({ where: { id: job!.id }, data: { state: 'RUNNING', leaseUntil: new Date(0), leaseId: 'expired-fixture-worker' } });
    for (let i = 0; i < 7; i++) await restarted.tick();
    const complete = await db.scanJob.findUniqueOrThrow({ where: { id: job!.id } });
    expect(complete).toMatchObject({ state: 'COMPLETED', pages: 2, processed: 6, seen: 6 });
    expect(complete.summary).toMatchObject({ following: 6, analyzed: 6, protected: 1, candidates: 2, inactive: 1 });
    expect(vi.mocked(provider.following).mock.calls.map(call => call[1])).toEqual([null, 'second-page', 'second-page']);
    expect(provider.timeline).toHaveBeenCalledTimes(6);
    const candidates = (await app.inject({ url: '/api/accounts/' + liveId + '/profiles?view=candidate', headers })).json();
    expect(candidates.total).toBe(2);
    profileCandidateId = candidates.items.find((row: { username: string }) => row.username === 'spam').id;
    await restarted.start(id, liveId, 'MANUAL');
    for (let i = 0; i < 8; i++) await restarted.tick();
    expect(provider.timeline).toHaveBeenCalledTimes(6);
  });

  it('ponownie weryfikuje ochronę przed zapisem oraz wykonuje pojedynczy unfollow idempotentnie', async () => {
    const provider = { write: vi.fn<XProvider['write']>().mockResolvedValueOnce({ following: false, pendingFollow: false })
      .mockResolvedValueOnce({ following: false, pendingFollow: true }) } as unknown as XProvider;
    const service = new Cleanup(db, true, () => provider);
    const untouchable = await db.profile.findFirstOrThrow({ where: { accountId: liveId, username: 'cryptospam' } });
    const batch = await service.prepare(id, liveId, [profileCandidateId, untouchable.id], 'UNFOLLOW');
    expect(batch.total).toBe(1);
    const record = batch.items[0];
    const values = { operationId: record.id, username: record.username, confirm: 'UNFOLLOW' as const };
    await db.profile.update({ where: { id: profileCandidateId }, data: { preference: 'PROTECT' } });
    expect((await service.confirm(id, liveId, batch.id, values)).items[0].state).toBe('SKIPPED');
    expect(provider.write).not.toHaveBeenCalled();
    await db.profile.update({ where: { id: profileCandidateId }, data: { preference: null } });
    const newBatch = await service.prepare(id, liveId, [profileCandidateId], 'UNFOLLOW');
    const newValue = { ...values, operationId: newBatch.items[0].id };
    expect((await service.confirm(id, liveId, newBatch.id, newValue)).items[0].state).toBe('SUCCEEDED');
    expect((await service.confirm(id, liveId, newBatch.id, newValue)).items[0].state).toBe('SUCCEEDED');
    expect(provider.write).toHaveBeenCalledTimes(1);
    const follow = await service.prepare(id, liveId, [profileCandidateId], 'FOLLOW');
    expect((await service.confirm(id, liveId, follow.id, { ...values, operationId: follow.items[0].id, confirm: 'FOLLOW' })).items[0].result).toMatchObject({ pendingFollow: true });
    expect((await db.profile.findUniqueOrThrow({ where: { id: profileCandidateId } })).following).toBe(false);
  });

  it('weryfikuje kontrakt MCP przez SDK, izoluje token do konta i respektuje cofnięcie dostępu', async () => {
    const key = await app.inject({ method: 'POST', url: '/api/accounts/' + archiveId + '/mcp', headers, payload: { canPrepare: false } });
    expect(key.statusCode).toBe(200);
    mcpToken = key.json().token;
    const scanner = new Scanner(db, () => { throw Error('unused'); }, async () => {}, new ManualReviewProvider());
    const cleanup = new Cleanup(db, false, () => { throw Error('unused'); });
    const server = await makeMcp(db, scanner, cleanup, mcpToken);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-local', version: '1' });
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const tools = (await client.listTools()).tools.map(tool => tool.name);
      expect(tools).toContain('get_dashboard_summary');
      expect(tools).not.toContain('start_analysis_scan');
      expect(tools).not.toContain('unfollow');
      expect((await client.callTool({ name: 'list_x_accounts', arguments: {} })).structuredContent).toMatchObject({ accounts: [{ accountId: archiveId, mode: 'ARCHIVE' }] });
      expect((await client.callTool({ name: 'get_dashboard_summary', arguments: {} })).structuredContent).toMatchObject({ metrics: { following: 24 } });
      expect((await client.callTool({ name: 'get_account_analysis', arguments: { profileId: profileCandidateId } })).isError).toBe(true);
      const stored = await db.mcpKey.findFirstOrThrow({ where: { accountId: archiveId } });
      expect(stored.tokenHash).not.toBe(mcpToken);
      await app.inject({ method: 'DELETE', url: '/api/accounts/' + archiveId + '/mcp/' + stored.id, headers });
      expect((await client.callTool({ name: 'get_dashboard_summary', arguments: {} })).isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
