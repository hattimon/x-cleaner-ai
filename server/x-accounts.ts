import type { PrismaClient, XAccount } from '@prisma/client';
import { z } from 'zod';
import type { Account, AccessState, Settings } from '../shared/contracts.js';
import { activeJobStates } from '../shared/contracts.js';
import type { Config } from './config.js';
import { AppError } from './config.js';
import { audit, iso, json, lock, ownedAccount, reserveUsage, settingsOf } from './db.js';
import { digest, Vault } from './security.js';
import { exchangeXCode, LiveXProvider, refreshX, revokeX, xCallback } from './x-provider.js';
import type { OAuthTokens, XProvider } from './x-provider.js';

const archiveIdentity = z.array(z.object({
  account: z.object({ accountId: z.string().regex(/^\d{1,24}$/), username: z.string().regex(/^[A-Za-z0-9_]{1,32}$/), accountDisplayName: z.string().max(120).optional() }),
})).length(1);
const archiveFollowing = z.array(z.object({ following: z.object({ accountId: z.string().regex(/^\d{1,24}$/) }) })).max(50000);

function archivePart(source: string, kind: 'account' | 'following') {
  const prefix = new RegExp('^\\s*(?:window\\.)?YTD\\.' + kind + '\\.part(\\d+)\\s*=\\s*');
  const match = prefix.exec(source.replace(/^\uFEFF/, ''));
  const content = (match ? source.replace(/^\uFEFF/, '').slice(match[0].length) : source).trim().replace(/;$/, '');
  try { return { part: Number(match?.[1] ?? 0), value: JSON.parse(content) as unknown }; }
  catch { throw new AppError(400, 'archive_format', 'Wybierz oryginalne pliki danych z rozpakowanego archiwum X.'); }
}
export function parseArchive(accountData: string, parts: string[]) {
  const identity = archiveIdentity.parse(archivePart(accountData, 'account').value)[0].account;
  const parsed = parts.map(part => archivePart(part, 'following')).sort((a, b) => a.part - b.part);
  if (parsed.some((p, index) => p.part !== index)) throw new AppError(400, 'archive_parts', 'Wskaż wszystkie części listy following, zaczynając od part0.');
  const ids = [...new Set(parsed.flatMap(part => archiveFollowing.parse(part.value).map(entry => entry.following.accountId)))];
  if (ids.length > 50000) throw new AppError(400, 'archive_size', 'Import obsługuje do 50 000 identyfikatorów.');
  return { identity, ids };
}

export function accountView(account: XAccount): Account {
  return {
    id: account.id, xId: account.xId, mode: account.mode, username: account.username, name: account.name,
    avatarUrl: account.avatarUrl, verified: account.verified, followingCount: account.followingCount, scopes: account.scopes,
    connected: account.mode === 'LIVE' && Boolean(account.encrypted) && account.connectionError !== 'x_unauthorized',
    connectionError: account.connectionError, settings: settingsOf(account), nextScanAt: iso(account.nextScanAt),
  };
}

const accessOperations = [
  { key: 'identity', label: 'Tożsamość konta', scopes: ['users.read', 'tweet.read'] },
  { key: 'following', label: 'Lista obserwowanych', scopes: ['follows.read', 'users.read', 'tweet.read'] },
  { key: 'timeline', label: 'Posty i odpowiedzi', scopes: ['tweet.read', 'users.read'] },
  { key: 'unfollow', label: 'Unfollow', scopes: ['follows.write', 'users.read', 'tweet.read'] },
  { key: 'follow', label: 'Ponowne follow', scopes: ['follows.write', 'users.read', 'tweet.read'] },
] as const;
const accessSchema = z.record(z.string(), z.object({ status: z.enum(['available', 'denied', 'limited', 'offline']), detail: z.string() }));
type Observation = z.infer<typeof accessSchema>[string];
const baseDetail: Record<AccessState, string> = {
  missing: 'Brak połączenia lub wymaganego uprawnienia.',
  unverified: 'Zakres OAuth jest przyznany. Dostęp do endpointu oczekuje na pierwsze wywołanie.',
  available: 'Ostatnie wywołanie zakończyło się powodzeniem.',
  denied: 'X odmówił dostępu.',
  limited: 'Limit wywołań lub kredytów.',
  offline: 'Niedostępne w trybie archiwum.',
};
const hasActiveOperations = (accountId: string) => ({ batch: { accountId }, state: 'IN_PROGRESS' as const });

export class XAccounts {
  constructor(private db: PrismaClient, private config: Config, private vault: Vault, private fetcher = fetch) {}

