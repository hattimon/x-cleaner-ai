# Test report

## Windows validation

| Check | Result |
| --- | --- |
| TypeScript and Vite | Backend and frontend compile. |
| Vitest | 13 unit tests and 11 PostgreSQL integration tests passed. |
| Playwright | 5 E2E tests passed in Chrome, at 1440 px desktop and 390 px mobile widths. |
| Docker targets | The release workflow builds backend, frontend and standalone images for linux/amd64 and linux/arm64. |
| Standalone DCC image | Each architecture must pass a fresh installation and sign-in using the generated credentials before the combined tag is published. |
| DCC catalog | Verified ARM64 support, the existing volume binding and detection of both bootstrap login formats. |

The validation suite uses a separate Compose project named `x-cleaner-ai-test`. Its PostgreSQL port binds only to loopback. Vitest creates an isolated database schema. Playwright signs in with a disposable account and imports a synthetic archive fixture into that test stack. The installed application starts with user data only after import or external connection.

```powershell
npm ci
npm run build
npm test
docker compose build
node scripts/test-env.mjs
docker compose --env-file .local/test.env -p x-cleaner-ai-test -f compose.yaml -f ops/compose.test.yaml up -d --no-build --wait
npm run test:integration
./scripts/test-browser.ps1
docker compose --env-file .local/test.env -p x-cleaner-ai-test -f compose.yaml -f ops/compose.test.yaml stop
```

Unit coverage includes constructive criticism, unavailable and protected accounts, reply activity, spam heuristics, OAuth request shapes, token encryption, structured inference, API rate limits, archive parsing and scheduling. Integration coverage includes database migrations, local authentication, CSRF, account safety, durable scans, cache, confirmed write semantics with provider fixtures, ChatGPT callback contracts and local MCP.

End-to-end checks cover desktop and mobile navigation, archive ingestion, filtering and pagination, drag selection, protection, exports, history, editing the local username and password, saving API keys and opening the X and ChatGPT authorization pages. Integration checks connect two X accounts through provider fixtures and exercise LAN sign-in, encryption and use of a stored API key. Actual access to X and ChatGPT depends on your provider accounts.
