import { z } from 'zod';

const loopback = ['localhost', '127.0.0.1', '[::1]'];
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
  ENABLE_CHATGPT_PLAN: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  MCP_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3181),
}).superRefine((env, ctx) => {
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.origin !== env.PUBLIC_ORIGIN || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback.includes(origin.hostname)))) {
    ctx.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'Oczekiwano lokalnego origin HTTP lub origin HTTPS.' });
  }
  const callback = new URL(env.SIWC_CALLBACK_ORIGIN);
  if (callback.origin !== env.SIWC_CALLBACK_ORIGIN || callback.hostname !== '127.0.0.1' || callback.protocol !== 'http:') {
    ctx.addIssue({ code: 'custom', path: ['SIWC_CALLBACK_ORIGIN'], message: 'Callback musi używać HTTP i 127.0.0.1.' });
  }
});

export type Config = z.infer<typeof envSchema>;
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
