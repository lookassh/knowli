---
title: 'Konfigurowalna liczba pytań sesji nauki per zestaw (domyślnie 20)'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: 'c042ab134a8fc4ecae9ec0dedad46e0953a0450e'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Liczba pytań (budżet zadań ocenianych) sesji nauki to globalna stała `DEFAULT_TASK_BUDGET = 12` — rodzic nie ma na nią wpływu, a właściciel chce domyślnie 20 pytań.

**Approach:** Nowy parametr na poziomie zestawu `decks.session_task_budget` (INT NOT NULL, 1–100, domyślnie 20), czytany w `startSession` przy starcie sesji zamiast stałej, edytowalny przez rodzica w panelu (edytor zestawu) przez nowy endpoint `PATCH /parent/decks/:id`.

**Decyzje właściciela (2026-10-19):**
- Limit czasu sesji skaluje się z budżetem: efektywny limit = max(10 min, 45 s × budżet zadań ocenianych sesji). Dla budżetów ≤ 13 zachowanie bez zmian (10 min); budżet 20 → 15 min.
- Parametr obowiązuje oba rodzaje zestawów (słownictwo i lekcje); pole edytowalne w DeckEditor i LessonEditor.
- Błąd walidacji PATCH to 400 + `code: "validation"` (jednolity kontrakt błędu §12 całego API), nie dosłowne 422 — renegocjacja wiersza macierzy.
- Cap czasu nauki w karcie aktywności (`reporting.ts`) skaluje się tak samo jak limit sesji (sessionTimeLimitMs budżetu sesji + 60 s bufora), by dłuższe sesje nie miały zaniżonego raportowanego czasu.

## Boundaries & Constraints

**Always:**
- Sesja przypina własną kopię budżetu w `learning_sessions.task_budget` przy starcie (bez zmian semantyki istniejących sesji).
- Walidacja na granicy: Zod w `packages/contracts` + CHECK (1–100) w Bazie; wzorcem jest `assignments.mock_test_task_count` (`MockTestTaskCountSchema`).
- Parametr jest konfiguracją runtime, nie treścią — mutacja bezpośrednia (bez nowego szkicu wersji), jak `assignments`/`archivedAt`.

