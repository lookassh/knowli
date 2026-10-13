# Odczyt raportu nauki przez Hermesa

Umiem! udostępnia rodzinie ograniczone, tylko do odczytu podsumowanie przez endpoint MCP w istniejącym procesie web. Hermes łączy się przez Streamable HTTP; nie uruchamia lokalnego serwera ani nie łączy się bezpośrednio z bazą.

## Endpoint i konfiguracja Hermesa

Endpoint to `POST /api/mcp` na prywatnym adresie HTTPS aplikacji Umiem!. Przykładowa konfiguracja:

```yaml
mcp_servers:
  umiem:
    url: "https://umiem.example/api/mcp"
    headers:
      Authorization: "Bearer ${UMIEM_READ_TOKEN}"
    timeout: 30
    connect_timeout: 10
```

Ustaw `UMIEM_READ_TOKEN` w chronionym środowisku procesu Hermesa oraz osobno procesu raportera rodzinnego. YAML zawiera jedynie referencję, nigdy wartość sekretu. Token korzysta z zakresu `learning:read`; system sprawdza go przy każdym żądaniu i ponownie przed odczytem danych. Token nie zastępuje sesji rodzica ani dziecka.

Wymagane jest HTTPS za prywatną bramą rodzinną (np. VPN/access proxy). Endpoint nie włącza CORS. Opcjonalna zmienna `UMIEM_MCP_ALLOWED_ORIGINS` zawiera rozdzielone przecinkami, dokładne originy HTTPS; domyślna pusta wartość dopuszcza klientów serwerowych bez nagłówka `Origin`, a odrzuca każde żądanie z nieznanym Origin. Limit wynosi 60 uwierzytelnionych żądań na token w ciągu minuty na proces i jest współdzielony z REST odczytem.

Skonfiguruj narzędzie w Hermes jako zwykły zdalny MCP `url` + `headers`. Dla raportu rodzinnego zainstaluj wersjonowany pakiet konsumenta zawierający walidator, schemat, manifest i skill; klient raportu korzysta z tego samego HTTP MCP. Token nie trafia do konfiguracji repozytorium, promptów, argumentów narzędzia ani logów.

## Narzędzie i znaczenie danych

Jedynym narzędziem jest `umiem_get_learning_overview`. Argumenty: `days` 1–31 (domyślnie 7), `upcomingTestDays` 1–90 (domyślnie 14) oraz opcjonalny UUID `childId`. Wynik zawiera dzieci osobno, aktywność każdego dnia, bieżący postęp per umiejętność, terminy sprawdzianów zapisane w Umiem! i estymowany czas nauki.

Dni są lokalnymi dniami rodziny, a dzisiejszy dzień może być częściowy. Czas zwracany jest z `estimated: true`; 1380 sekund można podać jako „Szacowany czas nauki: 23 min”. `null` oznacza za mało danych do oszacowania, a zero bez zarejestrowanej aktywności nie dowodzi, że dziecko nie uczyło się poza Umiem!.

Zachowuj osobne wpisy dla różnych wersji zestawu. `pendingAttempts` zawiera się w `submittedAttempts`. W sprawdzianie próbnym `skipped` i `unassessed` zawierają się w `notTested`. Liczba poprawnych odpowiedzi nie oznacza liczby nowych ani opanowanych słów; stan opanowania opisują pola `currentProgress`. `plannedTests` pochodzą tylko z terminów zapisanych w Umiem!, a nie z niezależnie sprawdzonego kalendarza szkolnego.

Błąd nigdy nie jest pustym sukcesem. Przy niedostępności danych reporter powinien powiedzieć, że nie mógł sprawdzić Umiem!, zamiast zastępować wynik pustą rodziną, zerową aktywnością lub nieaktualną migawką.

Zakres — raport nie obejmuje jeszcze lekcji (2026-10-12). Kontrakt `learning-overview` w wersji 1 dotyczy wyłącznie zestawów słówek. Moduł lekcji gramatyki (oraz przyszłe przedmioty) jest świadomie pominięty: postęp per reguła, próbne kartkówki z gramatyki i terminy sprawdzianów lekcji NIE pojawiają się w żadnym polu raportu. Brak danych lekcji w raporcie nie oznacza, że dziecko nie uczyło się gramatyki — reporter nie powinien wnioskować „braku nauki" na tej podstawie, a `SKILL.md` zawiera analogiczną notę dla konsumenta.

## Token i wydanie

Wydaj token w chronionym środowisku workera. CLI zapisuje sekret tylko do nowego pliku o prywatnych uprawnieniach:

```text
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts create --name hermes-family --out /absolute/private/path/umiem-token
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts list
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts revoke --id <uuid>
```

Do procesu Hermesa przekaż wartość tokenu przez chronione środowisko, a nie przez argument polecenia lub plik repozytorium. Rotacja: utwórz nowy token, skonfiguruj zmienną i odśwież połączenia klienta, potwierdź działanie, następnie odwołaj stary token.

## Aktualizacja kontraktu

Źródłem DTO i parametrów jest `packages/contracts`. Regeneruj schemat przez `npx --yes pnpm@10.34.6 contracts:export-learning-overview`; sprawdzaj bez zapisu przez dodanie `--check`. Zmiana API wymaga oceny MCP, aktualizacji kopii schematu/manifestu oraz skilla i testów konsumenta w tym samym przeglądzie zmian.

Po commitach z gotowymi i czystymi plikami źródłowymi buduj pakiet konsumenta poleceniem `uv run --locked python -m umiem_mcp.package_consumer --output-dir <private-output-directory>` w `integrations/umiem-mcp`. Archiwum zawiera wyłącznie walidator, schemat, manifest kontraktu, skill i manifest wydania z pełnym commitem oraz hashami. Nie ma w nim serwera, klienta REST/stdio, sekretów, danych dzieci ani środowiska wirtualnego. Aktualizacja zainstalowanego pakietu, konfiguracji Hermesa lub wdrożenia Coolify jest osobnym krokiem operacyjnym.
