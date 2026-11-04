# Agent generujący pulę lekcji — etap 1 — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reguły agenta puli lekcji w domenie, polityki trzech przedmiotów, porty z fake'ami i kierownik w pamięci, a próba `pnpm probe:agent` działa na tym kodzie.

**Architecture:** Funkcyjny rdzeń `domain/lessons/agent/` (niemutowalny stan lekcji, przyjmowanie paczki z kontrolą całej lekcji, status, widok rozwiązującego, plan) parametryzowany `SubjectModule.agentPolicy`. Kierownik w `modules/materials/lessons/` składa narzędzia podagentów z rdzenia i portu checkera, pilnuje mutexów, budżetu i terminów. AI SDK występuje wyłącznie w pliku próby (`tests/probes`).

**Tech Stack:** TypeScript strict, Vitest, Zod, pnpm; w próbie `ai@7.0.162` i `@openrouter/ai-sdk-provider@3.1.0` (devDependencies roota).

**Spec:** `docs/superpowers/specs/2026-11-04-lesson-pool-agent-stage1-design.md` (wersja 2; numery § poniżej odnoszą się do niego).

**Gałąź:** od gałęzi PR wstępnego (`docs/superpowers/plans/2026-11-04-lesson-card-sentences-generation.md`) — rdzeń używa `generationExposureSources`. PR do `main` po scaleniu PR wstępnego (rebase).

## Global Constraints

- Kod i identyfikatory po angielsku; komentarze, dokumentacja i opisy PR po polsku.
- `domain/lessons/agent/` nie importuje `ai`, `@openrouter/*`, `drizzle-orm`, `modules/`, `providers/`, `ports/`, `config*` (§9.4); bez `Date.now`, `Math.random`, env.
- Silnik, kierownik i `providers/fake-lesson-agent.ts` nie zawierają literałów `english_chapter`, `english_grammar`, `school` (istniejący skan `domain/lessons/architecture.test.ts`).
- `ai` i `@openrouter/*` tylko w `tests/probes/**` i jako devDependencies roota, przypięte dokładnie (`7.0.162`, `3.1.0`).
- Wartości polityki (§4.1, §7): `independentReserve` 1, `slack` 2, `maxStepsPerObjective` 8, `planMaxSteps` 8, `concurrency` 4, `checkerConcurrency` 4, `checkerTimeoutMs` 90 000, `objectiveTimeoutMs` 300 000, `runTimeoutMs` = `DEFAULT_LESSON_GENERATION_POLICY.runTimeoutMs`, `runBudgetUsd` 1,00, `unknownCallEstimateUsd` 0,02; plan 3–6 zagadnień.
- Do checkera trafiają wyłącznie widoki, liczby odpowiedzi, odpowiedź i warianty oraz materiał przy `checkerNeedsMaterial` (§11). Nigdy dane dziecka.
- Logi `[lesson-agent]` bez treści ćwiczeń, materiału, kart, tematów zdań i `detail` (§7.4).
- Instalacja tylko `pnpm install --prefer-offline --frozen-lockfile` / `pnpm add -D -w --save-exact`; nigdy `npm install`.
- Nie wypychaj do `main`, nie scalaj PR; nie wypychaj gałęzi `feat/lesson-review-probe`.

## Review Focus

- Model zwraca rekord z `objectiveId` innego zagadnienia, `exercises` niebędące tablicą albo `null` w polach — odrzucenie `shape` z powodem, bez wyjątku (test w Task 9).
- Lekcja z ok. 90 ćwiczeniami — `admitBatch` paczki 12 ćwiczeń na takim stanie kończy się poniżej 2 s (test w Task 4).
- `remove` z nieznanym id, id z innego zagadnienia albo id `fixed`; ponowne wysłanie identycznego ćwiczenia — `removed: []`, odrzucenie duplikatu z powodem (testy w Task 4).
- Checker zwraca mniej lub więcej pozycji niż wysłano albo w złej kolejności długości — pozycje bez pary są `unavailable`, nadmiar ignorowany, bez wyjątku (test w Task 9).
- Materiał rozdziału bez linii „en — pl” i bez sekcji ram — `planCoverage` puste, `planGate` przechodzi, `objectiveGaps` puste, pętla się kończy (test w Task 6).

---

### Task 1: Typy polityki agenta w `SubjectModule`

**Files:**
- Modify: `packages/server/src/domain/lessons/types.ts`
- Create: `packages/server/src/domain/lessons/agent/capable.ts`
- Test: `packages/server/src/domain/lessons/agent/capable.test.ts`

**Interfaces:**
- Produces (w `types.ts`): `AgentObjective` (§3.1: `id`, `titlePl`, `descriptionEn`, `kind?: DynamicObjectiveKind`, `cards`, `exerciseTypes: readonly LessonExerciseType[]`), `RawPlanObjective` (`slug`, `titlePl`, `descriptionEn`, `kind`, `cards: {title, body}[]`, `examples: string[]`), `SubjectAgentPolicy` (dokładnie §4), `SubjectModule.agentPolicy?: SubjectAgentPolicy`.
- Produces (w `capable.ts`): `type AgentCapableSubject = SubjectModule & { readonly agentPolicy: SubjectAgentPolicy }`; `asAgentCapable(subject: SubjectModule): AgentCapableSubject` — rzuca `Error("subject has no agentPolicy")` (kierownik mapuje na `AppError("validation")`); `agentObjectivesOf(topic: LessonTopic, kinds?: ReadonlyMap<string, DynamicObjectiveKind>): AgentObjective[]`.