**Never:**
- Nie zmieniamy budżetu kartkówek (maj własny per-przypisanie `mockTestTaskCount`).
- Nie konfigurujemy per dziecko ani per polityka nauki.
- Nie wystawiamy parametru w MCP (`learning-overview` nie eksponuje konfiguracji sesji; uzasadnić w PR).
- Kid DTO bez zmian — dziecko nadal widzi tylko `taskBudget`/`remainingAssessed` własnej sesji.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start sesji nauki | deck `session_task_budget = 20` (default) | plan sesji do 20 zadań ocenianych | N/A |
| Start sesji z override | deck ustawiony na 5 | plan do 5 zadań | N/A |
| PATCH wartość poza zakresem | `0` / `101` / brak pola | bez zmiany | 400 + `code: "validation"` z detalami (decyzja 2026-10-19) |
| PATCH poprawny | `{ "sessionTaskBudget": 7 }` | zapis, DeckDto zwraca 7 | N/A |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/sessions.ts:83,87,378` — `SESSION_TIME_LIMIT_MS`, `DEFAULT_TASK_BUDGET`; punkt wstrzyknięcia: `taskBudget: mockTestPlan?.slots.length ?? DEFAULT_TASK_BUDGET` (wiersz `deck` wczytany w :293). Plan treningu nadpisuje `taskBudget = plan.taskBudget` (sessions.ts:386-395).
- `packages/server/src/db/schema.ts:158-178` — tabela `decks` (brak pól ustawień; poprzednik kolumny: `coverAssetId`, migracja 0011). `:405-456` — `learning_sessions.task_budget DEFAULT 12`. Wzorzec CHECK: `:297,303` (`mock_test_task_count`).
- `packages/server/drizzle/` — migracje 0001–0019 + `meta/_journal.json`; generator: `pnpm --filter @learning/server db:generate`.
- `docs/schema.sql:43-50,203` — lustrzany projekt SQL do aktualizacji.
- `packages/contracts/src/decks.ts:302,334` — `DeckSummaryDtoSchema`, `DeckDtoSchema`; wzorzec PUT ustawień: `AssignmentPutSchema:362`.
- `packages/contracts/src/mock-tests.ts:22` — `MockTestTaskCountSchema` (1–100) do naśladowania.
- `packages/contracts/src/messages.ts:213-214` — wzorzec etykiet (`mockTaskCount`/Hint) dla nowego pola.
- `packages/server/src/modules/decks.ts:701,738` — `readDeck`/`listDecks` (przekazanie pola do DTO).
- `apps/web/src/parent/parent-router.ts:176-280` — blok decków; dodać `PATCH /:id` obok `assignments PUT:280`.
- `apps/web/src/parent/DeckEditor.tsx:829` + `apps/web/src/parent/AssignmentTestGoalFields.tsx` — wzorzec pola numerycznego (`<input type="number" min=1 max=100>`); blok ustawień w edytorze.
- `apps/web/src/parent/lessons/LessonEditor.tsx:684` — odpowiednik dla lekcji (jeśli Q2=A). `packages/contracts/src/lessons.ts:177` — `LessonDeckDtoSchema`.
- `packages/server/src/modules/lessons/lesson-sessions.ts:499-535` — plan lekcji pętla `while (assessed < session.taskBudget)`; nic nie zmieniać.
- Dokumentacja: `docs/architecture.md:240,246,254` („budżet 12"), `docs/SPEC.md:797,919`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/db/schema.ts` + nowa migracja `0020_*` — dodać `decks.session_task_budget` (INT NOT NULL DEFAULT 20, CHECK 1–100) i zrównać default `learning_sessions.task_budget` z 20; zaktualizować `docs/schema.sql`.
- [x] `packages/contracts/src/decks.ts` — `DeckDtoSchema.sessionTaskBudget`; `DeckSettingsPatchSchema` (`sessionTaskBudget` 1–100) + eksport; testy kontraktów.
- [x] `packages/server/src/modules/sessions.ts` — `DEFAULT_TASK_BUDGET` → 20 (nazwa zostaje); `:378` używa `deck.sessionTaskBudget`; helper `sessionTimeLimitMs(taskBudget) = Math.max(SESSION_TIME_LIMIT_MS, taskBudget * 45_000)` w trzech miejscach :1090/:1131/:1166.
- [x] `packages/server/src/modules/decks.ts` — use case `updateDeckSettings` + `sessionTaskBudget` w `readDeck`/`listDecks` DTO.
- [x] `apps/web/src/parent/parent-router.ts` — `PATCH /parent/decks/:id` (walidacja patch schema, 404/409 na brak/zarchiwizowany deck — jak inne mutacje decków).
- [x] `apps/web/src/parent/DeckEditor.tsx` + `apps/web/src/parent/lessons/LessonEditor.tsx` — pole „Liczba pytań w sesji nauki" (wzorzec `AssignmentTestGoalFields`, `data-testid="deck-session-task-budget"`), zapis przez PATCH.
- [x] `packages/contracts/src/messages.ts` — etykieta + podpowiedź dla pola.
- [x] Testy: integracyjne — override per zestaw (start sesji z 5), PATCH 400 (code "validation"), default 20, skalowany limit czasu (sesja z budżetem 20 wydaje zadania także po 10 min); zaktualizować asercje 12→20: `tests/integration/sessions.test.ts:601-602,839,1251`, `tests/integration/picture-vocabulary.test.ts:206`, `tests/integration/learning-algorithm.test.ts:108`. Jednostkowe fixture z `taskBudget: 12` zostają (ustawiają wprost własną wartość).
- [x] `docs/SPEC.md` + `docs/architecture.md` — zaktualizować opisy budżetu (12→20 + per zestaw) wraz z decyzją o skalowanym limicie czasu.

**Acceptance Criteria:**
- Given zestaw z defaultem, when start sesji nauki, then plan i `learning_sessions.task_budget` uwzględniają `deck.session_task_budget` (20 dla istniejących i nowych zestawów).
- Given rodzic ustawi 7 w edytorze, when dziecko startuje sesję, then sesja ma budżet 7, a kolejne edycje parametru nie wpływają na trwającą sesję.
- Given PATCH z 0/101, when żądanie, then 400 (code "validation") i bez zmiany w bazie.
- Given uruchomione testy integracyjne sesji, when wykonanie, then wszystkie przechodzą z nowym defaultem 20.

## Implementation Notes

