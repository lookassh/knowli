# Plan optymalizacji bazy danych — wdrożenie (opcja A)

- Data: 2026-10-25
- Branch: `feature/db-refactoring`, baza `ee256f8` (`main` == `origin/main`)
- Podstawa: `2026-10-25-db-model-performance-analysis.md` (ten katalog) oraz analiza Codexa
  `learning-data-and-projections` (branch `feature/learning-data-and-projections-plan`, kod `3397c40`).
- Decyzja właściciela: wdrożyć plan rekomendowany przez Muse; na końcu niezależne review.

## Werdykt przyjęty do wdrożenia

Model danych (historia append-only + odtwarzalne projekcje, jedna baza PostgreSQL)
zostaje bez zmian. Wdrażamy wyłącznie zachowawczą opcję A: indeksy pod udokumentowane
filtry oraz przepisanie zapytań, które ładują historię całego życia dziecka.
Żadna zmiana nie zmienia semantyki wyników, DTO ani reguł nauki.

## Zakres tej zmiany

1. **Indeksy** (migracja addytywna `0022_history_lookup_indexes` + `schema.ts`):
   - `assessments(child_id, skill_version_id, skill)`
   - `attempts(child_id, received_at DESC)`
   - `attempts(item_revision_id)`
   - `session_tasks(child_id, issued_at)`
   - `session_tasks(item_revision_id, issued_at)`
   - `learning_events(child_id, occurred_at DESC)`
   - `event_exposures(child_id, target_key)`
2. **`readPublishedProgress`**: projekcje filtrowane do wersji umiejętności
   przedmiotów danego zestawu (zamiast wszystkich wierszy dziecka).
3. **`getLearningOverview` / `mockRows`**: dolna granica `ended_at` (okno okresu
   z buforem), filtr JS bez zmian.
4. **`readParentWorkCard`**: sesje, próby i zadania ograniczone do okna UTC
   z buforem wokół żądanego dnia; wszystkie filtry daty lokalnej w JS bez zmian
   (nadzbiór bezpieczny dla każdej strefy z kontekstu sesji).
5. **`readSkillHistories`**: budowanie historii przez `push` zamiast kopiowania
   tablicy (usuwa koszt O(H²) wskazany przez Codexa).

## Świadomie poza zakresem (osobne decyzje/PR-y)

- Projekcja przyrostowa zamiast replayu (opcja B) — wymaga pomiarów i testu równoważności.
- Naprawa `policy_id` vs `config.version` i izolacja polityk celów lekcji — zmienia wyniki,
  wymaga akceptacji wpływu (Q3 u Codexa).
- Snapshot startu sesji słówek wg wzorca lekcji; odczyty ekspozycji z `child_target_exposures`.
- Pełny katalog celów/kryteriów i nowe przedmioty (etap późniejszy Codexa).
- Pomiar na produkcji (`pg_stat_statements`, benchmark 100 tys.) — krok 0 do wykonania
  na środowisku właściciela; ta zmiana go nie blokuje ani nie zastępuje.

## Wpływ na API → MCP → skill

Brak. Zmiany dotyczą wyłącznie kształtu zapytań i indeksów; DTO, parametry,
kody błędów i znaczenie danych bez zmian, więc adapter MCP ani
`skills/umiem-learning/SKILL.md` nie wymagają aktualizacji.

## Weryfikacja

- Nowy test integracyjny `tests/integration/db-history-indexes.test.ts`:
  po pełnej migracji świeżej bazy wszystkie indeksy z pkt 1 istnieją w `pg_indexes`.
- Istniejące testy integracyjne obszarów jako oracle równoważności wyników:
  `parent-work-card.test.ts`, `parent-work-card-regressions.test.ts`,
  `learning-overview.test.ts`, `sessions.test.ts` (historie umiejętności).
- Testy jednostkowe obszarów `reporting` i `module-boundaries.architecture.test.ts`;
  `pnpm typecheck`.
- Wdrożenie: `CREATE INDEX` bez `CONCURRENTLY` (jak 0018) blokuje zapisy na czas budowy;
  przy skali rodzinnej pomijalne, na dużej historii zaplanować poza godzinami nauki.
- Rollback: migracja jest addytywna (same `CREATE INDEX`); cofnięcie kodu nie
  wymaga cofania danych, indeksy można usunąć osobną migracją.

## Kolejność prac

1. Test indeksów (czerwony) → `schema.ts` + migracja → test zielony.
2. Poprawki zapytań po jednej, z testami obszarów po każdej.
3. Typecheck + testy integracyjne obszarów.
4. Niezależne review całego diffu; poprawki po review; raport końcowy bez commita/pusha
   (chyba że właściciel poleci inaczej).
