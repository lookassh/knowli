# Etap 2: przebieg bazowy i sonda gramatyki — plan implementacji

Wersja 2 (po trzech krytykach planu). Task 1–3 zrobione (commity na gałęzi).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przebieg bazowy generowania (paczka cel × typ → struktura → kontrola zamkniętych → walidacja puli) napisany raz w kodzie aplikacji, bez workera, plus sonda trzech wariantów i narzędzia ślepej oceny do bramki po etapie 2.

**Architecture:** Czyste funkcje domeny (`closed-check.ts`, `packet-plan.ts`) + koordynator w `modules/materials/lessons/lesson-baseline-pool.ts` z tymi samymi typami wejścia/wyniku co `runLessonPoolAgent` + dwie metody adaptera AI SDK. Walidacja puli i status na istniejącym kodzie agenta (`createLessonAgentState`, `submitExamples`, `lessonInvariantCheck`, `removeExercise`, `objectiveStatus`). Sonda wybiera wariant zmienną i nie ma własnych reguł.

**Tech Stack:** TypeScript strict, Zod, AI SDK + `@openrouter/ai-sdk-provider` (tylko adapter i `tests/probes`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-llm-content-judgment-stage2-baseline-design.md` (v3, zatwierdzony) i spec zbiorczy `docs/superpowers/specs/2026-11-07-llm-content-judgment-design.md`.

## Global Constraints

- Tylko typy gramatyki; kontrakty: wybór (choice, listen_choice, short_answer, notice), rozsypanka (order); tekstowe bez kontroli.
- Bez rund naprawy, bez warstw §8, bez reguł rozumiejących język, bez migracji, bez podłączenia do workera.
- `ai` i `@openrouter/*` tylko w `providers/openai/lesson-pool-agent.ts` i `tests/probes` (`tests/ai-sdk-scope.test.ts`).
- Domena nie importuje modułów, providerów ani env (`module-boundaries.architecture.test.ts`).
- Do generatora i kontroli żadnych danych dziecka; dzienniki `[lesson-baseline]` bez treści ćwiczeń.
- Liczby: `PACKET_RESERVE = 2`; notice 2; listen = `listenChoiceAllowance`; cele etapów = max(udział `poolStageCounts(targetCount)`, minimum `lessonPoolMinimums` + `independentReserve` dla independent).
- Jedno ponowienie wywołania, w przebiegu: `rate_limit` (po `retryAfterMs`, ≤ 30 s), `transient`, `timeout`, `output`; bez ponowienia `configuration`; adapter `canRetry: () => false`.
- Nowe operacje kosztu: `packet_generate`, `check_closed` (feature `lesson_generation`).
- Kod po angielsku, komentarze i dokumentacja po polsku; prompty po angielsku.
- Bez identyfikatorów modeli w commitach i opisie PR.

## Review Focus

- Model zwraca więcej rekordów niż zamówiono albo rekordy innego typu/zagadnienia → odpadają, reszta paczki żyje.
- Wynik kontroli innej długości niż pozycje paczki → cała paczka bez wyniku (`check_unknown`), nie dopasowanie po pozycji.
- Paczki kończą się w różnej kolejności → identyczny wynik (test z odwróconą kolejnością rozwiązań fake'a).
- Przykład karty równy odpowiedzi `open_answer` → odpada linia przykładu, ćwiczenie zostaje.
- Anulowanie w trakcie kontroli → run rzuca powód przerwania, nic niesprawdzonego w wyniku.

---

### Task 1: Kontrola zadań zamkniętych (domena)

**Files:**
- Create: `packages/server/src/domain/lessons/closed-check.ts`
- Test: `packages/server/src/domain/lessons/closed-check.test.ts`

**Interfaces:**
- Produces:
  - `type ClosedCheckContract = "choice" | "order"`
  - `closedCheckContract(type: LessonExerciseType): ClosedCheckContract | null`
  - `closedCheckItem(draft: LessonExerciseDraft, topic: LessonTopic): { contract: ClosedCheckContract; view: string } | null` (null = typ bez kontroli albo słuchanie bez zdania nagrania)
  - `CHOICE_CHECK_RESULT = z.object({ answers: z.array(z.string()).nullable() })`, `ORDER_CHECK_RESULT = z.object({ verdict: z.enum(["yes", "no", "unknown"]) })`
  - `type ClosedCheckCode = "check_wrong_set" | "check_unknown" | "check_order_no"`
  - `closedCheckVerdict(draft: LessonExerciseDraft, raw: unknown, normalizer: AnswerNormalizer): { pass: true } | { pass: false; code: ClosedCheckCode }`

- [ ] **Step 1: Testy** (`closed-check.test.ts`): kontrakt per typ (5 zamkniętych, 4 tekstowe → null); `closedCheckItem` — widok bez `answer`, `correctOption`, `hint`, `explanationPl`, bez tytułu celu przy braku `instructionPl`; słuchanie zawiera `Recording (transcript): ` + zdanie z kluczem; rozsypanka zawiera `Arranged answer: ` + `answer`; `closedCheckVerdict`: `{answers:["is"]}` przy kluczu „is” → pass; kolejność/wielkość liter/apostrof typograficzny → pass; `["is","is"]` → pass; `["is","are"]` → `check_wrong_set`; `[]` → `check_wrong_set`; `["was"]` (spoza opcji) → `check_wrong_set`; `{answers:null}` → `check_unknown`; `undefined`/zły kształt → `check_unknown`; „isn't” wobec opcji „is not” → pass (normalizator przedmiotu `englishNormalizer`); notice ze słowem klucza w dwóch segmentach → `check_wrong_set`; order `yes` → pass, `no` → `check_order_no`, `unknown` → `check_unknown`.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/domain/lessons/closed-check.test.ts` → FAIL (brak modułu).
- [ ] **Step 3:** Implementacja: widok przez `solverView(draft, { ...topic, objectives: topic.objectives.map((o) => ({ ...o, titlePl: "" })) })`; zdanie nagrania z `feedbackSentenceText`; przypisanie tekstu do opcji/segmentu przez `answersEquivalent(text, optionText, normalizer)`; pass, gdy zbiór przypisanych opcji = {opcja klucza} i każdy tekst ma opcję. Notice: segmenty to `noticeSegments.flat()`, klucz pasuje do dokładnie jednego.
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5:** commit `Etap 2: kontrola zadań zamkniętych w domenie`.

### Task 2: Plan paczek (domena)

**Files:**
- Create: `packages/server/src/domain/lessons/packet-plan.ts`
- Test: `packages/server/src/domain/lessons/packet-plan.test.ts`

**Interfaces:**
- Consumes: `lessonPoolMinimums` (`lesson-coverage.ts`), `stageOf`, `outsideStagePath` (`stages.ts`).
- Produces:
  - `PACKET_RESERVE = 2` (notice 2 jako stała lokalna)
  - `interface PacketPlan { readonly packets: readonly { readonly type: LessonExerciseType; readonly count: number }[]; readonly stageTargets: StageCounts }` (lokalny `StageCounts` — domena nie importuje `ports/ai.ts`)
  - `packetPlan(subject: SubjectModule, objective: LearningObjective, stageSplit: StageCounts, listenAllowance: number): PacketPlan` — `stageSplit` = `poolStageCounts(subject, objective.exerciseTypes, targetCount)` liczone przez moduł (funkcja żyje w `lesson-drafts.ts`). Paczki w kolejności lekcji: notice, typy guided, typy productive, typy independent, listen_choice; w etapie kolejność typów z `objective.exerciseTypes`.

- [ ] **Step 1: Testy**: `present_continuous.affirmative` z `stageSplit` {4,6,2} i `listenAllowance` 2 → notice 2, choice 2+2, order 2+2, gap 3+2, error_fix 3+2, open_answer 3+2, listen 2; `stageTargets` {4,6,3}; mały split {1,1,1} → cele = minima {3,4,3}; cel bez notice/listen ich nie ma; dla każdego celu trzech tematów gramatyki suma udziałów etapu = cel etapu i każdy etap ma ≥1 paczkę.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja (reszta podziału do wcześniejszych typów). **Step 4:** PASS. **Step 5:** commit `Etap 2: plan paczek cel × typ`.

### Task 3: Wspólne parsowanie rekordu

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-agent-tools.ts:311-321`
- Test: istniejące `lesson-pool-agent-tools.test.ts` + nowy przypadek

**Interfaces:**
- Produces: `parseLessonRecord(raw: unknown, objectiveId: string, subject: SubjectModule, familyScope: string | null): ParsedRecord` (eksportowany typ; porażka niesie `rejection: Rejection` z kodem `shape_malformed` / `shape_objective`); `parseRecord` agenta deleguje do niej. **Zrobione: 021a1919.**

- [ ] **Step 1:** test `parseLessonRecord` (rekord z `null` w opcjonalnych polach → `ok`, bez tych pól; obce `objectiveId` → `shape_objective`).
- [ ] **Step 2:** FAIL. **Step 3:** wydzielenie bez zmiany zachowania. **Step 4:** `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-pool-agent-tools.test.ts` → PASS (wszystkie stare też). **Step 5:** commit `Etap 2: wspólne parsowanie rekordu ćwiczenia`.

### Task 4: Porty i metody adaptera

**Files:**
- Modify: `packages/server/src/ports/ai.ts`, `packages/server/src/providers/openai/lesson-pool-agent.ts`, `packages/server/src/providers/openai/llm.ts` (wydzielone stałe: zasada `explanationPl`, akapit „Field meaning / Language discipline”; `renderRuleBook(book, { lead?: string })` — podmiana nagłówka „the tool checks…” i zdania o regułach `brief`, bo w paczce nie ma narzędzia)
- Test: `packages/server/src/providers/openai/lesson-pool-agent.test.ts`, migawki `__snapshots__/lesson-packet-prompt.english_grammar_present_continuous.txt` i `lesson-closed-check-prompt.txt` (w `lesson-pool-prompt.test.ts`)

**Interfaces:**
- Produces (`ports/ai.ts`):
  - `interface LessonPacketInput { readonly pool: LessonPoolInput; readonly objective: Pick<LessonObjectiveAgentInput["objective"], "id" | "title" | "cards">; readonly type: string; readonly count: number; readonly withExamples: boolean; readonly timeoutMs: number }` — `pool` zbudowany przez moduł z `exerciseTypes: [type]` (księga dla jednego typu), sekcje `lesson` i `checks` puste.
  - `interface LessonPacketGenerator { generatePacket(input: LessonPacketInput, cost: RunCostSink, signal: AbortSignal): Promise<{ readonly exercises: readonly unknown[]; readonly examples?: readonly unknown[] }> }`
  - `interface ClosedCheckInput { readonly contract: "choice" | "order"; readonly items: readonly { readonly view: string }[]; readonly timeoutMs: number }`
  - `interface ClosedExerciseChecker { checkClosed(input: ClosedCheckInput, cost: RunCostSink, signal: AbortSignal): Promise<{ readonly results: readonly unknown[] }> }` — przy innej liczbie wyników niż pozycji wszystkie `undefined` (`sameLength`).
- Produces (adapter): `AiSdkLessonPoolAgent` dodatkowo `implements LessonPacketGenerator`, `AiSdkExerciseChecker` dodatkowo `implements ClosedExerciseChecker`; eksport `packetInstructions(input: LessonPacketInput): string`, `closedCheckPrompt(input: ClosedCheckInput): string`. Schemat kontroli: `z.toJSONSchema` z `CHOICE_CHECK_RESULT` / `ORDER_CHECK_RESULT` (Task 1) opakowanych w `{ results: [...] }`; schemat paczki jak `submitSchema` (gałąź `exercises` z `lessonPoolJsonSchema(pool)` + linie `examples` tylko przy `withExamples`).

- [ ] **Step 1: Testy** na `MockLanguageModelV4`: `generatePacket` — system = `packetInstructions`, user = `lessonUserMaterial(input.pool)`; schemat bez `examples` przy `withExamples: false`; surowe rekordy bez zmian; koszt do `RunCostSink`; operacja `packet_generate` w `UsageRecorder`; timeout → `GenerationProviderError("timeout")` po jednym żądaniu. `checkClosed` — prompt z `CHECKER_DATA_RULE` i `<ITEMS>`; wynik innej długości → wszystkie `undefined`; operacja `check_closed`. `renderRuleBook` bez `lead` bez zmian (stare migawki). Migawki: prompt paczki PC `affirmative` × `lesson_choice` z przykładami; prompt kontroli obu kontraktów.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementacja. `AgentOperation` += `packet_generate`, `check_closed`; `tracked(..., { timeoutMs, canRetry: () => false })`. `packetInstructions`: `generationRole`; Subject / prompt locale / answer locale; `objective "<id>": <descriptionEn>`; karty; `transforms` przy `lesson_transform`; zasada `explanationPl`; akapit „Field meaning / Language discipline”; `Field rules…`; `interestsRule` przy tematach; `renderRuleBook(pool.ruleBook, { lead })`; „Write exactly N exercises of type T…”; przy `withExamples` przykłady kart (nigdy odpowiedź ćwiczenia); jednoznaczne polecenie i kontekst, skróty jako osobne warianty, różne zdania. Kontrola: pytania z §2 specu.
- [ ] **Step 4:** PASS (`pnpm vitest run packages/server/src/providers/openai`). **Step 5:** commit.

### Task 5: Przebieg bazowy

**Files:**
- Create: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts`

**Interfaces:**
- Consumes: Task 1–4; `LessonPoolAgentRunInput`, `LessonPoolAgentResult`, `SettledObjective`, `emptyLessonPoolAgentStats` (`lesson-pool-agent.ts`); `RejectionLogEntry` (`lesson-pool-agent-tools.ts`, bez nowego typu); `objectiveBatchCounts`, `poolStageCounts`, `listenChoiceAllowance`, `buildPoolInput` (`lesson-drafts.ts`); `RunCostMeter`, `agentFailureOf`, `DEFAULT_LESSON_AGENT_POLICY` (`lesson-pool-agent-policy.ts`); `deadlineSignal`, `Semaphore`, `untilAborted` (`lesson-agent-timers.ts`); `createLessonAgentState`, `withPool`, `takeIds`, `orderedLesson` (`state.ts`); `submitExamples` (`admission.ts`); `lessonInvariantCheck`, `objectiveStatus` (`status.ts`); `cardExposureSources`, `avoidSentencesFor`, `validateLessonExerciseIssues`, `agentObjectivesOf`.
- Produces:
  - `interface LessonBaselineDeps { readonly generator: LessonPacketGenerator; readonly checker: ClosedExerciseChecker; readonly subjects: Pick<SubjectRegistry, "getSubject">; readonly policy?: Partial<LessonAgentPolicy> }`
  - `runLessonBaselinePool(deps: LessonBaselineDeps, input: LessonPoolAgentRunInput, signal: AbortSignal): Promise<LessonPoolAgentResult>`
  - odrzucenia: `kind`/`code` z istniejącej unii — `shape`/`shape_*` (z `parseLessonRecord`), `shape`/`shape_type` (inny typ niż paczka), `rule`/`rule_exercise`, `limit`/`over_count`, `blind`/`check_wrong_set | check_unknown | check_order_no`, `lesson`/`lesson_pool` (kandydat łamie walidację puli). Nadmiar ponad limit przyjęcia to nie odrzucenie — tylko licznik w dzienniku.

- [ ] **Step 1: Testy** (fake generator: rekordy per `(objectiveId, type)`; fake checker: tabela wyników): (a) PS z 2 celami → `complete`, kolejność lekcji, `stats.submitted/accepted`; (b) rekord innego typu i nadmiar ponad zamówienie → odrzucone, reszta zostaje; (c) kontrola tylko paczek zamkniętych z ocalałymi; (d) fake rozwiązuje paczki w odwrotnej kolejności → ten sam wynik; (e) duplikat bodźca w dwóch paczkach → odpada późniejszy; (f) przykład karty równy kluczowi `open_answer` → linia przykładu odpada, ćwiczenie zostaje; (g) więcej ocalałych niż limit etapu → przyjęte pierwsze `S_s`, a ćwiczenie zapasu poza limitem, które byłoby źródłem ujawnienia, nie usuwa `open_answer`; (h) `transient` / `timeout` / `output` raz → ponowienie i sukces; dwa razy → zagadnienie `failed`, `exercises: []`; `configuration` → `failed` bez ponowienia; 429 z `retryAfterMs` → czeka (sterowany zegar `vi.useFakeTimers`); (i) budżet wyczerpany → kolejne wywołania nie startują, `incomplete`; (j) anulowanie w trakcie kontroli → rzuca `signal.reason`; (k) wynik kontroli innej długości → paczka `check_unknown`; (l) źródło `planner`/`input`, tryb `add`, niepuste `fixed` → `AppError("validation")`; (m) `console.log` bez tekstu ćwiczeń; (n) `onObjectivesResolved` raz, `onObjectiveSettled` per zagadnienie; (o) `lessonInvariantCheck` stanu z wyniku = []; (p) `avoidSentences` w wejściu paczki zawiera zdania kart.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementacja wg §3.2 specu (v3.1): per zagadnienie `targetCount` z `objectiveBatchCounts`, `packetPlan(..., poolStageCounts(subject, objective.exerciseTypes, targetCount), listenChoiceAllowance(...))`; wejście paczki z `buildPoolInput` na temacie z kopią celu o `exerciseTypes: [type]`, `ruleBook` z wyzerowanymi `lesson` i `checks`, `avoidSentencesFor({ examples: {}, exercises: [], subject, cardSentences })`; po wszystkich zagadnieniach: przyjęcie po kolei (kolejność lekcji, limit etapu, `lessonInvariantCheck` pusty z kandydatem) → `submitExamples` per zagadnienie → `objectiveStatus` z limitami `{ targetCount: 0, listenAllowance, maxExercises: Infinity }`. `onObjectiveSettled` po walidacji puli, w kolejności lekcji. Dziennik `[lesson-baseline] run=… obj=<slug> status=… ordered=… accepted=… overflow=… rejected=<code:n,…> costUsd=…`.
- [ ] **Step 4:** PASS + `pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts tests/ai-sdk-scope.test.ts`. **Step 5:** commit.

### Task 6: Dokumentacja (koszty i spec zbiorczy)

**Files:** `docs/architecture.md` §23, `docs/superpowers/specs/2026-11-02-llm-cost-tracking-design.md` (tabela §2), `docs/superpowers/specs/2026-11-07-llm-content-judgment-design.md` (§2, §11, §12.2, §17)

- [ ] **Step 1:** §23 i tabela kosztów: `packet_generate`, `check_closed` (feature `lesson_generation`), „do etapu 4 tylko sonda”.
- [ ] **Step 2:** spec zbiorczy: „bramka po etapie 2” (§11, nagłówek i treść §12.2); §17 „#288 … zamknąć po etapie 4”; §2 i §11: przy „nie” na bramce po etapie 2 zamrożenie heurystyk gramatyki znika, a niepodłączony kod etapu 2 jest usuwany w PR zapisującym decyzję.
- [ ] **Step 3:** commit.

### Task 7: Sonda trzech wariantów

**Files:**
- Create: `tests/probes/grammar-plain-subject.ts`, `tests/probes/grammar-plain-subject.test.ts`, `tests/probes/fixtures/to-be-objectives.json`
- Modify: `tests/probes/agent-generation.probe.test.ts`, `packages/server/src/domain/lessons/subjects/english-grammar/rules.ts` (`export` `TO_BE_GUIDANCE`, `PICTURE_CHOICE_GUIDANCE`), `vitest.unit.config.ts` (`include` += `tests/probes/grammar-plain-subject.test.ts`)

**Interfaces:**
- Produces: `grammarPlainSubject(): SubjectModule`, `GUIDANCE_TEXTS: readonly string[]` (7 stałych), `probeVariantOf(env: string | undefined): "agent" | "agent_plain" | "baseline"` (brak = `agent`, inna wartość → błąd).

- [ ] **Step 1: Testy** (bez sieci): `createSubjectRegistry([grammarPlainSubject()])` nie rzuca; `validateExercise` → []; każdy wpis `rules` ma id z `GRAMMAR_RULES`, te same `field/kind/types/when/priority`, opis = złączone (po `trim`) stałe z `GUIDANCE_TEXTS`, które występują w opisie produkcyjnym; każda z 7 stałych w jakimś wpisie; `probeVariantOf`; id zagadnień w `to-be-objectives.json` = dokładnie zagadnienia katalogowego `to_be` w wersji 1. Przy `UMIEM_PROBE_PROMPT_DIFF_OUT` (poza repo, `resolveOutsideRepoPath`) zapis promptów `objectiveInstructions` obu wariantów dla każdego zagadnienia trzech tematów i liczb znaków (do PR).
- [ ] **Step 2:** FAIL. **Step 3:** implementacja. W sondzie: `UMIEM_PROBE_AGENT_VARIANT`, rejestr wariantu, `graderAvailable: true`, dla `baseline` `runLessonBaselinePool({ generator: agent, checker, subjects, policy })` z `ProbeMeter` (`generatePacket` → generator, `checkClosed` → checker). Kontrola końcowa dopisuje do zrzutu: `variant`, `graderAvailable`, `publication` = `poolCoverage(lesson, objectiveIds, lessonPoolMinimums(subject))`, `countsByType`, `diversity` (per zagadnienie: różne odpowiedzi po `baseNormalizer` / liczba ćwiczeń). Fixture „to be”: `english_grammar`, `to_be`, wersja 1, wszystkie zagadnienia, fikcyjny materiał A1.
- [ ] **Step 4:** PASS (`pnpm vitest run tests/probes/grammar-plain-subject.test.ts tests/probes/probe-*.test.ts`). **Step 5:** commit.

### Task 8: Ćwiczenia wzorcowe

**Files:**
- Create: `tests/probes/fixtures/closed-check-gold.json`, `tests/probes/closed-check-gold.probe.test.ts`
- Modify: `vitest.unit.config.ts` (`include` += część bez sieci, jeśli w osobnym pliku)

Plik ma gotowe wiersze `{ id, class: "correct" | "wrong_key" | "second_correct", draft }` — 22 / 22 / 12. Wiersze `wrong_key` wygenerowane raz z poprawnych regułą §6 specu (choice/short_answer: `correctOption` i `answer` na pierwszą opcję o innym tekście; listen: to samo, a zdanie nagrania wynika z nowego klucza; notice: pierwszy segment zdania nierównoważny kluczowi; order: zamiana dwóch sąsiednich klocków w `items` i `answer`), przejrzane przez autora (potwierdzenie błędności słuchania i rozsypanki w opisie PR).

- [ ] **Step 1:** test bez sieci: liczności klas; każdy z 56 wierszy przechodzi `parseLessonRecord` + `validateLessonExerciseIssues` na `grammarPlainSubject()`; `closedCheckItem` ≠ null dla każdego.
- [ ] **Step 2:** FAIL. **Step 3:** plik i część płatna (`describe.skipIf` bez klucza): `UMIEM_PROBE_COSTS` (wpis tymczasowy, rozliczenie także po błędzie), 3 powtórzenia, paczki per typ, `checkClosed` + `closedCheckVerdict`; liczby per klasa i powtórzenie na konsolę, zrzut poza repo; asercje progów §6. **Step 4:** PASS. **Step 5:** commit.

### Task 9: Rubryka, arkusz, liczenie, sędzia automatyczny

**Files:**
- Create: `tests/probes/blind/rubric-stage2.md`, `tests/probes/blind/auto-judge.probe.test.ts`, `tests/probes/blind/score.test.ts`
- Modify: `tests/probes/blind/gen-blind-sheet.cjs`, `tests/probes/blind/score.cjs`, `vitest.unit.config.ts` (`include` += `tests/probes/blind/score.test.ts`)

**Interfaces:**
- `gen-blind-sheet.cjs <katalog lekcji> <seed> [prefiks]`: `rowId` = `<prefiks>-r001…` (prefiks tematu); kontekst + `descriptionEn`; ćwiczenie = pola szkicu bez `id`, `revisionId`, `*Audio`, `objectiveId` jako ostatni człon, klucze posortowane; kolumna `level` do wypełnienia; `key.json` z `type` i `hasExplanation` per wiersz; osobny katalog `judge/` tylko z `sheet.csv` — jedyna ścieżka dla sędziów (rubryka i materiał kopiowane obok).
- `score.cjs`: eksport `wilson(defects, n)` (z = 1,96) i `scoreStage2(groups)`; CLI `node score.cjs <sędzia> <key.json> <verdicts.csv> [<key.json> <verdicts.csv> …]` (pary per temat); mianowniki klas W1–W9 z `type`/`hasExplanation` (tabela §7 specu), per wariant (źródło `<wariant>-rN`), temat i typ ćwiczenia; liczniki per przebieg (min–max); błąd przy powtórzonym `rowId`, wierszu bez werdyktu, `defect` bez klasy albo klasie spoza mianownika; liczba uwag `level`. Zgodność: `node score.cjs --agree <key> <verdicts A> <verdicts B>` → odsetek zgodnych werdyktów per klasa.
- `auto-judge.probe.test.ts`: katalog sędziego, rubryka czytana dosłownie z `rubric-stage2.md`, partie po 25 z materiałem; `generateText` + `Output.object` (`{ rows: { rowId, verdict, criterion, level, adjudicatorNote }[] }`); partia odrzucona, gdy `rowId` ≠ wiersze partii albo klasa spoza W1–W9 (jedno ponowienie partii); `UMIEM_PROBE_COSTS` z wpisem tymczasowym (rezerwa `UMIEM_PROBE_JUDGE_BUDGET_USD`), sprawdzenie po każdej partii, rozliczenie po błędzie, żądanie bez kosztu po cenach sędziego; wynik `verdicts.csv` poza repo, istniejący nie jest nadpisywany; `UMIEM_PROBE_JUDGE_MODEL` wymagany.

- [ ] **Step 1: Testy** `score.test.ts`: `wilson(0, 400).high ≈ 0.0095`, `wilson(4, 400)` ≈ [0.0039, 0.0254], `wilson(0, 0)` → [0, 1]; `scoreStage2` na małym kluczu: mianowniki W1/W3/W8, błąd przy powtórzonym `rowId` i klasie spoza mianownika.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja + rubryka wg §7 specu. **Step 4:** PASS. **Step 5:** commit.

### Task 10: Weryfikacja, szkic PR i instrukcja biegów

- [ ] `pnpm check` → PASS.
- [ ] `pnpm test:integration` (w tle) → PASS.
- [ ] `pnpm test:e2e:shards` (w tle) → PASS (przy `net::ERR_NO_BUFFER_SPACE` powtórzyć spec osobno i odnotować).
- [ ] Szkic PR (draft) z SHA-256 `rubric-stage2.md`, `to-be-objectives.json`, `closed-check-gold.json`, bilansem linii §10, znakami migawek, diffem promptów `agent` vs `agent_plain`, potwierdzeniem wierszy wzorcowych — przed pierwszym płatnym biegiem.
- [ ] Instrukcja biegów w notatce sesji (poza repo): jeden rejestr `UMIEM_PROBE_COSTS` z `UMIEM_PROBE_COSTS_INIT=1` i `UMIEM_PROBE_COSTS_CAP_USD=18`; jawne `UMIEM_PROBE_AGENT_MODEL`, `UMIEM_PROBE_AGENT_SOLVER_MODEL`, `UMIEM_PROBE_JUDGE_MODEL` (§8 specu) w każdym poleceniu; `sceneShare` z `pcPoolStats` (`tests/probes/present-continuous-stats.ts`) na zrzutach PC.

Płatne biegi (spec §8), trzech krytyków na gałęzi, `ponytail:ponytail-review` i raport w PR — po zgodzie właściciela na koszt, poza tym planem.
