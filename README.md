# X-Cleaner AI

[Polska wersja dokumentacji](README.pl.md)

X-Cleaner AI is a self-hosted dashboard for reviewing the accounts you follow on X. Import your own archive to browse, protect and export real profiles for free. Connect the official X API to analyze available public posts and prepare individually confirmed unfollows.

## Run on Windows

Use Docker Desktop in Linux container mode and Node.js 22.12 or later to generate the local configuration. Run these commands in the project folder.

```powershell
node scripts/init.mjs
docker compose up -d --build --wait
docker compose ps
docker compose logs --no-color backend | Select-String 'initial_credentials'
```

Open [http://localhost:3180](http://localhost:3180). The backend creates a unique owner username and password on the first start of an empty database. The installation log records them once as JSON with `event: initial_credentials`, `login`, `username` and `password`. Keep that log private. Change the credentials in **Settings → Local account security**. **First sign-in or password reset** at the bottom of the sign-in screen includes the recovery command.

```powershell
docker compose exec backend node dist/server/account-cli.js reset-password
```

Changing or resetting the password invalidates existing sessions. The reset command shows the new password in the current terminal.

## Review your following list

1. Go to **X accounts → Import archive** and select `data/account.js` and all parts of `data/following.js` from your extracted X archive. The app records decisions and exports reports using the actual account IDs. Post evidence requires the X API.
2. For live scanning, follow the [X API setup](docs/X-API-SETUP.md). Enable billable reads and set your request and estimated spending limits per account.
3. Open **Scanning** and start a scan. The scheduler and cursor checkpoints live in PostgreSQL. Scheduled scans are opt-in.
4. Search, filter, change the page size or select all matching results. Drag down from an unchecked checkbox to select a range. Start from a checked checkbox to deselect a range. Release to skip rows and start another range.
5. Open **Unfollow candidates**, read the evidence and prepare a preview. Each live change requires its own confirmation. History keeps the result and supports a separate follow request where available.
6. Use the **EN / PL** switch in the header or on the sign-in screen. The app remembers your choice in this browser.

## AI providers

Local rules and the local assistant work without a subscription. **Integrations → Continue with ChatGPT** connects through official ChatGPT OAuth. In **Settings**, select an available model and optionally authorize its use by scheduled scans. OpenAI API, Anthropic Claude API and Google Gemini API are optional. Each needs a server-side key, model ID and billing consent. See [AI integration](docs/CHATGPT-PLUS-INTEGRATION.md).

## Raspberry Pi and DCC

The same Compose stack supports 64-bit Ubuntu Server on Raspberry Pi. [Install as a background server](docs/RASPBERRY-PI.md) for native or prebuilt `linux/arm64` images, private access and reboot behavior. The DCC App Store uses the standalone image, which bundles the dashboard, backend and PostgreSQL in one container with a named volume. [DCC installation](docs/DCC-INSTALL.md)

## Operations

```powershell
docker compose ps
docker compose up -d --build --wait
docker compose stop
docker compose start
```

The named PostgreSQL volume survives replacement of the containers. Keep the volume and `.env` during upgrades. [Backup and restore](docs/SECURITY.md) covers both the database and encryption key. Review staged files before publishing source. Leave local configuration, logs, exports, credentials and database files outside Git.

- [Architecture](docs/ARCHITECTURE.md)
- [X API setup and cost model](docs/X-API-SETUP.md)
- [ChatGPT and other AI providers](docs/CHATGPT-PLUS-INTEGRATION.md)
- [Optional local MCP](docs/MCP-INTEGRATION.md)
- [Security, backup and recovery](docs/SECURITY.md)
- [Test report](docs/TEST-REPORT.md)
- [Roadmap](docs/ROADMAP.md)
