# Etap 5a: rozdział na przebiegu bazowym — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `english_chapter` generuje się w workerze przebiegiem bazowym (paczki → oczyszczenie i struktura → kontrola zamkniętych → walidacja puli), z etapem zagadnień jako jednym wywołaniem; heurystyki rozdziału i planista agenta znikają; narzędzia sondy są gotowe do bramki rozdziału.

**Architecture:** Wszystko w istniejących granicach: domena (`closed-check.ts`, `packet-plan.ts`, moduł rozdziału), moduł `materials/lessons` (przebieg bazowy, worker, etap zagadnień w `lesson-drafts.ts`), adaptery (`providers/openai/llm.ts`, `providers/openai/lesson-pool-agent.ts`) i fake'i. Transakcje, punkt kontrolny, wynik próby i zapis szkicu — bez zmian. Szkoła zostaje na agencie (5b).

**Tech Stack:** TypeScript strict, Vitest, Playwright, Drizzle (bez migracji), AI SDK w adapterze.

**Spec:** `docs/superpowers/specs/2026-11-08-llm-content-judgment-stage5-chapter-school-design.md` (v2.1, zatwierdzony) — §3, §4, §7.1–§7.5, §9, §10, §11.

## Global Constraints

- Kod nie rozumie języka: bez nowych reguł tekstowych; reguły strukturalne zostają (spec §4.3).
- Do generatora, etapu zagadnień i kontroli żadnych danych dziecka; dziennik `[lesson-baseline]` bez treści ćwiczeń.
- Prompt pozycji kontroli jednego pola (`closedCheckPrompt`, gałąź `choice`) i prompt paczki (`packetInstructions`) bez zmian tekstu — są wspólne z gramatyką po bramce.
- `PACKET_RESERVE` bez zmian (3).
- `OPENROUTER_API_KEY` tylko po https do OpenRouter; bez identyfikatorów modeli w commitach i PR.
- Szkoła i agent szkoły zachowują się bez zmian (produkcja między 5a i 5b): wspólny kod zmieniamy tak, żeby ścieżka agenta dawała ten sam wynik.
- Bez migracji. API → MCP → skill bez zmian.

## Review Focus

1. Ćwiczenie match/group/cloze, w którym model zwraca komplet dla części pól (krótsza lista wyników) — całe ćwiczenie odpada jako `check_unknown`, a wyniki innych ćwiczeń paczki nie przesuwają się (Task 2).
2. Run rozdziału w toku przy wdrożeniu z punktem kontrolnym agenta (`dynamicTopic` + `planExamples`, część zagadnień `complete`) wznawia się przebiegiem bazowym bez ponownego etapu zagadnień i bez utraty przykładów (Task 2).
3. Etap zagadnień rozdziału zwraca zagadnienie bez `kind` albo z nieznanym `kind` — schemat wymaga pola; zagadnienie bez poprawnego `kind` nie przechodzi po cichu jako `words` (Task 3).
4. Ręczna edycja szkicu rozdziału ze słowem spoza materiału albo poleceniem „Wybierz słowo” zapisuje się (Task 4).
5. Tłumaczenie z modelu bez `instructionPl` w przebiegu bazowym dostaje stałe polecenie, a nie odpada (Task 4).

---

### Task 1: Kontrola match, group, cloze jako pozycje pól

**Files:**
- Modify: `packages/server/src/domain/lessons/closed-check.ts`
- Modify: `tests/probes/closed-check-gold.probe.test.ts` (nowe API)
- Test: `packages/server/src/domain/lessons/closed-check.test.ts`

**Interfaces:**
- Produces:
  - `closedCheckContract(type)`: `lesson_match`, `lesson_group`, `lesson_cloze` → `"choice"` (reszta bez zmian);
  - `closedCheckItems(draft: LessonExerciseDraft, topic: LessonTopic): string[] | null` — zastępuje `closedCheckItem`; typy jednego pola → `[view]` (ten sam tekst co dziś), match/group/cloze → jedna pozycja na pole, `null` jak dziś (typ bez kontroli, słuchanie bez zdania);
  - `closedCheckVerdict(draft: LessonExerciseDraft, results: readonly unknown[], normalizer: AnswerNormalizer): ClosedCheckVerdict` — `results` to wyniki pozycji tego ćwiczenia w kolejności `closedCheckItems`.

