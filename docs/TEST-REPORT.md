# Test report

## Windows validation

| Check | Result |
| --- | --- |
| TypeScript and Vite | Backend and frontend compile. |
| Vitest | 13 unit tests and 9 PostgreSQL integration tests passed. |
| Playwright | 4 E2E tests passed in Chrome, at 1440 px desktop and 390 px mobile widths. |
| Docker targets | Compose backend and frontend built for linux/amd64 and linux/arm64. |
| Standalone DCC image | Local container passed health, initial owner login, password reset and session invalidation checks. |
| DCC catalog | Official identity checks passed with the prior 69 entries intact. |

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

End-to-end checks cover desktop and mobile navigation, archive ingestion, filtering and pagination, drag selection, protection, exports, history and changing the local password. Connect your own X and ChatGPT accounts to verify real provider access. Provider fixtures were used for contract tests.
