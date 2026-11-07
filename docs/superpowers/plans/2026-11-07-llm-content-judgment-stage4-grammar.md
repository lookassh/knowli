# Etap 4: gramatyka na przebiegu bazowym — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Wersja 2, po trzech krytykach planu.

**Goal:** `english_grammar` generuje się w workerze przebiegiem bazowym (`runLessonBaselinePool`), heurystyki gramatyki znikają, bilans §10 ujemny.

**Architecture:** Worker wybiera przebieg po polu modułu `baselinePool` (tylko gramatyka). Przebieg bazowy dostaje wznowienie, dogenerowanie, limity zapisu i przyjęcie krokami agenta; polityka agenta gramatyki zostaje do etapu 5. Dydaktyka z kodu trafia do pola `generationNotesEn` zagadnień katalogu, czytanego tylko przez prompt paczki.

**Tech Stack:** TypeScript strict, Vitest (`pnpm test:unit`, `pnpm test:integration`), Playwright (`pnpm test:e2e:shards`), AI SDK w adapterze.

**Spec:** `docs/superpowers/specs/2026-11-07-llm-content-judgment-stage4-grammar-design.md` (v2.1).

## Global Constraints

- Ścieżki względem `packages/server/src`, o ile nie podano inaczej.
- Bez nowych reguł rozumiejących język; bez warstw z §8 specu zbiorczego.
- Do generatora i kontroli żadnych danych dziecka; dzienniki `[lesson-baseline]`/`[lesson-agent]` bez treści ćwiczeń.
- Bez identyfikatorów modeli w commitach i PR. Commit kończy `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Bez migracji. Bez zmian API/DTO/MCP/`SKILL.md`.
- Rozdział i szkoła zostają na agencie: kod agenta zmieniamy tylko tam, gdzie zadanie to wymienia (wydzielenie wspólnych funkcji bez zmiany zachowania).
- `PACKET_RESERVE = 3`.
- Etykiety (dokładny tekst): `shape_type` „ćwiczenie innego typu niż zamówione”, `over_count` „więcej ćwiczeń niż zamówiono”, `check_wrong_set` „drugi model wskazał inną odpowiedź”, `check_unknown` „drugi model nie rozstrzygnął odpowiedzi”, `check_order_no` „drugi model uznał ułożenie za błędne”.

## Review Focus

1. „Dodaj N”, gdy nowe ćwiczenie powtarza ćwiczenie szkicu z późniejszego etapu: kandydat odpada (ofiara `fixed`) — test w zadaniu 2.
2. „Dodaj N” przy etapie bez braku i bez udziału: brak paczek tego etapu, liczby nie przekraczają `addModePlan` — test w zadaniu 2.
3. Opublikowana lekcja „to be” v1 z `contractions`: sesja i ocena znajdują zagadnienie (temat po `topicVersion`) — test w zadaniu 6.
4. Szkic gramatyki z treścią, którą odrzucał dawny walidator: edycja i publikacja bez 400 — test w zadaniu 7.
5. Fake w E2E: paczki równoległe i „dodaj N” bez duplikatów (`rejectionCodes` puste, zagadnienia `complete`, dodane = zamówione) — testy w zadaniu 3.

---

### Task 1: Przebieg bazowy — przyjęcie krokami agenta, limity zapisu, wpis bez `fixed`, zapas 3

**Files:**
- Modify: `domain/lessons/packet-plan.ts`, `domain/lessons/agent/admission.ts` (wydzielenie kroków 3–4), `modules/materials/lessons/lesson-baseline-pool.ts`
- Test: `domain/lessons/packet-plan.test.ts`, `domain/lessons/agent/admission*.test.ts` (bez zmian zachowania), `modules/materials/lessons/lesson-baseline-pool.test.ts`

**Interfaces:**
- Produces: `export function lessonRulesStep(state: LessonAgentState, objectiveId: string, draft: LessonExerciseDraft, before: LessonSnapshot, ctx: AgentCheckContext, rejectedFamilies?: RejectedFamilies): StepOutcome` w `admission.ts` — dzisiejsze kroki 3–4 `deterministicSteps` (od `takeIds` do ujawnień); `deterministicSteps` woła ją po krokach 1–2. `StepOutcome`, `LessonSnapshot`, `snapshotOf` eksportowane (o ile nie są).
- Produces: przebieg bazowy z limitami `lessonAgentLimits(subject, topic, input.poolSize)` (`maxExercises` nie jest używane: przyjęcie nie woła kroku 1).

- [ ] **Step 1: Failing tests**
  - `packet-plan.test.ts`: zamówienie paczki = udział + 3 (popraw oczekiwania z +2).
  - `lesson-baseline-pool.test.ts`:
    - „status z limitów zapisu”: minimum publikacji spełnione, `total < targetCount` → `incomplete`, `missing` zawiera `exercises: N of T`;
    - „duplikat i ujawnienie mają kod i reguły agenta”: duplikat → `code: "lesson_pool"`, `ruleIds` niepuste, `detail: ""`; ujawnienie → `leak_victim` albo `leak_source`;
    - „wpis zagadnienia bez fixed” (z `fixed` tego zagadnienia — używane w zadaniu 2; tu: wpis = tylko nowe).
- [ ] **Step 2: Run** `pnpm vitest run packages/server/src/domain/lessons packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Wydziel `lessonRulesStep`. W przebiegu bazowym pętla przyjęcia: `before = snapshotOf(state, ctx)` na starcie i po każdym przyjęciu (`outcome.snapshot`); kandydat ponad limit kubełka — jak dziś (`overflow`); `lessonRulesStep` → przy `ok: false` `reject(id, type, rejection.kind, rejection.code, rejection.ruleIds)`, przy `ok: true` `state = outcome.state`. `lessonInvariantCheck` w przebiegu bazowym znika. `counts` indeksuj pozycją zagadnienia w temacie (`topic.objectives.findIndex`), nie indeksem `map`. Wpis: `entry.id !== null`. `PACKET_RESERVE = 3`.
- [ ] **Step 4: Run** te same testy + `pnpm vitest run packages/server/src/domain/lessons/agent packages/server/src/modules/materials/lessons` — PASS (testy agenta bez zmian).
- [ ] **Step 5: Commit** „Etap 4: przebieg bazowy — przyjęcie krokami agenta, limity zapisu, zapas 3”.