- [ ] **Step 1: Test** `capable.test.ts`: `asAgentCapable` przepuszcza przedmiot z polityką i rzuca dla przedmiotu bez niej; `agentObjectivesOf` zachowuje kolejność celów tematu, karty i `exerciseTypes`, a `kind` bierze z mapy.
- [ ] **Step 2: Uruchom — FAIL.** `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/agent/capable.test.ts`
- [ ] **Step 3: Zaimplementuj** typy i `capable.ts`.
- [ ] **Step 4: Uruchom — PASS**, plus `pnpm exec tsc --noEmit -p packages/server/tsconfig.json`.
- [ ] **Step 5: Commit** — „Lekcje: typy polityki agenta w SubjectModule (#237)”.

### Task 2: Stan lekcji agenta

**Files:**
- Create: `packages/server/src/domain/lessons/agent/state.ts`
- Test: `packages/server/src/domain/lessons/agent/state.test.ts`

**Interfaces:**
- Consumes: `AgentObjective` (Task 1), `stageOf`, `outsideStagePath` (`domain/lessons/stages.ts`).
- Produces: `LessonAgentState` (§3.1); `createLessonAgentState(input: { topic: LessonTopic; objectives: readonly AgentObjective[]; fixed: readonly LessonExerciseDraft[]; examples: Readonly<Record<string, readonly string[]>>; fixedSources: Readonly<Record<string, readonly string[]>> }): LessonAgentState`; `orderedLesson(state): readonly LessonExerciseDraft[]`; `orderedEntries(state): readonly { objectiveId: string; id: string | null; draft: LessonExerciseDraft }[]` (`id: null` dla `fixed`); `poolOf(state, objectiveId): readonly AgentPoolEntry[]`; `withPool(state, objectiveId, pool): LessonAgentState`; `allExamples(state): Record<string, string[]>` (= `examples` ∪ `fixedSources`, wejście reguł ujawnień); `nextIds(state, n): { ids: string[]; state }` (`ex1`, `ex2`…).

- [ ] **Step 1: Testy**: kolejność `orderedLesson` — zagadnienia w kolejności planu, w zagadnieniu `fixed` i pula po etapach `intro` < `guided` < `productive` < `independent`, typy poza ścieżką na końcu; `fixed` nie są w `poolOf`; `allExamples` łączy oba źródła bez duplikatów; `withPool` nie mutuje wejścia (`Object.isFrozen` nie jest wymagane — porównanie referencji i zawartości wejścia przed/po); identyfikatory deterministyczne.
- [ ] **Step 2: FAIL → Step 3: implementacja → Step 4: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/agent/state.test.ts`).
- [ ] **Step 5: Commit** — „Lekcje: stan lekcji agenta (#237)”.

### Task 3: Widok rozwiązującego i porównanie ślepego rozwiązania

**Files:**
- Create: `packages/server/src/domain/lessons/agent/solver.ts`
- Test: `packages/server/src/domain/lessons/agent/solver.test.ts`

**Interfaces:**
- Produces: `solverView(draft: LessonExerciseDraft, topic: LessonTopic): string`; `expectedAnswerCount(draft): number`; `blindMatches(draft, answers: readonly string[], normalizer: AnswerNormalizer): boolean`; `SOLVER_FIELD_CLASS: Readonly<Record<keyof LessonExerciseDraft, "view" | "key" | "meta">>` (eksportowana do testu i do budowy widoku).

- [ ] **Step 1: Testy**:
  - `SOLVER_FIELD_CLASS` ma klucz dla każdego pola `LessonExerciseDraft` (`satisfies Record<keyof LessonExerciseDraft, …>` + test runtime, że zbiór kluczy równa się kluczom pełnego przykładowego szkicu ze wszystkimi polami);
  - dla przykładowego szkicu każdego typu żadna wartość pola `key` (`answer`, `acceptedAnswers`, `focus`, `correctOption`, `gapAnswers`, `explanationPl`, `hint`, `requiredElements`, `supplementaryElements`, `commonErrors`, `expectedForm`, `sourceRefs`, `keyOptionIds`, `calculation`) nie występuje w `solverView` jako podciąg (dla tekstów ≥ 3 znaki, których nie ma w polach `view`);
  - `lesson_transform`: widok zawiera `topic.transforms[…].instructionPl`; `visualSubject` w widoku;
  - bloki `lesson_order`, prawe strony par (z `extraRight`) i bank luk posortowane;
  - `expectedAnswerCount`: luki w tekście, pary, grupy, inne = 1;
  - `blindMatches`: luki w tekście (pozycyjnie, z wariantem), pary z „lewa => prawa” i bez, grupy po etykietach, wybór/luka/tłumaczenie z wariantem i normalizatorem; inna liczba odpowiedzi → `false`; apostrof typograficzny i wielkość liter → `true`.
- [ ] **Step 2: FAIL → Step 3: implementacja** (widok z listy pól `view` w stałej kolejności z §3.7) **→ Step 4: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/agent/solver.test.ts`).
- [ ] **Step 5: Commit** — „Lekcje: widok rozwiązującego i ślepe porównanie (#237)”.

### Task 4: Przyjmowanie paczki, usuwanie i przykłady kart

**Files:**
- Create: `packages/server/src/domain/lessons/agent/admission.ts`, `packages/server/src/domain/lessons/keyword-families.ts`
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (import `withoutOrphanKeywords` z domeny)
- Test: `packages/server/src/domain/lessons/agent/admission.test.ts`
- Test: `packages/server/src/domain/lessons/agent/admission.property.test.ts`

**Interfaces:**
- Consumes: Task 1–3 (`blindMatches` w kroku 5); `validateLessonExercise`, `validatePool` (`PoolValidationContext.existingExercises`), `findExposureLeaks` (`mode: "coverage"`), `MAX_TEXT_LENGTH` (`pool-validation.ts`).
- Produces:
  - `AgentCheckContext` (§3.2) z `limits: ReadonlyMap<string, ObjectiveAgentLimits>`; `ObjectiveAgentLimits = { targetCount: number; listenAllowance: number; maxExercises: number }`.
  - `CheckResult<T>`, `CandidateChecks`, `Rejection` (§3.3; `kind` także `"shape"`, nadawany przez kierownika).
  - `PrecheckEntry = { pass: true; draft: LessonExerciseDraft; sanitized: readonly string[] } | { pass: false; rejection: Rejection }`.
  - `precheckBatch(state, objectiveId: string, drafts: readonly LessonExerciseDraft[], ctx: AgentCheckContext): PrecheckEntry[]`.
  - `AdmitEntry = { accepted: string; sanitized: readonly string[]; unchecked: boolean } | { rejected: Rejection }`.
  - `admitBatch(state, objectiveId, prechecked: readonly PrecheckEntry[], checks: readonly CandidateChecks[], ctx): { state: LessonAgentState; results: AdmitEntry[] }` — `checks[i]` dotyczy `prechecked[i]`; dla wpisów `pass: false` wynik to ich `rejection`.
  - `removeExercise(state, objectiveId, id: string, ctx): { state; removed: string[] }`.
  - `submitExamples(state, objectiveId, lines: readonly unknown[], ctx): { state; accepted: number; errors: string[] }`.
  - Kody odrzuceń (`Rejection.code`, stałe w pliku): `limit_full`, `limit_listen`, `rule_exercise`, `rule_gate`, `refine`, `lesson_pool`, `lesson_extra`, `leak_victim`, `leak_source`, `blind_mismatch`, `variant_rejected`.

Algorytm kroków 1–6: dokładnie §3.3. Szczegóły, których sygnatura nie rozstrzyga:
- kroki 3–4 porównują stan „przed” i „po” wstawieniu kandydata: zbiór par `(indeks ćwiczenia w orderedLesson przed, błędy)` z `validatePool` + `validatePoolExtra`, oraz zbiór indeksów ujawnionych z `findExposureLeaks` (źródła: `allExamples(state)`); kandydat odpada, gdy jest wśród odrzuconych/ujawnionych albo gdy pojawia się wpis dla ćwiczenia, którego nie było „przed”. Mapowanie indeksów „po” na „przed” przez pozycję kandydata w `orderedLesson`.
- `refineGeneratedPool` woła się dla pojedynczego kandydata `[draft]` z `{ material }`; odrzucenie → `refine` z powodem przedmiotu; `kept[0]` zastępuje szkic.
- `lesson_keywords`: w `admitBatch` przyjmowane po wszystkich pozostałych kandydatach paczki (stabilnie), wynik w indeksach wejścia.
- `removeExercise`: po usunięciu usuwa z tej samej puli `lesson_keywords`, których rodzina (`familyId`) nie ma już `lesson_open_answer` w lekcji — `withoutOrphanKeywords` (dziś czysta funkcja w `lesson-drafts.ts:660`) przenieś bez zmian do `domain/lessons/keyword-families.ts`; `lesson-drafts.ts` ją importuje i reeksportuje (istniejące importy działają).
- `submitExamples`: linie `string`, przycięte, niepuste, ≤ `MAX_TEXT_LENGTH`, najwyżej 3; linia ujawniająca (`findExposureLeaks` z linią jako przykładem) rozwiązanie dowolnego ćwiczenia lekcji odpada z błędem; zastępuje `examples` zagadnienia; gdy żadna nie przeszła — `examples` bez zmian.

- [ ] **Step 1: Testy przykładowe** `admission.test.ts` — przedmiot testowy z `domain/lessons/testing/history-like-subject.ts` rozszerzony o `agentPolicy` (wszystkie typy w `blindSolveTypes`) oraz fixture'y rozdziału dla reguł słuchowych:
  - `limit_full` przy pełnej puli; `limit_listen` przy `listenAllowance` 0;
  - duplikat w tej samej paczce → drugi `lesson_pool`; identyczne ćwiczenie wysłane ponownie → `lesson_pool`;
  - duplikat i konflikt słuchowy między zagadnieniami (`lesson_listen_choice` w A, ćwiczenie tekstowe z tym samym zdaniem w B) → `lesson_pool`;
  - wadliwe ćwiczenie `fixed` nie blokuje poprawnego kandydata;
  - błąd `validatePoolExtra` na innym indeksie → kandydat `lesson_extra`;
  - kandydat ujawniony przykładem → `leak_victim`; kandydat niesamodzielny ujawniający przyjęte samodzielne → `leak_source`; ujawniający samodzielne `fixed` → `leak_source`; samodzielny z tą samą odpowiedzią co inny samodzielny (miękkie) → `leak_victim`;
  - `CheckResult` `na` i `unavailable` → przyjęte, `unchecked` tylko dla `unavailable`; `solve` `done` z rozjazdem → `blind_mismatch`; `variants` z `false` → `variant_rejected`;
  - `sanitize` polityki: pole w `sanitized`, szkic po sanityzacji w puli; `refineGeneratedPool` usuwa wariant → `precheckBatch` zwraca oczyszczony szkic;
  - słowa kluczowe przed swoją rodziną w paczce → przyjęte;
  - `removeExercise`: własne → usunięte z sierotami; nieznane, cudze, `fixed` → `removed: []`;
  - `submitExamples`: limit 3, linia ujawniająca odpada, zastąpienie, brak przyjętych → stare zostają;
  - stan wejściowy niezmieniony po każdej operacji;
  - wydajność: stan z 90 ćwiczeniami w 6 zagadnieniach, `precheckBatch` + `admitBatch` paczki 12 → `< 2000 ms`.
- [ ] **Step 2: Test własności** `admission.property.test.ts`: generator deterministyczny (ziarno w teście, bez `Math.random` w kodzie produkcyjnym) — 50 sekwencji po 20 operacji `admitBatch`/`removeExercise` na losowanych z fixture'ów ćwiczeniach; po każdej operacji: brak nowych indeksów w `findExposureLeaks` (coverage) i brak nowych odrzuceń `validatePool` całej lekcji względem stanu przed.
- [ ] **Step 3: FAIL → Step 4: implementacja → Step 5: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/agent/admission`).
- [ ] **Step 6:** `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/modules/materials/lessons` — PASS (przeniesione `withoutOrphanKeywords`).
- [ ] **Step 7: Commit** — „Lekcje: przyjmowanie paczki agenta z kontrolą całej lekcji (#237)”.

### Task 5: Status, limity, kontrola końcowa i plan

**Files:**
- Create: `packages/server/src/domain/lessons/agent/status.ts`, `packages/server/src/domain/lessons/agent/plan.ts`
- Test: `packages/server/src/domain/lessons/agent/status.test.ts`, `packages/server/src/domain/lessons/agent/plan.test.ts`

**Interfaces:**
- Consumes: Task 1–4; `stageDeficits`, `lessonPoolMinimums` (`lesson-coverage.ts`).
- Produces:
  - `objectiveAgentLimits(counts: { targetCount: number; listenAllowance: number }, policy: Pick<SubjectAgentPolicy, "slack">): ObjectiveAgentLimits`.
  - `ObjectiveStatus = { counts: { guided; productive; independent; outsideStages; total }; missing: string[]; complete: boolean }`; `objectiveStatus(state, objectiveId, ctx): ObjectiveStatus` — pokrycie przez `stageDeficits` z przedmiotem, którego `poolMinimums.independent` podniesiono o `independentReserve`, na `orderedLesson` i `allExamples`; reszta §3.5. Teksty `missing` po angielsku, np. `"guided: 2 of 3"`, `"needs at least one lesson_cloze or lesson_group"`, `"card examples: 0 of 1-3"`, `"exercises: 6 of 8"`.
  - `lessonInvariantCheck(state, ctx): { objectiveId: string; id: string }[]`.
  - `validateAgentPlan(raw: unknown, subject: AgentCapableSubject, material: string): { ok: true; objectives: RawPlanObjective[] } | { ok: false; errors: string[] }`; stałe `AGENT_PLAN_MIN_OBJECTIVES = 3`, `AGENT_PLAN_MAX_OBJECTIVES = 6`.

- [ ] **Step 1: Testy `status.test.ts`**: minima + rezerwa (np. szkoła 3/2/2 → samodzielne 3); ćwiczenie ujawnione się nie liczy; szkoła — dwa pytania otwarte z tą samą odpowiedzią liczą się jak jedno; `total ≥ targetCount`; `outsideStages` (`lesson_listen_choice`, `lesson_keywords`) poza etapami; grupa `requiredTypes` z typem spoza `objective.exerciseTypes` pominięta; brak przykładów → brak; `objectiveGaps` dołączone; `fixed` liczone; `objectiveAgentLimits({ targetCount: 8, listenAllowance: 2 }, { slack: 2 })` → `maxExercises: 12`; `lessonInvariantCheck` pusty dla stanu z `admitBatch`, a dla ręcznie zepsutego stanu (ujawnione samodzielne w puli; ofiara `fixed` ze źródłem w puli) zwraca odpowiednio ofiarę i źródło.
- [ ] **Step 2: Testy `plan.test.ts`**: 3 i 6 zagadnień → `ok`; 2 i 7 → błędy z liczbą; slug nie-ASCII i duplikat → błędy; karty 1 i 5 → błędy; > 3 przykładów → błąd; `planGate` przedmiotu dołączony; brak `kind` → błąd.
- [ ] **Step 3: FAIL → Step 4: implementacja → Step 5: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/agent/status.test.ts packages/server/src/domain/lessons/agent/plan.test.ts`).
- [ ] **Step 6: Commit** — „Lekcje: status zagadnienia, limity i plan agenta (#237)”.

### Task 6: Polityka rozdziału

**Files:**
- Create: `packages/server/src/domain/lessons/subjects/english-chapter/material-lexicon.ts`, `packages/server/src/domain/lessons/subjects/english-chapter/agent-policy.ts`
- Modify: `packages/server/src/domain/lessons/subjects/english-chapter/module.ts`
- Test: `.../english-chapter/material-lexicon.test.ts`, `.../english-chapter/agent-policy.test.ts`

**Interfaces:**
- Produces: `parseMaterialLexicon(material: string): { words: string[]; frames: string[] }`, `frameKey(frame: string): string`, `plainText(text: string): string`, `mentions(haystack: string, word: string): boolean` (reguły PoC: `parseMaterial`, `frameKey`, `plainText`, `mentions`); `chapterAgentPolicy: SubjectAgentPolicy` (§4.2).

- [ ] **Step 1: Testy `material-lexicon.test.ts`**: słowa z linii „en — pl” (bez pytań i zdań, ≤ 3 słowa), ramy z sekcji „Zwroty:”/„Ramy:”; `frameKey("There's a … in the …")` → `"there's a"`; `mentions` z liczbą mnogą `-s/-es` i bez dopasowań częściowych („bed” nie w „bedroom”); materiał bez list i sekcji → `{ words: [], frames: [] }`.
- [ ] **Step 2: Testy `agent-policy.test.ts`**: `requiredTypes` dla `words` i `frame` (§4.2); bramka słów kart (luka, wybór, tłumaczenie, para z dwoma słowami vs jednym, grupa); bramka ramy — `lesson_order` i luka po wstawieniu odpowiedzi zawierają `frameKey` ramy z kart zagadnienia, ćwiczenie z ramą innego zagadnienia odpada, `lesson_listen_choice`/pary/grupy wyłączone; `objectiveGaps` — niepokryte słowa kart; `planCoverage` = `parseMaterialLexicon`; `planGate` — słowo lub rama na żadnej karcie → błąd z listą; materiał bez list → `planGate` `[]`; `rejectionTexts.leakVictim` zawiera „change the room, object or place”; `englishChapterSubject.agentPolicy === chapterAgentPolicy`.
- [ ] **Step 3: FAIL → Step 4: implementacja** (`blindSolveTypes`/`variantCheckTypes` z PoC `BLIND_TYPES`/`VARIANT_CHECK_TYPES` gałęzi nie-szkolnej przecięte z `CHAPTER_EXERCISE_TYPES`; `checkerNeedsMaterial: false`; `independentReserve: 1`; `slack: 2`) **→ Step 5: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/subjects/english-chapter`).
- [ ] **Step 6: Commit** — „Lekcje: polityka agenta rozdziału (#237)”.

### Task 7: Polityki gramatyki i szkoły (bramka podpowiedzi)

**Files:**
- Create: `packages/server/src/domain/lessons/subjects/english-grammar/agent-policy.ts`, `packages/server/src/domain/lessons/subjects/school/agent-policy.ts`, `packages/server/src/domain/lessons/subjects/school/hint-gate.ts`
- Modify: `.../english-grammar/module.ts`, `.../school/module.ts`
- Test: `.../english-grammar/agent-policy.test.ts`, `.../school/hint-gate.test.ts`, `.../school/agent-policy.test.ts`

**Interfaces:**
- Produces: `grammarAgentPolicy`, `schoolAgentPolicy` (§4.3, §4.4); `hintRevealsAnswer(hint: string, draft: LessonExerciseDraft, normalizer: AnswerNormalizer): boolean`; `stemMatches(a: string, b: string): boolean`; kod bramki `hint_reveals_answer` (tekst dla modelu po angielsku: „the hint gives away the answer or a required element; hint at the reasoning, not the content”).

- [ ] **Step 1: Testy `hint-gate.test.ts`** (wartości z §4.4):

```ts
expect(stemMatches("Odra", "Odrze")).toBe(true);
expect(stemMatches("Polska", "Polski")).toBe(true);
expect(stemMatches("zmniejszony", "zmniejszenie")).toBe(true);
expect(stemMatches("mapa", "mama")).toBe(false);
expect(stemMatches("kot", "koń")).toBe(false);
// odpowiedź „Mierzeja Wiślana” → podpowiedź „Przykładem jest Mierzeja Wiślana” ujawnia
// requiredElements [„obraz zmniejszony”, „uproszczony”] → „Użyj słów: zmniejszony, uproszczony” ujawnia
// fraza bez słów ≥ 4 liter („w 1410 r.”) → porównanie wszystkich tokenów, liczba 1410 jest tokenem
// podpowiedź „Pomyśl o rzekach w Polsce” przy odpowiedzi „Wisła i Odra” → nie ujawnia
```

- [ ] **Step 2: Testy polityk**: szkoła — `sanitize` usuwa `hint` przy `lesson_gap`/`lesson_choice`, zostawia przy `lesson_open_answer`; `exerciseGate` zwraca kod bramki dla ujawniającej podpowiedzi otwartej odpowiedzi; `blindSolveTypes` zawiera `lesson_gap`, nie zawiera `lesson_open_answer`, `lesson_order`, `lesson_calculation`, `lesson_keywords`; `variantCheckTypes` = [`lesson_gap`]; `checkerNeedsMaterial: true`; `leakVictim` szkoły nie zawiera „room”. Gramatyka — brak `sanitize`/`exerciseGate`; typy przecięte z typami przedmiotu (brak `lesson_match`); `leakVictim` „use a different subject, verb or object”.
- [ ] **Step 3: FAIL → Step 4: implementacja → Step 5: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/subjects`).
- [ ] **Step 6: Commit** — „Lekcje: polityki agenta gramatyki i szkoły, bramka podpowiedzi (#237)”.

### Task 8: Wspólna sanityzacja, porty i fake'i

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-acceptance.ts`
- Modify: `packages/server/src/ports/ai.ts`
- Create: `packages/server/src/providers/fake-lesson-agent.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-pool-acceptance.test.ts`, `packages/server/src/providers/fake-lesson-agent.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeFreshLessonDraft(draft: LessonExerciseDraft, subject: SubjectModule, familyScope: string | null): { draft: LessonExerciseDraft; droppedExplanation: boolean; droppedVariants: number }` — kroki §7.2 poza `stripParentAddedFlags`, w kolejności z `acceptFreshLessonPool`; `stripParentAddedFlags` kierownik woła osobno na pojedynczym szkicu (`stripParentAddedFlags([draft])[0]`). `acceptFreshLessonPool` używa nowej funkcji, zachowanie bez zmian.
  - W `ports/ai.ts` dokładnie typy §6.1: `RunCostSink`, `LessonObjectiveAgentInput`, `LessonAgentToolOutcome`, `LessonObjectiveAgentTools`, `LessonAgentPlanInput`, `LessonPoolAgentProvider`, `LessonExerciseCheckerProvider`.
  - `FakeLessonPoolAgent implements LessonPoolAgentProvider`: konstruktor `{ objectives?: Record<string, FakeAgentStep[]>; plans?: unknown[]; stepCostUsd?: number | null }`, gdzie klucz to slug (`objective.id.split(".").at(-1)`); `FakeAgentStep = { submit: { exercises: unknown[]; examples?: unknown[] } } | { remove: string } | { parallel: FakeAgentStep[] } | { throw: Error } | { hang: true }`; pola `calls: { objectiveId: string; input: LessonObjectiveAgentInput; outcomes: unknown[] }[]`.
  - `FakeExerciseChecker implements LessonExerciseCheckerProvider`: `{ solve?: (view: string) => string[] | null | "throw" | "hang"; judge?: (variant: string) => boolean | null; costUsd?: number | null }`; `solveCalls`, `judgeCalls` (wejścia), `maxConcurrent`.

- [ ] **Step 1: Testy sanityzacji**: istniejące testy `acceptFreshLessonPool` bez zmian + test każdego kroku `sanitizeFreshLessonDraft` (puste tablice, dodatki słuchowe, rodzina z sufiksem, redundantny wariant, ton, wyjaśnienie).
- [ ] **Step 2: Testy fake'ów**: agent wykonuje kroki do `shouldStop()`; `parallel` wywołuje narzędzia bez czekania na poprzednie (obserwacja przez narzędzie z opóźnieniem); `hang` kończy się dopiero przerwaniem sygnału (odrzucenie z `signal.reason`); `RunCostSink.record` raz na krok z `stepCostUsd`; checker zwraca `null` dla `solve` → `null`, mierzy `maxConcurrent`.
- [ ] **Step 3: FAIL → Step 4: implementacja → Step 5: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/modules/materials/lessons/lesson-pool-acceptance.test.ts packages/server/src/providers/fake-lesson-agent.test.ts packages/server/src/domain/lessons/architecture.test.ts`).
- [ ] **Step 6: Commit** — „Lekcje: porty agenta i checkera, fake'i, wspólna sanityzacja (#237)”.

