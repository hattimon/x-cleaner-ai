# Security and recovery

The app uses an owner account, scrypt password hashes, a seven-day HTTP-only session cookie, origin and CSRF checks, request throttling and account ownership checks. HTTPS deployments use Secure cookies. Password changes and terminal resets end all local sessions. HTTP sign-in accepts same-origin requests on loopback and private IP addresses. Keep the exposed frontend port on a trusted local network or bind it to loopback. Nginx and Node run as non-root users. The browser sees integration state and limited evidence.

The initial owner password is intentionally emitted once in a structured installation log at the user's request. Treat Docker log access as credential access until the password is changed. API tokens, OAuth grants and refresh tokens stay out of HTTP responses and request logs. OAuth credentials are encrypted at rest with AES-256-GCM. Preserve the `TOKEN_KEY` alongside encrypted backup material, using separate protected storage where possible.

## Back up

From your running installation, create a custom-format PostgreSQL backup and copy it from the database container. Name each copy separately. Store the environment file securely.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose exec -T db pg_dump -U xcleaner -d xcleaner -Fc -f /tmp/x-cleaner.dump
docker compose cp db:/tmp/x-cleaner.dump ./backups/x-cleaner.dump
```

## Restore into an empty stack

Use a separate Compose project name and unused frontend port for a recovery test. Prepare a protected `.env.recovery` with the backed-up `TOKEN_KEY` and matching database password. Configure the recovery origin and callback to match its new frontend port. Start the empty database, copy the backup and restore before starting the application.

```powershell
docker compose -p x-cleaner-recovery --env-file .env.recovery up -d --wait db
docker compose -p x-cleaner-recovery --env-file .env.recovery cp ./backups/x-cleaner.dump db:/tmp/x-cleaner.dump
docker compose -p x-cleaner-recovery --env-file .env.recovery exec -T db pg_restore -U xcleaner -d xcleaner --exit-on-error /tmp/x-cleaner.dump
docker compose -p x-cleaner-recovery --env-file .env.recovery up -d --wait
```

Keep active OAuth registrations on only one instance at a time to avoid races over refresh tokens. Verify the restored profiles, preferences and history before using it as the replacement. The PostgreSQL named volume is persistent. Avoid volume deletion when upgrading.
