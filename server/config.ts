import { z } from 'zod';
import { isIP } from 'node:net';

const loopback = ['localhost', '127.0.0.1', '[::1]'];
export const isPanelLoopback = (hostname: string) => loopback.includes(hostname);

function isLocalPanelHost(hostname: string) {
  if (isPanelLoopback(hostname)) return true;
  if (hostname.startsWith('[')) return /^\[f[cd][0-9a-f]{2}:/i.test(hostname) && isIP(hostname.slice(1, -1)) === 6;
  if (isIP(hostname) !== 4) return false;
  const [first, second] = hostname.split('.').map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TOKEN_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(key => Buffer.from(key, 'base64url').length === 32),
  PUBLIC_ORIGIN: z.url().default('http://localhost:3180'),
  SIWC_CALLBACK_ORIGIN: z.url().default('http://127.0.0.1:3180'),
  X_CLIENT_ID: z.string().default(''),
  X_CLIENT_SECRET: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  X_ENABLE_WRITE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  ENABLE_CHATGPT_PLAN: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  MCP_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3181),
}).superRefine((env, ctx) => {
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.origin !== env.PUBLIC_ORIGIN || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLocalPanelHost(origin.hostname)))) {
    ctx.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'Oczekiwano lokalnego adresu HTTP lub adresu HTTPS.' });
  }
  const callback = new URL(env.SIWC_CALLBACK_ORIGIN);
  if (callback.origin !== env.SIWC_CALLBACK_ORIGIN || callback.hostname !== '127.0.0.1' || callback.protocol !== 'http:') {
    ctx.addIssue({ code: 'custom', path: ['SIWC_CALLBACK_ORIGIN'], message: 'Callback musi używać HTTP i 127.0.0.1.' });
  }
});

export type Config = z.infer<typeof envSchema>;

export function panelOrigin(config: Pick<Config, 'PUBLIC_ORIGIN'>, host?: string) {
  if (!host || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(host)) return undefined;
  const configured = new URL(config.PUBLIC_ORIGIN);
  if (configured.host === host.toLowerCase()) return config.PUBLIC_ORIGIN;
  if (configured.protocol !== 'http:') return undefined;
  try {
    const candidate = new URL('http://' + host);
    if (candidate.host === host.toLowerCase() && isLocalPanelHost(candidate.hostname)) return candidate.origin;
  } catch { /* Invalid host or port. */ }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error('Błędna konfiguracja: ' + parsed.error.issues.map(issue => issue.path.join('.')).join(', '));
  return parsed.data;
}

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAt?: Date) {
    super(message);
  }
}
