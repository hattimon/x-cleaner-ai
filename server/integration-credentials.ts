import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { apiProviders } from '../shared/contracts.js';
import type { ApiProvider } from '../shared/contracts.js';
import type { Config } from './config.js';
import { audit, lock } from './db.js';
import type { Vault } from './security.js';
import type { XOAuthConfig } from './x-provider.js';

export const xClientSchema = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,250}$/),
  clientSecret: z.string().trim().max(512).optional(),
  writeEnabled: z.boolean().default(false),
}).strict();
export const apiKeySchema = z.object({ key: z.string().trim().regex(/^[!-~]{8,512}$/) }).strict();

type XClientInput = z.infer<typeof xClientSchema>;
type XClient = Required<XClientInput>;
type Provider = 'x' | ApiProvider;

export class IntegrationCredentials {
  private readonly apiDefaults: Record<ApiProvider, string>;

  constructor(private db: PrismaClient, private config: Config, private vault: Vault) {
    this.apiDefaults = { openai: config.OPENAI_API_KEY, anthropic: config.ANTHROPIC_API_KEY, gemini: config.GEMINI_API_KEY };
  }

  private associatedData(userId: string, provider: Provider) {
    return 'integration:' + userId + ':' + provider;
  }

  private async read<T>(userId: string, provider: Provider, db: Prisma.TransactionClient = this.db) {
    const saved = await db.integrationCredential.findUnique({ where: { userId_provider: { userId, provider } } });
    return saved ? this.vault.open<T>(saved.encrypted, this.associatedData(userId, provider)) : undefined;
  }

  private async save(userId: string, provider: Provider, value: (tx: Prisma.TransactionClient) => XClient | string | Promise<XClient | string>) {
    await this.db.$transaction(async tx => {
      await lock(tx, this.associatedData(userId, provider));
      const encrypted = this.vault.seal(await value(tx), this.associatedData(userId, provider));
      await tx.integrationCredential.upsert({
        where: { userId_provider: { userId, provider } },
        create: { userId, provider, encrypted }, update: { encrypted },
      });
      await audit(tx, userId, null, 'integration.saved', 'Zapisano konfigurację integracji ' + provider + '.');
    });
  }

  async x(userId: string, origin = this.config.PUBLIC_ORIGIN, db: Prisma.TransactionClient = this.db): Promise<XOAuthConfig> {
    const value = await this.read<XClient>(userId, 'x', db);
    return {
      PUBLIC_ORIGIN: origin,
      X_CLIENT_ID: value?.clientId ?? this.config.X_CLIENT_ID,
      X_CLIENT_SECRET: value?.clientSecret ?? this.config.X_CLIENT_SECRET,
      X_ENABLE_WRITE: value?.writeEnabled ?? this.config.X_ENABLE_WRITE,
    };
  }

  async saveX(userId: string, input: XClientInput) {
    await this.save(userId, 'x', async tx => {
      const before = await this.x(userId, undefined, tx);
      const previousSecret = before.X_CLIENT_ID === input.clientId ? before.X_CLIENT_SECRET : '';
      return { ...input, clientSecret: input.clientSecret ?? previousSecret };
    });
  }

  async apiStatus(userId: string) {
    const rows = await this.db.integrationCredential.findMany({
      where: { userId, provider: { in: [...apiProviders] } }, select: { provider: true },
    });
    const stored = apiProviders.filter(provider => rows.some(row => row.provider === provider));
    return {
      stored,
      configured: {
        openai: stored.includes('openai') || Boolean(this.apiDefaults.openai),
        anthropic: stored.includes('anthropic') || Boolean(this.apiDefaults.anthropic),
        gemini: stored.includes('gemini') || Boolean(this.apiDefaults.gemini),
      },
    };
  }

  async apiKey(userId: string, provider: ApiProvider) {
    return await this.read<string>(userId, provider) ?? this.apiDefaults[provider];
  }

  saveApiKey(userId: string, provider: ApiProvider, key: string) {
    return this.save(userId, provider, () => key);
  }

  async removeApiKey(userId: string, provider: ApiProvider) {
    await this.db.$transaction(async tx => {
      await lock(tx, this.associatedData(userId, provider));
      const { count } = await tx.integrationCredential.deleteMany({ where: { userId, provider } });
      if (count) await audit(tx, userId, null, 'integration.removed', 'Usunięto klucz API integracji ' + provider + '.');
    });
  }
}
