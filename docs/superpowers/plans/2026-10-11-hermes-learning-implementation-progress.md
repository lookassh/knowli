# Postęp implementacji API, MCP i raportów Umiem!

Plan/spec: `2026-10-11-hermes-learning-api.md`, `2026-10-11-hermes-learning-mcp-and-reports.md`, `2026-10-11-hermes-learning-report-deployment.md` oraz `2026-10-11-hermes-learning-integration-design.md`.

## Knowli

- A API, dokumentacja kontraktu oraz przykładowa odpowiedź: commits `71063e6..81040da`.
- B read-only MCP/stdio, walidacja źródłowego schematu, skill Umiem!, release i instrukcja operatora: commits `b5eaafe..5edb80a`.
- Walidacja API: E2E 1/1; integracyjne 21/21 i 52/52; unit 512/512; typecheck i build przeszły. Eksport kontraktu w trybie `--check` przeszła.
- Adapter MCP: 14/14 testów; smoke spakowanego release: lockfile sync, 14/14 testów i kontrola manifestu przeszły.
- Bazowy zakres review: `cb387633..HEAD`; obejmuje też wcześniejszy PR #48, który należy zaktualizować do końcowej implementacji zamiast tworzyć duplikat.

## Hermes-szkola

- Lokalny reporter Evening, kontekst nauki i graceful fallback: `9e68215..aa531f3`.
- Opcjonalny rodzinny profil, wersjonowana instalacja adaptera i skilla, walidacja hashy, ochrona przed drift, dokumentacja: `aa531f3..17a1eb1`.
- Pełna suite z adapterem Knowli: 122/122; suite instalatora: 12/12; `git diff --check` przeszło.
- Hermes checkout nie ma skonfigurowanego Git remote. Zmiany są zachowane w lokalnym worktree; nie utworzono zdalnego repo.

## Granica operacyjna i pozostałe bramki

- Testy korzystały z fikcyjnych danych. Nie użyto prywatnych danych dzieci, modelu, transportu wiadomości, crona, SSH, Coolify ani tokenu.
- Nie wykonano live instalacji. Weryfikacja Hermes native skill registry, wywołania jako service user i naturalnego Evening pozostają dowodami wymagającymi osobnej autoryzacji wdrożenia.
- Następny krok implementacyjny: niezależny reviewer całego zakresu w obu repozytoriach. Po obsłużeniu Critical/Important należy zaktualizować PR #48 w Knowli; nie scalać PR.
- Review-package skryptu Bash nie dało się uruchomić w bieżącym Windows runnerze (jego bash.exe przekierowuje do brakującego `/bin/bash`). Pakiet review zostanie wygenerowany równoważnie przez PowerShell z tymi samymi commit ranges i pełnymi diffami.

## Review findings i poprawki

Pierwszy niezależny przegląd pełnego zakresu (`cb387633..09aad9b7` w Knowli i `9e682159..17a1eb1f` w Hermes) znalazł 7 uwag Important i 0 Critical. Wszystkie 7 rozwiązano testami RED→GREEN:

- Instalator Hermesa kopiuje oba moduły klienta nauki, sprawdza ich obecność i ponownie weryfikuje hash konfiguracji bezpośrednio przed zapisem; manifest aktualizuje hash po zapisie, a activate/verify blokują drift. Dodano test pełnej izolowanej instalacji, importu skopiowanego MCP i kontroli profilu.
- Liczniki raportu MCP traktują `skipped` i `unassessed` jako podzbiory `notTested`, a `pendingAttempts` jako podzbiór `submittedAttempts`.
- Dzienne wpisy aktywności rozdzielają wersje jednego zestawu i sortują je deterministycznie; kontrakt wymaga unikalności po `deckVersionId`.
- MCP nakłada twardy timeout na całą próbę HTTP, również przy strumieniu stale wysyłającym małe fragmenty.
- Windows ACL pliku tokenu ustawiany jest na pustym pliku, zanim zostaną zapisane bajty sekretu.
- Test E2E API waliduje schemat i strukturę dzieci, nie pustą bazę współdzieloną ze wcześniejszymi testami.

Wyniki po poprawkach: `test:unit` 516/516, `test:integration` 192/192, `test:e2e` 129/129, `test:mcp` 16/16, Hermes full unittest 125/125, `typecheck`, `build`, eksport schema `--check`, `git diff --check`. Samodzielny pełny E2E przebieg potwierdził również gest nagrywania (test 126/129), który wcześniej nie przeszedł przy kolizji współbieżnie uruchomionych serwerów.

Minor celowo odłożone zgodnie z workflow: deterministyczny tie-break listy trudności przy kilku zdarzeniach tego samego dnia; sformułowanie w promptach dla sub-sekundowego dodatniego czasu („poniżej 1 min”); instalacja AGENTS.md z właściwym dokumentem `UMIEM-INTEGRATION.md`. Odrzucone jako poza tym zakresem: live instalacja i naturalny raport, modelowa próba prompt injection/jakości języka, osobna dystrybucja wheel oraz limity tokenów globalne między rodzinami/workerami.

Przed aktualizacją PR #48 pozostaje wymagany drugi, niezależny review całości po poprawkach. Package release i review aktualizującego PR wykonać dopiero po ostatnim commicie Knowli.
