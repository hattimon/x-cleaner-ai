import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);
const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const secret = (size) => randomBytes(size).toString('base64url');
const config = example.replace('POSTGRES_PASSWORD=', `POSTGRES_PASSWORD=${secret(24)}`)
  .replace('TOKEN_KEY=', `TOKEN_KEY=${secret(32)}`);
try {
  await writeFile(envFile, config, { flag: 'wx', mode: 0o600 });
  console.log(`Zapisano ${fileURLToPath(envFile)}. Login i hasło właściciela pojawią się w logach backendu po pierwszym uruchomieniu.`);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Plik .env już istnieje.');
}