### Task 2: Przebieg bazowy — wznowienie i dogenerowanie

**Files:**
- Modify: `domain/lessons/packet-plan.ts`, `modules/materials/lessons/lesson-pool-agent.ts` (wydzielenie stanu startowego), `modules/materials/lessons/lesson-pool-agent-input.ts` (wydzielenie zdań do unikania), `modules/materials/lessons/lesson-baseline-pool.ts`
- Test: `domain/lessons/packet-plan.test.ts`, `modules/materials/lessons/lesson-baseline-pool.test.ts`, istniejące testy agenta (bez zmian zachowania)

**Interfaces:**
- Produces: `export function packetPlanForTargets(objective: LearningObjective, targets: StageCounts, withNotice: boolean, listen: number): PacketPlan` — `packetPlan` liczy cele jak dziś i woła ją z `withNotice = objective.exerciseTypes.includes("lesson_notice")`. Etap z celem 0 nie ma paczek.
- Produces (z `lesson-pool-agent.ts`, użyte przez `superviseObjectives` i przebieg bazowy): `export function poolStartState(args: { subject; topic; objectives; input: LessonPoolAgentRunInput; planExamples }): { state: LessonAgentState; ctx: AgentCheckContext; addMode?: { remaining: number }; promptTargets?: AddModePlan["promptTargets"] }` — dzisiejsze linie 431–458 (limity, stan z `fixed`, przykładami, `mergeExamples`, `EXTRA_SOURCES_KEY`, `addModePlan`).
- Produces (z `lesson-pool-agent-input.ts`): `export function lessonAvoidSentences(subject: SubjectModule, topic: LessonTopic, state: LessonAgentState): string[]` — wydzielone z `objectiveAgentInput` (`withoutTexts` + `avoidSentencesFor`).

