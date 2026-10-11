# Odczyt raportu nauki przez Hermesa

API Umiem! udostępnia rodzinie Hermesa ograniczone, tylko do odczytu podsumowanie postępów. Interfejs HTTP jest częścią aplikacji web; nie otwiera osobnego portu ani połączenia do bazy.

## Endpoint

`GET /api/v1/integrations/learning-overview?days=7&upcomingTestDays=14`

Autoryzacja: `Authorization: Bearer <token>` z zakresem `learning:read`. Opcjonalny `childId` zawęża wynik do jednego dziecka. `days` przyjmuje 1–31, a `upcomingTestDays` 1–90. Nieznane i powtórzone parametry są błędem. Odpowiedź jest migawką w strefie `FAMILY_TIMEZONE`, obejmuje lokalne dni od najstarszego do dzisiejszego, aktualny postęp przypisanych zestawów i terminy sprawdzianów zapisane w przypisaniach Umiem!.

Przykład:

```http
GET /api/v1/integrations/learning-overview?days=3&upcomingTestDays=14
Authorization: Bearer umiem_<uuid>_<sekret>
```

Sukces zawiera `schemaVersion: 1`, `generatedAt`, `timezone`, `period`, `plannedTestsPeriod` i listę dzieci. Każde dziecko ma osobne dni, liczniki ocen według umiejętności, `learningTime`, `currentProgress`, `practiceItems` i `plannedTests`. Pełny JSON Schema to [`learning-overview.schema.json`](learning-overview.schema.json); jego źródłem są `packages/contracts`, nie kopia MCP.

`learningTime.seconds` to szacowana liczba całkowitych sekund albo `null`, zawsze z `estimated: true`. Metoda `activity_intervals_v1` sumuje przerwy do 120 sekund między zapisanymi działaniami i nie dopisuje czasu po ostatnim działaniu. 1380 sekund można przedstawić jako „Czas nauki: 23 min”. `null` oznacza za mało danych, a zero w dniu bez zdarzeń oznacza brak zapisu w Umiem!, nie brak nauki gdzie indziej.

W aktywności dziennej zachowuj osobne wpisy dla różnych wersji tego samego zestawu, jeśli przypisanie zmieniło się w wybranym okresie. `submittedAttempts` obejmuje odpowiedzi wciąż przetwarzane, a `pendingAttempts` jest jego podzbiorem. W podsumowaniu sprawdzianu próbnego `skipped` i `unassessed` zawierają się w `notTested`; nie dodawaj ich ponownie do sumy.

`plannedTests` pochodzą wyłącznie z terminów zapisanych w Umiem!. Brak wpisu nie oznacza, że dziecko nie ma sprawdzianu w szkole. Liczba poprawnych odpowiedzi nie jest liczbą nowych ani opanowanych słów; stan opanowania opisują osobne statusy w `currentProgress`.

Błędy używają formatu `{code, message, retryable, requestId}`. Brak tokenu i token odwołany zwracają 401, brak zakresu 403, błędne parametry 400, nieznane dziecko 404, limit 60 żądań na token w minutę 429, a przejściowy błąd bazy 503. Wszystkie odpowiedzi mają `Cache-Control: no-store`. Błąd nigdy nie jest pustym sukcesem.

## Wydanie i token

Stwórz token w chronionym środowisku workera. Nie podawaj sekretu jako argumentu polecenia — CLI zapisuje go tylko do nowego pliku o prywatnych uprawnieniach:

```text
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts create --name hermes-family --out /absolute/private/path/umiem-token
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts list
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts revoke --id <uuid>
```

Przenieś token-file wyłącznie do konta usługi Hermesa przez chroniony kanał. CLI nie wypisuje sekretu. Rotacja polega na utworzeniu nowego pliku i konfiguracji, sprawdzeniu go w profilu usługi, a potem odwołaniu poprzedniego tokenu.

Przed użyciem zdalnym wymagane jest HTTPS i uzgodniona prywatna brama (np. VPN albo access proxy). Nie wystawiaj publicznie portu PostgreSQL i nie umieszczaj tokenu w plikach repo, promptach ani argumentach modelu. Ustawienia URL i ścieżki do token-file należą do konfiguracji operatora MCP. Nie wykonuj live testu rodzinnego jako root: dostępność sprawdza się później jako konto usługi Hermesa.

## Aktualizacja kontraktu

Eksport schematu: `npx --yes pnpm@10.34.6 contracts:export-learning-overview`; kontrola bez zapisu: `npx --yes pnpm@10.34.6 contracts:export-learning-overview --check`. Zmiana API wymaga aktualizacji adaptera, kopii schema/manifestu i `SKILL.md` w `integrations/umiem-mcp`, a także testów konsumenta w tym samym review. Dokumenty planów A/B/C opisują granice instalacji i wdrożenia.

Po ukończeniu implementacji utwórz źródłowe archiwum z zatwierdzonego commita poleceniem `uv run --locked python package_release.py --output-dir <private-output-directory>` w `integrations/umiem-mcp`. `RELEASE-MANIFEST.json` zapisuje pełny commit kodu oraz commit kontraktu; sumy skilla i schematu są sprawdzane przy starcie adaptera. Archiwum nie zawiera `.venv`, cache, `.env`, plików tokenów ani sekretów. Hermes rozpakowuje wyłącznie zatwierdzone wydanie; aktualizacja API/MCP/skilla w produkcji jest osobnym wdrożeniem.
