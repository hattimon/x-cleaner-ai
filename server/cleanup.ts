import type { Prisma, PrismaClient, Profile, XAccount } from '@prisma/client';
import type { Cleanup as CleanupView, CleanupHistory } from '../shared/contracts.js';
import { actions, activeJobStates } from '../shared/contracts.js';
import { z } from 'zod';
import { AppError } from './config.js';
import { audit, json, lock, ownedAccount, reserveUsage, settingsOf } from './db.js';
import { isProtected } from './classification.js';
import { profileView } from './profiles.js';
import type { XProvider } from './x-provider.js';

export const idSchema = z.uuid();
const targets = z.array(idSchema).min(1).max(50000);
export const prepareSchema = z.object({ ids: targets, direction: z.enum(actions).default('UNFOLLOW') });
export const confirmSchema = z.object({ operationId: idSchema, confirm: z.enum(actions), username: z.string().min(1).max(32) }).strict();
const include = { operations: { include: { profile: true }, orderBy: { id: 'asc' as const }, take: 100, }, _count: { select: { operations: true } } };
type Batch = Prisma.CleanupBatchGetPayload<{ include: typeof include }>;
type Direction = typeof actions[number];
const result = z.object({ message: z.string().optional(), following: z.boolean().optional(), pendingFollow: z.boolean().optional() });

export class Cleanup {
  constructor(private db: PrismaClient, private writeEnabled: boolean, private provider: (account: XAccount) => XProvider) {}

  private view(batch: Batch, account: XAccount): CleanupView {
    return {
      id: batch.id, direction: batch.direction, mode: account.mode, expiresAt: batch.expiresAt.toISOString(), total: batch._count.operations,
      items: batch.operations.map(item => ({
        id: item.id, profileId: item.profileId, name: item.profile.name, username: item.profile.username,
        state: item.state, result: result.safeParse(item.result).data ?? null,
      })),
    };
  }
  private allowed(profile: Profile, account: XAccount, direction: Direction) {
    if (account.mode !== 'LIVE' || account.xId === profile.xId) return false;
    if (direction === 'FOLLOW') return !profile.following;
    return profile.following && profileView(profile, account).decision === 'UNFOLLOW_CANDIDATE'
      && profileView(profile, account).status === 'scanned' && !isProtected(profile.username, profile.preference, settingsOf(account));
  }
  private async verifiedPrevious(db: Prisma.TransactionClient, accountId: string, profileId: string, mode: Direction) {
    if (mode !== 'FOLLOW') return true;
    return Boolean(await db.cleanupOperation.findFirst({ where: { batch: { accountId, direction: 'UNFOLLOW' }, profileId, state: 'SUCCEEDED' }, select: { id: true } }));
  }

  async prepare(userId: string, accountId: string, ids: string[], direction: Direction) {
    return this.db.$transaction(async tx => {
      await lock(tx, 'account:' + accountId);
      const account = await ownedAccount(tx, userId, accountId);
      if (account.mode !== 'LIVE') throw new AppError(403, 'archive_read_only', 'Archiwum umożliwia lokalną ocenę. Do zmiany obserwowania otwórz profil w X.');
      const unique = [...new Set(ids)];
      if (direction === 'FOLLOW' && unique.length > 1) throw new AppError(400, 'follow_single', 'Wybierz jeden profil, żeby ponownie go zaobserwować.');
      const valid: string[] = [];
      for (let offset = 0; offset < unique.length; offset += 1500) {
        const selected = await tx.profile.findMany({ where: { accountId, id: { in: unique.slice(offset, offset + 1500) } } });
        for (const row of selected) if (this.allowed(row, account, direction) && await this.verifiedPrevious(tx, accountId, row.id, direction)) valid.push(row.id);
      }
      if (!valid.length) throw new AppError(409, 'no_eligible_profiles', 'Żaden z wybranych profili nie ma aktualnej i dozwolonej rekomendacji.');
      const batch = await tx.cleanupBatch.create({ data: { accountId, direction, expiresAt: new Date(Date.now() + 30 * 60000) } });
      for (let offset = 0; offset < valid.length; offset += 1500) await tx.cleanupOperation.createMany({
        data: valid.slice(offset, offset + 1500).map(profileId => ({ batchId: batch.id, profileId })),
      });
      await audit(tx, userId, account.id, 'cleanup.prepared', `Przygotowano podgląd dla ${valid.length} profili.`, json({ batchId: batch.id, direction }));
      return this.view(await tx.cleanupBatch.findUniqueOrThrow({ where: { id: batch.id }, include }), account);
    }, { timeout: 22000 });
  }

  async get(userId: string, accountId: string, batchId: string, page = 1) {
    const account = await ownedAccount(this.db, userId, accountId);
    const batch = await this.db.cleanupBatch.findFirst({ where: { id: batchId, accountId }, include: {
      ...include, operations: { ...include.operations, skip: (page - 1) * 100 },
    } });
    if (!batch) throw new AppError(404, 'batch_missing', 'Podgląd operacji jest niedostępny.');
    return this.view(batch, account);
  }

  async history(account: XAccount): Promise<CleanupHistory[]> {
    const batches = await this.db.cleanupBatch.findMany({
      where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 30, include: {
        ...include, operations: { where: { state: { not: 'PREPARED' } }, include: { profile: true }, orderBy: { updatedAt: 'desc' }, take: 8 },
      },
    });
    return batches.map(batch => {
      const view = this.view(batch, account);
      return { id: view.id, direction: view.direction, total: view.total, createdAt: batch.createdAt.toISOString(), expiresAt: view.expiresAt, results: view.items };
    });
  }

