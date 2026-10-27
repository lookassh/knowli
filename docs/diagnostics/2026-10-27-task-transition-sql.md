# Przejście między ćwiczeniami — liczba sekwencyjnych SQL (2026-10-27)

Pomiar: `tests/integration/task-transition-queries.test.ts` (`capturePoolQueries`
na kliencie `pg`; liczone są wszystkie wywołania `client.query`, w tym
`begin`/`commit`). Scenariusz treningu słówek: poprawna odpowiedź na wydane
zadanie (`submitAttempt`), potem wydanie kolejnego z zapisanego planu sesji
(`nextTask`).

| Ścieżka | Przed | Po | Budżet w teście |
| --- | ---: | ---: | ---: |
| `submitAttempt` (choice) | 36 | 20 | ≤21 |
| `nextTask` (plan) | 17 | 11 | ≤12 |
| Łącznie (choice + next) | 53 | 31 | ≤33 |
| `submitAttempt` (text, recall+spelling) | — | 22 | ≤23 |
| `submitLessonAttempt` (choice) | 27 | 20 | ≤21 |
| `nextTask` (lekcja, plan) | 12 | 11 | ≤12 |
| Łącznie lekcja (choice + next) | 39 | 31 | — |

## Co usunięto

- Osobna transakcja routująca `submitAttempt`/`readAttempt` po typie zadania
  (sam odczyt bez `begin`/`commit`).
- `lockTaskWithSession` jednym zapytaniem z joinami daje zadanie, `itemId`,
  `targetKey`, payload rewizji, locale wersji i rodzaj zestawu — wcześniej do
  3 osobnych odczytów rewizji na próbę.
- Wstęp próby: jedno zapytanie o próby zadania (z wynikami ocen) zamiast
  osobnych zapytań o istniejącą próbę, próby `processing`, liczbę prób
  i liczbę niepoprawnych prób; liczba wcześniejszych feedbacków i wsparcia
  z tego samego zapytania o zdarzenia zadania.
- Finalizacja: oceny wszystkich umiejętności jednym insertem, historie
  jednym wywołaniem `readSkillHistories`, projekcje jednym wielowierszowym
  upsertem (`persistSkillProjections`); insert próby z `returning()`; stan
  zadania z `returning()` update'a; polityki `learning-v1/v2` z rejestru
  stałych TS bez zapytania SQL.
- `nextTask`: rodzaj zestawu z zapytania blokady sesji, ostatnia aktywność
  i liczniki zadań jednym zapytaniem (`greatest()` + agregaty), `taskCounts`
  jako agregat.
- `writeSealedEvent`: pieczęć i upsert `child_target_exposures` jedną
  instrukcją CTE (4→3 instrukcje). Pełne połączenie w jedną instrukcję
  blokują triggery `guard_event_seal`/`guard_exposure_insert` (migracja
  0001): ekspozycje wolno dopisywać tylko do niezapieczętowanego zdarzenia,
  a pieczęć ma być dokładnie jednym przejściem `false→true`.

## Czego świadomie nie ruszono

- `readSkillHistories` nadal wykonuje 2 zapytania (historie + grupowany
  dowód audio `min(...) group by task_id` z `task_id = any(...)`). Próba
  połączenia ich w podzapytanie skorelowane złamała test
  `history.test.ts` pilnujący planu zapytania audio dla dużych historii —
  osobne zapytanie grupujące zostaje.
- Ścieżka lekcji ma te same cięcia we wstępie próby (jeden odczyt prób
  zadania, warunkowy re-read stanu) i finalizacji (stan zadania z `returning()`,
  temat celu i kontekst przedmiotu z joinów locka, znana liczba feedbacków),
  a `nextTask` lekcji liczy aktywność i zadania jednym zapytaniem jak słówka.
  Fallback `planNextTask`/`planLessonTask` dla sesji bez zapisanego planu
  (sesje legacy) nie był optymalizowany — tam dominuje budowa migawki
  planowania, nie samo przejście.
- Bez zmian kontraktów DTO — brak wpływu na MCP i `SKILL.md`.

Semantyka bez zmian: jedna transakcja finalizacji, kolejność blokad
profil → sesja, ekspozycje zapieczętowane przed odpowiedzią HTTP,
projekcja odtwarzalna z historii w tej samej transakcji.