- [ ] **Step 1: Testy (w `closed-check.test.ts`)**
  - `match: one item per left side, view without key` — 3 pary + 1 `extraRight`: 3 pozycje; każda zawiera widok `solverView` bez tytułu celu, wiersz `Field: <left>` z dopiskiem, że pozostałe pary nie zawężają wyboru, i `Options: ` z posortowanymi prawymi stronami i `extraRight`; żadna pozycja nie zawiera pary `left → right`.
  - `group: fields in view order` — kolejność pól = `groupItemsInViewOrder(draft)`; opcje = etykiety grup.
  - `cloze: numbered gaps only in the check view` — `clozeText` z dwoma `___` w widoku pozycji ma `___ (1)` i `___ (2)`; `solverView(draft, topic)` nadal zwraca `___` bez numerów; opcje = posortowany bank.
  - `single-field types unchanged` — dla choice, listen_choice, short_answer, notice, order `closedCheckItems` zwraca `[closedCheckItem-z-main]` (ten sam tekst; zrób migawkę tekstu z `main` w teście).
  - `verdict: all fields must pass` — match: wyniki `[["a"],["b"],["c"]]` równe kluczom → `pass`; jedno pole `["a","x"]` (dystraktor też poprawny) → `check_wrong_set`; jedno pole `[]` → `check_wrong_set`; jedno pole `null` → `check_unknown`; za krótka lista wyników → `check_unknown`; tekst spoza opcji → `check_wrong_set`.
  - `verdict: cloze swapped gaps` — pole 1 `["red","blue"]` → `check_wrong_set`.
  - `verdict: texts compared with subject normalizer` — wielkość liter i apostrofy jak w dzisiejszym teście wyboru.

- [ ] **Step 2: Uruchom** `pnpm vitest run packages/server/src/domain/lessons/closed-check.test.ts` — FAIL (brak `closedCheckItems`).

- [ ] **Step 3: Implementacja** w `closed-check.ts`: wspólna funkcja pól `fieldsOf(draft) → { label: string; options: {key,text}[]; key: Set<string> }[] | null` (jedno pole dla typów dzisiejszych — opcje i klucz jak dziś w `choicesOf`/`keyChoices`); widok pozycji = widok bazowy + (dla wielu pól) wiersz pola i opcji; werdykt dzisiejszej logiki wyboru wywołany per pole (komplet = dokładnie klucz pola; notice — jak dziś). `groupItemsInViewOrder` importowany z `agent/solver.ts` (eksport, jeśli brak). Rozsypanka bez zmian (`results[0]`).

- [ ] **Step 4: Popraw wołających** `closedCheckItem`/`closedCheckVerdict`: `lesson-baseline-pool.ts` (tymczasowo: `views.length === 1`, pełna obsługa w Task 2) i `tests/probes/closed-check-gold.probe.test.ts`.

- [ ] **Step 5: Uruchom** testy z kroku 1, `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts packages/server/src/providers/openai/lesson-pool-agent.test.ts` i `pnpm typecheck` — PASS.

- [ ] **Step 6: Commit** `Etap 5a: kontrola match, group i cloze jako pozycje pól`.

