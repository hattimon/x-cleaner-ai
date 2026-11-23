import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LocalUser, PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { AppError, panelOrigin } from './config.js';
import { digest, opaque, secureEquals, verifyPassword } from './security.js';
import { audit, lock } from './db.js';
import { passwordLock, rotatePassword } from './local-account.js';

const cookieName = 'xc_session';
const sessionSeconds = 60 * 60 * 24 * 7;
const credentials = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/),
  password: z.string().min(1).max(256),
});
const passwordChange = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }).strict();
const usernameChange = z.object({ username: credentials.shape.username, currentPassword: passwordChange.shape.currentPassword }).strict();

export type Identity = { sessionId: string; userId: string; username: string; csrf: string; initialPassword: boolean };

export class Auth {
  constructor(private db: PrismaClient, private config: Config) {}
  async read(req: FastifyRequest): Promise<Identity | null> {
    const raw = req.cookies[cookieName];
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const session = await this.db.session.findFirst({
      where: { id: digest(raw), expiresAt: { gt: new Date() } },
      select: { id: true, userId: true, user: { select: { username: true, initialPassword: true } } },
    });
    return session ? { sessionId: session.id, userId: session.userId, ...session.user, csrf: digest('csrf:' + raw) } : null;
  }
  async require(req: FastifyRequest) {
    const identity = await this.read(req);
    if (!identity) throw new AppError(401, 'login_required', 'Zaloguj się do aplikacji.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      this.requireOrigin(req);
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !secureEquals(csrf, identity.csrf)) throw new AppError(403, 'csrf', 'Odśwież stronę i spróbuj ponownie.');
    }
    return identity;
  }
  requireOrigin(req: FastifyRequest) {
    const origin = this.panel(req);
    if (req.headers.origin !== origin) throw new AppError(403, 'origin', 'Otwórz formularz z adresu panelu i spróbuj ponownie.');
  }
  panel(req: FastifyRequest) {
    const origin = panelOrigin(this.config, req.headers.host);
    if (!origin) throw new AppError(403, 'origin', 'Otwórz panel przez localhost, prywatny adres IP lub skonfigurowany adres HTTPS.');
    return origin;
  }
  async issue(reply: FastifyReply, user: LocalUser, replacedId?: string) {
    const raw = opaque();
    await this.db.$transaction(async tx => {
      await lock(tx, passwordLock(user.id));
      const latest = await tx.localUser.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
      if (latest?.passwordHash !== user.passwordHash) throw new AppError(409, 'password_changed', 'Hasło uległo zmianie. Zaloguj się ponownie.');
      if (replacedId) await tx.session.deleteMany({ where: { id: replacedId, userId: user.id } });
      await tx.session.create({ data: { id: digest(raw), userId: user.id, expiresAt: new Date(Date.now() + sessionSeconds * 1000) } });
    });
    reply.setCookie(cookieName, raw, { httpOnly: true, sameSite: 'lax', secure: this.config.PUBLIC_ORIGIN.startsWith('https:'), path: '/', maxAge: sessionSeconds });
    return { user: { id: user.id, username: user.username, initialPassword: user.initialPassword }, csrf: digest('csrf:' + raw) };
  }
  routes(app: FastifyInstance) {
    const throttled = { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } };
    app.get('/api/session', async req => {
      const current = await this.read(req);
      return current
        ? { user: { id: current.userId, username: current.username, initialPassword: current.initialPassword }, csrf: current.csrf }
        : { user: null, csrf: null };
    });
    app.post('/api/session/login', throttled, async (req, reply) => {
      this.requireOrigin(req);
      const { username, password } = credentials.parse(req.body);
      const user = await this.db.localUser.findUnique({ where: { username } });
      if (!(await verifyPassword(password, user?.passwordHash)) || !user) throw new AppError(401, 'credentials', 'Nieprawidłowy login lub hasło.');
      const current = await this.read(req);
      return this.issue(reply, user, current?.sessionId);
    });
    app.post('/api/session/password', throttled, async (req, reply) => {
      const identity = await this.require(req);
      const { currentPassword, newPassword } = passwordChange.parse(req.body);
      const user = await this.db.localUser.findUniqueOrThrow({ where: { id: identity.userId } });
      if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError(400, 'current_password', 'Obecne hasło jest nieprawidłowe.');
      if (currentPassword === newPassword) throw new AppError(400, 'same_password', 'Wybierz inne hasło.');
      await rotatePassword(this.db, user.id, newPassword, false, user.passwordHash);
      reply.clearCookie(cookieName, { path: '/', secure: this.config.PUBLIC_ORIGIN.startsWith('https:') });
      return { ok: true };
    });
    app.post('/api/session/username', throttled, async req => {
      const identity = await this.require(req);
      const { username, currentPassword } = usernameChange.parse(req.body);
      const user = await this.db.localUser.findUniqueOrThrow({ where: { id: identity.userId } });
      if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError(400, 'current_password', 'Obecne hasło jest nieprawidłowe.');
      if (username === user.username) return { username };
      await this.db.$transaction(async tx => {
        await lock(tx, passwordLock(user.id));
        const duplicate = await tx.localUser.findUnique({ where: { username }, select: { id: true } });
        if (duplicate && duplicate.id !== user.id) throw new AppError(409, 'username_taken', 'Ta nazwa użytkownika jest zajęta.');
        const changed = await tx.localUser.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { username } });
        if (!changed.count) throw new AppError(409, 'password_changed', 'Hasło uległo zmianie. Zaloguj się ponownie.');
        await audit(tx, user.id, null, 'security.username_changed', 'Zmieniono nazwę lokalnego użytkownika.');
      });
      return { username };
    });
    app.post('/api/session/logout', async (req, reply) => {
      const identity = await this.require(req);
      await this.db.session.deleteMany({ where: { id: identity.sessionId } });
      reply.clearCookie(cookieName, { path: '/', secure: this.config.PUBLIC_ORIGIN.startsWith('https:') });
      return { ok: true };
    });
  }
}
