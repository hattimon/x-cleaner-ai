import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const container = process.argv[2];
const origin = 'http://' + execFileSync('docker', ['port', container, '8080/tcp'], { encoding: 'utf8' }).trim();
let healthy = false;
for (let attempt = 0; attempt < 45 && !healthy; attempt++) {
  healthy = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }).then(response => response.ok, () => false);
  if (!healthy) await delay(1000);
}
assert(healthy, 'The packaged application did not become healthy');

const log = execFileSync('docker', ['logs', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const events = [...log.matchAll(/^initial_credentials service=x-cleaner-ai login=(admin) password=([A-Za-z0-9_-]{32})\r?$/gm)];
assert.equal(events.length, 1, 'The DCC log must contain one generated credential pair');
const [, username, password] = events[0];
const login = await fetch(origin + '/api/session/login', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200, 'The generated credentials must work on the published port');
const session = await login.json();
assert(session.user?.username === 'admin' && session.user.initialPassword, 'The initial password reminder must be active');
console.log('Packaged DCC install became healthy and accepted the generated credentials.');
