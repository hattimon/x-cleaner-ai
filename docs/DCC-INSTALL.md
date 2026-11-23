# Install from the DCC App Store

[Instrukcja po polsku](#instalacja-w-dcc)

Open the DCC App Store, refresh its catalog and search for **X-Cleaner AI** under **Analytics** or **AI → UI**. Select a Docker host, including a Raspberry Pi 4 running 64-bit Ubuntu. The preset maps host port 3180 to container port 8080. It creates the `x-cleaner-ai_data` volume for PostgreSQL and the installation's encryption key. The container restarts with Docker unless deliberately stopped.

Open the port selected during installation using `localhost` or the host's private LAN address. For one-click ChatGPT authorization on a Raspberry Pi from another device, follow the [localhost tunnel instructions](RASPBERRY-PI.md).

After a fresh install, open **Logs** in DCC and select **Detect access details**. Version 0.2.0 creates `admin` with a generated password. You can read both on the `initial_credentials` line. Change the username and password in **Settings → Local account security**. In the host terminal, this command generates a new password and revokes active sessions. Substitute the name selected in DCC if it differs.

```bash
docker exec x-cleaner-ai node /app/dist/server/account-cli.js reset-password
```

Use container environment variables for X and optional API keys. Reusing the data volume keeps your existing account and password. A new empty volume generates new credentials. The standalone and split Compose installations use independent volumes. Migrate data through PostgreSQL backup and restore with the appropriate encryption key.

## Instalacja w DCC

Odśwież sklep DCC, wyszukaj **X-Cleaner AI** i wybierz host Docker, np. Raspberry Pi 4 z Ubuntu ARM64. Preset uruchamia panel, backend i PostgreSQL w jednym kontenerze. Domyślnie panel otwiera się pod [http://localhost:3180](http://localhost:3180) lub przez prywatny adres IP hosta z tym samym portem.

Po świeżej instalacji wybierz w logach DCC **Wykryj dane dostępowe**. Od wersji 0.2.0 loginem jest `admin`, a hasło jest losowane. Obie wartości znajdziesz w wierszu `initial_credentials`. Dane logowania zmienisz w ustawieniach aplikacji.

Ponowne użycie wolumenu danych zachowuje dotychczasowe konto i hasło. Nowe dane logowania powstaną na nowym, pustym wolumenie.