### Task 2: Przebieg bazowy — pozycje pól, temat dynamiczny, oczyszczenie przedmiotu

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts`

**Interfaces:**
- Consumes: `closedCheckItems`, `closedCheckVerdict` (Task 1).
- Produces: `runLessonBaselinePool` przyjmuje `objectiveSource.source === "input"` (temat z `subject.buildDynamicTopic(source.dynamicTopic)`, jak `runLessonPoolAgent`); `"planner"` nadal rzuca `AppError("validation")` (znika z typu w Task 3). Wynik `planStatus: "not_needed"`, `onObjectivesResolved({ dynamicTopic, planExamples: {}, spentUsd })` z tematem wejścia. Rodzaje zagadnień (`kindsOf`) do `agentObjectivesOf` jak u agenta.

- [ ] **Step 1: Testy (fake'i portów)**
  - `multi-field exercise sends one check item per field and maps results back` — paczka match (2 ćwiczenia po 3 pary) + fake checkera zwracający 6 wyników; drugie ćwiczenie z błędnym polem odpada `check_wrong_set`, pierwsze przechodzi; wywołanie kontroli ma 6 pozycji.
  - `short check result rejects only the affected exercises` — checker zwraca 4 wyniki z 6: pierwsze ćwiczenie ocenione normalnie, drugie `check_unknown` (Review Focus 1).
  - `dynamic topic source` — przedmiot testowy z `buildDynamicTopic`, źródło `input`: paczki z typów zagadnienia, `onObjectivesResolved` dostaje `dynamicTopic`.
  - `resumes an agent checkpoint` — wejście jak z `lessonAgentRunInputFor` dla punktu kontrolnego agenta (`dynamicTopic`, `planExamples` → `initialExamples`, `examplesFixed: true`, jedno zagadnienie w `skipObjectives`): pominięte zagadnienie bez wywołań, przykłady zachowane, pierwsza paczka bez `withExamples` (Review Focus 2).
  - `subject sanitize runs before validation` — przedmiot testowy z `agentPolicy.sanitize` wstawiającym polecenie: ćwiczenie bez polecenia przechodzi walidację, która go wymaga.
  - `grammar unchanged` — istniejące testy przebiegu bazowego bez zmian oczekiwań.

- [ ] **Step 2: Uruchom** `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts` — FAIL.

- [ ] **Step 3: Implementacja**
  - `resolveInput`: gałąź `input` (przedmiot bez `buildDynamicTopic` → `AppError("validation")`); `kindsOf(dynamicTopic)` do `agentObjectivesOf`.
  - W `runPacket` po `parseLessonRecord`: `subject.agentPolicy.sanitize?.(draft, { material: input.material })?.draft ?? draft` przed sprawdzeniem typu i walidacją. Wywołanie przyjmowania agenta (`admission.ts`) zostaje do 5c — agent szkoły bez zmian.
  - Kontrola: dla każdego ćwiczenia `closedCheckItems` → lista `{ draft, views }`; jedno `checkClosed` z płaską listą pozycji; werdykt z wycinka wyników ćwiczenia. Ćwiczenie z `views === null` odpada `check_unknown` jak dziś.

- [ ] **Step 4: Uruchom** testy z kroku 1 i `pnpm vitest run packages/server/src/modules/materials/lessons` — PASS.

- [ ] **Step 5: Commit** `Etap 5a: przebieg bazowy dla tematu dynamicznego i ćwiczeń z wieloma polami`.

### Task 3: Etap zagadnień rozdziału jednym wywołaniem, usunięcie planisty

**Files:**
- Modify: `packages/server/src/ports/ai.ts` (`LessonObjectivesInput.objectivesRules?: string`; usunięcie `LessonAgentPlanInput` i `planObjectives`)
- Modify: `packages/server/src/providers/openai/llm.ts` (`lessonObjectivesJsonSchema`, `lessonObjectivesSystemPrompt`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`generateDynamicObjectives` przekazuje `objectivesRules`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-agent-outcome.ts` (`poolSource` bez gałęzi `planner`), `lesson-pool-agent.ts` (`AgentObjectiveSource` bez `planner`, `resolveSubject` i `runLessonPoolAgent` bez planisty, `examplesFixed` domyślnie `false`)
- Modify: `packages/server/src/domain/lessons/subjects/english-chapter/prompts.ts` (stałe `CHAPTER_MIN_OBJECTIVES = 3`, `CHAPTER_MAX_OBJECTIVES = 6` zamiast importu z `agent/plan.ts`)
- Modify: `packages/server/src/domain/lessons/types.ts` (`SubjectAgentPolicy` bez `planCoverage`, `planGate`), `subjects/english-chapter/agent-policy.ts`
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts` (`topicsFromMaterial` bez `planCoverage`)
- Delete: `packages/server/src/domain/lessons/agent/plan.ts` (+ test), `packages/server/src/modules/materials/lessons/lesson-pool-agent-plan.ts` (+ test)
- Modify: `packages/server/src/providers/openai/lesson-pool-agent.ts` (usunięcie `planObjectives`, `plannerInstructions`, `planSchema`), `packages/server/src/providers/fake-lesson-agent.ts` (usunięcie `planObjectives`, `fakePlanFromCoverage`), `packages/server/src/providers/fake.ts` (`fakeLessonObjectives` z `kind`, gdy `objectivesRules`)
- Test: `providers/openai/llm.test.ts` (albo istniejący test etapu zagadnień), `lesson-agent-outcome.test.ts`, `lesson-api` (katalog), integracja w Task 5.

**Interfaces:**
- Produces: `LessonObjectivesInput.objectivesRules?: string`; przy nim schemat zagadnienia ma `kind: { enum: ["words","frame"] }` w `required`, a prompt systemowy kończy się tekstem `objectivesRules`. `generateDynamicObjectives(llm, control, subject, input)` bez zmiany sygnatury.

- [ ] **Step 1: Testy**
  - `objectives schema requires kind only with objectivesRules` — schemat dla wejścia z `objectivesRules` ma `kind` w `required` z enum; bez — nie ma pola; prompt zawiera `objectivesRules`.
  - `chapter objectives without valid kind are dropped` — `generateDynamicObjectives` dla rozdziału z fake'iem zwracającym jedno zagadnienie bez `kind` i jedno z `kind: "frame"`: temat ma tylko drugie, `droppedObjectiveCount` 1 (Review Focus 3). Dziś `buildDynamicTopicData` zamienia nieznany `kind` na brak rodzaju, a `TYPES_BY_KIND` bierze wtedy `words`: `generateDynamicObjectives` dla przedmiotu z `objectivesRules` liczy zagadnienie bez `kind` jako odrzucone (to samo miejsce co dzisiejsze `built.errors`).
  - `poolSource: chapter needs the objectives stage` — rozdział bez tematu → `{ needsObjectives: true }`; z `progress.dynamicTopic` → `input`.
  - `catalog: chapter shows the objectives-stage service` — `generationServices` rozdziału obejmuje usługę `UMIEM_LLM_*`, gdy różni się od usługi agenta.

- [ ] **Step 2: Uruchom** testy — FAIL.

- [ ] **Step 3: Implementacja** wg Files; usuń martwe importy, testy planisty i przypadki planisty w testach agenta, fake'a i adaptera (`lesson-pool-agent.test.ts`, `fake-lesson-agent.test.ts`, `openai/lesson-pool-agent.test.ts`, `lesson-pool-prompt.test.ts`).

- [ ] **Step 4: Uruchom** `pnpm typecheck` i `pnpm test:unit` — PASS.

- [ ] **Step 5: Commit** `Etap 5a: zagadnienia rozdziału jednym wywołaniem etapu zagadnień, bez planisty agenta`.

### Task 4: Rozdział bez heurystyk, na przebiegu bazowym

**Files:**
- Modify: `packages/server/src/domain/lessons/subjects/english-chapter/module.ts` (`baselinePool: true`, bez `refineGeneratedPool`; sam hak w `SubjectModule` i reguła `lesson.refine_unnamed` zostają do 5c — używa ich przedmiot testowy agenta), `validators.ts` (zostają `stem_single_gap`, `translation_instruction_required`, `hint_not_allowed`, `order_items_distinct`; `withTranslationInstruction` przenosi się do `agent-policy.ts` jako `sanitize`), `rules.ts` (bez `instruction_stimulus`, `word_outside_material`, `function_words_only`, `card_word_missing`, `frame_missing` i bez `...ENGLISH_RULES`), `agent-policy.ts` (bez `requiredTypes`, `exerciseGate`, `objectiveGaps`, `objectiveCardWords`, `objectiveFrames`; z `sanitize`; haki w typie `SubjectAgentPolicy` zostają do 5c), `chapter.rule-cases.ts`, `prompts.ts` (dydaktyka — krok 3)
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-acceptance.ts` (`sanitizeFreshLessonDraft` usuwa niezamówione pola v3 przy `subject.usesV3Payload !== true`; `UNSOLICITED_V3_FIELDS` przeniesione z rozdziału)
- Delete: `subjects/english-chapter/lexicon.ts`, `material-lexicon.ts`, `subjects/english/listen-audibility.ts`, `subjects/english/rules.ts`, `subjects/english/english.rule-cases.ts` (+ testy); usuń eksport `stemsOf`, jeśli nie ma odbiorcy poza `inflection.ts`
- Test: `english-chapter/module.test.ts`, `validators.test.ts`, `rule-cases.test.ts`, `lesson-pool-acceptance` (test istniejący albo nowy), migawka `__snapshots__/lesson-packet-prompt.english_chapter*.txt` (nowa)

