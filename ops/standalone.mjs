import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { standaloneOwner } from './dist/server/local-account.js';

const directory = process.env.XC_STATE_DIR ?? '/var/lib/postgresql/data';
const data = join(directory, 'postgres');
const secretFile = join(directory, 'credentials.json');
const socket = '/tmp';
const children = new Set();
let stopping = false;

const exists = async path => access(path).then(() => true, () => false);
const secret = bytes => randomBytes(bytes).toString('base64url');
const spawnService = (file, args, extra = {}) => {
  const child = spawn(file, args, { stdio: 'inherit', ...extra });
  children.add(child);
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  }).finally(() => children.delete(child));
  return { child, result };
};
const run = async (file, args, extra) => {
  const status = await spawnService(file, args, extra).result;
  if (status !== 0) throw new Error(file + ' failed to initialize');
};
function required(file, args, extra) {
  const service = spawnService(file, args, extra);
  void service.result.then(() => {
    if (!stopping) { console.error(file + ' exited unexpectedly'); return shutdown(1); }
  }).catch(() => shutdown(1));
  return service;
}
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  for (let count = 0; children.size && count < 60; count++) await delay(100);
  for (const child of children) child.kill('SIGKILL');
  process.exitCode = code;
}
process.once('SIGTERM', () => void shutdown(0));
process.once('SIGINT', () => void shutdown(0));

try {
  await mkdir(data, { recursive: true, mode: 0o700 });
  if (!await exists(secretFile)) {
    const seed = secret(32);
    const owner = standaloneOwner(seed, 'admin');
    await writeFile(secretFile, JSON.stringify({ pg: secret(24), key: secret(32), seed, ownerName: owner.username }), { flag: 'wx', mode: 0o600 });
    // DCC Web's log viewer uses the generic key=value detector.
    console.log(`initial_credentials service=x-cleaner-ai login=${owner.username} password=${owner.password}`);
  }
  const { pg, key, seed, ownerName } = JSON.parse(await readFile(secretFile, 'utf8'));
  if (!/^[A-Za-z0-9_-]{32}$/.test(pg) || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Invalid persistent credential file');

  if (!await exists(join(data, 'PG_VERSION'))) {
    const passwordFile = join(directory, '.pg-init-password');
    await writeFile(passwordFile, pg + '\n', { mode: 0o600 });
    try {
      await run('initdb', ['-D', data, '-U', 'xcleaner', '--pwfile', passwordFile, '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8']);
    } finally { await rm(passwordFile, { force: true }); }
  }
  if (stopping) throw new Error('Interrupted');
  required('postgres', ['-D', data, '-h', '127.0.0.1', '-k', socket, '-c', 'unix_socket_permissions=0700']);
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    const probe = spawnService('pg_isready', ['-q', '-h', socket, '-U', 'xcleaner', '-d', 'postgres']);
    if (await probe.result === 0) { ready = true; break; }
    await delay(350);
  }
  if (!ready) throw new Error('PostgreSQL startup timed out');
  const probe = await spawnService('psql', ['-h', socket, '-U', 'xcleaner', '-d', 'xcleaner', '-qAtc', 'SELECT 1'], { stdio: 'ignore' }).result;
  if (probe !== 0) await run('createdb', ['-h', socket, '-U', 'xcleaner', 'xcleaner']);
  const env = {
    ...process.env, PORT: '3181', TOKEN_KEY: process.env.TOKEN_KEY || key,
    DATABASE_URL: `postgresql://xcleaner:${pg}@127.0.0.1:5432/xcleaner?connection_limit=8`,
  };
  await run('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env });
  if (stopping) throw new Error('Interrupted');
  required('node', ['dist/server/main.js'], { env: { ...env, XC_INITIAL_OWNER_SEED: seed, XC_INITIAL_OWNER_NAME: ownerName } });
  required('nginx', ['-e', '/dev/stderr', '-g', 'daemon off;']);
  if (seed) {
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      const ready = await fetch('http://127.0.0.1:3181/api/health', { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false);
      if (ready) {
        const partial = secretFile + '.new';
        await writeFile(partial, JSON.stringify({ pg, key }), { mode: 0o600 });
        await rename(partial, secretFile);
        break;
      }
      await delay(250);
    }
  }
} catch (failure) {
  if (!stopping) {
    console.error('X-Cleaner startup failed. Verify database state and volume permissions.');
    await shutdown(1);
  }
}
