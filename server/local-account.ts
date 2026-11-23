import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hashPassword, opaque } from './security.js';
import { audit, lock } from './db.js';
import { AppError } from './config.js';

export const passwordLock = (id: string) => 'local-password:' + id;

export async function ensureOwner(db: PrismaClient) {
  return db.$transaction(async tx => {
    await lock(tx, 'initialize-owner');
    if (await tx.localUser.findUnique({ where: { slot: true }, select: { id: true } })) return null;
    const username = 'admin-' + randomBytes(4).toString('hex');
    const password = opaque(24);
    const owner = await tx.localUser.create({ data: { username, passwordHash: await hashPassword(password), initialPassword: true } });
    await audit(tx, owner.id, null, 'security.setup', 'Utworzono lokalne konto właściciela z hasłem startowym.');
    return { username, password };
  });
}

export async function rotatePassword(db: PrismaClient, id: string, password: string, fromTerminal: boolean, expectedPasswordHash?: string) {
  const passwordHash = await hashPassword(password);
  return db.$transaction(async tx => {
    await lock(tx, passwordLock(id));
    const current = await tx.localUser.findUnique({ where: { id } });
    if (!current || (expectedPasswordHash && expectedPasswordHash !== current.passwordHash)) {
      throw new AppError(409, 'password_changed', 'Hasło uległo zmianie. Zaloguj się ponownie.');
    }
    const user = await tx.localUser.update({
      where: { id }, data: { passwordHash, initialPassword: fromTerminal },
    });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, id, null, 'security.password_changed', fromTerminal ? 'Zresetowano hasło właściciela z terminala.' : 'Zmieniono hasło właściciela.');
    return user;
  });
}
