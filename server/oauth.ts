import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from './auth.js';
import { AppError } from './config.js';
import { digest, opaque, Vault } from './security.js';

export const callbackQuery = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).max(2500).optional(),
  client_id: z.string().min(1).max(250).optional(),
  error: z.string().min(1).max(100).optional(),
});
export type Callback = z.infer<typeof callbackQuery>;
export type Pending = { verifier: string; nonce: string; clientId?: string; subject?: string };

export class OAuthAttempts {
  constructor(private db: PrismaClient, private vault: Vault) {}

  async begin(identity: Identity, provider: 'x' | 'chatgpt', existing?: { clientId: string; subject: string }) {
    const state = opaque();
    const stateHash = digest(state);
    const pending: Pending = { verifier: opaque(48), nonce: opaque(), ...existing };
    await this.db.$transaction([
      this.db.oAuthAttempt.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { provider, userId: identity.userId, sessionId: identity.sessionId }] } }),
      this.db.oAuthAttempt.create({ data: {
        provider, userId: identity.userId, sessionId: identity.sessionId, stateHash,
        encrypted: this.vault.seal(pending, 'oauth:' + stateHash), expiresAt: new Date(Date.now() + 10 * 60000),
      } }),
    ]);
    return { state, challenge: digest(pending.verifier), ...pending };
  }

  async receiveChat(query: Callback) {
    const stateHash = digest(query.state);
    const receipt = opaque();
    const { count } = await this.db.oAuthAttempt.updateMany({
      where: { stateHash, provider: 'chatgpt', expiresAt: { gt: new Date() }, receiptHash: null },
      data: { receiptHash: digest(receipt), result: this.vault.seal(query, 'receipt:' + stateHash) },
    });
    if (!count) throw new AppError(400, 'oauth_state', 'Sesja OAuth wygasła lub została już wykorzystana.');
    return receipt;
  }

  async consume(identity: Identity, provider: 'x' | 'chatgpt', secret: string) {
    const where = {
      userId: identity.userId, sessionId: identity.sessionId, provider, expiresAt: { gt: new Date() },
      ...(provider === 'x' ? { stateHash: digest(secret) } : { receiptHash: digest(secret) }),
    };
    return this.db.$transaction(async tx => {
      const attempt = await tx.oAuthAttempt.findFirst({ where });
      if (!attempt || !(await tx.oAuthAttempt.deleteMany({ where })).count) {
        throw new AppError(400, 'oauth_state', 'Brak aktywnej sesji OAuth dla tego logowania.');
      }
      return {
        pending: this.vault.open<Pending>(attempt.encrypted, 'oauth:' + attempt.stateHash),
        result: attempt.result ? this.vault.open<Callback>(attempt.result, 'receipt:' + attempt.stateHash) : null,
      };
    });
  }
}
