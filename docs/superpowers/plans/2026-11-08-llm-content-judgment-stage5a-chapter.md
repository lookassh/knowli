# Etap 5a: rozdział na przebiegu bazowym — plan implementacji

Wersja 2, 2026-11-08, po przeglądzie trzech krytyków planu (prostota, poprawność kodu i danych, dydaktyka i pomiar).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `english_chapter` generuje się w workerze przebiegiem bazowym (paczki → oczyszczenie i struktura → kontrola zamkniętych → walidacja puli), z etapem zagadnień jako jednym wywołaniem; heurystyki rozdziału i planista agenta znikają; narzędzia sondy są gotowe do bramki rozdziału.

**Architecture:** W istniejących granicach: domena (`closed-check.ts`, moduł rozdziału), moduł `materials/lessons` (przebieg bazowy, worker, etap zagadnień w `lesson-drafts.ts`), adaptery (`providers/openai/llm.ts`, `providers/openai/lesson-pool-agent.ts`) i fake'i. Transakcje, punkt kontrolny, wynik próby i zapis szkicu — bez zmian. Szkoła zostaje na agencie (5b).

**Tech Stack:** TypeScript strict, Vitest, Playwright, Drizzle (bez migracji), AI SDK w adapterze.

**Spec:** `docs/superpowers/specs/2026-11-08-llm-content-judgment-stage5-chapter-school-design.md` (v2.1, zatwierdzony) — §3, §4, §7.1–§7.5, §9, §10, §11.

## Global Constraints

- Kod nie rozumie języka: bez nowych reguł tekstowych; reguły strukturalne zostają (spec §4.3).
- Do generatora, etapu zagadnień i kontroli żadnych danych dziecka; dziennik `[lesson-baseline]` bez treści ćwiczeń.
- Prompt pozycji kontroli (`closedCheckPrompt`) i prompt paczki (`packetInstructions`) bez zmian tekstu — wspólne z gramatyką po bramce. `PACKET_RESERVE` bez zmian (3).
- Szkoła i agent szkoły bez zmian zachowania (produkcja między 5a i 5b).
- `OPENROUTER_API_KEY` tylko po https do OpenRouter; bez identyfikatorów modeli w commitach i PR. Bez migracji; API → MCP → skill bez zmian.

## Review Focus