  async connect(userId: string, code: string, verifier: string) {
    const tokens = await exchangeXCode(this.config, code, verifier, this.fetcher);
    const profile = await new LiveXProvider(tokens.access_token, this.fetcher).me();
    const encrypted = this.vault.seal(tokens, 'x:' + userId + ':' + profile.xId);
    const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    const metadata = { name: profile.name, username: profile.username, avatarUrl: profile.avatarUrl, verified: profile.verified, followingCount: profile.follows };
    const authorization = {
      encrypted, scopes, expiresAt: new Date(Date.now() + tokens.expires_in * 1000), connectionError: null,
      capabilities: { identity: { status: 'available', detail: baseDetail.available } },
    };
    return this.db.$transaction(async tx => {
      await lock(tx, 'x-register:' + userId + ':' + profile.xId);
      const where = { userId_mode_xId: { userId, mode: 'LIVE' as const, xId: profile.xId } };
      const existing = await tx.xAccount.findUnique({ where });
      if (existing) {
        await lock(tx, 'account:' + existing.id);
        if (await tx.cleanupOperation.count({ where: hasActiveOperations(existing.id) })) throw new AppError(409, 'write_in_progress', 'Poczekaj na odpowiedź X dla aktualnej operacji.');
      }
      const account = await tx.xAccount.upsert({
        where, create: { userId, xId: profile.xId, mode: 'LIVE', ...metadata, ...authorization }, update: { ...metadata, ...authorization },
      });
      await audit(tx, userId, account.id, 'x.connected', 'Połączono konto X @' + account.username + '.');
      return accountView(account);
    });
  }

  async importArchive(userId: string, source: string, parts: string[]) {
    const { identity, ids } = parseArchive(source, parts);
    return this.db.$transaction(async tx => {
      await lock(tx, 'x-archive:' + userId + ':' + identity.accountId);
      const entry = { xId: identity.accountId, name: identity.accountDisplayName || identity.username, username: identity.username, followingCount: ids.length };
      const account = await tx.xAccount.upsert({
        where: { userId_mode_xId: { userId, mode: 'ARCHIVE', xId: identity.accountId } },
        create: { ...entry, userId, mode: 'ARCHIVE', scopes: [] }, update: entry,
      });
      await lock(tx, 'account:' + account.id);
      if (await tx.scanJob.count({ where: { accountId: account.id, state: { in: [...activeJobStates] } } })) {
        throw new AppError(409, 'scan_in_progress', 'Zakończ bieżące skanowanie przed kolejnym importem.');
      }
      await tx.profile.updateMany({ where: { accountId: account.id, following: true }, data: { following: false } });
      for (let index = 0; index < ids.length; index += 2000) {
        const page = ids.slice(index, index + 2000);
        await tx.profile.createMany({
          data: page.map(xId => ({
            xId, accountId: account.id, username: xId, name: 'Konto ' + xId,
            statusReason: 'Archiwum X zawiera identyfikator obserwowanego konta. Brak próbki publikacji.',
          })), skipDuplicates: true,
        });
        await tx.profile.updateMany({ where: { accountId: account.id, xId: { in: page } }, data: { following: true } });
      }
      await audit(tx, userId, account.id, 'x.archive', `Zaimportowano ${ids.length} obserwowanych z archiwum X.`);
      return accountView(account);
    }, { timeout: 45000 });
  }

  async assertScan(account: XAccount) {
    if (account.mode === 'ARCHIVE') return;
    if (!account.encrypted || account.connectionError === 'x_unauthorized') throw new AppError(409, 'x_disconnected', 'Połącz ponownie konto X w Integracjach.');
    if (!accessOperations[1].scopes.every(scope => account.scopes.includes(scope))) throw new AppError(403, 'x_missing_scope', 'Przyznaj zakresy odczytu obserwowanych, użytkowników i postów.');
    if (!settingsOf(account).liveReadsEnabled) throw new AppError(403, 'live_reads_disabled', 'Włącz odczyty X API i ustaw limit wydatków w Ustawieniach.');
  }

  async token(account: XAccount) {
    const context = 'x:' + account.userId + ':' + account.xId;
    return this.db.$transaction(async tx => {
      await lock(tx, 'account:' + account.id);
      const current = await ownedAccount(tx, account.userId, account.id);
      if (!current.encrypted || current.connectionError === 'x_unauthorized' || current.mode !== 'LIVE') return { error: true as const };
      const tokens = this.vault.open<OAuthTokens>(current.encrypted, context);
      if (current.expiresAt && current.expiresAt.getTime() > Date.now() + 60000) return { value: tokens.access_token };
      try {
        if (!tokens.refresh_token) throw new AppError(401, 'x_unauthorized', 'Brak tokena odświeżania.');
        const next = await refreshX(this.config, tokens.refresh_token, this.fetcher);
        await tx.xAccount.update({ where: { id: current.id }, data: {
          encrypted: this.vault.seal({ ...next, refresh_token: next.refresh_token ?? tokens.refresh_token }, context),
          expiresAt: new Date(Date.now() + next.expires_in * 1000), scopes: next.scope ? next.scope.split(/\s+/) : current.scopes,
          connectionError: null,
        } });
        return { value: next.access_token };
      } catch (error) {
        if (!(error instanceof AppError) || error.status === 429 || error.status >= 500) throw error;
        await tx.xAccount.update({ where: { id: current.id }, data: { connectionError: 'x_unauthorized' } });
        return { error: true as const };
      }
    }, { timeout: 15000 }).then(result => {
      if (result.error) throw new AppError(401, 'x_unauthorized', 'Wymagane ponowne połączenie konta X.');
      return result.value;
    });
  }

