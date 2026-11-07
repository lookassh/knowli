# Etap 2: przebieg bazowy i sonda gramatyki — plan implementacji

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
- Jedno ponowienie wywołania, w przebiegu, tylko gdy `agentFailureOf(e).retryable`; adapter `canRetry: () => false`.
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
  - `PACKET_RESERVE = 2`, `NOTICE_PER_OBJECTIVE = 2`
  - `interface PacketPlan { readonly packets: readonly { readonly type: LessonExerciseType; readonly count: number }[]; readonly stageTargets: { readonly guided: number; readonly productive: number; readonly independent: number }; readonly listenAllowance: number }`
  - `packetPlan(subject: SubjectModule, objective: LearningObjective, stageSplit: LlmLessonStageCounts, listenAllowance: number): PacketPlan` — `stageSplit` = `poolStageCounts(subject, objective.exerciseTypes, targetCount)` liczone przez moduł (funkcja żyje w `lesson-drafts.ts`). Paczki w kolejności lekcji: notice, typy guided, typy productive, typy independent, listen_choice; w etapie kolejność typów z `objective.exerciseTypes`.

- [ ] **Step 1: Testy**: `present_continuous.affirmative` z `stageSplit` {4,6,2} i `listenAllowance` 2 → notice 2, choice 2+2, order 2+2, gap 3+2, error_fix 3+2, open_answer 3+2, listen 2; `stageTargets` {4,6,3}; mały split {1,1,1} → cele = minima {3,4,3}; cel bez notice/listen ich nie ma; dla każdego celu trzech tematów gramatyki suma udziałów etapu = cel etapu i każdy etap ma ≥1 paczkę.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja (reszta podziału do wcześniejszych typów). **Step 4:** PASS. **Step 5:** commit `Etap 2: plan paczek cel × typ`.

