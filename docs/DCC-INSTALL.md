# Install from the DCC App Store

[Instrukcja po polsku](#instalacja-w-dcc)

Open the DCC App Store, refresh its catalog and search for **X-Cleaner AI** under **Analytics** or **AI → UI**. Select a Docker host on amd64 or 64-bit ARM. The preset maps host port 3180 to container port 8080. It creates the `x-cleaner-ai_data` volume for PostgreSQL and the installation's encryption key. The container restarts with Docker unless deliberately stopped.

Keep port 3180 free on the selected host. If another install uses it, stop that installation before adopting the same port or set `PUBLIC_ORIGIN` and `SIWC_CALLBACK_ORIGIN` to match a different browser-facing port. To connect to a private Raspberry Pi, use the [SSH or private HTTPS setup](RASPBERRY-PI.md).

After a fresh install of X-Cleaner AI 0.1.2 or later, open **Logs** in DCC and select **Detect access details**. You can also read `login` and `password` on the `initial_credentials` line. Open [http://localhost:3180](http://localhost:3180) on the local Docker host and change your password in the app. In the host terminal, this command generates a new password and revokes active sessions. Substitute the name selected in DCC if it differs.

```bash
docker exec x-cleaner-ai node /app/dist/server/account-cli.js reset-password
```

Use container environment variables for X and optional API keys. Reusing the data volume keeps your existing account and password. A new empty volume generates new credentials. The standalone and split Compose installations use independent volumes. Migrate data through PostgreSQL backup and restore with the appropriate encryption key.

## Instalacja w DCC

Odśwież sklep DCC, wyszukaj **X-Cleaner AI** i wybierz host Docker. Preset sklepu uruchamia jeden obraz na amd64 lub ARM64 z panelem, backendem i PostgreSQL. Zachowaj wolumen `x-cleaner-ai_data`. Domyślnie panel otwiera się pod [http://localhost:3180](http://localhost:3180). Z odległego komputera połącz się przez [tunel SSH albo prywatne HTTPS](RASPBERRY-PI.md).

Po świeżej instalacji X-Cleaner AI 0.1.2 lub nowszej wybierz w logach DCC **Wykryj dane dostępowe**. Login i hasło możesz też odczytać z wiersza `initial_credentials`. Hasło zmienisz w ustawieniach aplikacji albo zresetujesz poleceniem powyżej. Jeżeli na hoście działa już lokalna instalacja Compose na porcie 3180, zwolnij port przed instalacją z DCC albo ustaw nowy port i dopasuj adres aplikacji.

Ponowne użycie wolumenu danych zachowuje dotychczasowe konto i hasło. Nowe dane logowania powstaną na nowym, pustym wolumenie.
