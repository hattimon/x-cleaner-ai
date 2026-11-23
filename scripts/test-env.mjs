import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const fixture = new URL('../.local/', import.meta.url);
await mkdir(fixture, { recursive: true });
const secret = size => randomBytes(size).toString('base64url');
const content = [
  'APP_BIND=127.0.0.1',
  'APP_PORT=3182',
  'PUBLIC_ORIGIN=http://localhost:3182',
  'SIWC_CALLBACK_ORIGIN=http://127.0.0.1:3182',
  'ENABLE_CHATGPT_PLAN=true',
  'POSTGRES_PASSWORD=' + secret(24),
  'TOKEN_KEY=' + secret(32),
].join('\n') + '\n';
try { await writeFile(new URL('test.env', fixture), content, { mode: 0o600, flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
console.log('Zapisano konfigurację odizolowanych testów w .local/test.env.');
