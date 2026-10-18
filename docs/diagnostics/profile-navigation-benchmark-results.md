# Benchmark profil → lista zestawów

Raport przeznaczony dla fikcyjnej bazy PostgreSQL tworzonej przez global-setup
testów integracyjnych. Nie zawiera danych produkcyjnych.

## Zakres i uruchomienie

Benchmark jest opt-in (`UMIEM_NAV_BENCHMARK=1`). Domyślnie integracja wykonuje
wyłącznie deterministyczny test statystyk i nie seeduje ciężkiego fixture.
Global-setup jest izolowany identyfikatorem `UMIEM_TEST_RUN_ID=nav-benchmark`.

```powershell
$env:UMIEM_TEST_RUN_ID = 'nav-benchmark'
$env:UMIEM_NAV_BENCHMARK = '1'
corepack pnpm test:integration tests/integration/profile-navigation-benchmark.test.ts
```

Fixture ma dwoje dzieci, 10 opublikowanych zestawów słówek po 50 rewizji,
10 000 ocen i 50 000 zapieczętowanych zdarzeń. Drugi przebieg odtwarza tę samą
widoczną treść z 10× większą historią: 100 000 ocen i 500 000 zdarzeń.
Porównanie historii obejmuje starą wersję zapytania z commit
`5356529150a92bd782c6118ab52b49e4fcd905ae` i aktualny czytnik; wpisy normalizują
się jako multizbiory wewnątrz zakresów dziecko/skillVersion/skill.

Każdy nowy czytnik i `listKidDecks` mają pierwszy pomiar cold, 5 rozgrzewek i
30 próbek. Stary czytnik ma 3 próbki; p95 jest pominięte przy tak małej próbie.
Percentyl liczony jest metodą nearest-rank. Po każdym rozmiarze fixture test
zapisuje dotychczasowe wyniki do ignorowanego `test-results/`:
`profile-navigation-benchmark-<UMIEM_TEST_RUN_ID>.json`. Po ukończeniu każdej
wielkości danych plik jest nadpisywany pełną tablicą dotychczasowych wyników.
Test nie zapisuje parametrów SQL ani
odpowiedzi. Legacy bez indeksu ma osobne 3 próby tylko dla fixture bazowego,
z limitem `statement_timeout=60s`; indeks jest odtwarzany w `finally`.

## Wyniki

Poprzedni pełny przebieg zakończył się poprawnie 2026-10-18: Vitest zgłosił 3/3
testów zaliczonych. Podane 397.23 s czasu testu i 402.10 s całego procesu to
wyłącznie czas seedowania i wykonania testu, nie latencja czytnika ani listy.
Poprzednia wersja testu nie zapisywała JSON-u, a Vitest ukrył `console.info`,
więc czasy operacji i liczbę zapytań z tego przebiegu utracono.

Legacy SQL był mierzony na schemacie/indeksach istniejących w chwili przebiegu.
To jest wariant `oldSQL+newIndex`, a nie pełny baseline sprzed naprawy; dodany
indeks zdarzeń może zmieniać jego koszt. Nie wykonano osobnego `oldSQL+oldSchema`
bez indeksu. Wyników tych nie należy interpretować jako ilościowego porównania
przed/po.

### Mała próbka fixture/readerów

Osobny smoke test 1 zestaw × 2 rewizje × 1 sesja na dziecko przeszedł: 4 oceny,
20 zapieczętowanych zdarzeń, zgodność multizbiorów historii legacy/current oraz
1 zestaw zwrócony przez `listKidDecks`. Polecenie:

```powershell
$env:UMIEM_TEST_RUN_ID = 'nav-benchmark'
$env:UMIEM_NAV_BENCHMARK = '0'
corepack pnpm test:integration tests/integration/profile-navigation-benchmark.test.ts
```

### Pełny fixture

Pełne fixture 10 000/100 000 ocen i 50 000/500 000 zdarzeń zakończyły się bez
błędu. Ponowny pełny przebieg po zakończeniu etapu B zapisze wyniki do JSON-u;
uwzględni odbudowanie projekcji raw historii przez `rebuildProgress(apply: true)`
przed pomiarem listy. Obecny przebieg nie stanowi liczbowego baseline'u listy.
