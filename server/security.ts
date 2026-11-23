import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
export const opaque = (size = 32) => randomBytes(size).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
export const secureEquals = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64, scryptOptions);
  return [salt, key].map(buffer => buffer.toString('base64url')).join('.');
}

export async function verifyPassword(password: string, stored?: string) {
  const [salt, encoded] = stored?.split('.') ?? [];
  const key = await derive(password, salt ? Buffer.from(salt, 'base64url') : Buffer.alloc(16), 64, scryptOptions);
  const expected = encoded ? Buffer.from(encoded, 'base64url') : Buffer.alloc(64);
  return timingSafeEqual(expected, key) && Boolean(stored);
}

export class Vault {
  private readonly key: Buffer;
  constructor(key: string) { this.key = Buffer.from(key, 'base64url'); }
  seal(data: unknown, context: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const payload = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), payload].map(part => part.toString('base64url')).join('.');
  }
  open<T>(sealed: string, context: string): T {
    const [iv, tag, payload] = sealed.split('.').map(part => Buffer.from(part, 'base64url'));
    const cipher = createDecipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(payload), cipher.final()]).toString('utf8')) as T;
  }
}