- 2026-10-19: Matrix row „PATCH poza zakresem" — ROZSTRZIĄGNIĘTE decyzją właściciela: 400 + code "validation" (jednolity kontrakt §12). Macierz i AC zaktualizowane.
- 2026-10-19: `tests/integration/learning-algorithm.test.ts:108` — asercja liczy 12 unikalnych przedmiotów talii (deck 12-miesięcy), nie budżet; świadomie zostaje przy 12.
- 2026-10-19: Kartkówki — helper limitu czasu działa też w ścieżce mock_test (:1100), więc większa porcja kartkówki dostaje proporcjonalnie dłuższy limit (arch §9.4 zaktualizowane; domyślna porcja 10 → nadal 10 min). Zmiana wynika wprost z zatwierdzonej decyzji „limit skaluje się z budżetem sesji".
- 2026-10-19: `reward-projection-migration.test.ts` pre-dodaje kolumnę bez CHECK na czas seedu bieżącym kodem i zrzuca ją przed pełnym przejściem journala, by 0020 przeszedł jak w produkcji.
- 2026-10-19: DTO `sessionTaskBudget` ma parse-time `.default(20)` dla starszych ładunków (wzorzec `coverAssetId`).
- 2026-10-19: MCP bez zmian — `umiem-learning`/`learning-overview` nie eksponują konfiguracji sesji zestawu; `schemaVersion` i wygenerowany schemat nietknięte. Uzasadnienie do opisu PR.
- 2026-10-19: `reporting.ts` — decyzją właściciela cap czasu nauki w karcie aktywności skaluje się per sesja: zapytanie pobiera `task_budget`, cap = `sessionTimeLimitMs(budżet) + 60 s`. `reporting.test.ts` zaktualizowane (11→16 min przy budżecie 20); 10/10 zielone.
- 2026-10-19: Weryfikacja: typecheck PASS (6 tsconfig), unit 1337 PASS, integration pełny suite 469 PASS (jeden przebieg przerwany przez zgon kontenera Postgres — znany flak infra; czysty re-run zielony); dotknięte pliki (sessions, manual-decks-api, picture-vocabulary: 63 testy; reporting: 10 testów) zielone także w samodzielnym re-runie po decyzjach właściciela.
- 2026-10-19 (review round 1): trzy warstwy review (blind hunter / edge case / verification gap); pełny triage w Review Triage Log. Patch naniesiony: hinty z regułą 45 s/zadanie (messages.ts), SPEC §17 + §532, wiersz `PATCH /parent/decks/:id` w tabeli tras arch §12, guard tożsamości decka w `onSaved` + wspólny komponent `DeckSessionTaskBudgetSettings.tsx` (+ test `deck-session-settings.test.tsx`), komentarze `task_budget` (oba źródła), poprawki sformułowań, test skalowanego limitu kartkówki (mock-tests: porcja 20 → wydaje po 11 min, zamyka po 16), surowy JSON `sessionTaskBudget` w lesson GET + kontrakt default lekcji. **Nowy test wyłapał bug poza trzema punktami specu: `attempts.ts:575` odrzucał odpowiedzi kartkówki po płaskich 10 minutach** (zablokowałby odpowiedzi na zadania 15+ w porcji 20) — naprawione `sessionTimeLimitMs(session.taskBudget)`. Defer: regeneracja łańcucha snapshotów Drizzle, treść AGENTS.md „5–10 minut". Weryfikacja po poprawkach: typecheck PASS, unit 139 plików/1341 PASS, integration 52 pliki/471 PASS + 2 pre-existing skipy.

## Spec Change Log

## Review Triage Log

