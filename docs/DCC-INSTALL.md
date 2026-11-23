# Install from the DCC App Store

[Instrukcja po polsku](#instalacja-w-dcc)

Open the DCC App Store, refresh its catalog and search for **X-Cleaner AI** under **Analytics** or **AI → UI**. Select a Docker host on amd64 or 64-bit ARM. The preset uses the full `ghcr.io/hattimon/x-cleaner-ai:0.1.1` image and maps host port 3180 to container port 8080. It creates the `x-cleaner-ai_data` volume for PostgreSQL and the installation's encryption key. The container restarts with Docker unless deliberately stopped.

Keep port 3180 free on the selected host. If another install uses it, stop that installation before adopting the same port or set `PUBLIC_ORIGIN` and `SIWC_CALLBACK_ORIGIN` to match a different browser-facing port. To connect to a private Raspberry Pi, use the [SSH or private HTTPS setup](RASPBERRY-PI.md).

In **Logs**, locate the `initial_credentials` event and use its `login` and `password` fields. Change the password in the app. In the host terminal, this command generates a new password and revokes active sessions. Substitute the name selected in DCC if it differs.

```bash
docker exec x-cleaner-ai node /app/dist/server/account-cli.js reset-password
```

Use container environment variables for X and optional API keys. Leave the data volume attached during upgrades. The standalone and split Compose installations use independent volumes. Migrate data through PostgreSQL backup and restore with the appropriate encryption key.

## Instalacja w DCC

Odśwież sklep DCC, wyszukaj **X-Cleaner AI** i wybierz host Docker. Preset sklepu uruchamia jeden obraz na amd64 lub ARM64 z panelem, backendem i PostgreSQL. Zachowaj wolumen `x-cleaner-ai_data`. Domyślnie panel otwiera się pod [http://localhost:3180](http://localhost:3180). Z odległego komputera połącz się przez [tunel SSH albo prywatne HTTPS](RASPBERRY-PI.md).

W logach kontenera wyszukaj `initial_credentials`. Login i hasło zostaną wygenerowane na świeżym wolumenie. Hasło można potem zmienić w ustawieniach aplikacji albo zresetować poleceniem powyżej. Jeżeli na hoście działa już lokalna instalacja Compose na porcie 3180, zwolnij port przed instalacją z DCC albo ustaw nowy port i dopasuj adres aplikacji.
