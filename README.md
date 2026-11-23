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

Open [http://localhost:3180](http://localhost:3180) or use the host's private IP address from your local network. On an empty database, the app creates `admin` with a generated password and records both once under `initial_credentials`. Change the username and password in **Settings → Local account security**. **First sign-in or password reset** at the bottom of the sign-in screen includes the recovery command.

```powershell
docker compose exec backend node dist/server/account-cli.js reset-password
```

Changing or resetting the password invalidates existing sessions. The reset command shows the new password in the current terminal.

## Review your following list

1. Go to **X accounts → Import archive** and select `data/account.js` and all parts of `data/following.js` from your extracted X archive. The app records decisions and exports reports using the actual account IDs. Post evidence requires the X API.
2. For live scanning, choose **Integrations → Connect X account** and follow the one-time [X API setup](docs/X-API-SETUP.md). Use **Add another X account** for more accounts. Enable billable reads and set request and spending limits per account.
3. Open **Scanning** and start a scan. The scheduler and cursor checkpoints live in PostgreSQL. Scheduled scans are opt-in.
4. Search, filter, change the page size or select all matching results. Drag down from an unchecked checkbox to select a range. Start from a checked checkbox to deselect a range. Release to skip rows and start another range.
5. Open **Unfollow candidates**, read the evidence and prepare a preview. Each live change requires its own confirmation. History keeps the result and supports a separate follow request where available.
6. Use the **EN / PL** switch in the header or on the sign-in screen. The app remembers your choice in this browser.

## AI providers

Local rules and the local assistant work without a subscription. Open the panel over localhost and select **Integrations → Continue with ChatGPT** for official OAuth. You can also add an OpenAI API, Anthropic Claude API or Google Gemini API key in **Integrations**. In account **Settings**, select a model and decide whether scheduled scans can use it. [AI integration](docs/CHATGPT-PLUS-INTEGRATION.md)

## Raspberry Pi and DCC

Select your Raspberry Pi 4 running 64-bit Ubuntu in the DCC App Store and install the **X-Cleaner AI** entry. The standalone image supports `linux/arm64` and `linux/amd64` and persists everything in a named volume. [DCC installation](docs/DCC-INSTALL.md) · [Raspberry Pi and Compose](docs/RASPBERRY-PI.md)

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