**Interfaces:**
- Consumes: Task 2 (`sanitize` wołane w przebiegu bazowym).
- Produces: `englishChapterSubject.baselinePool === true`; `chapterAgentPolicy.sanitize(draft) → { draft, removed: [] }` (tłumaczenie bez polecenia dostaje `TRANSLATION_INSTRUCTION`).

- [ ] **Step 1: Testy**
  - `chapter module: baseline, no refine hook, structural rules only` — `baselinePool`, brak `refineGeneratedPool`, katalog reguł rozdziału to dokładnie `chapter.stem_single_gap`, `chapter.translation_instruction_required`, `chapter.hint_not_allowed`, `chapter.order_items_distinct`.
  - `parent edit accepts words outside the material and a generic instruction` — `validateLessonExerciseIssues` na ćwiczeniu choice z „Wybierz słowo” i słowem spoza materiału: brak zgłoszeń (Review Focus 4).
  - `fresh translation without instruction gets the fixed instruction` — `parseLessonRecord` + `sanitize` (Review Focus 5).
  - `unsolicited v3 fields stripped for subjects without v3 payload` — rozdział i gramatyka: `sourceRefs` z modelu usunięte; szkoła: zostają.
  - `packet prompt snapshot` — migawka promptu paczki rozdziału (zagadnienie `words`, typ `lesson_cloze`) i liczba znaków.

