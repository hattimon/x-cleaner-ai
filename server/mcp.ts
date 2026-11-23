import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { decisions, dataStatuses, jobStates } from '../shared/contracts.js';
import { AppError } from './config.js';
import { audit, iso, json, ownedAccount } from './db.js';
import { detailProfile, listProfiles, metricsFor, scanView } from './profiles.js';
import { mcpTokenHash } from './x-accounts.js';
import type { Scanner } from './scanner.js';
import type { Cleanup } from './cleanup.js';

const uuid = z.uuid();
const count = z.number().int().nonnegative();
const mode = z.enum(['LIVE', 'ARCHIVE']);
const date = z.iso.datetime().nullable();
const scanOut = z.object({ id: uuid, state: z.enum(jobStates), phase: z.enum(['FOLLOWING', 'PROFILES']), seen: count, processed: count, pages: count, startedAt: date, finishedAt: date });
const profileOut = z.object({ id: uuid, xUserId: z.string(), decision: z.enum(decisions), confidence: count, spam: count.nullable(), quality: count.nullable(), lastActivity: date, status: z.enum(dataStatuses) });
const summaryOut = z.object({
  following: count, analyzed: count, active: count, occasional: count, inactive: count, spam: count, review: count,
  candidates: count, protected: count, unfollowed: count, coverage: count, decisions: z.record(z.enum(decisions), count), buckets: z.array(count),
});
const paging = { page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(50).default(20) };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const preparation = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const response = <T extends Record<string, unknown>>(value: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value,
});
function safeScan(value: ReturnType<typeof scanView> | null) {
  return value ? scanOut.parse(value) : null;
}
function safeProfile(value: Awaited<ReturnType<typeof detailProfile>>) {
  return profileOut.parse({
    id: value.id, xUserId: value.xId, decision: value.decision, confidence: value.confidence,
    spam: value.assessment?.spam_score ?? null, quality: value.assessment?.quality_score ?? null,
    lastActivity: value.lastActivity, status: value.status,
  });
}

export async function makeMcp(db: PrismaClient, scanner: Scanner, cleanup: Cleanup, token: string) {
  if (!/^xc_mcp_[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(401, 'mcp_token', 'Podaj klucz MCP w zmiennej MCP_TOKEN.');
  const tokenHash = mcpTokenHash(token);
  const findKey = () => db.mcpKey.findFirst({ where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } } });
  const initial = await findKey();
  if (!initial) throw new AppError(401, 'mcp_token', 'Klucz MCP wygasł lub został cofnięty.');
  const current = async (operation: string, needsPrepare = false) => {
    const key = await findKey();
    if (!key) throw new Error('Klucz MCP wygasł lub został cofnięty.');
    if (needsPrepare && !key.canPrepare) throw new Error('Klucz nie ma uprawnienia do przygotowania operacji.');
    const account = await ownedAccount(db, key.userId, key.accountId);
    await audit(db, key.userId, key.accountId, 'mcp.call', 'Wywołano narzędzie MCP ' + operation + '.', json({ tool: operation }));
    return account;
  };
  const server = new McpServer({ name: 'x-cleaner-ai', version: '0.1.1' });
  server.registerTool('list_x_accounts', {
    description: 'Lista kont X objętych uprawnieniem klucza.',
    inputSchema: {}, outputSchema: { accounts: z.array(z.object({ accountId: uuid, xUserId: z.string(), mode })) }, annotations: readOnly,
  }, async () => {
    const account = await current('list_x_accounts');
    return response({ accounts: [{ accountId: account.id, xUserId: account.xId, mode: account.mode }] });
  });
  server.registerTool('get_dashboard_summary', {
    description: 'Statystyki z wybranego konta X-Cleaner.',
    inputSchema: {}, outputSchema: { metrics: summaryOut }, annotations: readOnly,
  }, async () => response({ metrics: await metricsFor(db, await current('get_dashboard_summary')) }));
  server.registerTool('get_scan_status', {
    description: 'Status skanowania z wybranego konta.',
    inputSchema: { scanId: uuid.optional() }, outputSchema: { scan: scanOut.nullable() }, annotations: readOnly,
  }, async ({ scanId }) => {
    const account = await current('get_scan_status');
    const scan = await db.scanJob.findFirst({ where: { accountId: account.id, ...(scanId ? { id: scanId } : {}) }, orderBy: { createdAt: 'desc' } });
    return response({ scan: safeScan(scan ? scanView(scan) : null) });
  });
  for (const [name, view, decision] of [['list_unfollow_candidates', 'candidate', undefined], ['list_protected_accounts', 'kept', 'PROTECTED']] as const) {
    server.registerTool(name, {
      description: view === 'candidate' ? 'Rekomendacje unfollow oparte na aktualnych danych.' : 'Profile chronione przez właściciela.',
      inputSchema: paging, outputSchema: { profiles: z.array(profileOut), total: count }, annotations: readOnly,
    }, async ({ page, pageSize }) => {
      const account = await current(name);
      const result = await listProfiles(db, account, { view, decision, page, pageSize, q: '', sort: 'confidence' });
      return response({ profiles: result.items.map(item => safeProfile({ ...item, posts: [], history: [] })), total: result.total });
    });
  }
  server.registerTool('get_account_analysis', {
    description: 'Ocena profilu i identyfikatory dowodów z wybranego konta.',
    inputSchema: { profileId: uuid }, outputSchema: { profile: profileOut, evidence: z.array(z.object({ kind: z.string(), postId: z.string().optional() })) }, annotations: readOnly,
  }, async ({ profileId }) => {
    const account = await current('get_account_analysis');
    const detail = await detailProfile(db, account, profileId);
    return response({ profile: safeProfile(detail), evidence: detail.assessment?.evidence.map(({ kind, postId }) => ({ kind, postId })) ?? [] });
  });
  server.registerTool('get_audit_history', {
    description: 'Daty i typy zdarzeń z dziennika audytowego.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(20) }, outputSchema: { events: z.array(z.object({ kind: z.string(), at: date })) }, annotations: readOnly,
  }, async ({ limit }) => {
    const account = await current('get_audit_history');
    const events = await db.auditEvent.findMany({ where: { userId: account.userId, accountId: account.id }, take: limit, orderBy: { createdAt: 'desc' } });
    return response({ events: events.map(event => ({ kind: event.kind, at: iso(event.createdAt) })) });
  });
  if (initial.canPrepare) {
    server.registerTool('start_analysis_scan', {
      description: 'Zleca skan z limitami konta. Dla LIVE może wykorzystać kredyty X.',
      inputSchema: {}, outputSchema: { scan: scanOut.nullable() }, annotations: { ...preparation, idempotentHint: true, openWorldHint: true },
    }, async () => {
      const account = await current('start_analysis_scan', true);
      return response({ scan: safeScan(await scanner.start(account.userId, account.id, 'MCP')) });
    });
    server.registerTool('prepare_cleanup_review', {
      description: 'Tworzy podgląd do ręcznej weryfikacji w panelu.',
      inputSchema: { profileIds: z.array(uuid).min(1).max(100) }, outputSchema: { previewId: uuid, total: count, expiresAt: date }, annotations: preparation,
    }, async ({ profileIds }) => {
      const account = await current('prepare_cleanup_review', true);
      const batch = await cleanup.prepare(account.userId, account.id, profileIds, 'UNFOLLOW');
      return response({ previewId: batch.id, total: batch.total, expiresAt: batch.expiresAt });
    });
  }
  return server;
}