  async confirm(userId: string, accountId: string, batchId: string, input: z.infer<typeof confirmSchema>) {
    const slot = await this.db.$transaction(async tx => {
      await lock(tx, 'account:' + accountId);
      const account = await ownedAccount(tx, userId, accountId);
      const operation = await tx.cleanupOperation.findFirst({
        where: { id: input.operationId, batchId, batch: { accountId }, profile: { accountId } },
        include: { batch: true, profile: true },
      });
      if (!operation) throw new AppError(404, 'operation_missing', 'Operacja jest niedostępna.');
      if (operation.state !== 'PREPARED') return null;
      const { batch, profile } = operation;
      if (batch.direction !== input.confirm || profile.username !== input.username) throw new AppError(400, 'confirmation', 'Potwierdzenie nie odpowiada wybranemu profilowi.');
      if (batch.expiresAt.getTime() <= Date.now()) throw new AppError(409, 'preview_expired', 'Podgląd wygasł. Przygotuj go ponownie.');
      if (!this.writeEnabled || !account.encrypted || account.connectionError === 'x_unauthorized' ||
          !['follows.write', 'users.read', 'tweet.read'].every(scope => account.scopes.includes(scope))) {
        throw new AppError(403, 'x_writes_disabled', 'Włącz zapis X i połącz konto z uprawnieniem follows.write.');
      }
      if (await tx.scanJob.count({ where: { accountId, state: { in: [...activeJobStates] } } })) throw new AppError(409, 'scan_in_progress', 'Poczekaj na zakończenie skanowania.');
      if (await tx.cleanupOperation.count({ where: { batch: { accountId }, state: 'IN_PROGRESS' } })) throw new AppError(409, 'write_in_progress', 'Poczekaj na wynik poprzedniej operacji.');
      const unresolved = await tx.cleanupOperation.findFirst({ where: { batch: { accountId }, profileId: profile.id, state: 'UNCERTAIN' }, orderBy: { updatedAt: 'desc' } });
      if (unresolved && !await tx.scanJob.count({ where: { accountId, state: 'COMPLETED', startedAt: { gt: unresolved.updatedAt } } })) {
        throw new AppError(409, 'uncertain_x_write', 'Wynik poprzedniej próby jest niepewny. Odśwież listę obserwowanych.');
      }
      if (batch.direction === 'FOLLOW') {
        const previous = await tx.cleanupOperation.findFirst({
          where: { batch: { accountId }, profileId: profile.id, state: 'SUCCEEDED' }, orderBy: { updatedAt: 'desc' }, include: { batch: true },
        });
        if (previous?.batch.direction === 'FOLLOW' && result.safeParse(previous.result).data?.pendingFollow) {
          throw new AppError(409, 'private_follow_pending', 'Ostatnia prośba oczekuje na decyzję konta prywatnego. Sprawdź jej stan w X.');
        }
      }
      if (!(this.allowed(profile, account, batch.direction) && await this.verifiedPrevious(tx, accountId, profile.id, batch.direction))) {
        await tx.cleanupOperation.update({ where: { id: operation.id }, data: { state: 'SKIPPED', result: { message: 'Zmieniła się rekomendacja, lista lub ochrona profilu.' } } });
        await audit(tx, userId, accountId, 'cleanup.skipped', 'Pominięto profil, który przestał spełniać warunki.', json({ operationId: operation.id }));
        return null;
      }
      await tx.cleanupOperation.update({ where: { id: operation.id }, data: { state: 'IN_PROGRESS' } });
      await audit(tx, userId, accountId, 'cleanup.confirmed', `Użytkownik potwierdził ${batch.direction.toLowerCase()} dla @${profile.username}.`, json({ operationId: operation.id }));
      return { account, operation, batch, profile };
    });
    if (!slot) return this.get(userId, accountId, batchId);

    let outcome: Prisma.CleanupOperationUpdateInput;
    let following: boolean | undefined;
    try {
      await reserveUsage(this.db, accountId, 'x-write', slot.batch.direction === 'FOLLOW' ? 15 : 10);
      const response = await this.provider(slot.account).write(slot.account.xId, slot.profile.xId, slot.batch.direction);
      const matched = slot.batch.direction === 'UNFOLLOW' ? !response.following && !response.pendingFollow : response.following || response.pendingFollow;
      const message = response.pendingFollow ? 'Prośba oczekuje na akceptację konta prywatnego.'
        : matched ? 'X potwierdził zmianę.' : 'X zwrócił stan niezgodny z żądaniem.';
      outcome = { state: matched ? 'SUCCEEDED' : 'FAILED', result: json({ ...response, message }) };
      if (matched && !response.pendingFollow) following = response.following;
    } catch (error) {
      const trusted = error instanceof AppError;
      outcome = {
        state: !trusted || error.status >= 500 ? 'UNCERTAIN' : 'FAILED',
        result: json({ message: trusted ? error.message : 'Wynik zapisu wymaga sprawdzenia w X.' }),
      };
    }
    await this.db.$transaction(async tx => {
      await lock(tx, 'account:' + accountId);
      const applied = await tx.cleanupOperation.updateMany({ where: { id: slot.operation.id, state: 'IN_PROGRESS' }, data: outcome as Prisma.CleanupOperationUpdateManyMutationInput });
      if (!applied.count) return;
      if (following !== undefined) {
        await tx.profile.update({ where: { id: slot.profile.id }, data: { following } });
        const total = await tx.profile.count({ where: { accountId, following: true } });
        await tx.xAccount.update({ where: { id: accountId }, data: { followingCount: total } });
      }
      await audit(tx, userId, accountId, 'cleanup.' + String(outcome.state).toLowerCase(),
        `Zapisano wynik operacji na @${slot.profile.username}.`, json({ operationId: slot.operation.id, result: outcome.result }));
    });
    return this.get(userId, accountId, batchId);
  }
}