### Task 9: Kierownik — przebieg i narzędzia

**Files:**
- Create: `packages/server/src/modules/materials/lessons/lesson-pool-agent.ts` (`runLessonPoolAgent`), `packages/server/src/modules/materials/lessons/lesson-pool-agent-tools.ts` (narzędzia podagenta: mutex, parsowanie, checker, przyjęcie, zamknięcie), `packages/server/src/modules/materials/lessons/lesson-pool-agent-policy.ts` (`LessonAgentPolicy`, `DEFAULT_LESSON_AGENT_POLICY`)
- Test: `packages/server/src/modules/materials/lessons/lesson-pool-agent.test.ts`

**Interfaces:**
- Consumes: Task 1–8; `objectiveBatchCounts`, `listenChoiceAllowance`, `buildPoolInput`, `isWellShapedRawExercise`, `toExerciseDraft`, `stripParentAddedFlags`, `buildDynamicTopicData`, `withSubjectObjectiveKinds` (`lesson-drafts.ts`); `validateDynamicTopicData`; `classifyLessonGenerationFailure`; `generationExposureSources` (PR wstępny); `avoidSentencesFor`.
- Produces: `LessonAgentPolicy` (wartości z Global Constraints); `LessonPoolAgentRunInput` i `LessonPoolAgentResult` (§7, §7.1 pkt 7); `runLessonPoolAgent(deps: { agent: LessonPoolAgentProvider; checker: LessonExerciseCheckerProvider; policy?: Partial<LessonAgentPolicy> }, input: LessonPoolAgentRunInput, signal: AbortSignal): Promise<LessonPoolAgentResult>`; `ObjectiveRunStatus = "complete" | "incomplete" | "failed"`; wynik planu `planStatus: "accepted" | "plan_failed" | "not_needed"`.

