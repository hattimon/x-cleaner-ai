import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (!process.env.POSTGRES_PASSWORD || process.env.APP_PORT !== '3182') throw new Error('Uruchom oddzielny projekt x-cleaner-ai-test.');
const schema = 'xc_integration_' + randomBytes(5).toString('hex');
const url = `postgresql://xcleaner:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:55432/xcleaner?schema=${schema}`;
const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url };
function run(args) {
  const child = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status) process.exit(child.status);
}
run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts']);
