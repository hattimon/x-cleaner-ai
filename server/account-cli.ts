import { PrismaClient } from '@prisma/client';
import { AppError } from './config.js';
import { rotatePassword } from './local-account.js';
import { opaque } from './security.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.argv[2] !== 'reset-password' || process.argv.slice(3).some(arg => arg !== '--json')) {
  console.error('Użycie: node dist/server/account-cli.js reset-password [--json]');
  process.exit(2);
}

let db: PrismaClient | undefined;
try {
  let datasourceUrl = process.env.DATABASE_URL;
  if (!datasourceUrl && process.env.XC_STATE_DIR) {
    const { pg } = JSON.parse(await readFile(join(process.env.XC_STATE_DIR, 'credentials.json'), 'utf8'));
    if (typeof pg !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(pg)) throw new Error('Invalid persistent credential');
    datasourceUrl = 'postgresql://xcleaner:' + pg + '@127.0.0.1:5432/xcleaner';
  }
  db = new PrismaClient({ datasourceUrl });
  const owner = await db.localUser.findUnique({ where: { slot: true }, select: { id: true, username: true } });
  if (!owner) throw new AppError(404, 'owner_missing', 'Uruchom backend, żeby utworzyć konto właściciela.');
  const password = opaque(24);
  await rotatePassword(db, owner.id, password, true);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ username: owner.username, password }));
  else console.log('Login: ' + owner.username + '\nNowe hasło: ' + password + '\nPoprzednie sesje zostały zakończone.');
} catch (error) {
  console.error(error instanceof AppError ? error.message : 'Reset hasła się nie powiódł. Sprawdź stan usług backend i db.');
  process.exitCode = 1;
} finally { await db?.$disconnect(); }
