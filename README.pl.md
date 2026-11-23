# X-Cleaner AI

[English documentation](README.md)

Lokalny panel analizuje listę obserwowanych na X, pokazuje dowody i pomaga przygotować zmiany. Możesz bezpłatnie zaimportować własne archiwum, przeglądać prawdziwe profile i zapisywać ręczne decyzje. Analiza postów i zapis na X wymagają oficjalnego API.

## Windows i Docker Desktop

W katalogu aplikacji wykonaj w PowerShell poniższe polecenia. Skrypt inicjalizacji wymaga Node.js 22.12 lub nowszego.

```powershell
node scripts/init.mjs
docker compose up -d --build --wait
docker compose ps
docker compose logs --no-color backend | Select-String 'initial_credentials'
```

Otwórz [http://localhost:3180](http://localhost:3180) lub użyj prywatnego adresu IP hosta w sieci lokalnej. Przy pierwszym starcie pustej bazy aplikacja tworzy konto `admin` i generuje hasło. Wpis `initial_credentials` zawiera obie wartości. Login i hasło zmienisz w **Ustawienia → Bezpieczeństwo konta lokalnego**. Rozwijana sekcja na dole logowania zawiera polecenie resetu.

```powershell
docker compose exec backend node dist/server/account-cli.js reset-password
```

Zmiana i reset kończą wcześniejsze sesje.

## Praca z aplikacją

1. Kliknij **PL** w nagłówku lub na ekranie logowania. Przeglądarka zapamięta wybór.
2. Zaimportuj `data/account.js` i wszystkie części `data/following.js` z rozpakowanego archiwum. Do lokalnego przeglądania, ręcznych decyzji i eksportu nie potrzebujesz płatnego API.
3. Kliknij **Integracje → Połącz konto X**. Przy pierwszym połączeniu panel poprosi o Client ID z konsoli X. Kolejne konta dodasz tym samym przyciskiem, a aktywne konto zmienisz na liście. Włącz odczyty i ustaw limity przed skanem. [Konfiguracja X API](docs/X-API-SETUP.md)
4. Zaznaczaj pojedyncze profile, całą stronę lub wszystkie wyniki bieżącego filtra. Możesz przeciągnąć od checkboxa w dół. Start od zaznaczonego checkboxa odznacza zakres. Puszczenie rozpoczyna przerwę między zakresami.
5. Otwórz podgląd unfollow i potwierdzaj profile pojedynczo. Zapis wymaga uprawnień i może wiązać się z opłatą X. Wynik znajdziesz w Historii.
6. Otwórz panel przez localhost i kliknij **Continue with ChatGPT** w Integracjach. Klucze OpenAI API, Anthropic Claude i Gemini dodasz w tym samym ekranie. Model wybierzesz osobno dla każdego konta X. [Konfiguracja AI](docs/CHATGPT-PLUS-INTEGRATION.md)

W sklepie DCC wybierz host Raspberry Pi 4 z Ubuntu Server ARM64 i zainstaluj **X-Cleaner AI**. Ten sam wpis działa na ARM64 i amd64. [Instrukcja Raspberry Pi](docs/RASPBERRY-PI.md) · [Instalacja przez DCC](docs/DCC-INSTALL.md)

[Kopie bezpieczeństwa i przywracanie](docs/SECURITY.md) · [Raport testów](docs/TEST-REPORT.md)