  async observe(account: XAccount, key: string, status: Observation['status'], detail: string) {
    // Update one JSON entry atomically so read and write observations do not clobber each other.
    const value = JSON.stringify({ status, detail });
    await this.db.$executeRaw`UPDATE "XAccount" SET capabilities = jsonb_set(capabilities, ARRAY[${key}], ${value}::jsonb, true) WHERE id = ${account.id}`;
  }

  private async invoke<T>(account: XAccount, operation: string, call: (provider: LiveXProvider) => Promise<T>) {
    try {
      const token = await this.token(account);
      const value = await call(new LiveXProvider(token, this.fetcher));
      await this.observe(account, operation, 'available', baseDetail.available);
      return value;
    } catch (error) {
      if (error instanceof AppError) {
        await this.observe(account, operation, error.status === 429 || error.status === 402 ? 'limited' : 'denied', error.message);
        if (error.code === 'x_unauthorized') await this.db.xAccount.updateMany({
          where: { id: account.id, encrypted: account.encrypted }, data: { connectionError: 'x_unauthorized' },
        });
      }
      throw error;
    }
  }
  provider(account: XAccount): XProvider {
    return {
      following: async (source, cursor, limit) => {
        await reserveUsage(this.db, account.id, 'x', limit * 10);
        return this.invoke(account, 'following', x => x.following(source, cursor, limit));
      },
      timeline: async (target, size) => {
        await reserveUsage(this.db, account.id, 'x', size * 5);
        return this.invoke(account, 'timeline', x => x.timeline(target, size));
      },
      write: (source, target, direction) => this.invoke(account, direction.toLowerCase(), x => x.write(source, target, direction)),
    };
  }

  async disconnect(userId: string, id: string) {
    const previous = await this.db.$transaction(async tx => {
      await lock(tx, 'account:' + id);
      const account = await ownedAccount(tx, userId, id);
      if (account.mode !== 'LIVE') throw new AppError(409, 'archive_account', 'Konto pochodzi z lokalnego archiwum.');
      if (await tx.cleanupOperation.count({ where: hasActiveOperations(id) })) throw new AppError(409, 'write_in_progress', 'Poczekaj na aktualną operację X.');
      await tx.scanJob.updateMany({
        where: { accountId: id, state: { in: [...activeJobStates] } },
        data: { state: 'CANCELLED', finishedAt: new Date(), leaseUntil: null, leaseId: null, message: 'Odłączono konto X.' },
      });
      await tx.xAccount.update({ where: { id }, data: { encrypted: null, expiresAt: null, scopes: [], nextScanAt: null, connectionError: null, capabilities: {} } });
      await audit(tx, userId, id, 'x.disconnected', 'Odłączono lokalne połączenie X.');
      return account;
    });
    if (!previous.encrypted) return { revoked: true };
    const tokens = this.vault.open<OAuthTokens>(previous.encrypted, 'x:' + userId + ':' + previous.xId);
    const results = await Promise.allSettled([
      ...(tokens.refresh_token ? [revokeX(this.config, tokens.refresh_token, 'refresh_token', this.fetcher)] : []),
      revokeX(this.config, tokens.access_token, 'access_token', this.fetcher),
    ]);
    return { revoked: results.every(result => result.status === 'fulfilled') };
  }

  diagnostics(account?: XAccount) {
    const observations = accessSchema.safeParse(account?.capabilities);
    return {
      configured: Boolean(this.config.X_CLIENT_ID), writeEnabled: this.config.X_ENABLE_WRITE, callback: xCallback(this.config),
      operations: accessOperations.map(operation => {
        let status: AccessState = 'unverified';
        const stored = observations.success ? observations.data[operation.key] : null;
        if (account?.mode === 'ARCHIVE') status = 'offline';
        else if (!account || !accountView(account).connected || operation.scopes.some(scope => !account.scopes.includes(scope))
          || (['unfollow', 'follow'].includes(operation.key) && !this.config.X_ENABLE_WRITE)) status = 'missing';
        else if (stored) status = stored.status;
        return { key: operation.label, status, detail: stored?.status === status ? stored.detail : baseDetail[status] };
      }),
    };
  }
}

export const exportConfig = (settings: Settings) => ({ version: 1, settings });
export const mcpTokenHash = (secret: string) => digest('mcp:' + secret);
