# Cykl życia runu generowania lekcji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run puli lekcji da się ponowić po porażce i edycji, nie da się go zrestartować, gdy jest zdrowy, sam wraca po padzie workera, a panel rodzica nie ma martwych przycisków, wiecznego spinnera ani cichego zamykania runu zapisem.

**Architecture:** Jeden predykat SQL „run puli utknął” (`claimed_at` + termin runu z polityki + margines, czas bazy) w `generation-runs.ts`, używany przez `retryGeneration` (bramka), DTO (`stalled`) i worker (przywrócenie do `queued` jednym `UPDATE` z CAS w `WHERE`). Panel blokuje zapis i publikację w trakcie zdrowego generowania; run uznany za utknięty (pole `stalled` albo długie `queued` mierzone w przeglądarce) odblokowuje je, żeby rodzic nie został uwięziony.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Vitest (integracja na PostgreSQL), React + Mantine, Playwright.

**Spec:** ustalenia 1–7 z przeglądu modułu generowania lekcji (pakiet B, zlecenie koordynatora 2026-11-10) — streszczone w zadaniach; osobnego specu nie ma. Tło: `docs/architecture.md` §19.17, `docs/agents/lessons.md`, `docs/agents/testing.md`.

## Global Constraints

- Tożsamość próby (stan `running` + `attempts` + `expectedEditNumber` + numer edycji wersji) sprawdzana przy każdym zapisie; kolejność blokad wersja → run; zapis szkicu, podsumowanie i stan runu w jednej transakcji; spóźniony worker nie nadpisuje nowszego stanu.
- Bez nowych kolejek, procesów, kolumn i migracji. Bez zmian w `providers/`, `lesson-baseline-pool.ts`, `lesson-agent-outcome.ts`, `domain/lessons/pool-validation.ts`, `rules/`, promptach.
- Runy historyjki (`input.purpose = "story"`) zostają bez zmian.
- Testy integracyjne: bramki i `expect.poll`, wiek runu ustawiany przez `update … set claimed_at = now() - interval …`, bez `setTimeout`.
- Teksty UI po polsku w `packages/contracts/src/messages.ts`, bez nazw modeli, id reguł i żargonu.
- Commity kończ `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. Rodzic edytuje formularz w trakcie generowania (formularz „brudny”, odpytywanie nie odświeża `deck`): blokada zapisu musi czytać stan runu z bieżącej odpowiedzi zapytania, inaczej zapis zostaje wyłączony na zawsze (Task 5, test „blokada znika po zakończeniu runu mimo niezapisanych zmian”).
2. Worker nie działa wcale: `queued` bez końca — rodzic musi móc zapisać/opublikować lekcję po komunikacie (Task 5, test zegara).
3. Run w `running` z wyczerpanymi próbami po przywróceniu: kończy `attempts_exhausted`, nie krąży bez końca (Task 3).
4. Spóźniony worker starej próby po automatycznym przywróceniu: nie zapisuje niczego (Task 3, test z bramką).
5. Web i worker z różnym `UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS`: web czyta politykę z własnego env (Task 2); błędna wartość nie wywraca web (wartość domyślna).

---

### Task 1: „Ponów” po porażce przyjmuje bieżący numer edycji (ustalenie 1)

Moduł: `materials` (`generation.ts`, `retryGeneration`). Zależności: bez nowych. Transakcja: istniejąca transakcja `retryGeneration`, blokady wersja → run.

**Files:**
- Modify: `packages/server/src/modules/materials/generation.ts` (gałąź runu puli, wiersz `if (version.editNumber !== current.expectedEditNumber) throw conflict`)
- Test: `tests/integration/lesson-generation.test.ts`

- [ ] **Step 1: test** `"ponowienie po porażce i edycji szkicu przyjmuje bieżący numer edycji"`: fake z błędem trwałym pierwszej paczki (`{ throw: new GenerationProviderError("configuration", { status: 400 }) }`), `executeLessonGeneration` → `failed`; `editLessonDraft(services, deckVersionId, { expectedEditNumber: 1, title: "Zmiana rodzica" })`; `retryGeneration` nie rzuca; `executeLessonGeneration` → `succeeded`; tytuł wersji „Zmiana rodzica”, są rewizje.
- [ ] **Step 2:** uruchom `pnpm test:integration tests/integration/lesson-generation.test.ts -t "bieżący numer edycji"` — FAIL (`conflict`).
- [ ] **Step 3:** usuń porównanie numerów edycji w gałęzi runu puli (dla `failed` i utkniętego `running` nowy `expectedEditNumber` to i tak `version.editNumber + 1`; stara próba ma niższy numer, więc straż tożsamości jej nie przepuści). Komentarz: dlaczego (świadoma decyzja rodzica, jak #302).
- [ ] **Step 4:** test PASS. **Step 5:** commit.

### Task 2: predykat „utknął”, bramka „Ponów” dla `running`, `stalled` w DTO (ustalenie 2)

Moduł: `materials` (`generation-runs.ts` — predykat; `generation.ts`, `lessons/lesson-story-generation.ts` — użycie). Zależności: `generation-runs.ts` → `lessons/lesson-generation-policy` (same stałe, bez cyklu). Transakcja: bez zmian; predykat liczony w `SELECT … FOR UPDATE` runu.

**Files:**
- Modify: `packages/server/src/modules/materials/generation-runs.ts`, `generation.ts`, `lessons/lesson-story-generation.ts` (`latestLessonRunOfPurpose`), `packages/server/src/config.ts` (`Services.lessonExecution?`, `createServices`), `packages/server/src/index.ts` (eksport `lessonGenerationPolicyFromEnv`), `apps/web/src/composition.ts`, `packages/contracts/src/generation.ts` (komentarz pola `stalled`)
- Test: `tests/integration/lesson-generation.test.ts`, `tests/integration/lesson-agent-generation.test.ts` (istniejące ponowienia runu `running` postarzają `claimed_at`)

**Interfaces — Produces:**
```ts
// generation-runs.ts
export const LESSON_RUN_STALL_MARGIN_MS = 120_000;
/** Run puli lekcji w `running` dłużej niż termin runu + margines od `claimed_at` (czas bazy); `claimed_at is null` też. */
export function lessonPoolRunStalled(services: Pick<Services, "generation" | "lessonExecution">): SQL<boolean>;
```
Termin: `(services.generation?.lessonExecution ?? services.lessonExecution ?? DEFAULT_LESSON_GENERATION_POLICY).runTimeoutMs`. Zdrowa próba kończy się przed terminem runu (kontroler i termin finalizacji), więc predykat nie trafia w żywy run.

- [ ] **Step 1: testy.** (a) `"zdrowy run puli w toku: „Ponów” to konflikt, utknięty da się ponowić"`: paczka na bramce, `readGeneration(...).stalled` niezdefiniowane, `readLessonDeck(...).generation.stalled` niezdefiniowane, `retryGeneration` → `conflict`, liczba prób i `agent_checkpoint` bez zmian; `claimed_at = now() - interval '11 minutes'` → nadal konflikt (10 min + 2 min marginesu); `13 minutes` → `stalled === true` w obu DTO, `retryGeneration` przechodzi → `queued`, `attempts = 0`. (b) popraw trzy istniejące testy ponowienia runu `running` (postarz `claimed_at` przed `retryGeneration`) oraz odpowiedniki w `lesson-agent-generation.test.ts`.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja: predykat; w `retryGeneration` run puli wybierany z `stalled`, `running && !stalled` → `conflict` przed jakąkolwiek zmianą; `readGeneration` i `latestLessonRunOfPurpose("pool")` zwracają `stalled: true`; web: `lessonExecution` z env (`try/catch` → domyślna polityka; błędne limity zatrzymują worker, nie web).
- [ ] **Step 4:** `pnpm test:integration tests/integration/lesson-generation.test.ts tests/integration/lesson-agent-generation.test.ts tests/integration/generation.test.ts` PASS; `*.architecture.test.ts` PASS. **Step 5:** commit.

### Task 3: worker przywraca utknięte runy puli (ustalenie 3)

Moduł: `materials` (`generation-runs.ts` — operacja, `generation-worker.ts` — wywołanie na początku przelotu). Transakcja: jeden `UPDATE` (autocommit) z CAS w `WHERE` (predykat z Task 2: `running` + wiek); nie dotyka wersji, więc nie wchodzi w kolejność blokad wersja → run (bierze tylko blokadę wiersza runu; równoległa finalizacja wygrywa albo przegrywa na ponownym sprawdzeniu `WHERE`).

**Interfaces — Produces:**
```ts
/** `running` → `queued` dla utkniętych runów puli; liczba prób i punkt kontrolny zostają. */
export async function requeueStalledLessonRuns(services: Pick<Services, "db" | "generation" | "lessonExecution">): Promise<number>;
```
Decyzja o budżecie prób: `attempts` się nie zeruje — przejęcie podbija próbę, więc spóźniony worker (stara wartość `attempts`) nie przejdzie straży, a run, który trzy razy wywraca worker, kończy po czwartym przejęciu zapisem części z punktu kontrolnego albo `attempts_exhausted` (istniejąca ścieżka `attempts > MAX_AUTOMATIC_ATTEMPTS`), zamiast krążyć bez końca. `next_attempt_at = null`, `error_code` bez zmian. Log `[lesson] run=… przywrócony po zatrzymaniu próba=…` bez treści.

**Files:** Modify `generation-runs.ts`, `generation-worker.ts`. Test: `tests/integration/lesson-generation.test.ts`.

- [ ] **Step 1: testy.** (a) `"worker przywraca run puli utknięty w running i kończy go"`: `claimQueuedRun`, postarzenie, `runDueGenerationWork` → `succeeded`, `attempts === 2`. (b) `"worker nie rusza zdrowego runu w toku"`: po `claimQueuedRun` bez postarzenia `runDueGenerationWork` zostawia `running`, zero wywołań paczek. (c) `"spóźniony worker po przywróceniu niczego nie zapisuje"`: paczka starej próby na bramce (`cancelPollMs: 60_000`), postarzenie, `runDueGenerationWork` (druga próba kończy `succeeded`), migawka rewizji, otwarcie bramki, rewizje i stan bez zmian. (d) `"utknięty run z wyczerpanymi próbami kończy attempts_exhausted"`: `attempts = 3`, `state = running`, postarzony → po `runDueGenerationWork` `failed`/`attempts_exhausted`, zero paczek. (e) run historyjki w `running` postarzony — nietknięty.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja. **Step 4:** PASS + `generation-worker.architecture.test.ts`. **Step 5:** commit.

### Task 4: test straży publikacji w trakcie „Dogeneruj” (ustalenie 4, serwer)

Bez zmian kodu serwera (publikacja już zamyka runy, a zapis sprawdza stan pod blokadami) — sam test. Jeśli test wykaże lukę, zatrzymaj się i opisz ją.

**Files:** Test: `tests/integration/lesson-generation.test.ts`.

- [ ] **Step 1:** `"publikacja w trakcie dogenerowania: spóźniony zapis nie zmienia opublikowanej wersji"`: pełna generacja → `regenerateObjective` z paczką na bramce → `executeLessonGeneration` (w locie, `await reached`) → `publishLessonDraft` → migawka rewizji → otwarcie bramki, `await` → run `superseded`, rewizje bez zmian, wersja `published`.
- [ ] **Step 2:** uruchom — oczekiwany PASS (test charakteryzujący); sprawdź, że pada po tymczasowym usunięciu straży stanu w `finalizeLessonPoolWrite` (i przywróć). **Step 3:** commit.

### Task 5: panel rodzica (ustalenia 2, 4, 5, 6, 7)

Moduł: `apps/web/src/parent/lessons/LessonEditor.tsx`, `apps/web/src/parent/EditorAssignments.tsx` (`EditorActionBar`), `packages/contracts/src/messages.ts`.

**Zachowanie:**
- `liveRun = lessonQuery.data?.generation` (bieżąca odpowiedź, także przy niezapisanych zmianach).
- `queueSlow`: `true` po `LESSON_QUEUE_NOTICE_MS = 180_000` nieprzerwanego `queued` tego samego runu i próby (`useEffect` + `setTimeout`, klucz `id:attempts`); bez nowego pola DTO — czas kolejki nie ma dziś znacznika w bazie.
- `generationStuck = liveRun.state === "running" ? liveRun.stalled === true : queueSlow`; `generationBlocksSave = (queued || running) && !generationStuck`.
- Zapis i publikacja: wyłączone przy `generationBlocksSave` (także strażnik w `save()`/`publish()`), powód `messages.lessons.generationBlocksSave` w pasku akcji, oba przyciski z `aria-describedby` na powód (`EditorActionBar`: `id` na tekście powodu, nowy opcjonalny prop `reasonBlocksSave`).
- Baner: przycisk „Ponów generowanie” przy `running` tylko gdy `stalled === true`, z tekstem `stalledPoolGenerationHint`; przy `queueSlow` tekst `generationQueueSlow` (`data-testid="generation-queue-slow"`).
- Alert porażki: `disabled={busy || isDirty || conflict || generationUnavailable}`; przy niezapisanych zmianach powód `messages.lessons.saveBeforePublish` („Najpierw zapisz zmiany.”) przez `aria-describedby` (`data-testid="generation-retry-blocked"`); to samo w wariancie utkniętym.
- Teksty (`messages.lessons`):
  - `generationBlocksSave`: „Trwa generowanie ćwiczeń. Zapis i publikacja będą dostępne po jego zakończeniu.”
  - `generationQueueSlow`: „Usługa generująca nie odpowiada. Możesz poczekać — zapis lub publikacja lekcji przerwie generowanie.”
  - `stalledPoolGenerationHint`: „Generowanie się zatrzymało. Możesz je ponowić — zapis lub publikacja lekcji je przerwie.”
  - `generationErrors.validation`: „Z tego materiału nie udało się przygotować poprawnych ćwiczeń. Możesz ponowić próbę albo utworzyć lekcję z innym materiałem.”
  - `generationErrors.attempts_exhausted`: „Kilka prób z rzędu się nie udało. Odczekaj chwilę i ponów generowanie.”
  - `generationErrors.provider`: „Usługa generująca jest chwilowo niedostępna. Ponów próbę za kilka minut.”
  - `generationErrors.internal`: „Generowanie przerwał błąd aplikacji. Ponowienie raczej nie pomoże — utwórz lekcję od nowa.”
  - `generationErrors.deck_version_gone`: „Ta wersja lekcji już nie istnieje. Odśwież stronę.”

**Files:** Modify jak wyżej. Test: `tests/e2e/parent-lesson-editor-layout.spec.ts` (mocked), `tests/e2e/lesson-parent.spec.ts` (real), test jednostkowy komunikatów w `packages/contracts/src/messages.test.ts` albo istniejącym pliku testów komunikatów.

- [ ] **Step 1: testy mocked** w `parent-lesson-editor-layout.spec.ts`: (a) `running` bez `stalled`: brak `retry-stalled-generation`, `save-lesson` i `publish-lesson` wyłączone, `publish-blocked-reason` = `generationBlocksSave`, dostępny opis przycisków; (b) `running` + `stalled: true`: przycisk widoczny i aktywny, klik wysyła `POST …/generation`, publikacja aktywna; (c) `failed` + zmiana tytułu: `generation-retry` wyłączony z opisem „Najpierw zapisz zmiany.”; bez zmian — aktywny; (d) `queued` + `page.clock`: po 3 min `generation-queue-slow` widoczny i publikacja aktywna, wcześniej nie; (e) blokada znika po zakończeniu runu mimo niezapisanych zmian (odpowiedź zaślepki zmienia się z `running` na `succeeded` po edycji tytułu → `save-lesson` aktywny); (f) `failed` z kodem `internal` pokazuje `generationErrors.internal`. Test jednostkowy: każdy z kodów `validation`, `attempts_exhausted`, `internal`, `provider`, `deck_version_gone` ma własny tekst różny od `generationFailed`.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja. **Step 4:** `UMIEM_E2E_WEB_MODE=dev UMIEM_E2E_PORT=<25600+> pnpm exec playwright test tests/e2e/parent-lesson-editor-layout.spec.ts --project=mocked` PASS.
- [ ] **Step 5: real** `lesson-parent.spec.ts:113`: test „parent can safely restart…” zmienia się w „zdrowy run w toku: bez ponowienia, zapis zablokowany, run kończy się sam” (`retry-stalled-generation` ma `toHaveCount(0)` przy widocznym banerze, `publish-blocked-reason` = `generationBlocksSave`, potem baner znika i są grupy ćwiczeń). Uruchom pojedynczo w trybie dev.
- [ ] **Step 6:** commit.

### Task 6: dokumentacja i MCP

- [ ] `docs/architecture.md` §19.17: akapit „Cykl życia runu puli” (predykat, przywracanie przez worker, reguły „Ponów”, blokada zapisu w panelu, ograniczenie: komunikat o kolejce liczony w przeglądarce).
- [ ] API → MCP → skill: sprawdź `apps/web/src/integrations/lesson-authoring-mcp-tools.ts`, `integrations/umiem-mcp/` i oba `SKILL.md` — narzędzia MCP nie wołają `retryGeneration` ani nie zwracają `GenerationDto`; jeśli to się potwierdzi, zapisz uzasadnienie braku wpływu w opisie PR (schemat konsumenta bez zmian: `stalled` było już w `GenerationDtoSchema`).
- [ ] `pnpm check`; commit.

---

## Poprawki po przeglądzie trzech krytyków (2026-11-10) — mają pierwszeństwo przed treścią zadań powyżej

**Task 1 (ponowienie po porażce):**
- W miejsce usuniętego porównania numerów edycji: run musi być NAJNOWSZYM runem puli wersji (`created_at desc`), inaczej `conflict` — stary nieudany run ze starej karty nie zamknie nowszego runu ani nie dopisze drugiej puli.
- Ponawiane dogenerowanie (`input.regenerate`): `conflict`, gdy zagadnienia nie ma już w `lessonContext.objectiveIds`; `input.dynamicTopic` runu odświeżane z bieżącego kontekstu wersji (rodzic mógł zmienić karty po porażce). Testy: „usunięte zagadnienie → conflict”, „starszy run → conflict”.
- Odroczone `queued` („Ponów” skraca odroczenie) idzie wspólną ścieżką z podbiciem numeru edycji — zerowanie `attempts` bez zmiany `expectedEditNumber` pozwalało na kolizję tożsamości ze spóźnionym workerem. `queued` nieodroczone nadal zwraca run bez zmian.
- Znane ograniczenie (do opisu PR): ponowiony pełny run dopisuje pulę do szkicu takiego, jaki jest — ćwiczenia dodane ręcznie po porażce zostają i nie są uwzględniane przy deduplikacji.

**Task 2 (predykat):**
- `lessonPoolRunStalled(stallAfterMs: number): SQL<boolean>` w `generation-runs.ts` (bez importu z `lessons/`); `lessonRunStallAfterMs(source: { generation?: { lessonExecution?: LessonGenerationPolicy }; lessonExecution?: LessonGenerationPolicy }): number` w `lessons/lesson-generation-policy.ts` (termin runu + `LESSON_RUN_STALL_MARGIN_MS = 120_000`).
- `stalled` tylko w `readLessonDeck` (`latestLessonRunOfPurpose` dostaje `stallAfterMs`, wywołanie w `lesson-api.ts`); `readGeneration` bez zmian — panel lekcji go nie czyta.
- `lessonGenerationPolicyFromEnv` eksportowane przez `modules/materials/index.ts`, potem root.
- Dokumentacja: `UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS` musi być wspólne dla web i workera.

**Task 3 (worker):**
- Test (c): także druga próba stoi na bramce (`running`, `attempts = 2`), gdy otwiera się bramka pierwszej; sprawdzane: punkt kontrolny, stan, rewizje bez zmian; dopiero potem druga kończy `succeeded`.
- Testy (b) i (e) to testy regresji (zielone przed implementacją); w (b) `claimed_at` postarzone o 11 minut (granica predykatu także w workerze).

**Task 4:** bez kroku mutacyjnego (starą próbę zatrzymują wcześniejsze straże); test sprawdza wynik: run `superseded`, rewizje i wersja bez zmian.

**Task 5 (panel):**
- Istniejący test „zawieszony run…” (`parent-lesson-editor-layout.spec.ts`) dostaje `stalled: true`; `regenUnavailableShown` w `LessonEditor.tsx` liczy `running` tylko z `stalled === true` (inaczej `aria-describedby` wskazuje nieistniejący element).
- Bez nowego `stalledPoolGenerationHint` — zostaje istniejący `lessons.stalledGenerationHint`.
- Teksty po uwagach:
  - `generationBlocksSave`: „Trwa generowanie ćwiczeń. Poprawki wprowadź po jego zakończeniu — teraz nie da się ich zapisać.” (zapis po zakończeniu runu przy niezapisanych zmianach kończy się istniejącym konfliktem wersji; blokada pól formularza to decyzja właściciela, poza zakresem).
  - `generationQueueSlow`: „Generowanie jeszcze się nie zaczęło. Możesz poczekać albo wrócić później. Zapis lub publikacja lekcji je przerwie.”
  - `generationErrors.validation`: „Nie udało się przygotować poprawnych ćwiczeń. Ponów próbę.”
  - `generationErrors.internal`: „Generowanie przerwał błąd aplikacji. Ponowienie może nie pomóc.”
- Test zegara: `page.clock.install()` przed otwarciem strony, `runFor`, asercja braku komunikatu przy 170 s i obecności po 180 s.
- Test real: asercja banera razem z `publish-blocked-reason` = `generationBlocksSave` (bramka `holdFakeGeneration` nie obejmuje puli lekcji — zostaje `FAKE_SLOW_MARKER`).

**Poza zakresem, do decyzji właściciela (raport):** alert i ponowienie dla runu `superseded`; blokada pól formularza w trakcie generowania; serwerowa odmowa zapisu przy zdrowym runie (druga karta nadal może go zamknąć).
