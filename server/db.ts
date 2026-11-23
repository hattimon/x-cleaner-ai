import { Prisma, PrismaClient } from '@prisma/client';
import type { XAccount } from '@prisma/client';
import { settingsSchema } from '../shared/contracts.js';
import { AppError } from './config.js';

export type Db = PrismaClient | Prisma.TransactionClient;
export const json = <T extends object>(data: T) => data as unknown as Prisma.InputJsonValue;
export const iso = (date: Date | null) => date?.toISOString() ?? null;
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
export const nextUtcDay = () => new Date(Date.parse(dayKey()) + 86400000);
export const settingsOf = (account: Pick<XAccount, 'settings'>) => settingsSchema.parse(account.settings ?? {});

export async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function ownedAccount(db: Db, userId: string, id: string) {
  const account = await db.xAccount.findFirst({ where: { id, userId } });
  if (!account) throw new AppError(404, 'account_missing', 'Konto jest niedostępne.');
  return account;
}

export function audit(db: Db, userId: string, accountId: string | null, kind: string, message: string, data?: Prisma.InputJsonValue) {
  return db.auditEvent.create({ data: { userId, accountId, kind, message, data } });
}

export async function reserveUsage(db: PrismaClient, id: string, provider: 'x' | 'x-write' | 'ai', milliUsd = 0) {
  return db.$transaction(async tx => {
    await lock(tx, 'usage:' + id);
    const account = await tx.xAccount.findUniqueOrThrow({ where: { id } });
    const settings = settingsOf(account);
    const day = dayKey();
    const where = { accountId_day: { accountId: id, day } };
    const used = await tx.usageDay.findUnique({ where });
    if (provider !== 'ai') {
      if (provider === 'x' && !settings.liveReadsEnabled) throw new AppError(403, 'live_reads_disabled', 'Włącz płatne odczyty X dla tego konta w ustawieniach.');
      if ((used?.xRequests ?? 0) >= settings.xDailyRequests || (used?.xMilliUsd ?? 0) + milliUsd > settings.xDailyBudgetCents * 10) {
        throw new AppError(429, 'x_budget', 'Osiągnięto dzienny limit aplikacji dla X API.', nextUtcDay());
      }
    } else if ((used?.aiRequests ?? 0) >= settings.aiDailyRequests) {
      throw new AppError(429, 'ai_budget', 'Osiągnięto dzienny limit wywołań AI.', nextUtcDay());
    }
    const delta = provider !== 'ai' ? { xRequests: 1, xMilliUsd: milliUsd, aiRequests: 0 } : { xRequests: 0, xMilliUsd: 0, aiRequests: 1 };
    await tx.usageDay.upsert({
      where, create: { accountId: id, day, ...delta },
      update: { xRequests: { increment: delta.xRequests }, xMilliUsd: { increment: delta.xMilliUsd }, aiRequests: { increment: delta.aiRequests } },
    });
  });
}