Szczegóły, których sygnatury nie rozstrzygają:
- `LessonObjectiveAgentInput.pool` = `buildPoolInput(...)` dla zagadnienia z `countPerObjective`/`stageCounts`/`listenChoicePerObjective` nadpisanymi z `targets`; `avoidSentences` = `avoidSentencesFor({ examples: allExamples(state), exercises: orderedLesson(state), subject })` w chwili startu podagenta; `cardSentences` = `allExamples(state)[objectiveId]`.
- Mutex: prosta kolejka obietnic per zagadnienie (bez biblioteki); semafor checkera — licznik + kolejka.
- Zamknięcie narzędzi: każde wywołanie rejestruje obietnicę w zbiorze zagadnienia; po `runObjective` kierownik czeka `Promise.allSettled` na zbiór, ustawia `closed = true`.
- Checker: z paczki `pass` buduje `solve.items` (typy z `blindSolveTypes`, `solverView(draft, state.topic)`, `expectedAnswerCount`) i `judgeVariants.items` (typy z `variantCheckTypes` z wariantami); `material` tylko przy `checkerNeedsMaterial`; odpowiedź dłuższa lub krótsza niż `items` — brakujące pozycje `unavailable`, nadmiar ignorowany; wyjątek, timeout (`AbortSignal.any([run, AbortSignal.timeout(checkerTimeoutMs)])`) lub budżet → całość `unavailable`.
- Wynik dla modelu (`LessonAgentToolOutcome`): błędy = `Rejection.reasons`; `note` = lista `sanitized` i „unchecked” przy `unchecked`.