- [BH1/EC5/VG-Other] messages.ts `mockTaskCountHint` obiecuje „kartkówka trwa do 10 minut" — **medium**: gałąź mock_test (sessions.ts:1100) skaluje limit od slotów, hint okłamuje rodzica przy porcji >13 — patch (treść).
- [BH2/EC7] SPEC.md:532 „Kartkówka ma limit czasu 10 minut" — **medium**: sprzeczne z arch §9.4 po tej zmianie — patch (dokument).
- [BH13] `sessionTaskBudgetHint` bez reguły 45 s/zadanie — **low**: rodzic nie wyliczy 20→15 min — patch (w grupie z BH1).
- [BH3a] SPEC.md §17:451 „Domyślna sesja trwa około 5–10 minut" — **low**: nieaktualne przy domyślnym budżecie 20 — patch (jedna linia).
- [BH3b] AGENTS.md „Sesje trwają około 5–10 minut" — **low**: niespójne, ale to plik agent-context — defer.
- [BH4] Tabela tras arch §12 bez `PATCH /api/v1/parent/decks/:id` — **low**: tabela istnieje, nowa publiczna trasa poza rejestrem — patch (wiersz).
- [BH5] Input `Number("")=0`/NaN, brak komunikatu, brak anulowania — **low**, reject: type=number nie daje NaN, przejściowe 0 znika przy wpisie; fix = dodatkowe stany/komunikaty (complexity), spójnie z istniejącymi polami numerycznymi.
- [BH6] Zdublowany blok UI ustawień w dwóch edytorach — **low**, reject: idiom repo to osobny wiring per edytor + współdzielony mały komponent pola (AssignmentTestGoalFields); ekstrakcja = refaktor ponad bezpośrednią korektę.
- [BH7/VG3] Ścieżka zapisu UI bez testu — **medium** (pre-verified): złamanie wiringu (zły URL/stara wartość w PATCH) zostaje zielone — patch (test w idiomie deck-editor-assignments.test.tsx).
- [BH8+VG2] Lesson GET nie asseruje surowego `sessionTaskBudget`; parse-time default(20) maskuje pominięcie — **medium** (pre-verified): usunięcie pola z readLessonDeckSnapshot nie psuje żadnego testu — patch (raw JSON = 7 + kontrakt lesson default).
- [BH9] Dolna gałąź `max()` limitu bez testu — **false**: mock-test-reporting.test.ts (budget 3, +600_001 ms) zamyka sesję na floorze 10 min przez ten sam helper.
- [BH10] E2E nieuruchomione/nieuzasadnione — **low**, reject: adekwatne skrypty dla tej zmiany to unit+integration+typecheck (wg Verification); e2e wykona CI na PR; uzasadnienie w opisie PR.
- [BH11] Brak meta/0020_snapshot.json — **low**, defer: łańcuch snapshotów zerwany już przez 0018/0019 (stan pre-existing); regeneracja to osobne zadanie.
- [BH12] Komentarz `learning_sessions.task_budget` pomija źródło mock_test (slots.length) — **low**: mylący dla czytelnika — patch (komentarz + schema.sql).
- [BH14] „Dosiejamy" (nieistniejące słowo), „zrobi się dla zapytań zamknięcia" — **low**: bezpośrednia poprawka sformułowań — patch.
- [BH15] Status specu `in-progress` — **false**: już ustawione `in-review`; triage log wypełniany niniejszym.
- [BH16] `DeckSettingsPatchSchema` bez `.strict()` — **false**: wskazany wzorzec `AssignmentPutSchema` też nie jest strict; pole wymagane chroni przed cichym no-op (brak pola → 400).
- [EC1/EC2] Merge wyniku PATCH bez guardu tożsamości decka w obu edytorach — **low**: nawigacja do innego zestawu w locie wbuduje cudzą wartość; polling (1 s) koryguje, ale przy dirty stan się utrzymuje — patch (guard `cur.id === deckId`).
- [EC3] Polling LessonEditora nadpisuje świeżo zapisany budżet — **low**, reject: poll co 1 s samo koryguje (<2 s glitch); trwały fix wymagałby śledzenia savedBudget poza zakresem.
- [EC4] TOCTOU archiwizacja/mutacja w updateDeckSettings — **low**, reject: jednorodzinny panel, okno milisekund, zarchiwizowany zestaw i tak nie startuje sesji.
- [EC6] `DEFAULT_TASK_BUDGET` martwy eksport — **low**, reject: spec jawnie postanowił „nazwa zostaje"; stała dokumentuje wartość domyślną.
- [VG1] Gałąź skalowanego limitu mock_test nad podłogą bez testu — **medium** (pre-verified): porcja >13 slotów nigdy nie przekracza starego limitu w testach — patch (mockTestTaskCount 20, +11 min wydaje, +16 min zamyka ended).

## Design Notes

- Punkt wstrzyknięcia to wyłącznie `sessions.ts:378` — plan treningu i plan lekcji budują się od `session.taskBudget` z insertu, więc jedna zmiana propaguje wszędzie; fallback `DEFAULT_TASK_BUDGET` zostaje dla ścieżek bez `deck` (obecnie nieistniejących).
- Kartkówki: `mockTestPlan?.slots.length` ma pierwszeństwo — ich budżet nadal z `mockTestTaskCount` per przypisanie.
- Q1 (rozstrzygnięte): `sessionTimeLimitMs(taskBudget) = Math.max(SESSION_TIME_LIMIT_MS, taskBudget * 45_000)` użyte w trzech miejscach :1090/:1131/:1166 (bez zmiany zachowania dla budżetów ≤ 13). Limit liczymy od budżetu sesji (max promissory output), nie od liczby już wydanych zadań.

## Verification

**Commands:**
- `pnpm --filter @learning/server test -- src/modules/sessions.test.ts` (jeśli istnieje; inaczej pokrewne) -- expected: PASS
- `pnpm test:integration tests/integration/sessions.test.ts` -- expected: PASS z nowym defaultem 20
- `pnpm typecheck` -- expected: PASS

**Manual checks (if no CLI):**
- W edytorze zestawu zmiana wartości i zapis; start sesji dziecka — liczba zadań zgodna z ustawieniem.