### Task 3: Wspólne parsowanie rekordu

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-agent-tools.ts:311-321`
- Test: istniejące `lesson-pool-agent-tools.test.ts` + nowy przypadek

**Interfaces:**
- Produces: `parseLessonRecord(raw: unknown, objectiveId: string, subject: SubjectModule, familyScope: string | null): { ok: true; draft: LessonExerciseDraft; notes: readonly LessonRuleIssue[] } | { ok: false; exerciseType: string; code: "shape_malformed" | "shape_objective"; issues: readonly LessonRuleIssue[] }` — eksport z `lesson-pool-agent-tools.ts`; `parseRecord` agenta deleguje do niej (dalej mapuje porażkę na `shapeRejection`).

- [ ] **Step 1:** test `parseLessonRecord` (rekord z `null` w opcjonalnych polach → `ok`, bez tych pól; obce `objectiveId` → `shape_objective`).
- [ ] **Step 2:** FAIL. **Step 3:** wydzielenie bez zmiany zachowania. **Step 4:** `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-pool-agent-tools.test.ts` → PASS (wszystkie stare też). **Step 5:** commit `Etap 2: wspólne parsowanie rekordu ćwiczenia`.

### Task 4: Porty i metody adaptera

**Files:**
- Modify: `packages/server/src/ports/ai.ts`, `packages/server/src/providers/openai/lesson-pool-agent.ts`
- Test: `packages/server/src/providers/openai/lesson-pool-agent.test.ts`, migawki `providers/openai/__snapshots__/lesson-packet-prompt.english_grammar_present_continuous.txt`, `lesson-closed-check-prompt.txt` (test w `lesson-pool-prompt.test.ts`)

**Interfaces:**
- Produces (`ports/ai.ts`):
  - `interface LessonPacketInput { readonly pool: LessonPoolInput; readonly objective: { readonly id: string; readonly title: string; readonly cards: readonly { readonly title: string; readonly body: string }[] }; readonly type: string; readonly count: number; readonly withExamples: boolean; readonly callTimeoutMs: number }` — `pool.ruleBook` już zawężony przez moduł do `general` + bloku typu (`lesson`/`checks` puste).
  - `interface LessonPacketGenerator { generatePacket(input: LessonPacketInput, cost: RunCostSink, signal: AbortSignal): Promise<{ readonly exercises: readonly unknown[]; readonly examples?: readonly unknown[] }> }`
  - `interface ClosedCheckInput { readonly contract: "choice" | "order"; readonly items: readonly { readonly view: string }[]; readonly timeoutMs: number }`
  - `interface ClosedExerciseChecker { checkClosed(input: ClosedCheckInput, cost: RunCostSink, signal: AbortSignal): Promise<{ readonly results: readonly unknown[] }> }` — `results.length === items.length` albo wszystkie `undefined`.
- Produces (adapter): `AiSdkLessonPoolAgent implements LessonPoolAgentProvider, LessonPacketGenerator`; `AiSdkExerciseChecker implements LessonExerciseCheckerProvider, ClosedExerciseChecker`; eksport `packetInstructions(input: LessonPacketInput): string`, `closedCheckPrompt(input: ClosedCheckInput): string`.

- [ ] **Step 1: Testy** na `MockLanguageModelV4`: `generatePacket` wysyła system = `packetInstructions`, user = `lessonUserMaterial(input.pool)`, schemat z gałęzią `exercises` (enum `exerciseType` = [typ]) i `examples` tylko przy `withExamples`; zwraca surowe rekordy; koszt z `providerMetadata` do `RunCostSink`; operacja `packet_generate` w `UsageRecorder`; timeout żądania → `GenerationProviderError("timeout")` po jednym żądaniu (bez ponowienia); `checkClosed` — prompt zawiera `CHECKER_DATA_RULE` i `<ITEMS>`, wynik innej długości → wszystkie `undefined`; operacja `check_closed`. Migawki: prompt paczki dla PC `affirmative` × `lesson_choice` z pierwszą paczką i prompt kontroli obu kontraktów.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementacja: `AgentOperation` += `packet_generate`, `check_closed`; `tracked(..., { timeoutMs, canRetry: () => false })`. `packetInstructions` składa: `generationRole`; odbiorca jak w `lessonSystemPrompt` (Subject / prompt / answer locale); `- objective "<id>": <descriptionEn>`; karty; `transforms` przy `lesson_transform`; zasada `explanationPl` (ten sam tekst co w `lessonSystemPrompt` — wydziel stałą w `llm.ts`); `Field rules…` i `interestsRule`; `renderRuleBook(pool.ruleBook)`; „Write exactly N exercises of type T for this objective…”; przy `withExamples` „Also return 1-3 short card examples…, never the answer of an exercise”; wymagania: jednoznaczne polecenie i kontekst, skróty jako osobne warianty `acceptedAnswers`, różne zdania. Kontrola: pytania z §2 specu.
- [ ] **Step 4:** PASS (`pnpm vitest run packages/server/src/providers/openai`). **Step 5:** commit `Etap 2: porty i adapter paczki oraz kontroli zamkniętych`.

### Task 5: Przebieg bazowy

**Files:**
- Create: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts`

**Interfaces:**
- Consumes: Task 1–4; `LessonPoolAgentRunInput`, `LessonPoolAgentResult`, `SettledObjective`, `emptyLessonPoolAgentStats`, `lessonAgentLimits` (`lesson-pool-agent.ts`); `objectiveBatchCounts`, `poolStageCounts`, `listenChoiceAllowance`, `buildPoolInput`, `mergeExamples` (`lesson-drafts.ts`); `RunCostMeter`, `agentFailureOf`, `DEFAULT_LESSON_AGENT_POLICY`, `LessonAgentPolicy` (`lesson-pool-agent-policy.ts`); `deadlineSignal`, `Semaphore`, `untilAborted` (`lesson-agent-timers.ts`); `createLessonAgentState`, `withPool`, `takeIds`, `orderedEntries` (`state.ts`); `submitExamples`, `removeExercise` (`admission.ts`); `lessonInvariantCheck`, `objectiveStatus` (`status.ts`); `cardExposureSources`, `avoidSentencesFor`, `validateLessonExerciseIssues`, `agentObjectivesOf`.
- Produces:
  - `interface LessonBaselineDeps { readonly generator: LessonPacketGenerator; readonly checker: ClosedExerciseChecker; readonly subjects: Pick<SubjectRegistry, "getSubject">; readonly policy?: Partial<LessonAgentPolicy> }`
  - `runLessonBaselinePool(deps: LessonBaselineDeps, input: LessonPoolAgentRunInput, signal: AbortSignal): Promise<LessonPoolAgentResult>`
  - `RejectionLogEntry` z `code` ∈ `shape_malformed | shape_objective | shape_type | rule_exercise | over_count | check_wrong_set | check_unknown | check_order_no | lesson_pool | leak_victim | trimmed` (bez `detail` z treścią poza sondą — pole `detail` jak u agenta, tylko dla zrzutu).