- [ ] **Step 1: Testy** `lesson-pool-agent.test.ts` (fake'i z Task 8, przedmiot testowy z polityką; scenariusze z §9.2 w części przebiegu):
  - `complete` po scenariuszu: paczka z błędem → poprawka → przyjęcie; model dostaje `errors` z powodem;
  - rekord z obcym `objectiveId`, `exercises: "x"`, `null` w polach → `shape`, bez wyjątku;
  - checker wołany tylko dla `pass` i typów polityki, z oczyszczonym szkicem (bez `hint` w szkole), jedno `solve` na `submit`; materiał tylko przy `checkerNeedsMaterial`; wejście checkera nie zawiera polecenia rodzica, tematów zdań, kart ani przykładów (asercja na serializacji `solveCalls`/`judgeCalls` wobec unikalnych znaczników w tych polach wejścia);
  - checker zwraca o jedną pozycję mniej → ostatnie ćwiczenie `unchecked`, przyjęte;
  - `{ parallel: [submit, submit] }` i `{ parallel: [submit, remove] }` → wynik równy wykonaniu sekwencyjnemu (porównanie końcowych pul);
  - dwa zagadnienia równolegle z tym samym ujawnieniem → drugie odrzucone, `lessonInvariantCheck` pusty;
  - plan rozdziału: pierwsza propozycja z niepokrytym słowem → `errors`; druga przyjęta; identyfikatory `^…\.d<deckId>\.<slug>$`; przykłady z planu w wyniku; brak planu po `planMaxSteps` → `planStatus: "plan_failed"` bez podagentów;
  - gramatyka/szkoła: przykłady przez `submit.examples` → w wyniku;
  - `skipObjectives` + `fixed`: zagadnienie bez wywołania agenta, jego ćwiczenia blokują duplikat w innym;
  - `onObjectiveSettled` wołany po każdym zagadnieniu szeregowo; rzucony błąd przerywa run;
  - przedmiot bez polityki → `AppError("validation")`, zero wywołań fake'ów;
  - model dostaje `LessonAgentToolOutcome` bez pól szkicu (`answer`, `acceptedAnswers`).
- [ ] **Step 2: FAIL → Step 3: implementacja → Step 4: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/modules/materials/lessons/lesson-pool-agent.test.ts`).
- [ ] **Step 5: Commit** — „Lekcje: kierownik agenta puli — przebieg i narzędzia (#237)”.

### Task 10: Kierownik — budżet, terminy, błędy i logi

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-agent.ts`, `.../lesson-pool-agent-tools.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-pool-agent.limits.test.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: `LessonPoolAgentResult.spentUsd`, `unknownCostCalls`, `stats.checkUnavailable`, `objectives[i].failure?: { errorCode: string }`; log `[lesson-agent] run=<runId> obj=<slug> status=<…> steps=<n> accepted=<n> rejected=<kod:liczba,…> costUsd=<x>`.

- [ ] **Step 1: Testy** (`vi.useFakeTimers()` tam, gdzie terminy):
  - budżet 0,05 przy `stepCostUsd` 0,02 → po trzecim kroku `shouldStop()` = `true`, kolejne `submit` → błąd „budget exhausted”, checker po przekroczeniu nie jest wołany; `spentUsd` ≤ budżet + koszt żądań w locie (`concurrency` × koszt kroku + `checkerConcurrency` × koszt checkera);
  - `stepCostUsd: null` → liczone po 0,02, `unknownCostCalls` rośnie;
  - `initialSpentUsd` 0,99 przy budżecie 1,00 → pierwszy krok i stop;
  - `hang` agenta + termin zagadnienia → `incomplete` (nie `failed`); spóźniony `submit` po zamknięciu → odmowa, pula bez zmian;
  - `throw` agenta → `failed` z kodem `classifyLessonGenerationFailure`, pozostałe `complete`;
  - termin runu → trwające `incomplete`, wynik zwrócony;
  - przerwanie sygnału runu z `reason` → `runLessonPoolAgent` odrzuca tym samym `reason`;
  - nigdy ponad `concurrency` jednoczesnych `runObjective` i `checkerConcurrency` wywołań checkera (`maxConcurrent`);
  - logi (`vi.spyOn(console, "log")`): żaden wpis nie zawiera tekstu ćwiczenia, materiału, karty ani `detail` z fixture (unikalne znaczniki).
- [ ] **Step 2: FAIL → Step 3: implementacja → Step 4: PASS** (`pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/modules/materials/lessons/lesson-pool-agent`).
- [ ] **Step 5: Commit** — „Lekcje: kierownik agenta — budżet, terminy i przerwanie (#237)”.

### Task 11: Testy architektury

**Files:**
- Modify: `packages/server/src/domain/lessons/architecture.test.ts`
- Create: `tests/ai-sdk-scope.test.ts`; Modify: `vitest.unit.config.ts` (dopisz plik)

- [ ] **Step 1: Testy**: `domain/lessons/agent/**` bez importów z listy Global Constraints i bez `Date.now`/`Math.random`/`process.env`; `tests/ai-sdk-scope.test.ts` — w `packages/**/src/**` i `apps/**/src/**` brak importów `"ai"`, `"ai/…"`, `"@openrouter/…"`, a w `packages/*/package.json` i `apps/*/package.json` brak tych zależności.
- [ ] **Step 2: Uruchom — PASS** (kod z Task 1–10 już spełnia): `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/architecture.test.ts tests/ai-sdk-scope.test.ts packages/server/src/modules/module-boundaries.architecture.test.ts`. Sprawdź, że test łapie naruszenie: tymczasowo dodaj `import "ai"` w pliku domeny → FAIL → cofnij.
- [ ] **Step 3: Commit** — „Testy: granice agenta i zakres AI SDK (#237)”.

### Task 12: Narzędzia próby, rejestr kosztów i zależności

**Files:**
- Create (z `git show origin/probe/lesson-pool-agent:<ścieżka>`): `tests/probes/blind/gen-blind-sheet.cjs`, `tests/probes/blind/score.cjs`, `tests/probes/blind/rubric-generation.md`, `tests/probes/blind/rubric-criteria.md` — bez zmian.
- Create: `tests/probes/probe-costs.ts`, `tests/probes/probe-costs.test.ts` (z `git show feat/lesson-review-probe:tests/probes/probe-results.ts` i `…probe-results.test.ts` — tylko eksporty z §8)
- Modify: `tests/probes/probe-helpers.ts` (+ `runDirsOf`), Create: `tests/probes/probe-helpers.test.ts` (z `feat/lesson-review-probe`, część dotycząca przeniesionych funkcji)
- Modify: `vitest.probe.config.ts` (wg `git diff main feat/lesson-review-probe -- vitest.probe.config.ts`), `vitest.unit.config.ts` (dopisz `tests/probes/probe-costs.test.ts`, `tests/probes/probe-helpers.test.ts`)
- Modify: `package.json`, `pnpm-lock.yaml`; `packages/server/src/providers/openai/llm.ts` (eksport `lessonSystemPrompt`, `lessonUserMaterial`)

- [ ] **Step 1:** `pnpm add -D -w --save-exact ai@7.0.162 @openrouter/ai-sdk-provider@3.1.0` (oraz `zod`, jeśli `package.json` roota go nie ma — wersja jak w `packages/server/package.json`); skrypt `"probe:agent": "vitest run --config vitest.probe.config.ts tests/probes/agent-generation.probe.test.ts"`.
- [ ] **Step 2:** Przenieś pliki; przegląd higieny: `rg -n -i "<imiona z historii gałęzi>|C:\\\\Users|/home/|deckId|childId|[0-9a-f]{8}-[0-9a-f]{4}" tests/probes` — brak trafień w przeniesionych plikach (wzorce imion uzupełnij z `git log feat/lesson-review-probe -p -- tests/probes | rg` przed przeglądem; nie wpisuj ich do repo).
- [ ] **Step 3:** `pnpm exec vitest run --config vitest.unit.config.ts tests/probes/probe-costs.test.ts tests/probes/probe-helpers.test.ts tests/ai-sdk-scope.test.ts` — PASS; `pnpm typecheck` — PASS.
- [ ] **Step 4: Commit** — „Próby: narzędzia ślepej oceny, rejestr kosztów i zależności AI SDK (#237)”.

### Task 13: Próba agenta i punkt odniesienia

**Files:**
- Create: `tests/probes/agent-generation.probe.test.ts`
- Modify: `tests/probes/chapter-generation.probe.test.ts`

**Interfaces:**
- Consumes: `runLessonPoolAgent` (Task 9–10), porty (Task 8), `probe-costs` i `probe-helpers` (Task 12).
- Produces: tymczasowe klasy w pliku próby `AiSdkLessonPoolAgent implements LessonPoolAgentProvider` (`ToolLoopAgent`, `tool()` z `jsonSchema` gałęzi `exercises`/`examples` z `lessonPoolJsonSchema`, `stopWhen: [isStepCount(maxSteps), () => tools.shouldStop()]`, `providerOptions.openrouter.reasoning.effort`, `RunCostSink.record` z `providerMetadata.openrouter.usage.cost` w `onStepEnd`, materializacja jak `generateLessonPool`) i `AiSdkExerciseChecker implements LessonExerciseCheckerProvider` (`generateText` + `Output.object` z tablicą odpowiedzi per pozycja). Format zrzutu: jak PoC (`UMIEM_PROBE_AGENT_DUMP`) + `objectives[].status`, `rejections[].detail`.

- [ ] **Step 1:** Napisz próbę wg §8 (zmienne, `describe.skipIf` bez kluczy i wejść, nagłówek z opisem uruchomienia i kosztów, dopisek przepływu narzędzi z PoC `objectiveInstructions` + „hint only for lesson_open_answer” + „up to 6 objectives” dla planera). Bez własnych reguł — tylko adaptery, wejście i zrzut.
- [ ] **Step 2:** Rozszerz `chapter-generation.probe.test.ts`: `UMIEM_PROBE_POOL_DUMP_OUT` — zrzut końcowego szkicu po `executeLessonGeneration` w formacie arkusza i zrzut zagadnień z kartami jako `{ title, body }[]`; `UMIEM_PROBE_COSTS`, `_COSTS_INIT`, `_OUT_DIR`, `_ALLOW_HOST`, `_SUBJECT` wg `feat/lesson-review-probe`, bez importów z `lesson-review`.
- [ ] **Step 3:** `pnpm typecheck` — PASS; `pnpm exec vitest run --config vitest.probe.config.ts tests/probes/agent-generation.probe.test.ts` bez zmiennych → testy pominięte, exit 0.
- [ ] **Step 4: Commit** — „Próby: agent puli na kodzie domenowym i zrzut potoku (#237)”.

### Task 14: Dokumentacja

**Files:**
- Modify: `docs/architecture.md` (nowe §19.17 „Agent generujący pulę (etap 1)”), `AGENTS.md`

- [ ] **Step 1:** §19.17 wg §10 specu: rdzeń i niezmiennik przyjęcia, `agentPolicy`, porty, kierownik, budżet i terminy, status „za flagą od etapu 2”, opis `pnpm probe:agent` (zmienne, format zrzutu, ślepa ocena krok po kroku z issue).
- [ ] **Step 2:** `AGENTS.md`, sekcja „Reguły biznesowe i adaptery”: zdanie o `SubjectModule.agentPolicy` (agent puli lekcji, `docs/architecture.md` §19.17) i o tym, że `ai`/`@openrouter/*` są dozwolone tylko w `tests/probes` (od etapu 2 także w jednym adapterze), pilnuje `tests/ai-sdk-scope.test.ts`.
- [ ] **Step 3: Commit** — „Dokumentacja: agent generujący pulę — etap 1 (#237)”.

### Task 15: Weryfikacja, przebiegi kontrolne i PR

- [ ] **Step 1:** `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build` — PASS.
- [ ] **Step 2:** `pnpm test:e2e:shards` — PASS (raportuj liczby).
- [ ] **Step 3:** Przebiegi kontrolne (płatne, łącznie ok. 0,45 USD, zatwierdzone w specu §9.5): szkoła i rozdział, `UMIEM_PROBE_COSTS` poza repo, każdy przebieg do osobnego pliku wyniku. Kryteria: brak wyjątku; w zrzucie 0 twardych ujawnień i 0 błędów `validatePool` całej lekcji (sprawdź skryptem w scratchpadzie na zrzucie); każde zagadnienie ma status; `node tests/probes/blind/gen-blind-sheet.cjs <katalog> <seed>` czyta zrzut; wpis w rejestrze rozliczony. Niezaliczony przebieg = błąd do poprawy przed PR, nie strojenie progów.
- [ ] **Step 4:** Trzech niezależnych krytyków na diffie gałęzi (zgodność ze specem; architektura, prywatność, koszty; testy i zakres), poprawki.
- [ ] **Step 5:** Push gałęzi, PR do `main` (nie scalać). Opis po polsku: gdzie są reguły (domena, polityki przedmiotów), jakie zależności dodano (dev, root), jakie gwarancje zweryfikowano (testy, niezmiennik, przebiegi kontrolne z kosztem), co etap 2 dokłada; wpływ API → MCP → `SKILL.md`: brak, z uzasadnieniem.