1. Ćwiczenie match/group/cloze, dla którego wynik kontroli ma za mało pozycji: w adapterze zła długość listy daje `undefined` dla całej paczki (`sameLength`), w przebiegu każde ćwiczenie bez kompletu wyników pól odpada `check_unknown`, a wyniki innych ćwiczeń się nie przesuwają (Task 1; test na fake'u).
2. Run rozdziału w toku przy wdrożeniu z punktem kontrolnym agenta (`dynamicTopic` + `planExamples`, część zagadnień `complete`) wznawia się przebiegiem bazowym bez etapu zagadnień i bez utraty przykładów (Task 1).
3. Etap zagadnień rozdziału zwraca zagadnienie bez poprawnego `kind` — zagadnienie odpada (licznik odrzuconych), nie przechodzi po cichu jako `words` (Task 2).
4. Ręczna edycja szkicu rozdziału ze słowem spoza materiału albo poleceniem „Wybierz słowo” zapisuje się (Task 3).
5. Tłumaczenie z modelu bez `instructionPl` w przebiegu bazowym dostaje stałe polecenie, a nie odpada (Task 3).

---

### Task 1: Kontrola pól i przebieg bazowy dla tematu dynamicznego

**Files:**
- Modify: `packages/server/src/domain/lessons/closed-check.ts`, `packages/server/src/domain/lessons/agent/solver.ts` (eksport `groupItemsInViewOrder`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts`
- Modify: `tests/probes/closed-check-gold.probe.test.ts` (nowe API; reszta zmian w Task 5)
- Test: `packages/server/src/domain/lessons/closed-check.test.ts`, `packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts`

**Interfaces:**
- Produces:
  - `closedCheckContract(type)`: `lesson_match`, `lesson_group`, `lesson_cloze` → `"choice"`;
  - `closedCheckItems(draft: LessonExerciseDraft, topic: LessonTopic): string[] | null` (zastępuje `closedCheckItem`): typy jednego pola → `[view]` z dzisiejszym tekstem; match/group/cloze → jedna pozycja na pole; `null` jak dziś;
  - `closedCheckVerdict(draft, results: readonly unknown[], normalizer): ClosedCheckVerdict` — wyniki pozycji tego ćwiczenia w kolejności `closedCheckItems`;
  - `runLessonBaselinePool` przyjmuje źródło `input` (temat z `subject.buildDynamicTopic(source.dynamicTopic)`, `onObjectivesResolved({ dynamicTopic, planExamples: {}, spentUsd })`); po `parseLessonRecord` woła `subject.agentPolicy.sanitize?.(draft, { material })`.

- [ ] **Step 1: Testy domeny** (`closed-check.test.ts`)
  - `match: one item per left side, view without key` — 3 pary + 1 `extraRight`: 3 pozycje; każda = widok bez tytułu celu + wiersz `Field: <left>` z dopiskiem, że pozostałe pola nie zawężają wyboru, + `Options: ` (posortowane prawe strony i `extraRight`); żadna pozycja nie zawiera par klucza.
  - `group: fields in view order` — kolejność pól = `groupItemsInViewOrder(draft)`, opcje = etykiety.
  - `cloze: gaps numbered only in the check view` — luki liczone jak w `clozeParts`/`lessonGapParts` (2+ podkreślenia); pozycja pokazuje `___ (1)`, `___ (2)` przez `solverView({ ...draft, clozeText: numbered }, untitled)`; `solverView(draft, topic)` bez zmian.
  - `single-field types unchanged` — choice, listen_choice, short_answer, notice, order: `closedCheckItems` = `[tekst z main]` (literał w teście).
  - `verdict` — wszystkie pola równe kluczom → `pass`; pole `["a","x"]` → `check_wrong_set`; pole `[]` → `check_wrong_set`; pole `null` / brak wyniku pola → `check_unknown`; tekst spoza opcji → `check_wrong_set`; cloze z zamienionymi słowami → `check_wrong_set`; normalizator przedmiotu (wielkość liter, apostrofy).
- [ ] **Step 2: Testy przebiegu** (`lesson-baseline-pool.test.ts`, fake'i portów)
  - `multi-field exercises: one check item per field, results mapped back` — 2 ćwiczenia match po 3 pary, fake kontroli zwraca 6 wyników; drugie z błędnym polem odpada `check_wrong_set`; wywołanie kontroli ma 6 pozycji.
  - `missing field results reject only the affected exercise` (fake: 4 wyniki z 6) — Review Focus 1.
  - `dynamic topic source` — przedmiot testowy z `buildDynamicTopic`: paczki z typów zagadnienia; `onObjectivesResolved` z tematem.
  - `resumes an agent checkpoint` — wejście z `lessonAgentRunInputFor` dla punktu kontrolnego agenta (`dynamicTopic`, `planExamples`, jedno zagadnienie `complete`): pominięte bez wywołań, przykłady zachowane, bez `withExamples` (Review Focus 2).
  - `subject sanitize runs before validation` — przedmiot testowy z `sanitize` wstawiającym wymagane polecenie.
- [ ] **Step 3: Uruchom** `pnpm vitest run packages/server/src/domain/lessons/closed-check.test.ts packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts` — FAIL.
- [ ] **Step 4: Implementacja.** `closed-check.ts`: wspólne `fieldsOf(draft)` (etykieta, opcje `{key,text}`, klucz) — dzisiejsze typy jako jedno pole z logiką `choicesOf`/`keyChoices`; werdykt dzisiejszej logiki wyboru per pole; rozsypanka `results[0]`. Przebieg: `resolveInput` z gałęzią `input` (przedmiot bez `buildDynamicTopic` → `AppError("validation")`); kontrola jednym `checkClosed` z płaską listą pozycji i wycinkiem wyników per ćwiczenie. Wywołanie `sanitize` w przyjmowaniu agenta zostaje do 5c.
- [ ] **Step 5: Uruchom** testy z kroków 1–2, `pnpm vitest run packages/server/src/modules/materials/lessons packages/server/src/providers` i `pnpm typecheck` — PASS.
- [ ] **Step 6: Commit** `Etap 5a: kontrola pól match, group, cloze i przebieg bazowy dla tematu dynamicznego`.

### Task 2: Etap zagadnień rozdziału jednym wywołaniem, usunięcie planisty

**Files:**
- Modify: `ports/ai.ts` (`LessonObjectivesInput.objectivesRules?: string`; usunięcie `LessonAgentPlanInput`, `planObjectives`), `providers/openai/llm.ts`, `modules/materials/lessons/lesson-drafts.ts` (`generateDynamicObjectives`), `lesson-agent-outcome.ts` (`poolSource` bez `planner`; `planStatus`, `planFailure` i wiersz `plan_failed` w `lessonAgentRunOutcome` usunięte; `examplesFixed` bez `|| source === "planner"`), `lesson-pool-agent.ts` (`AgentObjectiveSource` bez `planner`, `runLessonPoolAgent` i `resolveSubject` bez planisty, wynik bez `planStatus`), `lesson-baseline-pool.ts` i `lesson-agent-generation.ts` (bez `planStatus`), `lesson-pool-agent-policy.ts` i `config.ts` (bez `planMaxSteps`), `lesson-api.ts` (`topicsFromMaterial` bez `planCoverage`), `domain/lessons/types.ts` (`SubjectAgentPolicy` bez `planCoverage`, `planGate`), `subjects/english-chapter/agent-policy.ts`, `subjects/english-chapter/prompts.ts` (stałe `CHAPTER_MIN_OBJECTIVES = 3`, `CHAPTER_MAX_OBJECTIVES = 6`)
- Modify: `providers/openai/lesson-pool-agent.ts` (bez `planObjectives`, `plannerInstructions`, `planSchema`, operacji `agent_plan`), `providers/fake-lesson-agent.ts` (bez `planObjectives`, `fakePlanFromCoverage`, `agent_plan`), `providers/fake.ts` (`fakeLessonObjectives`: przy `objectivesRules` poprawne zagadnienia rozdziału z `kind` dla dowolnego tekstu)
- Modify: `tests/probes/probe-submissions.ts`, `tests/probes/probe-submissions.test.ts`, `tests/probes/agent-generation.probe.test.ts` (bez planisty i źródła `planner`)
- Delete: `domain/lessons/agent/plan.ts`, `modules/materials/lessons/lesson-pool-agent-plan.ts` (+ testy); `__snapshots__/lesson-pool-prompt.english_chapter*.txt` i `english_chapter` z `SUBJECT_IDS` w `lesson-pool-prompt.test.ts`
- Modify testy: `grammar/agent-policy.test.ts`, `school/agent-policy.test.ts`, `rules/rules.architecture.test.ts` (lista haków bez `planGate`), testy agenta, fake'a i adaptera z przypadkami planisty
- Docs: `docs/architecture.md` (operacja `agent_plan` jako historyczna), `docs/provider-config.md`

**Interfaces:**
- Produces: przy `objectivesRules` schemat etapu zagadnień ma `kind: { enum: ["words","frame"] }` w `required`, a prompt systemowy zastępuje dwa ogólne zdania (liczba „2-8” i opis kart) tekstem `objectivesRules`; bez `objectivesRules` prompt i schemat bez zmian (szkoła).

- [ ] **Step 1: Testy**
  - `objectives schema and prompt with objectivesRules` — `kind` w `required` z enum; prompt zawiera `objectivesRules` i nie zawiera „2-8” ani „Polish explanation cards”; bez `objectivesRules` — tekst i schemat identyczne z dzisiejszymi (literał).
  - `chapter objective without valid kind is dropped` — `generateDynamicObjectives` dla rozdziału: zagadnienie bez `kind` liczone w `droppedObjectiveCount` (sprawdzenie w callbacku walidacji zagadnienia, bo `buildDynamicTopicData` zamienia nieznany `kind` na brak) — Review Focus 3.
  - `poolSource: chapter needs the objectives stage` — bez tematu → `needsObjectives`; z `progress.dynamicTopic` → `input`.
  - `catalog: chapter shows the objectives-stage service`.
- [ ] **Step 2: Uruchom** — FAIL; **Step 3: Implementacja** wg Files; **Step 4:** `pnpm typecheck` i `pnpm test:unit` — PASS.
- [ ] **Step 5: Commit** `Etap 5a: zagadnienia rozdziału jednym wywołaniem etapu zagadnień, bez planisty agenta`.

### Task 3: Rozdział bez heurystyk, na przebiegu bazowym (z fake'ami)

**Files:**
- Modify: `subjects/english-chapter/module.ts` (`baselinePool: true`, bez `refineGeneratedPool`; hak w `SubjectModule` i `lesson.refine_unnamed` zostają do 5c), `validators.ts` (zostają reguły strukturalne), `rules.ts` (dokładnie `chapter.stem_single_gap`, `chapter.translation_instruction_required`, `chapter.hint_not_allowed`, `chapter.order_items_distinct`; bez `...ENGLISH_RULES`), `agent-policy.ts` (bez `requiredTypes`, `exerciseGate`, `objectiveGaps`, `objectiveCardWords`, `objectiveFrames`; z `sanitize` = stałe polecenie tłumaczenia; haki w typie do 5c), `chapter.rule-cases.ts`, `prompts.ts` (krok 3)
- Modify: `modules/materials/lessons/lesson-pool-acceptance.ts` (`sanitizeFreshLessonDraft` usuwa niezamówione pola v3 przy `subject.usesV3Payload !== true`; `UNSOLICITED_V3_FIELDS` przeniesione)
- Modify: `providers/fake-lesson-pool.ts` — usunięta gałąź rozdziału fake'a agenta (`chapterContentWords`, `chapterVocabulary`, `chapterObjectiveExercises`, `CHAPTER_TYPES`) i importy słownika; `fakeExercise` dostaje match, group, cloze (także dla szkoły w 5b) z konwencją klucza w kolejności sortowania: prawa strona i słowo luki i-tego pola to i-ta opcja po sortowaniu, dystraktory (`extraRight`, `extraWords`) sortują się na końcu, element grupy k (w kolejności widoku) należy do grupy k mod n; `fakeClosedAnswer` czyta numer pola z wiersza `Field:` i wybiera opcję według tej konwencji. Bez stanu współdzielonego.
- Delete: `subjects/english-chapter/lexicon.ts`, `material-lexicon.ts`, `subjects/english/listen-audibility.ts`, `subjects/english/rules.ts`, `subjects/english/english.rule-cases.ts`, eksport `stemsOf` (+ testy)
- Modify testy: `rules/catalog.test.ts`, `rules/rule-cases.test.ts`, `rules/rules.architecture.test.ts` (liczba plików haków 8 → 7, bez `englishIssue`, nieaktualne wyjątki rozdziału), `english-chapter/module.test.ts`, `validators.test.ts`, `fake-lesson-pool.test.ts`, `fake-lesson-agent.test.ts`
- Test: migawka `__snapshots__/lesson-packet-prompt.english_chapter.txt` (zagadnienie `words`, typ `lesson_cloze`, liczba znaków)

**Interfaces:**
- Consumes: Task 1 (`sanitize` w przebiegu bazowym, kontrola pól).

- [ ] **Step 1: Testy**
  - `chapter module: baseline, structural rules only` — `baselinePool`, brak `refineGeneratedPool`, katalog reguł = cztery reguły z Files.
  - `parent edit accepts words outside the material and a generic instruction` — Review Focus 4.
  - `fresh translation without instruction gets the fixed instruction` — Review Focus 5.
  - `unsolicited v3 fields stripped without v3 payload` — rozdział i gramatyka: `sourceRefs` z modelu usunięte (gramatyka: dziś odrzucenie `exercise.v3_field_not_allowed` — zmiana do opisu PR); szkoła: zostają.
  - `fake packet for chapter types passes structure and closed check` — match, group, cloze, choice, order, gap, open_answer, listen: `parseLessonRecord` → `sanitize` → walidacja → `closedCheckVerdict` z wynikami fake'a kontroli = `pass`.
  - `packet prompt snapshot`.
- [ ] **Step 2: Uruchom** — FAIL.
- [ ] **Step 3: Dydaktyka do promptu** (`english-chapter/prompts.ts`, po angielsku, bez list sprawdzeń). W `fieldRules`: „In lesson_choice, lesson_gap, lesson_order and lesson_cloze, instructionPl starts with the Polish sentence the child translates, then the task; a bare task such as 'Wybierz słowo' is not enough.” oraz „When the cards list words, the checked part (gap word, correct option, answer, left sides of pairs, group items) is a word of THIS objective's cards, at least two in pairs and groups; when the cards show a sentence frame, the solved sentence uses THIS objective's frame and the checked part may be the frame or the word filling it. The checked part is never a function word alone.” Z `generationRole` usuń „exercises with other words are discarded”; popraw komentarze (`prompts.ts:8-11`, `:37-39`), które wskazują egzekwowane reguły.
- [ ] **Step 4: Implementacja** wg Files.
- [ ] **Step 5: Uruchom** `pnpm typecheck`, `pnpm test:unit` (z testami architektury) — PASS.
- [ ] **Step 6: Commit** `Etap 5a: rozdział na przebiegu bazowym, usunięcie heurystyk rozdziału`.

### Task 4: Testy integracyjne i E2E rozdziału

**Files:** `tests/integration/lesson-chapter.test.ts`, `lesson-agent-generation.test.ts` (przypadki rozdziału z `planCalls`, `part_N`), `source-materials.test.ts`, `lesson-listen-choice.test.ts`, `lesson-error-explanation.test.ts`, `lesson-parent-api.test.ts`, `lesson-chapter-sentence-audio.test.ts`, `fakes.ts`, `chapter-lesson-helpers.ts`; E2E `tests/e2e/parent-sources.spec.ts` (komentarz i asercje o planerze) i speki rozdziału.

- [ ] **Step 1:** przypadki mechaniki agenta rozdziału (skrypty `submit`/`plans`, bramki kart i ram, planista) usuń; zachowanie rozdziału niezależne od generatora zostaje (pula z edycji rodzica albo z fake'a paczek); dodaj `chapter lesson generates through the baseline` (etap zagadnień z `kind`, przebieg bazowy, szkic publikowalny), `resume from an agent checkpoint`, `add N on a chapter objective`.
- [ ] **Step 2:** `pnpm test:integration` — PASS.
- [ ] **Step 3:** E2E speki rozdziału (`UMIEM_E2E_WEB_MODE=dev` do iteracji) — PASS; zmiana oczekiwań tylko z uzasadnieniem w commicie.
- [ ] **Step 4: Commit** `Etap 5a: testy integracyjne i E2E rozdziału na przebiegu bazowym`.

### Task 5: Narzędzia sondy i materiały bramki rozdziału

**Files:**
- Modify: `tests/probes/chapter-generation.probe.test.ts`: wariant zrzutu `baseline` dla rozdziału (`variantOf`: tylko szkoła `agent`; `source` w zrzucie z wariantu); model i `UMIEM_LLM_REASONING` etapu zagadnień w `models` także dla rozdziału; „+N” domyślnie na pierwszym zagadnieniu z luką pokrycia (`draft.coverage`); asercja ujawnień: na każdym zapisanym szkicu (po runie i po „+N”) `findExposureLeaks` w trybie `coverage` z przykładami szkicu i `cardExposureSources` — rzucana dopiero po zapisie wyników i zrzutów; koszt lekcji w raporcie = `agentUsd + lessonObjectivesUsd` z `runCosts`.
- Modify: `tests/probes/blind/gen-blind-sheet.cjs` (rubryka jako argument, kopiowana do katalogu sędziego jako `rubric.md`; porównanie materiału `dump.materialSha256 ?? dump.input?.sha256`), `tests/probes/blind/auto-judge.probe.test.ts` (czyta `rubric.md`), `tests/probes/blind/score.cjs` (match, group, cloze w listach typów W1, W3, W5, W6, W9)
- Create: `tests/probes/blind/coverage.cjs` — pokrycie offline ze zrzutów obu ramion: `node coverage.cjs <forms.txt> <dump.json>…`; plik form: jedna pozycja na linię, alternatywy po `|`; dopasowanie bez wielkości liter, na granicach słów, w kartach i angielskich polach ćwiczeń zrzutu; wynik: braki per zrzut
- Modify: `tests/probes/closed-check-gold.probe.test.ts` (przedmiot, temat dynamiczny z `kind` i materiał per przypadek; `draftOf` z tym samym oczyszczeniem co przebieg bazowy; klasa „błędny klucz” w kontrakcie wyboru i przypisania liczona z odpowiedzi na poprawne ćwiczenie, bez wywołań — wywołania z mutacją tylko rozsypanka)
- Create: `tests/probes/blind/rubric-stage5.md` (spec §7.4; w W5 rozdziału: słowo wypełniające ramę w zagadnieniu ramy nie jest „słowem innego zagadnienia”), `tests/probes/fixtures/closed-check-gold-stage5.json` (rozdział: match, group, cloze po 4 poprawne i po 3 „druga poprawna”; choice, listen_choice, order rozdziału po 2 poprawne; mutacje według spec §7.3), `tests/probes/fixtures/chapter-{clothes-weather,home-rooms,food-likes}.txt` i `…-forms.txt` (format jak w produkcji: linie „en — pl” z półpauzą w spacjach, nagłówki kończące się „:”, sekcja „Zwroty:” z ramami; każdy 15–25 słów i 2–3 ramy)
- Test: `tests/probes/blind/score.test.ts`, `tests/probes/probe-helpers.test.ts` (albo test `coverage.cjs`)

Zmiany narzędzi potrzebne tylko szkole (keywords, calculation, W6h/`hasHint`, `graderAvailable`, preflight bez gradera) — w 5b. Reguła „≤ 1 wada przy mianowniku < 34” stosowana ręcznie w raporcie z liczników `score.cjs`.

- [ ] **Step 1: Testy pomocników** — `coverage: word boundaries` („hat” nie liczy się w „What's”), `coverage: alternatives and case`, `score: W1 applies to lesson_match`, `gold: wrong-key verdict from the correct item's answers`.
- [ ] **Step 2:** FAIL → implementacja → PASS (`pnpm vitest run tests/probes/blind/score.test.ts tests/probes/probe-helpers.test.ts`).
- [ ] **Step 3: Materiały i rubryka**; sprawdzenie bez sieci na worktree `main`: `parseMaterialLexicon` każdego materiału daje niepuste listy słów i ram (planista agenta na `main` z nich korzysta); SHA-256 plików do opisu PR.
- [ ] **Step 4: Commit** `Etap 5a: narzędzia sondy i materiały bramki rozdziału`.

### Task 6: Dokumentacja

**Files:** `docs/architecture.md` §19.17 (rozdział na przebiegu bazowym, kontrola pól, etap zagadnień rozdziału, oczyszczenie w kroku struktury; opis planisty agenta usunięty), `AGENTS.md` (rozdział na przebiegu bazowym; planista i bramki rozdziału usunięte), spec etapu (status 5a).

- [ ] **Step 1:** aktualizacja; **Step 2: Commit** `Etap 5a: dokumentacja`.

### Task 7: Sprawdzenia, bramka i PR

- [ ] `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards` (w tle), testy architektury — PASS.
- [ ] Zapytanie tylko do odczytu o runy rozdziału w toku (za zgodą właściciela).
- [ ] Bilans §10 (`wc -l`, spec §9.2) i znaki migawek promptów.
- [ ] **Płatne biegi (spec §7.7) — tylko po zgodzie właściciela.** Notatka biegu (poza repo): SHA obu worktree (agent: przypięty `main`; przebieg bazowy: commit gałęzi, `git diff --quiet HEAD` przed każdym biegiem, każda runda strojenia commitowana), modele i reasoning, koszt. Kolejność: wzorcowe → runda 0 → strojenie (≤ 2 rundy, wyłącznie pola przedmiotu) → bieg potwierdzający → sędzia 1 (skryptowy Claude Opus przez OpenRouter, osobny rejestr) i sędzia 2 → pokrycie (`coverage.cjs`) → raport §7.8 → decyzja właściciela.
- [ ] Trzech krytyków na całej gałęzi, potem `ponytail:ponytail-review`; wynik obu w opisie PR; w PR także: zmiana pól v3 w gramatyce (zdejmowane zamiast odrzucenia), koszt etapu zagadnień poza budżetem runu (jak w szkole), wpływ API → MCP → skill.
