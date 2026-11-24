import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { apiProviders, preferences, profileQuerySchema, settingsSchema, xClientIdPattern } from '../shared/contracts.js';
import type { Config } from './config.js';
import { AppError } from './config.js';
import { Vault, opaque } from './security.js';
import { audit, dayKey, json, lock, ownedAccount, settingsOf } from './db.js';
import { Auth } from './auth.js';
import { XAccounts, accountView, exportConfig, mcpTokenHash } from './x-accounts.js';
import { xAuthorization } from './x-provider.js';
import { callbackQuery, OAuthAttempts } from './oauth.js';
import { ChatGPTPlanProvider, chatAuthorization, chatCallback, chatRedirect } from './ai-providers.js';
import { Scanner } from './scanner.js';
import { nextScheduled } from './scheduler.js';
import { Cleanup, confirmSchema, idSchema, prepareSchema } from './cleanup.js';
import { auditHistory, csvReport, dashboard, detailProfile, listProfiles, profileWhere, report, setPreference } from './profiles.js';
import { askAssistant } from './assistant.js';
import { AiProviders } from './external-ai.js';
import { apiKeySchema, IntegrationCredentials, xClientSchema } from './integration-credentials.js';

const accountParams = z.object({ accountId: idSchema });
const profileParams = accountParams.extend({ profileId: idSchema });
const scanParams = accountParams.extend({ scanId: idSchema });
const batchParams = accountParams.extend({ batchId: idSchema });
const receiptSchema = z.object({ receipt: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const prefSchema = z.enum(preferences).nullable();
const apiProviderParams = z.object({ provider: z.enum(apiProviders) });

export async function makeApp(db: PrismaClient, config: Config, fetcher = fetch, logger = true) {
  const app = Fastify({
    logger: logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] } : false,
    logController: new Fastify.LogController({ disableRequestLogging: true }), bodyLimit: 8 * 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      if (error.retryAt) reply.header('Retry-After', Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 1000)));
      if (error.status >= 500) req.log.warn({ route: req.routeOptions.url, code: error.code }, 'provider operation unavailable');
      return reply.status(error.status).send({ code: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      const field = error.issues[0]?.path.join('.');
      return reply.status(400).send({ code: 'validation', message: field ? `Sprawdź format pola „${field}”.` : 'Sprawdź format danych.' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ code: 'rate_limit', message: 'Zbyt wiele prób. Spróbuj za minutę.' });
    if (status === 413) return reply.status(413).send({ code: 'payload_limit', message: 'Przesłane dane przekraczają limit 8 MB.' });
    if (status && status < 500) return reply.status(status).send({ code: 'request', message: 'Żądanie ma nieprawidłowy format.' });
    req.log.error({ route: req.routeOptions.url, code: (error as { code?: string }).code, name: (error as Error).name }, 'internal operation failed');
    return reply.status(500).send({ code: 'internal', message: 'Nie udało się wykonać operacji. Spróbuj ponownie.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ code: 'route_not_found', message: 'Ta operacja jest niedostępna.' }));
  app.get('/api/health', async () => { await db.$queryRaw`SELECT 1`; return { status: 'ok' }; });

  const vault = new Vault(config.TOKEN_KEY);
  const auth = new Auth(db, config);
  const attempts = new OAuthAttempts(db, vault);
  const accounts = new XAccounts(db, config, vault, fetcher);
  const chat = new ChatGPTPlanProvider(db, config, vault, fetcher);
  const credentials = new IntegrationCredentials(db, config, vault);
  const ai = new AiProviders(db, credentials, chat, fetcher);
  const scanner = new Scanner(db, account => accounts.provider(account), account => accounts.assertScan(account), ai,
    code => app.log.warn({ code }, 'scan worker'));
  const cleanup = new Cleanup(db, async (userId, tx) => (await credentials.x(userId, undefined, tx)).X_ENABLE_WRITE, account => accounts.provider(account));
  auth.routes(app);

  app.get('/api/accounts', async req => {
    const { userId } = await auth.require(req);
    return (await db.xAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map(accountView);
  });
  app.post('/api/accounts/archive', async req => {
    const { userId } = await auth.require(req);
    const body = z.object({ account: z.string().min(2).max(8192), following: z.array(z.string().min(2).max(7500000)).min(1).max(100) }).parse(req.body);
    return accounts.importArchive(userId, body.account, body.following);
  });
  app.post('/api/accounts/:accountId/disconnect', async req => {
    const { userId } = await auth.require(req);
    return accounts.disconnect(userId, accountParams.parse(req.params).accountId);
  });
  app.get('/api/integrations', async req => {
    const { userId } = await auth.require(req);
    const panel = auth.panel(req);
    const { accountId } = accountParams.partial().parse(req.query);
    const [account, chatStatus, keys, xClient, apiStatus] = await Promise.all([
      accountId ? ownedAccount(db, userId, accountId) : Promise.resolve(undefined),
      chat.status(userId, panel),
      accountId && config.MCP_ENABLED ? db.mcpKey.findMany({
        where: { userId, accountId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, canPrepare: true, expiresAt: true },
      }) : Promise.resolve([]),
      credentials.x(userId, panel),
      credentials.apiStatus(userId),
    ]);
    return {
      x: accounts.diagnostics(xClient, account), chat: chatStatus,
      apiProviders: apiStatus.configured, storedApiKeys: apiStatus.stored,
      mcp: { enabled: config.MCP_ENABLED, keys: keys.map(key => ({ ...key, expiresAt: key.expiresAt.toISOString() })) },
    };
  });
  app.put('/api/integrations/x/client', async req => {
    const { userId } = await auth.require(req);
    await credentials.saveX(userId, xClientSchema.parse(req.body));
    return { ok: true };
  });
  app.post('/api/integrations/x/start', async req => {
    const identity = await auth.require(req);
    z.object({ acceptCosts: z.literal(true) }).parse(req.body);
    const xClient = await credentials.x(identity.userId, auth.panel(req));
    if (!xClientIdPattern.test(xClient.X_CLIENT_ID)) throw new AppError(409, 'x_not_configured', 'Dodaj identyfikator aplikacji X na ekranie Integracje.');
    const pending = await attempts.begin(identity, 'x', { xClient });
    return { url: xAuthorization(xClient, pending.state, pending.challenge) };
  });
  app.get('/api/integrations/x/callback', async (req, reply) => {
    const panel = auth.panel(req);
    const destination = panel + '/integracje?event=';
    try {
      const identity = await auth.require(req);
      const query = callbackQuery.parse(req.query);
      const { pending } = await attempts.consume(identity, 'x', query.state);
      if (query.error || !query.code) return reply.redirect(destination + 'x_cancelled', 303);
      if (pending.xClient && pending.xClient.PUBLIC_ORIGIN !== panel) throw new AppError(400, 'oauth_state', 'Wróć na adres panelu użyty do połączenia z X.');
      const connected = await accounts.connect(identity.userId, query.code, pending.verifier, pending.xClient);
      return reply.redirect(destination + 'x_connected&account=' + encodeURIComponent(connected.id), 303);
    } catch (error) {
      const code = error instanceof AppError && ['x_credits', 'x_forbidden', 'x_unauthorized', 'oauth_state'].includes(error.code) ? error.code : 'x_connect_error';
      return reply.redirect(destination + code, 303);
    }
  });

  app.post('/api/integrations/chatgpt/start', async req => {
    const identity = await auth.require(req);
    chat.requireEnabled();
    const redirect = chatRedirect(auth.panel(req));
    if (!redirect) throw new AppError(409, 'chat_callback', 'Aby połączyć ChatGPT, otwórz panel na localhost.');
    const [row, host] = await Promise.all([
      db.chatConnection.findUnique({ where: { userId: identity.userId }, select: { clientId: true, subject: true } }),
      chat.hostId(),
    ]);
    const pending = await attempts.begin(identity, 'chatgpt', { ...row, chat: redirect });
    return { url: chatAuthorization(config, host, pending) };
  });
  app.get('/api/integrations/chatgpt/callback', async (req, reply) => {
    chat.requireEnabled();
    const { receipt, panel } = await attempts.receiveChat(callbackQuery.parse(req.query), req.headers.host, {
      panel: config.PUBLIC_ORIGIN, callback: chatCallback(config),
    });
    return reply.redirect(panel + '/integracje?complete=' + receipt, 303);
  });
  app.post('/api/integrations/chatgpt/finish', async req => {
    const identity = await auth.require(req);
    const { receipt } = receiptSchema.parse(req.body);
    const { pending, result } = await attempts.consume(identity, 'chatgpt', receipt);
    if (!result) throw new AppError(400, 'chat_callback', 'Brak odpowiedzi ChatGPT.');
    await chat.connect(identity.userId, result, pending);
    return chat.status(identity.userId, auth.panel(req));
  });
  app.post('/api/integrations/chatgpt/disconnect', async req => {
    const { userId } = await auth.require(req);
    return chat.disconnect(userId, z.object({ forget: z.boolean().default(false) }).parse(req.body ?? {}).forget);
  });
  app.get('/api/integrations/chatgpt/models', async req => chat.listModels((await auth.require(req)).userId));
  app.put('/api/integrations/keys/:provider', async req => {
    const { userId } = await auth.require(req);
    const { provider } = apiProviderParams.parse(req.params);
    const { key } = apiKeySchema.parse(req.body);
    await credentials.saveApiKey(userId, provider, key);
    return { ok: true };
  });
  app.delete('/api/integrations/keys/:provider', async req => {
    const { userId } = await auth.require(req);
    await credentials.removeApiKey(userId, apiProviderParams.parse(req.params).provider);
    return { ok: true };
  });

  app.post('/api/accounts/:accountId/mcp', async req => {
    const { userId } = await auth.require(req);
    if (!config.MCP_ENABLED) throw new AppError(403, 'mcp_disabled', 'MCP jest wyłączone w konfiguracji serwera.');
    const { accountId } = accountParams.parse(req.params);
    const { canPrepare } = z.object({ canPrepare: z.boolean().default(false) }).parse(req.body ?? {});
    await ownedAccount(db, userId, accountId);
    const token = 'xc_mcp_' + opaque();
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    await db.$transaction(async tx => {
      await tx.mcpKey.create({ data: { userId, accountId, tokenHash: mcpTokenHash(token), expiresAt, canPrepare } });
      await audit(tx, userId, accountId, 'mcp.key_created', 'Utworzono dostęp MCP ograniczony do tego konta.');
    });
    return { token, expiresAt: expiresAt.toISOString() };
  });
  app.delete('/api/accounts/:accountId/mcp/:keyId', async req => {
    const { userId } = await auth.require(req);
    const { accountId, keyId } = accountParams.extend({ keyId: idSchema }).parse(req.params);
    await ownedAccount(db, userId, accountId);
    await db.$transaction(async tx => {
      const revoked = await tx.mcpKey.updateMany({ where: { id: keyId, accountId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (revoked.count) await audit(tx, userId, accountId, 'mcp.key_revoked', 'Cofnięto dostęp MCP.');
    });
    return { ok: true };
  });

  app.get('/api/accounts/:accountId/dashboard', async req => {
    const { userId } = await auth.require(req);
    return dashboard(db, await ownedAccount(db, userId, accountParams.parse(req.params).accountId));
  });
  app.get('/api/accounts/:accountId/history', async req => {
    const { userId } = await auth.require(req);
    return auditHistory(db, await ownedAccount(db, userId, accountParams.parse(req.params).accountId));
  });
  app.get('/api/accounts/:accountId/profiles', async req => {
    const { userId } = await auth.require(req);
    const account = await ownedAccount(db, userId, accountParams.parse(req.params).accountId);
    return listProfiles(db, account, profileQuerySchema.parse(req.query));
  });
  app.get('/api/accounts/:accountId/profiles/selection', async req => {
    const { userId } = await auth.require(req);
    const account = await ownedAccount(db, userId, accountParams.parse(req.params).accountId);
    const rows = await db.profile.findMany({ where: profileWhere(account, profileQuerySchema.parse(req.query)), select: { id: true }, take: 50001 });
    if (rows.length > 50000) throw new AppError(409, 'selection_limit', 'Zawęź wynik do 50 000 profili przy użyciu filtrów.');
    return { ids: rows.map(row => row.id) };
  });
  app.post('/api/accounts/:accountId/profiles/preferences', async req => {
    const { userId } = await auth.require(req);
    const { accountId } = accountParams.parse(req.params);
    const { ids, preference } = z.object({ ids: z.array(idSchema).min(1).max(50000), preference: z.enum(preferences) }).parse(req.body);
    const count = await db.$transaction(async tx => {
      await lock(tx, 'account:' + accountId);
      await ownedAccount(tx, userId, accountId);
      const unique = [...new Set(ids)];
      let changed = 0;
      for (let i = 0; i < unique.length; i += 1500) {
        const updated = await tx.profile.updateMany({ where: {
          accountId, id: { in: unique.slice(i, i + 1500) }, following: true,
          operations: { none: { state: 'IN_PROGRESS' } },
          ...(preference === 'PROTECT' || preference === 'EXCLUDE' ? {} : { OR: [{ preference: null }, { preference: { in: ['REVIEW', 'KEEP'] } }] }),
        }, data: { preference } });
        changed += updated.count;
      }
      await audit(tx, userId, accountId, 'profile.bulk_preference', `Zapisano lokalną decyzję właściciela dla ${changed} profili.`, json({ count: changed, preference }));
      return changed;
    }, { timeout: 22000 });
    return { count };
  });
  app.get('/api/accounts/:accountId/profiles/:profileId', async req => {
    const { userId } = await auth.require(req);
    const { accountId, profileId } = profileParams.parse(req.params);
    return detailProfile(db, await ownedAccount(db, userId, accountId), profileId);
  });
  app.put('/api/accounts/:accountId/profiles/:profileId/preference', async req => {
    const { userId } = await auth.require(req);
    const { accountId, profileId } = profileParams.parse(req.params);
    return setPreference(db, userId, accountId, profileId, z.object({ preference: prefSchema }).parse(req.body).preference);
  });
  app.post('/api/accounts/:accountId/scans', async req => {
    const { userId } = await auth.require(req);
    const { accountId } = accountParams.parse(req.params);
    return scanner.start(userId, accountId, 'MANUAL', z.object({ forceRefresh: z.boolean().default(false) }).parse(req.body ?? {}).forceRefresh);
  });
  app.post('/api/accounts/:accountId/scans/:scanId', async req => {
    const { userId } = await auth.require(req);
    const { accountId, scanId } = scanParams.parse(req.params);
    return scanner.control(userId, accountId, scanId, z.object({ action: z.enum(['pause', 'resume', 'cancel']) }).parse(req.body).action);
  });
  app.post('/api/accounts/:accountId/cleanup', async req => {
    const { userId } = await auth.require(req);
    const { accountId } = accountParams.parse(req.params);
    const { ids, direction } = prepareSchema.parse(req.body);
    return cleanup.prepare(userId, accountId, ids, direction);
  });
  app.get('/api/accounts/:accountId/cleanup', async req => {
    const { userId } = await auth.require(req);
    return cleanup.history(await ownedAccount(db, userId, accountParams.parse(req.params).accountId));
  });
  app.get('/api/accounts/:accountId/cleanup/:batchId', async req => {
    const { userId } = await auth.require(req);
    const { accountId, batchId } = batchParams.parse(req.params);
    const page = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query).page;
    return cleanup.get(userId, accountId, batchId, page);
  });
  app.post('/api/accounts/:accountId/cleanup/:batchId', async req => {
    const { userId } = await auth.require(req);
    const { accountId, batchId } = batchParams.parse(req.params);
    return cleanup.confirm(userId, accountId, batchId, confirmSchema.parse(req.body));
  });
  app.get('/api/accounts/:accountId/settings', async req => {
    const { userId } = await auth.require(req);
    const account = await ownedAccount(db, userId, accountParams.parse(req.params).accountId);
    const usage = await db.usageDay.findUnique({ where: { accountId_day: { accountId: account.id, day: dayKey() } }, select: { xRequests: true, xMilliUsd: true, aiRequests: true } });
    return { ...exportConfig(settingsOf(account)), usage };
  });
  app.put('/api/accounts/:accountId/settings', async req => {
    const { userId } = await auth.require(req);
    const { accountId } = accountParams.parse(req.params);
    const next = settingsSchema.parse(req.body);
    const before = await ownedAccount(db, userId, accountId);
    const current = settingsOf(before);
    if (next.aiProvider === 'chatgpt' && (next.aiModel !== current.aiModel || current.aiProvider !== 'chatgpt')) {
      const models = await chat.listModels(userId);
      if (!models.some(model => model.id === next.aiModel)) throw new AppError(400, 'chat_model', 'Wybierz dostępny model z katalogu połączonego konta.');
    }
    const external = apiProviders.find(provider => provider === next.aiProvider);
    if (external && (!next.aiPaidConsent || !/^[a-zA-Z0-9._:-]{1,100}$/.test(next.aiModel) || !await credentials.apiKey(userId, external))) {
      throw new AppError(400, 'ai_not_enabled', 'Skonfiguruj klucz API, podaj model i zaakceptuj rozliczane wywołania.');
    }
    if (next.scheduleEnabled && (before.mode !== 'LIVE' || !next.liveReadsEnabled)) {
      throw new AppError(400, 'schedule_requirements', 'Harmonogram wymaga konta LIVE z włączonym odczytem X API.');
    }
    const nextScanAt = next.scheduleEnabled && before.encrypted ? nextScheduled(next.scheduleTime, next.timeZone) : null;
    const account = await db.$transaction(async tx => {
      await lock(tx, 'account:' + accountId);
      const found = await ownedAccount(tx, userId, accountId);
      if (await tx.cleanupOperation.count({ where: { batch: { accountId }, state: 'IN_PROGRESS' } })) throw new AppError(409, 'write_in_progress', 'Zapisz ustawienia po zakończeniu operacji X.');
      const updated = await tx.xAccount.update({ where: { id: accountId }, data: { settings: json(next), nextScanAt: found.encrypted ? nextScanAt : null } });
      await audit(tx, userId, accountId, 'settings.updated', 'Zapisano ustawienia konta.');
      return updated;
    });
    return accountView(account);
  });
  app.get('/api/accounts/:accountId/report/:format', async (req, reply) => {
    const { userId } = await auth.require(req);
    const { accountId, format } = accountParams.extend({ format: z.enum(['csv', 'json']) }).parse(req.params);
    const account = await ownedAccount(db, userId, accountId);
    const data = await report(db, account);
    reply.header('Content-Disposition', 'attachment; filename="x-cleaner-report.' + format + '"');
    return format === 'csv' ? reply.type('text/csv; charset=utf-8').send('\uFEFF' + csvReport(data.profiles)) : data;
  });
  app.post('/api/accounts/:accountId/assistant', async req => {
    const { userId } = await auth.require(req);
    const { accountId } = accountParams.parse(req.params);
    const values = z.object({
      question: z.string().trim().min(2).max(1200), useModel: z.boolean().default(false),
      profileId: idSchema.optional(), language: z.enum(['en', 'pl']).default('en'),
    }).parse(req.body);
    return askAssistant(db, ai, await ownedAccount(db, userId, accountId), values);
  });

  app.addHook('onClose', async () => { await scanner.stop(); });
  return { app, scanner };
}
