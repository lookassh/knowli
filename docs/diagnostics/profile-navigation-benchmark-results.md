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

## Wyniki pomiarów (przebieg zweryfikowany: `nav-benchmark-run`)

Pomiary wykonano na PostgreSQL 17 (Docker, `jit=on`).
Plik ze szczegółowymi wynikami: `test-results/profile-navigation-benchmark-nav-benchmark-run.json`.

### Bazowe fixture (10 zestawów, 500 rewizji, 10 000 ocen, 50 000 zdarzeń, 2500 zakresów):

| Wariant | Mediana [ms] | p95 [ms] | Max [ms] | Zapytania SQL |
|---|---:|---:|---:|---:|
| **Legacy bez indeksu (`oldSQL + noIndex`)** | **1511.9** | — | 1546.1 | 1 |
| **Legacy z indeksem (`oldSQL + newIndex`)** | **115.9** | — | 158.8 | 1 |
| **Nowy czytnik historii (`currentReader`)** | **95.6** | **101.1** | 101.4 | 2 |
| **Nowy odczyt listy (`listKidDecks` z projekcjami)** | **159.6** | **165.2** | 169.2 | read-only tx |

### Zgodność z budżetami wydajnościowymi (§7 planu naprawy):
- **Czytnik historii p95 ≤ 250 ms:** Osiągnięto **101.1 ms** (PASS, ponad 2.4× poniżej limitu).
- **Odczyt listy `listKidDecks` p95 ≤ 500 ms:** Osiągnięto **165.2 ms** (PASS, ponad 3× poniżej limitu).
- **Przyspieszenie względem unindexed legacy:** Zapytanie historii przyspieszyło z **1511.9 ms do 95.6 ms** (ponad **15.8× szybciej**). Cały odczyt `listKidDecks` działa w **~160 ms** (zamiast wielosekundowej blokady).

### Mała próbka fixture/readerów

Osobny smoke test 1 zestaw × 2 rewizje × 1 sesja na dziecko: 4 oceny, 20 zapieczętowanych zdarzeń, zgodność multizbiorów historii legacy/current oraz 1 zestaw zwrócony przez `listKidDecks` (PASS).