- [ ] **Step 2: Uruchom** — FAIL.

- [ ] **Step 3: Dydaktyka do promptu** (`english-chapter/prompts.ts`, bez list sprawdzeń, po angielsku): w `fieldRules` jedno zdanie — „In lesson_choice, lesson_gap, lesson_order and lesson_cloze, instructionPl starts with the Polish sentence the child translates, then the task; a bare task such as 'Wybierz słowo' is not enough.”; jedno zdanie — „The checked part of every exercise (gap word, correct option, answer, left sides of pairs, group items) is a word or the sentence frame of THIS objective's cards; other chapter words only fill the sentence.” Reszta (tylko słowa materiału) jest już w `generationRole`.

- [ ] **Step 4: Implementacja** wg Files; testy i przypadki usuniętych reguł usuń; `validators.test.ts` zostaje z przypadkami reguł strukturalnych.

- [ ] **Step 5: Uruchom** `pnpm typecheck`, `pnpm test:unit` (z testami architektury i `rules.architecture.test.ts`) — PASS.

- [ ] **Step 6: Commit** `Etap 5a: rozdział na przebiegu bazowym, usunięcie heurystyk rozdziału`.

### Task 5: Fake'i, testy integracyjne i E2E rozdziału

**Files:**
- Modify: `packages/server/src/providers/fake-lesson-pool.ts` (`fakePacketExercises` dla typów rozdziału z danych materiału; parser listy „en — pl” i ram przeniesiony tu z `material-lexicon.ts` jako kod fake'a), `packages/server/src/providers/fake-lesson-agent.ts` (`FakeExerciseChecker.checkClosed` dla pozycji pól)
- Modify: `tests/integration/lesson-chapter.test.ts`, `lesson-listen-choice.test.ts`, `source-materials.test.ts`, `fakes.ts`, `chapter-lesson-helpers.ts` (gdzie potrzeba)
- Test: `fake-lesson-pool.test.ts`, `fake-lesson-agent.test.ts`, E2E rozdziału

**Interfaces:**
- Produces: `FakeLessonPoolAgent` i `FakeExerciseChecker` mogą dzielić `FakeKeyBook` (`Map<string, string>`: etykieta pola → tekst klucza), który fake generatora wypełnia dla match/group/cloze, a fake kontroli czyta z wiersza `Field:` pozycji; tworzone razem w składaniu fake'ów workera i w `tests/integration/fakes.ts`. Pozycje jednego pola — dzisiejsza konwencja `fakeClosedAnswer`.

- [ ] **Step 1: Testy fake'ów** — `fake packet for chapter types passes structure and closed check` (match, group, cloze, choice, order, gap, open_answer, listen dla zagadnienia `words` i `frame`: wszystkie przechodzą `parseLessonRecord`, walidację i `closedCheckVerdict` z wynikami fake'a kontroli).
- [ ] **Step 2: Integracja** — w `lesson-chapter.test.ts` przypadki mechaniki agenta rozdziału (skrypty `submit`, `plans`, bramki kart i ram, planista) usuń; przypadki zachowania rozdziału niezależne od generatora zostają (pula z edycji rodzica albo z fake'a paczek); dodaj `chapter lesson generates through the baseline` (nowa lekcja: etap zagadnień z `kind`, przebieg bazowy, szkic publikowalny), `resume from an agent checkpoint` (punkt kontrolny w formacie agenta) i `add N on a chapter objective`. Analogicznie `lesson-listen-choice` i `source-materials` (przypadki rozdziału na fake paczek).
- [ ] **Step 3: Uruchom** `pnpm test:integration` — PASS.
- [ ] **Step 4: E2E** — `pnpm exec playwright test` speków rozdziału (`UMIEM_E2E_WEB_MODE=dev` do iteracji); zmiana oczekiwań tylko z uzasadnieniem w commicie.
- [ ] **Step 5: Commit** `Etap 5a: fake'i i testy rozdziału na przebiegu bazowym`.

### Task 6: Narzędzia sondy i materiały bramki rozdziału

**Files:**
- Modify: `tests/probes/chapter-generation.probe.test.ts` (model etapu zagadnień w `models` także dla rozdziału; SHA `HEAD` w zrzucie; asercja `findExposureLeaks(…, "coverage")` ze zdaniami kart na zapisanym szkicu = 0, inaczej błąd; pokrycie z listy fixture'u: `UMIEM_PROBE_COVERAGE` — plik JSON `{ forms: string[][] }`, forma = alternatywy podciągu bez wielkości liter w kartach i angielskich polach ćwiczeń; wynik w zrzucie)
- Modify: `tests/probes/blind/score.cjs` (typy match, group, cloze, keywords, calculation w listach klas; `W6h` z polem `hasHint`; próg „≤ 1 wada” przy mianowniku < 34 w trybie materiału wstrzymanego), `gen-blind-sheet.cjs` (rubryka jako argument, domyślnie `rubric-stage2.md`; `hasHint` w kluczu; `graderAvailable` poza polami równymi między ramionami)
- Modify: `tests/probes/closed-check-gold.probe.test.ts` (przedmiot, temat i materiał per przypadek; mutacje klucza bez osobnych wywołań poza rozsypanką — spec §7.3)
- Create: `tests/probes/blind/rubric-stage5.md` (spec §7.4), `tests/probes/fixtures/closed-check-gold-stage5.json` (przypadki rozdziału: match, group, cloze po 4 poprawne + 3 „druga poprawna”, choice/listen/order rozdziału po 2), `tests/probes/fixtures/chapter-{clothes-weather,home-rooms,food-likes}.txt` i `…-coverage.json`
- Test: `score.test.ts`, `probe-helpers.test.ts` (pomocniki pokrycia i mutacji)

- [ ] **Step 1: Testy pomocników** — `coverage counts forms case-insensitively in cards and English fields`, `score: W1 applies to lesson_match`, `score: small denominator uses at most one defect`, `gold: wrong-key verdict computed from the correct item's answers` (bez wywołania).
- [ ] **Step 2: Uruchom** `pnpm vitest run tests/probes/blind/score.test.ts tests/probes/probe-helpers.test.ts` — FAIL, potem implementacja, PASS.
- [ ] **Step 3: Materiały i rubryka** — trzy fikcyjne rozdziały (format „en — pl”, sekcja „Zwroty:” z ramami), listy form, rubryka; SHA-256 plików do opisu PR.
- [ ] **Step 4: Commit** `Etap 5a: narzędzia sondy i materiały bramki rozdziału`.

### Task 7: Dokumentacja

**Files:** `docs/architecture.md` (§19.17: rozdział na przebiegu bazowym, kontrola pól, etap zagadnień rozdziału, oczyszczenie w kroku struktury; opis planisty agenta usunięty), `AGENTS.md` (rozdział na przebiegu bazowym; planista i bramki rozdziału usunięte; katalog reguł rozdziału bez heurystyk), spec etapu (status 5a).

- [ ] **Step 1:** aktualizacja tekstów; `pnpm check` — PASS.
- [ ] **Step 2: Commit** `Etap 5a: dokumentacja`.

### Task 8: Sprawdzenia przed bramką i PR

- [ ] `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards` (w tle), testy architektury — PASS; wynik i czasy do notatki.
- [ ] Zapytanie tylko do odczytu o runy rozdziału w toku (za zgodą właściciela) — do opisu PR.
- [ ] Bilans §10 (`wc -l` na ścieżkach specu §9.2) i znaki migawek promptów.
- [ ] **Płatne biegi (spec §7.7) — tylko po zgodzie właściciela**: wzorcowe → runda 0 (worktree `main` na przypiętym SHA dla ramienia agenta) → strojenie (≤ 2 rundy, wyłącznie pola przedmiotu) → bieg potwierdzający → sędziowie (sędzia 1 skryptowy Claude Opus przez OpenRouter, sędzia 2 automatyczny) → raport §7.8 → decyzja właściciela.
- [ ] Trzech krytyków na całej gałęzi, potem `ponytail:ponytail-review`; wynik obu w opisie PR; PR do `main` z wpływem API → MCP → skill.
