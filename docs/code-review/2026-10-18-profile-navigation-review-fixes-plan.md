# Plan napraw po review PR #93

## Zakres

Naprawa trzech wykrytych regresji w projekcji i raportowaniu postępu oraz dwóch
helperów pomiarowych dla zapytań wykonywanych wewnątrz transakcji. Bez zmian
publicznych DTO, zachowania listy/planera ani kontraktu API/MCP.

## Kroki i kryteria akceptacji

1. Dodać test PostgreSQL: rebuild odtwarza dokładnie projekcję i jej fakty po
   ręcznym uszkodzeniu, a drugi apply zgłasza zero insert/update/delete.
2. Oddzielić monotoniczne zapisy online od dokładnego zapisu rebuild; porównanie
   rebuild uwzględnia również `delayed_confirmation_at` i wszystkie fakty.
3. Dodać test raportu rodzica po zmianie polityki, dla nowszego wyniku innej
   polityki, remisu polityk oraz wiersza wydania bez oceny.
4. Raport redukuje wyłącznie wiersze z wiarygodnym (`non-null`)
   `last_reviewed_at` na `skill_version_id`: najnowszy czas wygrywa, a remis
   rozstrzyga leksykograficznie mniejszy `policy_id`. Wydanie z samym
   wystawieniem (`last_reviewed_at = null`) ma status unseen i nie dowodzi
   oceny; jeśli brak wiarygodnego wyniku, działa dotychczasowy `statusFor` /
   predecessor, ewentualnie `not_assessed`. Lista i planner pozostają
   ograniczone do polityki profilu.
5. Przechwytywać zapytania z wypożyczonych klientów puli, także wcześniej
   utworzonych; asercje potwierdzają dodatnią liczbę SELECT w testowanej ścieżce.
6. Uruchomić testy integracyjne i jednostkowe, typy, build, MCP oraz E2E;
   wpisać wyłącznie faktycznie wykonane wyniki.

## Decyzje techniczne

- Zapisy online zachowują monotoniczne `greatest`/`least`/`OR`; autorytatywny
  rebuild zapisuje fakty projekcji dokładnie według historii, w tym `null` i
  `false`, aby naprawić uszkodzone wartości. Idempotencja porównuje także
  `delayed_confirmation_at`.
- Raport postępu zachowuje semantykę historycznej, ostatniej wiarygodnej oceny
  dla bieżącej wersji materiału, niezależnie od aktualnej polityki profilu.
  `currentPolicyVersion` w overview nadal służy wewnętrznie wyborowi trudności
  elementów ćwiczeń; nie zmienia się ten wybór ani publiczny DTO.
- Zmiana naprawia odczyt `currentProgress`, również przez MCP
  `learning-overview`; schematy/DTO/API nie zmieniają się. Manifest MCP
  zaktualizowano wyłącznie o hash zmienionego skilla.
- Instrumentacja testowa opakowuje query klienta dokładnie raz dla zapytań
  bezpośrednich i transakcyjnych oraz przywraca metody także po wyjątku.

## Dziennik RED/GREEN

RED (PostgreSQL, `UMIEM_TEST_RUN_ID=pr93-luna-red`): 2 pliki, 3 testy
zawiodły z oczekiwanymi symptomami: 0 przechwyconych SELECT-ów, zatrute
`first_issued_at`/`last_reviewed_at`/flaga oceny po rebuild oraz
`not_assessed` po zmianie polityki bez dowodu.

## Wyniki weryfikacji

GREEN (`UMIEM_TEST_RUN_ID=pr93-luna-green`): 4 pliki integracyjne,
19 testów zaliczonych, 2 pominięte testy benchmarkowe opt-in. Obejmują rebuild,
raportowanie, helpery nawigacji i odczyt lekcji z SELECT-only assertion.

## Końcowa weryfikacja

- `corepack pnpm test:unit` — 136 plików, 1 285 testów zaliczonych.
- `$env:UMIEM_TEST_RUN_ID='pr93-luna-int2'; corepack pnpm test:integration` —
  52 pliki, 462 testy zaliczone, 2 benchmarki opt-in pominięte.
- `corepack pnpm typecheck` — zakończony pomyślnie.
- `corepack pnpm build` — zakończony pomyślnie; Next.js wygenerował wszystkie
  strony.
- `corepack pnpm test:mcp` — 8 testów zaliczonych; przed zielonym przebiegiem
  odświeżono hash skilla w manifeście MCP.
- Pełne E2E (`UMIEM_TEST_RUN_ID=pr93-luna-e2e`, port web `24593`, health
  `34593`) — 197/198 zaliczonych; jeden test ujawnił przestarzały fixture
  `seedDue`, który tworzył `needs_confirmation` bez `last_reviewed_at`. Po
  poprawie fixture uruchomiono `corepack pnpm exec playwright test
  tests/e2e/kid-flow.spec.ts` (`UMIEM_TEST_RUN_ID=pr93-luna-kidflow`, port web
  `24595`, health `34595`) — 10/10 testów zaliczonych. Pełny przebieg po
  poprawce fixture jest sprawdzany ponownie przez wszystkie shardy E2E w CI;
  aktualny wynik znajduje się w checkach PR #93.

Kryterium gotowości implementacji: regresje PostgreSQL/report/helper oraz pełny
`kid-flow.spec.ts` przechodzą, a niezależny review parenta nie ma uwag
blokujących. Zielony pełny przebieg CI dla wypchniętego commita jest końcowym
warunkiem gotowości całego PR do scalenia.