- [ ] **Step 1: Testy** (fake generator: deterministyczne rekordy per `(objectiveId, type)`; fake checker: tabela wyników): (a) temat PS z 2 celami → statusy `complete`, ćwiczenia w kolejności lekcji, `stats.submitted/accepted`; (b) rekord innego typu i nadmiar → odrzucone, reszta zostaje; (c) kontrola tylko dla paczek zamkniętych (licznik wywołań fake'a = liczba paczek zamkniętych z ocalałymi); (d) fake rozwiązuje paczki w odwrotnej kolejności → ten sam wynik; (e) duplikat bodźca w dwóch paczkach → odpada późniejszy; (f) przykład karty równy kluczowi `open_answer` → przykład odrzucony, ćwiczenie zostaje; (g) przycięcie: więcej ocalałych niż cel etapu → zostaje `S_s` pierwszych, kod `trimmed`; (h) błąd `transient` raz → ponowienie i sukces; dwa razy → zagadnienie `failed`, `exercises: []`; błąd `configuration` → `failed` bez ponowienia; (i) budżet wyczerpany → kolejne paczki nie startują, `incomplete`; (j) anulowanie sygnałem w trakcie kontroli → rzuca `signal.reason`; (k) wynik kontroli innej długości → paczka odrzucona `check_unknown`; (l) źródło `planner`/`input`, tryb `add` albo niepuste `fixed` → `AppError("validation")`; (m) `console.log` nie zawiera tekstu żadnego ćwiczenia; (n) haki `onObjectivesResolved` (raz) i `onObjectiveSettled` (per zagadnienie) wołane; (o) wynik przechodzi `lessonInvariantCheck` = [] i `findExposureLeaks` (tryb `coverage`) bez twardych.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementacja wg §3.2 specu: per zagadnienie `targetCount` z `objectiveBatchCounts(input.poolSize, n, subject)`, `packetPlan(..., poolStageCounts(...targetCount), listenChoiceAllowance(...))`; wejście paczki z `buildPoolInput` (avoid z `avoidSentencesFor` stanu startowego) z `ruleBook` zawężonym do `{ general, types: [blok typu], lesson: [], checks: [] }` i `exerciseTypes: [type]`; po wszystkich zagadnieniach: stan → `withPool` (kolejność paczek) → `submitExamples` per zagadnienie → `lessonInvariantCheck` + `removeExercise` → przycięcie → `objectiveStatus` z limitami `{ targetCount: 0, listenAllowance, maxExercises: Infinity }`. Haki: `onObjectiveSettled` dopiero po walidacji puli (kolejność lekcji). Dziennik: `[lesson-baseline] run=… obj=<slug> status=… ordered=… accepted=… rejected=<code:n,…> costUsd=…`.
- [ ] **Step 4:** PASS + `pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts tests/ai-sdk-scope.test.ts`. **Step 5:** commit `Etap 2: przebieg bazowy puli lekcji (bez workera)`.

### Task 6: Dokumentacja (koszty i spec zbiorczy)

**Files:**
- Modify: `docs/architecture.md` §23, `docs/superpowers/specs/2026-11-02-llm-cost-tracking-design.md` (tabela §2), `docs/superpowers/specs/2026-11-07-llm-content-judgment-design.md` (§2 Zamrożenie, §11, §12.2, §17)

- [ ] **Step 1:** §23 i tabela kosztów: operacje `packet_generate`, `check_closed` (feature `lesson_generation`), z adnotacją „do etapu 4 tylko sonda”.
- [ ] **Step 2:** Spec zbiorczy: „bramka po etapie 2” w §11 i §12.2 (nagłówek §12.2); §17 „#288 … zamknąć po etapie 4”; §2 i §11: przy „nie” na bramce po etapie 2 zamrożenie heurystyk gramatyki znika, a niepodłączony kod etapu 2 jest usuwany w PR zapisującym decyzję; wpis w §18.
- [ ] **Step 3:** commit `Etap 2: koszty i poprawki specu zbiorczego`.

### Task 7: Sonda trzech wariantów

**Files:**
- Create: `tests/probes/grammar-plain-subject.ts`, `tests/probes/grammar-plain-subject.test.ts`, `tests/probes/fixtures/to-be-objectives.json`
- Modify: `tests/probes/agent-generation.probe.test.ts`, `packages/server/src/domain/lessons/subjects/english-grammar/rules.ts` (`export` `TO_BE_GUIDANCE`, `PICTURE_CHOICE_GUIDANCE`)

**Interfaces:**
- Produces: `grammarPlainSubject(): SubjectModule`, `GUIDANCE_TEXTS: readonly string[]` (7 stałych), `probeVariantOf(env: string | undefined): "agent" | "agent_plain" | "baseline"` (domyślnie `agent`, inna wartość → błąd).

- [ ] **Step 1: Testy** (`grammar-plain-subject.test.ts`, bez sieci): `createSubjectRegistry([grammarPlainSubject()])` nie rzuca; `validateExercise` zwraca []; każdy wpis `rules` ma opis złożony wyłącznie z `GUIDANCE_TEXTS` i id istniejące w `GRAMMAR_RULES` z tymi samymi `field/kind/types/when/priority`; każda z 7 stałych jest w jakimś wpisie; dla każdego zagadnienia trzech tematów prompt agenta (`objectiveInstructions` na wejściu `objectiveAgentInput`) wariantu plain jest krótszy i każda linia `RULES`-owa plain występuje w produkcyjnym (różnica tylko w opisach reguł); przy `UMIEM_PROBE_PROMPT_DIFF_OUT` (poza repo, `resolveOutsideRepoPath`) zapis diffu i liczb znaków. `probeVariantOf`.
- [ ] **Step 2:** FAIL. **Step 3:** implementacja; w sondzie: `UMIEM_PROBE_AGENT_VARIANT`, rejestr wariantu, `graderAvailable: true` (zapis w nagłówku zrzutu jako `graderAvailable` + `variant`), dla `baseline` `runLessonBaselinePool({ generator: agent, checker, subjects, policy })` z tym samym licznikiem kosztu (`ProbeMeter`: `generatePacket` → generator, `checkClosed` → checker); zrzut z liczbami per typ (`countsByType`). Fixture „to be”: `subjectId english_grammar`, `topicId to_be`, wersja 1, wszystkie 5 zagadnień, fikcyjny materiał A1 w stylu `present-simple-objectives.json`.
- [ ] **Step 4:** PASS (`pnpm vitest run tests/probes/grammar-plain-subject.test.ts tests/probes/probe-*.test.ts`); sonda bez klucza jest pomijana (`describe.skipIf`). **Step 5:** commit `Etap 2: sonda trzech wariantów i materiał „to be”`.

### Task 8: Ćwiczenia wzorcowe

**Files:**
- Create: `tests/probes/fixtures/closed-check-gold.json`, `tests/probes/closed-check-gold.ts` (mutacje), `tests/probes/closed-check-gold.test.ts`, `tests/probes/closed-check-gold.probe.test.ts`

**Interfaces:**
- Produces: `goldCases(): readonly { id: string; class: "correct" | "wrong_key" | "second_correct"; draft: LessonExerciseDraft }[]` — z pliku: `correct` (12 wybór + 10 rozsypanka), `second_correct` (12), `wrongKeyConfirmed: string[]` (id słuchania i rozsypanki potwierdzone przez autora); `wrong_key` liczone mechanicznie `mutateKey(draft)` (§6 specu).

- [ ] **Step 1: Testy bez sieci**: liczności klas (22/22/12); każdy przypadek przechodzi walidację struktury (`parseLessonRecord` + `validateLessonExerciseIssues` na module bez heurystyk); `mutateKey` zmienia klucz (choice: `correctOption` i `answer` na pierwszą opcję o innym tekście; listen: to samo, nowe zdanie nagrania ≠ stare; notice: inny segment zdania; order: zamiana dwóch sąsiednich klocków w `items` i `answer`, wynik przechodzi strukturę); każdy zmutowany przypadek słuchania i rozsypanki jest na liście `wrongKeyConfirmed`.
- [ ] **Step 2:** FAIL. **Step 3:** plik i mutacje; sonda płatna: `UMIEM_PROBE_COSTS`, 3 powtórzenia, paczki per typ, `checkClosed` + `closedCheckVerdict`, wynik per klasa i powtórzenie na konsolę (liczby) i do zrzutu poza repo; asercje progów §6. **Step 4:** PASS testów bez sieci. **Step 5:** commit `Etap 2: ćwiczenia wzorcowe kontroli zamkniętych`.

### Task 9: Rubryka, arkusz, liczenie, sędzia automatyczny

**Files:**
- Create: `tests/probes/blind/rubric-stage2.md`, `tests/probes/blind/auto-judge.probe.test.ts`, `tests/probes/blind/wilson.cjs` + `tests/probes/blind/wilson.test.ts`
- Modify: `tests/probes/blind/gen-blind-sheet.cjs` (kontekst + `descriptionEn`; ćwiczenie z polami kontraktu w posortowanej kolejności), `tests/probes/blind/score.cjs` (tryb `--stage2`: mianowniki klas W1–W9 z typu w arkuszu, Wilson 95%, per źródło/wariant, zgodność dwóch plików werdyktów per klasa)

**Interfaces:**
- Produces: `wilson(defects: number, n: number): { low: number; high: number }` (z = 1,96); źródło arkusza `<wariant>-r<N>` (nazwa katalogu), wariant = część przed `-r`.

- [ ] **Step 1: Testy** `wilson.test.ts`: `wilson(0, 400).high ≈ 0.0095`, `wilson(4, 400)` ≈ [0.0039, 0.0254], `wilson(0, 0)` → [0, 1].
- [ ] **Step 2:** FAIL. **Step 3:** rubryka wg §7 specu (klasy, mianowniki, rozstrzygnięcia, pakiet sędziego, zasada wykazywalności); `auto-judge.probe.test.ts`: arkusz + rubryka + materiał, partie po 25, `generateText` + `Output.object` (`{ rows: { rowId, verdict, criterion, adjudicatorNote }[] }`), rejestr kosztów jak w sondzie, wynik `verdicts.csv` poza repo, istniejący plik nie jest nadpisywany. **Step 4:** PASS. **Step 5:** commit `Etap 2: rubryka ślepej oceny, liczenie z przedziałem Wilsona i sędzia automatyczny`.

### Task 10: Weryfikacja i przegląd

- [ ] `pnpm check` → PASS.
- [ ] `pnpm test:integration` (w tle) → PASS.
- [ ] `pnpm test:e2e:shards` (w tle) → PASS (przy `net::ERR_NO_BUFFER_SPACE` powtórzyć spec osobno i odnotować).
- [ ] SHA-256 `rubric-stage2.md`, `to-be-objectives.json`, `closed-check-gold.json` zapisane do opisu PR.
- [ ] Bilans linii ścieżek §10 i znaki migawek.

Płatne biegi (spec §8), trzech krytyków na gałęzi, `ponytail:ponytail-review` i PR — po zgodzie właściciela na koszt, poza tym planem.
