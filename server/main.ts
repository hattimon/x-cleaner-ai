import { PrismaClient } from '@prisma/client';
import { readConfig } from './config.js';
import { makeApp } from './app.js';
import { ensureOwner, standaloneOwner } from './local-account.js';

const config = readConfig();
const db = new PrismaClient();
const { app, scanner } = await makeApp(db, config);
const seed = process.env.XC_INITIAL_OWNER_SEED;
delete process.env.XC_INITIAL_OWNER_SEED;
const initialOwner = seed && /^[A-Za-z0-9_-]{43}$/.test(seed) ? standaloneOwner(seed) : undefined;
const credentials = await ensureOwner(db, initialOwner);
if (credentials && !initialOwner) {
  app.log.info({ event: 'initial_credentials', service: 'x-cleaner-ai', login: credentials.username, ...credentials }, 'Initial application credentials');
}
await app.listen({ host: '0.0.0.0', port: config.PORT });
scanner.run();
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  await db.$disconnect();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