- [ ] **Step 1: Failing tests** (`lesson-baseline-pool.test.ts`, fake'i portów z istniejących testów):
  - „wznowienie”: `skipObjectives: [A]`, `fixed` = ćwiczenia A, `initialExamples: {A: [...]}` → brak paczek A; brak wpisu A; ćwiczenie B równe odpowiedzi z `fixed` odpada (`leak_victim`).
  - „dogenerowanie”: `target: {mode: "add", objectiveId: B, count: 3}`, `fixed` = szkic, `examplesFixed: true`, `extraExposureSources: ["Story line."]` → paczki tylko B, bez `lesson_notice`, wszystkie `withExamples: false`; liczby z `addModePlan`; ćwiczenie równe „Story line.” odpada; `avoidSentences` paczki zawierają zdania szkicu; wpis B bez ćwiczeń szkicu; status `objectiveStatusFor(..., { remaining: 3 })`.
  - Review Focus 1: nowe ćwiczenie etapu prowadzonego, duplikat ćwiczenia samodzielnego szkicu → odpada (`lesson_pool`).
  - Review Focus 2: etap bez braku i z udziałem 0 → brak paczek tego etapu.
  - „nieznane zagadnienie w dogenerowaniu” → `AppError("validation")` bez wywołań; źródło `planner`/`input` → `AppError("validation")`; usuń test „resume inputs rejected”.
  - `packet-plan.test.ts`: `packetPlanForTargets` z celem 0 → brak paczek etapu; `withNotice: false` → brak paczki notice.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `superviseObjectives` i przebieg bazowy używają `poolStartState`; `objectiveAgentInput` i przebieg bazowy — `lessonAvoidSentences` (przebieg bazowy liczy je raz, na stanie startowym). W `resolveInput` zostaje tylko: znany przedmiot, źródło `catalog`, znany cel dogenerowania. Zagadnienia do generowania: pula → bez `skipObjectives`; dogenerowanie → tylko cel, plan `packetPlanForTargets(objective, promptTargets.stages, false, promptTargets.listenAllowance)`. `withExamples = !(input.examplesFixed ?? false) && packetIndex === 0`. Status w dogenerowaniu: `objectiveStatusFor(state, id, ctx, addMode)`.
- [ ] **Step 4: Run** testy `modules/materials/lessons` i `domain/lessons/agent` — PASS.
- [ ] **Step 5: Commit** „Etap 4: przebieg bazowy — wznowienie i dogenerowanie”.

### Task 3: Fake'i paczki i kontroli zamkniętych

**Files:**
- Modify: `providers/fake-lesson-agent.ts`, `providers/fake-lesson-pool.ts`
- Test: `providers/fake-lesson-agent.test.ts`

**Interfaces:**
- Produces: `FakeLessonPoolAgent` implementuje też `LessonPacketGenerator`; opcja `packets?: Record<string /* slug celu */, FakeAgentStep[]>` (kroki `throw`, `gate`, `hang`, `build` dla `generatePacket`; brak scenariusza = generator). `FakeExerciseChecker` implementuje też `ClosedExerciseChecker`; opcja `closed?: "pass" | "unknown"` (domyślnie `"pass"`; `unavailable` jej nie dotyczy).
- Produces: `export function fakePacketExercises(input: LessonPacketInput): { exercises: Record<string, unknown>[]; examples?: string[] }` w `fake-lesson-pool.ts`.

- [ ] **Step 1: Failing tests**
  - „generatePacket daje `count` ćwiczeń typu paczki” dla każdego typu gramatyki (słuchanie z `fakeListenChoice`).
  - Review Focus 5: `runLessonBaselinePool` z fake'ami (generator, `new FakeExerciseChecker({ unavailable: true })` jak w workerze) na Present Simple z katalogu → `rejections` puste, wszystkie zagadnienia `complete`; drugi przebieg „dodaj 3” na wyniku → dodane 3, bez odrzuceń.
  - „checkClosed przepuszcza ćwiczenia fake'a”: wybór (opcje posortowane w widoku) → najkrótsza opcja będąca prefiksem drugiej; słuchanie → opcja obecna w wierszu `Recording (transcript):`; notice → pierwsze słowo `Sentence 1:`; rozsypanka → `{ verdict: "yes" }`; `closed: "unknown"` → `null`.
  - scenariusz `packets: { third_person_s: [{ throw: transient }] }` → wywołanie rzuca.
  - `FAKE_SLOW_MARKER` w materiale → każda paczka czeka `FAKE_SLOW_DELAY_MS` (przerywalnie); `delayMs` jak w `runObjective`.
  - koszt: `stepCostUsd` i z `usage` wiersz z operacją `packet_generate` / `check_closed`.
- [ ] **Step 2: Run** `pnpm vitest run packages/server/src/providers/fake-lesson-agent.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `fakePacketExercises`: odpowiedzi `materialWord` od przesunięcia `1000 × (indeks celu w temacie) + 100 × (indeks typu w celu)`, z pętlą pomijania odpowiedzi, których `avoidKey` jest w `input.pool.avoidSentences` (jak w generatorze rozdziału, `fake-lesson-pool.ts:374-414`); pierwsza paczka (`withExamples`) zwraca `examples: ["Example for <id>."]`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** „Etap 4: fake'i paczki i kontroli zamkniętych”.

### Task 4: Worker — `baselinePool` i przepięcie testów agenta

**Files:**
- Modify: `domain/lessons/types.ts` (`SubjectModule.baselinePool?: true` z komentarzem: przedmiot katalogowy generowany przebiegiem bazowym, etap 4 #358), `domain/lessons/subjects/english-grammar/module.ts` (`baselinePool: true`)
- Modify: `config.ts` (`LessonAgentDeps.agent: LessonPoolAgentProvider & LessonPacketGenerator`, `.checker: LessonExerciseCheckerProvider & ClosedExerciseChecker`), `modules/materials/lessons/lesson-agent-generation.ts` (`attempt`)
- Modify (z repo root): `tests/probes/probe-submissions.ts` (`recordingAgent` generyczny po `T extends LessonPoolAgentProvider`, przekazuje `generatePacket`)
- Create: `domain/lessons/testing/agent-grammar-subject.ts` — `export const agentGrammarSubject: SubjectModule = { ...englishGrammarSubject, baselinePool: undefined }` (komentarz: mechanika workera i agenta na gramatyce do etapu 5)
- Modify (testy z repo root): `tests/integration/lesson-agent-generation.test.ts`, `lesson-generation.test.ts`, `lesson-present-continuous.test.ts`, `lesson-listen-choice.test.ts`, `lesson-parent-api.test.ts`, `lesson-story.test.ts`, `provider-usage-scope.test.ts` i inne, które scenariuszują `FakeLessonPoolAgent.objectives` albo oczekują operacji `agent_objective` dla gramatyki — rejestr z `agentGrammarSubject`
- Test: nowe przypadki w `tests/integration/lesson-agent-generation.test.ts`

**Interfaces:**
- Consumes: `runLessonBaselinePool` (zadania 1–2), fake'i z opcją `packets` (zadanie 3).

- [ ] **Step 1: Inwentarz.** `grep -rln "FakeLessonPoolAgent\|agent_objective" tests/integration packages/server/src --include=*.test.ts`; w plikach na gramatyce, które scenariuszują `runObjective`, podmień przedmiot w rejestrze na `agentGrammarSubject` (bez zmiany asercji).
- [ ] **Step 2: Failing tests** (integracja, fake'i, rejestr z `englishGrammarSubject`):
  - „lekcja gramatyki idzie przebiegiem bazowym”: Present Simple → `generatePacket` wołany, `runObjective` nie; szkic zapisany, luki puste, koszty z operacją `packet_generate`.
  - „wznowienie”: scenariusz `packets` z `throw` transient dla jednego celu → próba 1 `requeue`; próba 2 nie generuje celów `complete` (liczba wywołań `generatePacket` per cel).
  - „dogenerowanie zagadnienia szkicu gramatyki”: `regenerate` → przebieg bazowy w trybie add, „dodano k z N” zgodne.
- [ ] **Step 3: Run** `pnpm test:integration tests/integration/lesson-agent-generation.test.ts` — FAIL (nowe), PASS (przepięte).
- [ ] **Step 4: Implement.** W `attempt`: `subject.baselinePool === true` → `runLessonBaselinePool({ generator: agentDeps.agent, checker: agentDeps.checker, subjects: services.subjects, policy: { ...agentDeps.policy, runTimeoutMs: remainingMs } }, runInputWithHooks, agentSignal)`, inaczej `runLessonPoolAgent` jak dziś; haki (`onSpend`, `onObjectivesResolved`, `onObjectiveSettled`) w jednym obiekcie dla obu.
- [ ] **Step 5: Run** `pnpm test:integration` (w tle) i `pnpm vitest run packages/server/src/modules/materials/lessons` — PASS.
- [ ] **Step 6: Commit** „Etap 4: worker generuje gramatykę przebiegiem bazowym”.

### Task 5: Notatki dydaktyczne w katalogu (`generationNotesEn`)

**Files:**
- Modify: `domain/lessons/types.ts` (`LearningObjective.generationNotesEn?: string`), `ports/ai.ts` (`LlmLessonObjectiveInput.generationNotesEn?: string`), `modules/materials/lessons/lesson-drafts.ts` (`buildPoolInput` kopiuje pole), `providers/openai/lesson-pool-agent.ts` (`packetInstructions`: zaraz po wierszu celu `Teaching notes: <tekst>`, gdy pole jest)
- Modify: `domain/lessons/subjects/english-grammar/topics/{present-continuous,present-simple,to-be}.ts`
- Test: `providers/openai/lesson-pool-agent.test.ts`, `english-grammar/module.test.ts`, migawka `providers/openai/__snapshots__/lesson-packet-prompt.english_grammar_present_continuous.txt`

- [ ] **Step 1: Inwentarz** wpisów `english-grammar/rules.ts`, `grammar.rule-cases.ts`, `present-continuous.rule-cases.ts` z etykietą „już w katalogu/prompcie” / „pułapka → zdanie” / „opis sprawdzenia → odpada” w notatce `C:\Users\looka\AppData\Roaming\Claude\side-session-notes\local_c243a3eb-4e68-49a1-bcf4-ca2f27b5bf45\stage4-grammar.md` (do opisu PR). Na pewno cztery zdania (spec §8): PC + wskaźnik przyszłości (cele PC); samo „now” w przeczeniu PC (`present_continuous.negative`); twierdząca krótka odpowiedź bez skrótu (`to_be.short_answers`, `present_simple.short_answers`); podmiot bez widocznej liczby (fish, sheep, deer) bez słowa liczby (cele PS i PC z luką formy). Przed usunięciem `rules.ts` (zadanie 7) wypisz z jego `when`/`types` zbiory zagadnień siedmiu wskazówek.
- [ ] **Step 2: Failing tests**
  - prompt paczki zawiera `Teaching notes:` z tekstem, gdy pole jest; bez pola — bez wiersza;
  - moduł: każde zagadnienie PC ma tekst `PC_GUIDANCE`; `now_or_usually` i `now_or_usually_more` — `PC_TENSE_CHOICE_GUIDANCE`; `now_or_usually` — `PC_NOW_OR_USUALLY_GUIDANCE`; `now_or_usually_more` — `PC_NOW_OR_USUALLY_MORE_GUIDANCE`; cele form PC z wpisu `when` (affirmative, negative, questions, ing_spelling) — `PC_FORMS_TRANSLATION_GUIDANCE`; każde zagadnienie „to be” — `TO_BE_GUIDANCE`; tylko `to_be.affirmative_forms` — `PICTURE_CHOICE_GUIDANCE`; cztery pułapki przy swoich celach.
- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement.** Teksty siedmiu stałych dosłownie jako literały w plikach tematów (bez spacji na początku), stała całego tematu doklejana do notatek każdego zagadnienia; poprawka `PC_GUIDANCE`: „never a verb of the table as an adjective after is” → „never a verb used as an adjective after is”; wzory wyjaśnień jako literały. `present-continuous-guidance.ts` zostaje do zadania 7.
- [ ] **Step 5: Run** testy + aktualizacja migawki paczki (`pnpm vitest run -u packages/server/src/providers/openai/lesson-pool-agent.test.ts`), zanotuj liczbę znaków migawki — PASS.
- [ ] **Step 6: Commit** „Etap 4: dydaktyka gramatyki w notatkach zagadnień katalogu”.

### Task 6: #369 — temat „to be” w wersji 2

**Files:**
- Modify: `domain/lessons/subjects/english-grammar/topics/to-be.ts` (`export const toBeV2`), `english-grammar/module.ts` (`topics: [presentSimpleV1, toBeV1, toBeV2, presentContinuousV1]`)
- Test: `english-grammar/module.test.ts`, `modules/learning/lessons/lesson-materialize.test.ts` i inne z `topics.find(t => t.id === "to_be")` albo mapą po id tematu (grep)

**Interfaces:**
- Produces: `toBeV2: LessonTopic = { ...toBeV1, version: 2, objectives: toBeV1.objectives.filter((o) => o.id !== contractions.id) }`.

- [ ] **Step 1: Failing tests:** katalog (`lessonCatalog`) daje `to_be` v2 bez `contractions`; rejestr: `to_be@1` z `contractions`, `to_be@2` bez; materializacja ćwiczenia `to_be.contractions` z `topicVersion: 1` znajduje cel (Review Focus 3); testy szukające `to_be` po samym id wskazują wersję jawnie.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm vitest run packages/server/src/domain/lessons packages/server/src/modules/learning/lessons` — PASS.
- [ ] **Step 5: Commit** „Etap 4: temat to be v2 bez zagadnienia skrótów (#369)”.

### Task 7: Usunięcie heurystyk gramatyki i porządki sondy

**Files:**
- Delete: `english-grammar/{present-continuous-validation,present-continuous-tense-choice,present-continuous-exercise-rules,present-continuous-guidance,time-markers,be-agreement,present-simple-forms,validators,rules,grammar.rule-cases,present-continuous.rule-cases}.ts` z testami; `english/ing-forms.ts` z testem; migawki `providers/openai/__snapshots__/lesson-pool-prompt.english_grammar*.txt`
- Modify: `english-grammar/module.ts` (`validateExercise: () => []`, `rules: {}`), `english-grammar/module.test.ts`, `english-grammar/type-examples.test.ts` (import `scanTimeMarkers`), `domain/lessons/rules/rule-cases.test.ts`, `domain/lessons/rules/rule-book.test.ts` (asercje `grammar.*`), `domain/lessons/rules/catalog.test.ts` (lista plików z `rules.ts` gramatyki), testy agenta/promptu oparte na regułach gramatyki (`admission.*.test.ts`, `lesson-pool-prompt.test.ts` i inne z `pnpm test:unit`) — przepięcie na `testing/agent-test-subject.ts` albo usunięcie przypadku sprawdzającego samą heurystykę
- Modify (z repo root): usuń `tests/probes/grammar-plain-subject.ts` z testem i `tests/probes/present-continuous-stats.ts` z testem; `tests/probes/agent-generation.probe.test.ts` — warianty `agent | baseline`, oba na produkcyjnym rejestrze (gramatyka z `agent` → błąd „gramatyka generuje się przebiegiem bazowym”), bez `sceneShare`; `tests/probes/chapter-generation.probe.test.ts` — `UMIEM_PROBE_GRAMMAR_TOPIC` (`present_simple` domyślnie, `present_continuous`, `to_be` — najnowsza wersja tematu) i `UMIEM_PROBE_ADD_OBJECTIVE` (slug celu dla „+N”, domyślnie pierwszy); zrzut puli po „+N” w formacie arkusza (drugi plik obok `UMIEM_PROBE_POOL_DUMP_OUT`, nazwa `…-add.json`)

- [ ] **Step 1: Failing test** (Review Focus 4, `lesson-api`/integracja): szkic „to be” z `lesson_gap` z `hint: "go"` (dawniej `grammar.be_gap_hint`) przechodzi edycję i publikację — dziś 400.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** usunięcia i poprawki importów; `pnpm typecheck` czysty.
- [ ] **Step 4: Run** `pnpm test:unit`; usuń testy usuniętego kodu, przepnij testy, które używały gramatyki jako nośnika reguł. Testy architektury (`module-boundaries.architecture.test.ts`, `tests/ai-sdk-scope.test.ts`, `lesson-agent-imports.architecture.test.ts`) — PASS.
- [ ] **Step 5: Commit** „Etap 4: usunięcie heurystyk gramatyki”.

### Task 8: Etykiety kodów odrzuceń

**Files:**
- Modify: `packages/contracts/src/messages.ts` (`lessons.agentRejectionReasons`: pięć kluczy z Global Constraints)
- Test: `modules/materials/lessons/lesson-agent-outcome.test.ts`

- [ ] **Step 1: Failing test:** `agentRejectedReasons({ check_wrong_set: 2, over_count: 1 })` → `{ "drugi model wskazał inną odpowiedź": 2, "więcej ćwiczeń niż zamówiono": 1 }`.
- [ ] **Step 2–4:** FAIL → etykiety → PASS.
- [ ] **Step 5: Commit** „Etap 4: etykiety kodów odrzuceń przebiegu bazowego”.

### Task 9: Dokumentacja

**Files:**
- Modify: `docs/architecture.md` §19.17 (przebieg bazowy jako generator gramatyki: `baselinePool`, paczki z zapasem 3, kontrola zamkniętych i jej dane, przyjęcie krokami agenta, limity zapisu, wznowienie, dogenerowanie, punkt kontrolny na końcu próby jako znane ograniczenie, `generationNotesEn`, polityka agenta gramatyki do etapu 5, nowe wersje skilli `to_be` v2 przez hash `topicVersion` w kryteriach) i §23 (`packet_generate`, `check_closed` bez „tylko sonda”)
- Modify: `AGENTS.md` (akapity o agencie puli: „jedyny generator” → rozdział i szkoła; gramatyka przebiegiem bazowym; dane kontroli zamkniętych; katalog reguł bez reguł gramatyki; notatki dydaktyczne), `docs/superpowers/specs/2026-11-02-llm-cost-tracking-design.md` (tabela §2), spec zbiorczy §13 (stan produkcji 2026-11-07) i §17 (#288)
- [ ] **Step 1:** edycje. **Step 2:** `grep -rn "AGENTS.md\|architecture.md" tests packages --include=*.test.ts` — uruchom znalezione testy dokumentacji. **Step 3: Commit** „Etap 4: dokumentacja”.

### Task 10: Weryfikacja, przeglądy, przebieg kontrolny

- [ ] **Step 1:** `pnpm check` — PASS.
- [ ] **Step 2:** `pnpm test:integration` (w tle) — PASS.
- [ ] **Step 3:** `pnpm test:e2e:shards` (w tle) — PASS (`net::ERR_NO_BUFFER_SPACE` → powtórz spec osobno i odnotuj).
- [ ] **Step 4:** bilans linii §10 i znaki migawek promptów.
- [ ] **Step 5:** trzech krytyków na całej gałęzi, potem `ponytail:ponytail-review`; poprawki tylko poprawności i uproszczeń.
- [ ] **Step 6:** pytanie do właściciela o płatny przebieg kontrolny (spec §9: `probe:chapter`, gramatyka, „to be” × 3 z „+3” w `short_answers` w jednym biegu, PS × 1, PC × 1, sędzia 2; ok. 2 USD, limit 3,5 USD). Materiały: teksty z fixture'ów sondy etapu 2 skopiowane poza repo. Po biegu: arkusze `gen-blind-sheet.cjs`, sędzia 2, `score.cjs`, ręczne zliczenie kluczy ze skrótem bez pełnej formy (klucz albo poprawna opcja z `'m|'s|'re|n't`, żaden wariant nie jest formą rozwiniętą), raport w PR.
