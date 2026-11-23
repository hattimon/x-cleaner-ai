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

Otwórz [http://localhost:3180](http://localhost:3180). Przy pierwszym starcie pustej bazy backend generuje login i hasło. W logu znajdziesz pola `login` i `password`. Strzeż logu tak jak hasła. Zmianę wykonasz w **Ustawienia → Bezpieczeństwo konta lokalnego**. Rozwijana sekcja na dole logowania zawiera polecenie resetu.

```powershell
docker compose exec backend node dist/server/account-cli.js reset-password
```

Zmiana i reset kończą wcześniejsze sesje.

## Praca z aplikacją

1. Kliknij **PL** w nagłówku lub na ekranie logowania. Przeglądarka zapamięta wybór.
2. Zaimportuj `data/account.js` i wszystkie części `data/following.js` z rozpakowanego archiwum. Do lokalnego przeglądania, ręcznych decyzji i eksportu nie potrzebujesz płatnego API.
3. Aby analizować publiczne posty, połącz X przez OAuth, włącz odczyty i ustaw limity dla danego konta. Uruchom skan w panelu. [Konfiguracja X API](docs/X-API-SETUP.md)
4. Zaznaczaj pojedyncze profile, całą stronę lub wszystkie wyniki bieżącego filtra. Możesz przeciągnąć od checkboxa w dół. Start od zaznaczonego checkboxa odznacza zakres. Puszczenie rozpoczyna przerwę między zakresami.
5. Otwórz podgląd unfollow i potwierdzaj profile pojedynczo. Zapis wymaga uprawnień i może wiązać się z opłatą X. Wynik znajdziesz w Historii.
6. W **Integracjach** połącz opcjonalnie plan ChatGPT. Klucze OpenAI API, Anthropic Claude i Gemini ustawiasz oddzielnie. [Konfiguracja AI](docs/CHATGPT-PLUS-INTEGRATION.md)

Na Raspberry Pi przygotowano instalację Ubuntu Server ARM64 w tle. Sklep DCC korzysta z obrazu zawierającego wszystkie trzy usługi i osobny wolumen. [Instrukcja Raspberry Pi](docs/RASPBERRY-PI.md) · [Instalacja przez DCC](docs/DCC-INSTALL.md)

[Kopie bezpieczeństwa i przywracanie](docs/SECURITY.md) · [Raport testów](docs/TEST-REPORT.md)
