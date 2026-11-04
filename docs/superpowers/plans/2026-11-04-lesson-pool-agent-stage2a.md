# Agent puli lekcji — etap 2a: adapter AI SDK i integracja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pełna generacja i „Dogeneruj” lekcji przedmiotów z listy `UMIEM_LESSON_AGENT_SUBJECTS` idą przez kierownika agenta z produkcyjnym adapterem AI SDK, punktem kontrolnym w runie, wznawianiem i informacją dla rodzica; pozostałe przedmioty — dzisiejszym potokiem bez zmian.

**Architecture:** Wspólny zapis do szkicu wydzielony z potoku; nowa ścieżka `executeLessonAgentGeneration` wołana z `executeLessonGeneration` po wyborze `lessonGeneratorFor`; kierownik z etapu 1 dostaje hak planu, przykłady początkowe, start pod budżetem i tryb „dodaj N”; postęp w `generation_runs.agent_checkpoint` (zapis ze strażą tożsamości, podsumowanie bez treści po zapisie); adapter AI SDK w jednym pliku `providers/openai/lesson-pool-agent.ts`, składany wyłącznie przez eksport `@learning/server/lesson-agent` (worker).

**Tech Stack:** TypeScript strict, Drizzle/PostgreSQL, Vitest (unit, integration na Postgresie), Playwright, AI SDK `ai@7.0.162` + `@openrouter/ai-sdk-provider@3.1.0`, Zod 4, Next.js (panel rodzica, Mantine).

**Spec:** `docs/superpowers/specs/2026-11-04-lesson-pool-agent-stage2a-design.md` (wersja 2, zaakceptowana 2026-11-04). Spec etapu 1: `docs/superpowers/specs/2026-11-04-lesson-pool-agent-stage1-design.md`.

## Global Constraints

- Nie wypychaj do `main`, nie scalaj PR; nie uruchamiaj płatnych wywołań modeli (żadnych `pnpm probe:*` z kluczem).
- Instalacja wyłącznie `pnpm install --prefer-offline --frozen-lockfile`; dodanie zależności: `pnpm --filter @learning/server add --save-exact ai@7.0.162 @openrouter/ai-sdk-provider@3.1.0`. Nigdy `npm install`.
- `ai` i `@openrouter/*` importują wyłącznie: `tests/probes/**`, `packages/server/src/providers/openai/lesson-pool-agent.ts` i `packages/server/src/providers/openai/lesson-pool-agent.test.ts`.
- Adapter osiągalny tylko z `packages/server/src/providers/lesson-agent-env.ts` (eksport `@learning/server/lesson-agent`); `config.ts`, `generation-env.ts`, `src/index.ts` nie importują go nawet pośrednio.
- Domena (`src/domain/**`) bez I/O, SDK, env; kierownik bez identyfikatorów przedmiotów; lista przedmiotów tylko z konfiguracji.
- Do modeli nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka; logi `[lesson-agent]`/`[lesson]` bez treści ćwiczeń, materiału, kart, tematów zdań i `detail`.
- Koszty: `UsageRecorder` raz na żądanie HTTP przez helpery `recordResponse`/`recordHttpError`/`recordTransportFailure` (`providers/usage/record-http.ts`), `feature: "lesson_generation"`, `provider: "openrouter"`, operacje `agent_plan`, `agent_objective`, `check_solve`, `check_variants`.
- Wartości domyślne env: `UMIEM_LESSON_AGENT_SUBJECTS=""`, `UMIEM_LESSON_AGENT_MODEL=google/gemini-3.8-flash`, `UMIEM_LESSON_AGENT_REASONING=low`, `UMIEM_LESSON_AGENT_CHECKER_MODEL=deepseek/deepseek-v4.1-flash-1017`, `UMIEM_LESSON_AGENT_CHECKER_REASONING=low`, `UMIEM_LESSON_AGENT_MAX_STEPS=8`, `UMIEM_LESSON_AGENT_CONCURRENCY=4`, `UMIEM_LESSON_AGENT_CHECKER_CONCURRENCY=4`, `UMIEM_LESSON_AGENT_OBJECTIVE_TIMEOUT_MS=300000`, `UMIEM_LESSON_AGENT_CHECKER_TIMEOUT_MS=90000`, `UMIEM_LESSON_AGENT_RUN_BUDGET_USD=1.00`.
- `AGENT_FINALIZATION_RESERVE_MS = 30_000`.
- Teksty UI po polsku, w `packages/contracts/src/messages.ts`; kod, nazwy i klucze po angielsku; komentarze w stylu otoczenia (po polsku).
- Potok (przedmioty spoza listy) zachowuje się bitowo jak dziś: istniejące testy jednostkowe, integracyjne i E2E przechodzą bez zmian asercji.
- Komunikaty commitów po polsku w stylu repo („Lekcje: …”, „Lekcje i próby: …”) z sufiksem `(#237)` i stopką `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Run, któremu kontroler kończy czas w trakcie podagentów, ma zapisać część (`succeeded`), a nie `failed`/`provider_timeout` — Task 9, test integracyjny „termin runu”.
2. „Dogeneruj +2” w zagadnieniu z 12 ćwiczeniami nie może dodać więcej niż `2 + stageGap + listenLeft` — Task 4, test jednostkowy limitu; Task 9, test integracyjny.
3. Rodzic, który zmienia szkic w trakcie runu (także przez nadzór: przyjęcie werdyktu jako wariantu), nie może zostawić runu w `running` ani dostać zapisu na starej wersji — Task 5 (straż), Task 9 (test).
4. Zły klucz OpenRouter (401) nie może ponawiać runu trzy razy ani zgłaszać `validation` — Task 6 (mapowanie), Task 9 (wiersz 6 wyniku).
5. Restart workera w ostatniej próbie z zapisanym postępem kończy się zapisem części, nie `attempts_exhausted` — Task 9.

---

### Task 1: Wspólny zapis do szkicu (czysty refaktor)

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (transakcja końcowa i `failValidation` w `executeLessonGeneration`, ok. l. 1931–2100; `existingDraftsOf` ok. l. 1329)

**Interfaces:**
- Produces:
  ```ts
  export interface LessonPoolWriteContext {
    readonly dynamicTopic?: DynamicTopicData;
    readonly newExamples: Record<string, string[]>;
    readonly rejectedCount: number;            // tej próby; sumowany z poprzednim kontekstem
    readonly rejectedReasons: Record<string, number>;
    readonly droppedObjectiveCount: number;
    readonly generationGaps?: LessonGenerationGap[];   // Task 8 dodaje typ; w Task 1 pole jeszcze nie istnieje
  }
  export async function finalizeLessonPoolWrite(services: Services, args: {
    runId: string; attempts: number; expectedEditNumber: number; deckVersionId: string;
    subject: SubjectModule; topicVersion: number | undefined; regenerate: boolean;
    existingDrafts: readonly LessonExerciseDraft[]; accepted: readonly LessonExerciseDraft[];
    context: LessonPoolWriteContext;
    review?: (tx: Tx, versionId: string, previous: LessonReviewReport | undefined,
              saved: readonly { draft: LessonExerciseDraft; exerciseId: string }[]) => Promise<LessonReviewReport>;
    finalizationDeadlineAtMs: number; signal?: AbortSignal;
    onTransaction?: (tx: Tx) => Promise<void>;   // Task 8: podsumowanie punktu kontrolnego w tej samej transakcji
  }): Promise<"succeeded" | "failed_validation" | "superseded" | "gone">;
  export async function failLessonPoolValidation(services: Services, args: { runId; attempts; expectedEditNumber; deckVersionId; context: LessonPoolWriteContext; review?: … }): Promise<void>;
  export async function orderedDraftExercises(db: Executor, deckVersionId: string): Promise<LessonExerciseDraft[]>;  // kolejność lekcji (pozycja elementu)
  ```
  `markCurrentRun` wyciągnięty do funkcji modułu `markLessonRun(db, { runId, attempts, expectedEditNumber }, state, errorCode, nextAttemptAt?)` (ta sama straż i log co dziś).

- [ ] **Step 1:** Uruchom bazę testów potoku i zanotuj wynik (ma przejść przed i po refaktorze):
  `pnpm vitest run packages/server/src/modules/materials/lessons` oraz `pnpm test:integration -- tests/integration/lesson-generation.test.ts tests/integration/lesson-review.test.ts tests/integration/lesson-story.test.ts tests/integration/lesson-chapter.test.ts` — Expected: PASS.
- [ ] **Step 2:** Przenieś kroki transakcji końcowej (blokady wersja → run, straże, kolizje z historyjką, `withoutOrphanKeywords`, `applyLessonExercises`, `lessonContext` z sumowaniem `rejectedCount`/`rejectedReasons`/`droppedObjectiveCount` z poprzednim kontekstem, `reconcileDraftAssetsTx`, `editNumber + 1`, `supersedeLessonRuns` z `includeStoryRuns: !regenerate`, `queueLessonStoryRunTx`, stan `review`, `succeeded`) do `finalizeLessonPoolWrite`, a `failValidation` do `failLessonPoolValidation`; `executeLessonGeneration` woła je z dzisiejszymi wartościami (`review: mergedReview`). `orderedDraftExercises` zastępuje użycia `existingDraftsOf` tam, gdzie kolejność ma znaczenie (dziś: brak różnicy — eksport dla Task 9).
- [ ] **Step 3:** Uruchom testy ze Step 1 i `pnpm typecheck` — Expected: PASS bez zmian asercji.
- [ ] **Step 4:** Commit: `Lekcje: wspólny zapis puli do szkicu wydzielony z generowania (#237)`.

### Task 2: `control.run` w kontrolerze generowania

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-generation-control.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-generation-control.test.ts`

**Interfaces:**
- Produces: `LessonGenerationControl.run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>` oraz `LessonGenerationControl.deadlineAtMs: number` (= `startedAt + runTimeoutMs`, zegar `now`).

- [ ] **Step 1: Testy** (w istniejącym pliku, `describe("run")`):
  - `"run nie ma limitu pojedynczego żądania"` — `requestTimeoutMs: 25, runTimeoutMs: 500`; `control.run` z pracą 100 ms → zwraca wynik.
  - `"run mapuje przerwanie: superseded, shutdown, timeout"` — trzy przypadki jak istniejące testy `call`: `assertCurrent` → `false` daje `LessonGenerationCancelledError("superseded")`; `signal` wywołującego → `("shutdown")`; `runTimeoutMs: 20` przy pracy 200 ms → `GenerationProviderError` o `kind: "timeout"`; praca, która sama rzuca `signal.reason` (DOMException), też jest mapowana.
  - `"deadlineAtMs = start + runTimeoutMs"` z `now` sterowanym.
- [ ] **Step 2:** Run `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-generation-control.test.ts` — Expected: FAIL (`run` nie istnieje).
- [ ] **Step 3:** Implementuj: `run` = `verifyCurrent()`, wyścig pracy z `root.signal` (ten sam `aborted`-mapping co `invoke`, bez `requestTimer`), `verifyCurrent()` po sukcesie; przerwanie z błędem `AbortError`/DOMException → mapowanie jak w `invoke`.
- [ ] **Step 4:** Run test — Expected: PASS.
- [ ] **Step 5:** Commit: `Lekcje: kontroler generowania uruchamia długą pracę bez limitu żądania (#237)`.

### Task 3: Kierownik — hak planu, przykłady początkowe, budżet, porażka z `retryable`

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-agent.ts`, `lesson-pool-agent-tools.ts` (pole `examplesFromPlan` → `examplesFixed`)
- Test: `packages/server/src/modules/materials/lessons/lesson-pool-agent.test.ts`, `lesson-pool-agent.limits.test.ts`

**Interfaces:**
- Produces (pola `LessonPoolAgentRunInput`, wszystkie opcjonalne):
  ```ts
  readonly initialExamples?: Readonly<Record<string, readonly string[]>>;
  readonly examplesFixed?: boolean;                       // brak = (source === "planner"), jak dziś
  readonly extraExposureSources?: readonly string[];      // stałe źródła ujawnień (zdania historyjki)
  readonly onObjectivesResolved?: (resolved: {
    readonly dynamicTopic?: DynamicTopicData;
    readonly planExamples: Readonly<Record<string, readonly string[]>>;
    readonly spentUsd: number;
  }) => Promise<void>;
  ```
  `SettledObjective` dostaje `spentUsd: number` (= `cost.spentUsd` w chwili rozliczenia) i `failure?: { errorCode: string; retryable: boolean; retryAfterMs?: number }` (z `classifyLessonGenerationFailure`).
  `ObjectiveToolsArgs.examplesFromPlan` → `examplesFixed` (bez zmiany zachowania).

- [ ] **Step 1: Testy** (fake'i etapu 1):
  - `"onObjectivesResolved: planer — temat, przykłady planu i wydatek przed pierwszym podagentem"` — hak zapisuje kolejność zdarzeń; asercja: hak przed pierwszym `runObjective`, `spentUsd` = koszt kroków planera.
  - `"onObjectivesResolved: katalog i wejście — bez dynamicTopic dla katalogu"`.
  - `"błąd onObjectivesResolved przerywa run bez podagentów"` — `runObjective` nie wołane, wyjątek haka propagowany.
  - `"initialExamples liczą się do statusu i są źródłem ujawnień"` — zagadnienie z `initialExamples` i bez przykładów w `submit` może być `complete`; ćwiczenie samodzielne z rozwiązaniem równym przykładowi odrzucone (`leak`).
  - `"examplesFixed: przykłady z submit ignorowane z notą"` przy źródle `input`.
  - `"extraExposureSources odrzucają ćwiczenie samodzielne z tym zdaniem"`.
  - `"wyczerpany budżet: kolejne zagadnienia nie startują"` — `initialSpentUsd = runBudgetUsd`; `runObjective` nie wołane; zagadnienia `incomplete`.
  - `"spentUsd w rozliczeniu nie liczy initialSpentUsd podwójnie"` — `initialSpentUsd: 0.3`, krok 0.1 → `spentUsd` 0.4.
  - `"failure niesie retryable"` — `{ throw: new GenerationProviderError("rate_limit", { retryAfterMs: 5000 }) }` → `failure = { errorCode: "provider_rate_limit", retryable: true, retryAfterMs: 5000 }`; `configuration` → `retryable: false`.
- [ ] **Step 2:** Run `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-pool-agent` — Expected: FAIL.
- [ ] **Step 3:** Implementuj: `initialExamples` scalane do `createLessonAgentState({ examples })` (przykłady planu wygrywają per zagadnienie); `extraExposureSources` dołączane do `fixedSources` pod kluczem technicznym spoza identyfikatorów zagadnień (`"__extra"`); `runOne` sprawdza `cost.exhausted()` przed startem i rozlicza jak termin; hak wołany po rozwiązaniu tematu, przed `superviseObjectives`, błąd = odrzucenie runu.
- [ ] **Step 4:** Run testy kierownika i narzędzi — Expected: PASS (także istniejące).
- [ ] **Step 5:** Commit: `Lekcje: kierownik agenta — hak planu, przykłady początkowe i start pod budżetem (#237)`.

### Task 4: Tryb „dodaj N” w kierowniku

**Files:**
- Modify: `packages/server/src/domain/lessons/agent/status.ts`, `packages/server/src/modules/materials/lessons/lesson-pool-agent.ts`, `lesson-pool-agent-tools.ts`, `lesson-pool-agent-input.ts`
- Test: `packages/server/src/domain/lessons/agent/status.test.ts`, `packages/server/src/modules/materials/lessons/lesson-pool-agent.add.test.ts` (nowy)

**Interfaces:**
- Consumes: Task 3 (`initialExamples`, `examplesFixed`, `extraExposureSources`).
- Produces:
  ```ts
  // domain/lessons/agent/status.ts
  export function stageGapOf(status: ObjectiveStatus): number;   // suma braków guided/productive/independent z `missing`-źródeł (liczba, nie tekst)
  export function addModeStatus(status: ObjectiveStatus, added: number, remaining: number, stageGapNow: number):
    { readonly missing: string[]; readonly complete: boolean };  // complete = added >= remaining && stageGapNow === 0; missing[0] = `new exercises: ${added} of ${remaining}`
  // LessonPoolAgentRunInput
  readonly target?: { readonly mode: "pool" } | { readonly mode: "add"; readonly objectiveId: string; readonly count: number };
  ```
  W trybie `add` kierownik: `remaining = count` (wznowienie podaje już pomniejszony `count`, Task 9); limity zagadnienia `{ targetCount: fixedOnStagePath + remaining, listenAllowance: listenChoiceAllowance(subject, objective, []), maxExercises: remaining + stageGap0 + listenLeft }` przy `slack = 0`, gdzie `listenLeft = max(0, listenAllowance − ćwiczenia słuchowe zagadnienia w fixed)`; `targets` dla promptu z `remaining` i braków etapów (nie z `fixed`); `shouldStop` i `settle()` używają `addModeStatus`.
  `stageGapOf` wymaga liczbowego wyniku braków etapów — dodaj do `ObjectiveStatus` pole `stageGaps: { guided: number; productive: number; independent: number }` (różnica required − actual, ≥ 0) wypełniane tam, gdzie dziś powstaje `missing` etapów.

- [ ] **Step 1: Testy domeny:** `"addModeStatus: komplet tylko przy remaining nowych i bez braków etapów"`, `"addModeStatus: missing zaczyna się od new exercises"`, `"stageGaps liczbowo zgodne z missing"`.
- [ ] **Step 2: Testy kierownika (`lesson-pool-agent.add.test.ts`):**
  - `"uruchamia tylko wybrane zagadnienie"`;
  - `"planner w trybie add → AppError validation bez wywołań"`; `"nieznane zagadnienie → validation"`;
  - `"limit nowych: szkic z 12 ćwiczeniami, +2 przy pełnych etapach → najwyżej 2 + listenLeft nowych"` — scenariusz zgłasza 8 ćwiczeń w jednym kroku; przyjęte ≤ limit, reszta `limit_full`;
  - `"zagadnienie z brakiem etapu: komplet dopiero po remaining i uzupełnieniu etapu"`;
  - `"zagadnienie już pełne: shouldStop dopiero po remaining nowych"` (nie po pierwszym kroku);
  - `"targets promptu z remaining, nie z fixed"` — szkic z 12 ćwiczeniami zagadnienia, `count: 2`, pełne etapy: `LessonObjectiveAgentInput.targets.targetCount === 2` (a status liczy `12 + 2`);
  - `"ćwiczenia szkicu innych zagadnień są źródłem ujawnień"`.
- [ ] **Step 3:** Run `pnpm vitest run packages/server/src/domain/lessons/agent packages/server/src/modules/materials/lessons/lesson-pool-agent` — Expected: FAIL.
- [ ] **Step 4:** Implementuj (bez identyfikatorów przedmiotów).
- [ ] **Step 5:** Run — Expected: PASS; `pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts packages/server/src/domain/lessons` PASS.
- [ ] **Step 6:** Commit: `Lekcje: kierownik agenta — tryb dogenerowania zagadnienia o N ćwiczeń (#237)`.

### Task 5: Punkt kontrolny — kolumna, schemat, zapis ze strażą, czyszczenie, „Ponów”

**Files:**
- Create: `packages/server/drizzle/0037_generation_run_agent_checkpoint.sql` (+ `drizzle/meta/0037_snapshot.json`, wpis w `meta/_journal.json` — wygeneruj `pnpm --filter @learning/server db:generate`, potem przejrzyj SQL), `packages/server/src/modules/materials/lessons/lesson-agent-checkpoint.ts`, `lesson-agent-checkpoint.test.ts`
- Modify: `packages/server/src/db/schema.ts` (`generationRuns.agentCheckpoint: jsonb("agent_checkpoint").$type<Record<string, unknown>>()`), `packages/server/src/modules/materials/generation-runs.ts` (`supersedeLessonRuns` zeruje kolumnę), `packages/server/src/modules/materials/generation.ts` (`retryGeneration`), `docs/schema.sql` (kolumna z komentarzem)
- Test: `tests/integration/lesson-agent-generation.test.ts` (nowy; dopisz do koszyka `INTEGRATION_BUCKETS` o najmniejszej sumie czasów — przy braku pomiaru do koszyka z najmniejszą liczbą plików lekcji)

**Interfaces:**
- Produces:
  ```ts
  export type LessonAgentProgress = { version: 1; kind: "progress"; dynamicTopic?: DynamicTopicData; droppedObjectiveCount?: number;
    planExamples?: Record<string, string[]>;
    objectives: Record<string, { status: "complete" | "incomplete" | "failed"; failureCode?: string; exercises: LessonExerciseDraft[]; examples: string[] }>;
    budgetSpentUsd: number; totalSpentUsd: number; rejectionCodes: Record<string, number> };
  export type LessonAgentSummary = { version: 1; kind: "summary";
    objectives: Record<string, { status: string; accepted: number; failureCode?: string }>;
    totalSpentUsd: number; rejectionCodes: Record<string, number>; attempts: number };
  export function parseLessonAgentProgress(value: unknown): LessonAgentProgress | undefined;   // Zod; summary/uszkodzony → undefined
  export function summarizeLessonAgentProgress(progress: LessonAgentProgress, attempts: number): LessonAgentSummary;
  export function emptyLessonAgentProgress(): LessonAgentProgress;
  export class LessonAgentCheckpointLostError extends Error {}
  export async function saveLessonAgentCheckpoint(db: Executor,
    run: { runId: string; attempts: number; expectedEditNumber: number; deckVersionId: string },
    value: LessonAgentProgress | LessonAgentSummary): Promise<void>;   // 0 wierszy → LessonAgentCheckpointLostError
  export async function resetLessonAgentBudget(tx: Tx, runId: string): Promise<void>;   // progress: budgetSpentUsd = 0
  ```
  Schemat Zod ćwiczeń: `LessonExerciseDraft` waliduj przez istniejący guard kształtu (`isWellShapedRawExercise` + `toExerciseDraft`) zamiast nowego schematu; wpis nieprzechodzący = cały punkt kontrolny `undefined`.

- [ ] **Step 1: Testy jednostkowe** (`lesson-agent-checkpoint.test.ts`): `"parse: poprawny postęp"`, `"parse: podsumowanie → undefined"`, `"parse: uszkodzone ćwiczenie → undefined"`, `"parse: inna wersja → undefined"`, `"summarize: bez treści — tylko statusy, liczby, kody, wydatek"` (asercja: `JSON.stringify(summary)` nie zawiera tekstu ćwiczenia z fixture).
- [ ] **Step 2: Testy integracyjne** (nowy plik, `describe("punkt kontrolny")`):
  - `"zapis przechodzi dla bieżącej próby"`;
  - `"zapis odrzucony po edycji rodzica (run superseded)"`;
  - `"zapis odrzucony po podbiciu editNumber bez anulowania runów"` — `UPDATE deck_versions SET edit_number = edit_number + 1` w teście;
  - `"zapis odrzucony dla starej próby (inne attempts)"`;
  - `"supersedeLessonRuns zeruje punkt kontrolny"`;
  - `"Ponów: porażka, running i odroczone queued — postęp zostaje, budżet 0, totalSpentUsd bez zmian"`.
- [ ] **Step 3:** Run `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-agent-checkpoint.test.ts` i `pnpm test:integration -- tests/integration/lesson-agent-generation.test.ts` — Expected: FAIL.
- [ ] **Step 4:** Implementuj (SQL straży jak w specu §8.2, z `EXISTS` na `deck_versions`; `retryGeneration` — `resetLessonAgentBudget` w każdej gałęzi runu puli lekcji, która ustawia `queued`, pod istniejącym `FOR UPDATE`).
- [ ] **Step 5:** Run — Expected: PASS; `pnpm vitest run tests/integration-buckets.test.ts` PASS.
- [ ] **Step 6:** Commit: `Lekcje: punkt kontrolny agenta w runie generowania ze strażą tożsamości (#237)`.

### Task 6: Produkcyjny adapter AI SDK

**Files:**
- Create: `packages/server/src/providers/openai/lesson-pool-agent.ts` (z `tests/probes/ai-sdk-lesson-agent.ts`), `packages/server/src/providers/openai/lesson-pool-agent.test.ts` (z `tests/probes/ai-sdk-lesson-agent.test.ts`)
- Delete: `tests/probes/ai-sdk-lesson-agent.ts`, `tests/probes/ai-sdk-lesson-agent.test.ts`
- Modify: `tests/probes/agent-generation.probe.test.ts` (import z adaptera produkcyjnego), `vitest.unit.config.ts` (ścieżka testu), `packages/server/package.json` (zależności), `pnpm-lock.yaml`, `tests/ai-sdk-scope.test.ts`, `packages/server/src/providers/usage-recording.architecture.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AiSdkLessonAgentOptions {
    readonly apiKey: string;
    readonly model: string;
    readonly effort: string;                       // openrouter reasoning.effort
    readonly provider?: Readonly<Record<string, unknown>>;   // providerOptions.openrouter.provider (routing, data_collection, require_parameters)
    readonly usage?: UsageRecorder;
  }
  export class AiSdkLessonPoolAgent implements LessonPoolAgentProvider { constructor(options: AiSdkLessonAgentOptions) }
  export class AiSdkExerciseChecker implements LessonExerciseCheckerProvider { constructor(options: AiSdkLessonAgentOptions) }
  export function toGenerationProviderError(error: unknown, signal: AbortSignal): unknown;   // przerwanie → bez zmian; SDK → GenerationProviderError bez cause; inne → bez zmian
  export function openRouterCostOf(meta: ProviderMetadata | undefined): number | null;
  export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
  ```
  Konstruktor tworzy `createOpenRouter({ apiKey, baseURL: OPENROUTER_BASE_URL })` i model `openrouter.chat(model, { usage: { include: true } })`. `providerOptions.openrouter = { reasoning: { effort }, ...(provider ? { provider } : {}) }`.

- [ ] **Step 1:** `pnpm --filter @learning/server add --save-exact ai@7.0.162 @openrouter/ai-sdk-provider@3.1.0`; `git diff pnpm-lock.yaml` — tylko wpisy importera `packages/server`.
- [ ] **Step 2:** `git mv` obu plików próby do `providers/openai/` pod nowe nazwy; popraw importy; próba importuje `../../packages/server/src/providers/openai/lesson-pool-agent`; `vitest.unit.config.ts` — nowa ścieżka testu. Run `pnpm vitest run packages/server/src/providers/openai/lesson-pool-agent.test.ts` — Expected: PASS (przeniesione testy).
- [ ] **Step 3: Nowe testy** (`MockLanguageModelV4`):
  - `"mapowanie błędów"` — tabela: `APICallError` 401/402/403 → `configuration`; 429 z `retry-after: 7` → `rate_limit`, `retryAfterMs` 7000; 408/500/503 i `isRetryable` → `transient`; 400/422 → `output`; `NoObjectGeneratedError`/`InvalidToolInputError` → `output`; każdy wynik bez `cause`; przerwanie sygnałem → `signal.reason` bez zmian; `TypeError` z narzędzia → bez zmian;
  - `"usage: ok raz na żądanie"` — 2 kroki → 2 zdarzenia `outcome: "ok"`, `provider: "openrouter"`, `operation: "agent_objective"`, `providerCostUsd` z metadanych;
  - `"usage i RunCostSink: błąd HTTP"` — 500 → `recordHttpError` z `httpStatus: 500`, `RunCostSink.record(0)`;
  - `"usage i RunCostSink: brak odpowiedzi"` — błąd sieci → zapis transportu bez statusu, `RunCostSink.record(null)`;
  - `"providerOptions: wysiłek, routing, require_parameters"` — asercja na opcjach wywołania modelu w mocku;
  - `"klucz i baseURL jawne"` — w `process.env` brak `OPENROUTER_API_KEY`, adapter z `apiKey: "test-key"` wysyła żądanie (mock fetch przez `fetch` w opcjach providera albo podmiana modelu — asercja nagłówka `Authorization: Bearer test-key` i hosta `openrouter.ai`).
- [ ] **Step 4:** Run — Expected: FAIL dla nowych.
- [ ] **Step 5:** Implementuj (`toGenerationProviderError` w `catch` wokół `tracked`; zapis `UsageRecorder` przez `recordResponse(usage, base, 200, { usage: { prompt_tokens, completion_tokens, cost } })`, `recordHttpError`, `recordTransportFailure` — lokalna flaga `recorded` jak w `record-http.ts`).
- [ ] **Step 6: Testy architektury:**
  - `tests/ai-sdk-scope.test.ts`: `ALLOWED` = `tests/probes/` + oba pliki adaptera; manifest `packages/server/package.json` może deklarować `ai` i `@openrouter/ai-sdk-provider` z dokładną wersją, pozostałe manifesty nie; nowy dowód czułości: inny plik w `providers/` z importem `ai` jest wykrywany;
  - `usage-recording.architecture.test.ts`: wykrywanie importu `ai`/`@openrouter/*` obok `fetch(`; `"openai/lesson-pool-agent.ts"` w `PAID_ADAPTERS`; reguła liczby zapisów: dla pliku SDK `recordCalls ≥ 3`.
- [ ] **Step 7:** Run `pnpm vitest run tests/ai-sdk-scope.test.ts packages/server/src/providers` i `pnpm typecheck` — Expected: PASS.
- [ ] **Step 8:** Commit: `Lekcje: produkcyjny adapter AI SDK agenta puli z mapowaniem błędów i kosztami (#237)`.

### Task 7: Konfiguracja i składanie

**Files:**
- Modify: `packages/server/src/config-defaults.ts`, `packages/server/src/config.ts`, `packages/server/src/providers/openrouter-key.ts`, `packages/server/src/providers/generation-env.ts`, `packages/server/src/providers/fake-lesson-agent.ts`, `packages/server/package.json` (`"exports": { ".": …, "./lesson-agent": "./src/providers/lesson-agent-env.ts" }`), `apps/worker/src/composition.ts`, `packages/server/src/index.ts` (eksport `lessonAgentPublicFromEnv`, typów)
- Create: `packages/server/src/providers/lesson-agent-env.ts`
- Test: `packages/server/src/config.test.ts`, `packages/server/src/providers/lesson-agent-env.test.ts`, `packages/server/src/providers/fake-lesson-agent.test.ts`, `packages/server/src/providers/lesson-agent-imports.architecture.test.ts` (nowy)

**Interfaces:**
- Produces:
  ```ts
  // config.ts (bez importu adaptera i SDK)
  export interface LessonAgentSettings {
    readonly subjects: ReadonlySet<string>; readonly apiKey: string;
    readonly model: string; readonly effort: string; readonly provider?: Readonly<Record<string, unknown>>;
    readonly checkerModel: string; readonly checkerEffort: string; readonly checkerProvider?: Readonly<Record<string, unknown>>;
    readonly policy: Partial<LessonAgentPolicy>;   // maxStepsPerObjective, planMaxSteps, concurrency, checkerConcurrency, objectiveTimeoutMs, checkerTimeoutMs, runBudgetUsd
  }
  export function lessonAgentSettingsFromEnv(env: Record<string, string | undefined>, subjects: Pick<SubjectRegistry, "getSubject">): LessonAgentSettings | undefined;   // rzuca przy błędach startu (§5)
  export function lessonAgentPublicFromEnv(env: Record<string, string | undefined>, subjects: Pick<SubjectRegistry, "getSubject">):
    { readonly subjects: ReadonlySet<string>; readonly generationService: string; readonly checkService: string } | undefined;   // nigdy nie rzuca
  export interface LessonAgentDeps { readonly subjects: ReadonlySet<string>; readonly agent: LessonPoolAgentProvider; readonly checker: LessonExerciseCheckerProvider; readonly policy: Partial<LessonAgentPolicy> }
  // GenerationDeps.lessonAgent?: LessonAgentDeps
  // providers/lesson-agent-env.ts (eksport @learning/server/lesson-agent)
  export function lessonAgentDepsFromEnv(env: Record<string, string | undefined>, subjects: Pick<SubjectRegistry, "getSubject">, usage?: UsageRecorder, llm?: LlmProvider): LessonAgentDeps | undefined;
  // generation-env.ts
  export function createGenerationDepsFromEnv(env, usage?, options?: { readonly lessonAgent?: LessonAgentDeps }): GenerationDeps | undefined;
  // fake-lesson-agent.ts
  FakeLessonPoolAgentOptions.fromLlm?: LlmProvider;   // tryb „jak LLM”: podagent zgłasza w 1 kroku wynik llm.generateLessonPool dla swojego zagadnienia; planer — propozycję z llm.generateLessonObjectives
  FakeExerciseCheckerOptions.unavailable?: true;      // solve/judge zwracają null dla każdej pozycji
  ```
  Nazwy usług: `generationService = "openrouter.ai · <model>"`, `checkService = "openrouter.ai · <checkerModel>"`; tryb fake: `"fake-lesson-agent-model"`, `"fake-lesson-checker-model"`.
  Klucz: `endpointKeyFromEnv` rozszerzony o kolejność `UMIEM_LESSON_AGENT_API_KEY` → `OPENROUTER_API_KEY` → `UMIEM_LLM_API_KEY` (gdy `isSecureOpenRouterEndpoint(UMIEM_LLM_BASE_URL)`); nowa funkcja `lessonAgentKeyFromEnv(env): string | undefined` w `openrouter-key.ts`.
  Routing: `chatRequestExtrasFromEnv(env, "UMIEM_LESSON_AGENT")` i `(…, "UMIEM_LESSON_AGENT_CHECKER")`; gdy brak własnych `*_PROVIDER_*`, użyj wyniku dla `"UMIEM_LLM"`; wyciągnij z wyniku obiekt `provider` i dołóż `require_parameters: true`.

- [ ] **Step 1: Testy:**
  - `config.test.ts` `describe("lessonAgentSettingsFromEnv")`: pusta lista → `undefined`; lista bez klucza → `undefined` + jedno `console.warn` z `UMIEM_LESSON_AGENT_SUBJECTS`; kolejność kluczy (własny wygrywa; `UMIEM_LLM_API_KEY` tylko przy https OpenRouter); nieznany przedmiot → rzuca z nazwą zmiennej; przedmiot bez `agentPolicy` → rzuca; `google/…` i `google/…` → rzuca (`UMIEM_LESSON_AGENT_CHECKER_MODEL`); `UMIEM_LESSON_AGENT_MAX_STEPS=abc` → rzuca; nieznany wysiłek → rzuca; routing dziedziczony z `UMIEM_LLM_PROVIDER_DATA_COLLECTION=deny`, własny wygrywa, `require_parameters: true`.
  - `describe("lessonAgentPublicFromEnv")`: nieznany identyfikator pominięty bez wyjątku; brak klucza → nadal zwraca nazwy usług; pusta lista → `undefined`.
  - `lesson-agent-env.test.ts`: `UMIEM_FAKE_PROVIDERS=1` + lista → fake'i (`fromLlm`, checker `unavailable`); bez listy → `undefined`; z kluczem → instancje adaptera z modelami z env.
  - `fake-lesson-agent.test.ts`: `"fromLlm: jeden krok submit z wyniku generateLessonPool"`, `"checker unavailable zwraca null"`.
  - `lesson-agent-imports.architecture.test.ts`: tylko `providers/lesson-agent-env.ts` importuje `providers/openai/lesson-pool-agent`; `config.ts`, `generation-env.ts`, `index.ts` nie importują `lesson-agent-env` ani adaptera (skan importów jak w `module-boundaries.architecture.test.ts`).
- [ ] **Step 2:** Run `pnpm vitest run packages/server/src/config.test.ts packages/server/src/providers` — Expected: FAIL.
- [ ] **Step 3:** Implementuj; `apps/worker/src/composition.ts`: `const lessonAgent = lessonAgentDepsFromEnv(env, subjects, usage, llmFromGeneration)` — gdzie `llm` w trybie fake to `FakeLlmProvider` z `fakeGenerationDeps` (przekaż `generation.llm` po złożeniu: złóż najpierw `createGenerationDepsFromEnv(env, usage)`, potem `{ ...generation, lessonAgent }`); dodaj `config-defaults.ts` (komentarz sekcji jak inne).
- [ ] **Step 4:** Run — Expected: PASS; `pnpm typecheck`; `pnpm --filter worker build` albo `pnpm build` (sprawdza eksport subścieżki).
- [ ] **Step 5:** Commit: `Lekcje: konfiguracja agenta puli per przedmiot i składanie w workerze (#237)`.

### Task 8: Funkcje czyste ścieżki agenta

**Files:**
- Create: `packages/server/src/modules/materials/lessons/lesson-agent-outcome.ts`, `lesson-agent-outcome.test.ts`
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`LessonContext.generationGaps?`, typ `LessonGenerationGap`; `LessonPoolWriteContext.generationGaps`)

**Interfaces:**
- Consumes: Task 3 (`SettledObjective.failure.retryable`), Task 5 (`LessonAgentProgress`).
- Produces:
  ```ts
  export type LessonGenerationGap = { objectiveId: string; reason: "incomplete" | "failed" | "add_short"; added?: number; requested?: number };
  export function lessonGeneratorFor(subject: SubjectModule, agent: LessonAgentDeps | undefined): "agent" | "pipeline";
  export type LessonAgentOutcome =
    | { kind: "requeue"; errorCode: string; retryAfterMs?: number }
    | { kind: "finalize" }
    | { kind: "failed"; errorCode: string };
  export function lessonAgentRunOutcome(args: {
    planStatus: LessonPoolAgentResult["planStatus"]; planFailure?: { errorCode: string; retryable: boolean; retryAfterMs?: number };
    objectives: readonly Pick<SettledObjective, "status" | "failure">[];
    accepted: number;            // tryb add: tylko nowe
    budgetExhausted: boolean; attempts: number; maxAttempts: number;
  }): LessonAgentOutcome;       // tabela §9 specu, wiersze 1–7 w kolejności
  export function mergeAttemptIntoProgress(progress: LessonAgentProgress, result: LessonPoolAgentResult, mode: "pool" | "add"): LessonAgentProgress;
  export function acceptedInLessonOrder(progress: LessonAgentProgress, objectiveOrder: readonly string[]): LessonExerciseDraft[];
  export function generationGapsOf(progress: LessonAgentProgress, mode: "pool" | { add: { objectiveId: string; count: number } }): LessonGenerationGap[];
  export function mergeGenerationGaps(previous: readonly LessonGenerationGap[] | undefined, next: readonly LessonGenerationGap[], mode: "pool" | "add", objectiveId?: string): LessonGenerationGap[];
  ```
  `planFailure` z kierownika ma dziś tylko `errorCode` — w Task 8 rozszerz `LessonPoolAgentResult.planFailure` o `retryable`/`retryAfterMs` (z `classifyLessonGenerationFailure`).
  Wiersz 6 §9: wszystkie zagadnienia `failed` z jednym kodem i 0 przyjętych → `failed` z tym kodem, a gdy kod przejściowy i próby wyczerpane → `attempts_exhausted`.

- [ ] **Step 1: Testy:** po jednym `it` na wiersz tabeli §9 (nazwy `"wiersz 1: budżet …"` … `"wiersz 7: …"`), `"wiersz 1 wygrywa z wierszem 4"`, `lessonGeneratorFor` (lista, brak polityki, brak deps), `mergeAttemptIntoProgress` (zagadnienie wznowione zastępuje wpis; `complete` z wcześniejszej próby zostaje; tryb add dopisuje nowe do wpisu zagadnienia; histogram kodów sumowany), `acceptedInLessonOrder`, `generationGapsOf` (incomplete, failed, add_short), `mergeGenerationGaps` (pula zastępuje; add usuwa wpis przy komplecie).
- [ ] **Step 2:** Run `pnpm vitest run packages/server/src/modules/materials/lessons/lesson-agent-outcome.test.ts` — FAIL.
- [ ] **Step 3:** Implementuj.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit: `Lekcje: wynik próby agenta i luki generowania jako funkcje czyste (#237)`.

### Task 9: Ścieżka agenta w `executeLessonGeneration`

**Files:**
- Create: `packages/server/src/modules/materials/lessons/lesson-agent-generation.ts`
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (wybór ścieżki przed limitem prób)
- Test: `tests/integration/lesson-agent-generation.test.ts`

**Interfaces:**
- Consumes: Task 1 (`finalizeLessonPoolWrite`, `failLessonPoolValidation`, `markLessonRun`, `orderedDraftExercises`), Task 2 (`control.run`, `control.deadlineAtMs`), Task 3–4 (pola kierownika), Task 5 (punkt kontrolny), Task 7 (`GenerationDeps.lessonAgent`), Task 8 (funkcje czyste).
- Produces: `export async function executeLessonAgentGeneration(services: Services, args: { run: GenerationRunRow; attempts: number; subject: SubjectModule; input: LessonRunInput; runStartedAtMs: number; signal?: AbortSignal }): Promise<void>`.

Przebieg (spec §7–§10): odczyt postępu (`parseLessonAgentProgress`) → przy `attempts > MAX_AUTOMATIC_ATTEMPTS`: postęp z ≥ 1 ćwiczeniem → zapis bez modelu, inaczej `failed`/`attempts_exhausted` → `withLessonGenerationControl` → źródło zagadnień wg tabeli §7.1 (szkoła: `control.call(generateLessonObjectives)` + zapis postępu) → `control.run(signal => runLessonPoolAgent(deps, input, signal))` z `policy.runTimeoutMs = control.deadlineAtMs − AGENT_FINALIZATION_RESERVE_MS − now()` (≤ 0 → od razu wynik bez podagentów), hakami `onObjectivesResolved`/`onObjectiveSettled` zapisującymi postęp, `familyScope = \`${runId}:${attempts}\``, w trybie `add` `count = count − nowe z postępu` i `extraExposureSources` = zdania historyjki szkicu → `mergeAttemptIntoProgress` → `lessonAgentRunOutcome` → `requeue` (zapis postępu, `markLessonRun queued` z `lessonRetryDelayMs`) / `failed` (zapis postępu, `failLessonPoolValidation` albo `markLessonRun failed`) / `finalize`: `acceptedInLessonOrder` → kontrola końcowa `lessonInvariantCheck` na stanie z `accepted` jako pulą (nowa czysta funkcja domeny `finalLessonCheck(subject, topic, material, fixed, accepted, examples)` w `domain/lessons/agent/status.ts`, zwraca usunięte) → `finalizeLessonPoolWrite` z `onTransaction` zapisującym podsumowanie (`summarizeLessonAgentProgress`) i `context.generationGaps` (`mergeGenerationGaps`), `rejectedCount` = usunięcia kontroli końcowej + bezpiecznika (`result.stats.invariantViolations`). Wyjątki: `shutdown` → zapis postępu best-effort, `queued`; `superseded` i `LessonAgentCheckpointLostError` → `markLessonRun superseded`; inne → `classifyLessonGenerationFailure` jak potok, zapis wydatku best-effort. Log zakończenia wg §9.

- [ ] **Step 1: Testy integracyjne** (fake'i przez `services.generation.lessonAgent`; nazwy = punkty 1–15 §12 specu), m.in.:
  - `"rozdział: planer → szkic, dynamicTopic, przykłady, editNumber+1, historyjka w kolejce, podsumowanie bez treści"`;
  - `"gramatyka (katalog) i szkoła (etap zagadnień z fake LLM)"`;
  - `"błąd przejściowy zagadnienia → queued; kolejna próba pomija gotowe, planera i etap zagadnień, przenosi wydatek"`;
  - `"wyczerpane próby → zapis części i generationGaps"`;
  - `"shutdown w ostatniej próbie → następne przejęcie zapisuje z punktu kontrolnego bez wywołań modelu"`;
  - `"budżet wyczerpany przy błędzie przejściowym innego zagadnienia → zapis części bez ponowienia"`;
  - `"termin runu → succeeded z częścią, nie provider_timeout"` — `UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS` mały przez `lessonExecution`, scenariusz z `hang` w jednym zagadnieniu;
  - `"zero przyjętych → failed validation"`; `"wszystkie zagadnienia provider_configuration → failed provider_configuration bez ponowienia"`;
  - `"edycja rodzica w trakcie → superseded, szkic bez zmian"`; `"podbicie editNumber przez acceptVerdictAsVariant w trakcie → run nie zostaje running"`;
  - `"Ponów w trakcie próby (dwie karty) → spóźniony zapis odrzucony, nowa próba wznawia"`;
  - `"dogeneruj +2 → najwyżej 2+stageGap+listenLeft nowych, szkic nietknięty"`; `"dogeneruj z kolizją historyjki"`; `"dogeneruj z błędem przejściowym → requeue → bez duplikatów"`; `"dogeneruj bez nowych → failed, editNumber bez zmian"`;
  - `"uszkodzony punkt kontrolny → start od zera"`; `"przełączenie na potok między próbami"`; `"przedmiot spoza listy → potok bez zmian"`;
  - `"koszty: zdarzenia UsageRecorder w zakresie runu"` (fake agent zgłasza koszt; asercja na `createTestRecorder`);
  - `"składanie z env: UMIEM_FAKE_PROVIDERS=1 + lista → ścieżka agenta"`.
- [ ] **Step 2:** Run `pnpm test:integration -- tests/integration/lesson-agent-generation.test.ts` — FAIL.
- [ ] **Step 3:** Implementuj; w `executeLessonGeneration` przenieś sprawdzenie `attempts > MAX_AUTOMATIC_ATTEMPTS` za wybór ścieżki tylko dla agenta (potok: kolejność bez zmian).
- [ ] **Step 4:** Run nowy plik i regresję potoku (`lesson-generation`, `lesson-review`, `lesson-story`, `lesson-chapter`, `generation`) — PASS; `pnpm vitest run packages/server/src/modules` PASS.
- [ ] **Step 5:** Commit: `Lekcje: generowanie puli agentem w przebiegu lekcji z punktem kontrolnym i wznawianiem (#237)`.

### Task 10: Panel rodzica — usługi per przedmiot i niepełna pula

**Files:**
- Modify: `packages/contracts/src/lessons.ts` (`SubjectCatalogDtoSchema` — pola przedmiotu `generationServices?: z.array(z.string().min(1)).min(1)`, `checkService?: z.string().min(1)`, `checkServiceIncludesMaterial?: z.boolean()`; `LessonDeckDtoSchema` — `generationGaps?`), `packages/contracts/src/messages.ts`, `packages/server/src/config.ts` (`Services.lessonAgentPublic?`), `packages/server/src/modules/materials/lessons/lesson-api.ts` (`lessonCatalog`, mapowanie szkicu), `apps/web/src/composition.ts`, `apps/web/src/parent/lessons/NewLessonForm.tsx`, `apps/web/src/parent/sources/SourcePage.tsx`, `apps/web/src/parent/lessons/LessonEditor.tsx`
- Test: `packages/contracts/src/lessons.test.ts`, `packages/server/src/modules/materials/lessons/lesson-api.test.ts`, `apps/web/src/parent/lessons/new-lesson-form.test.tsx`, test edytora (istniejący plik testów `LessonEditor`/`lesson-editor-state`), E2E `mocked`: istniejące specy formularza lekcji i edytora szkicu

**Interfaces:**
- Consumes: Task 7 (`lessonAgentPublicFromEnv`), Task 8 (`LessonGenerationGap`).
- Produces: komunikaty (dokładne teksty):
  - `checkServiceInfo`: „Gotowe ćwiczenia trafiają też do drugiego modelu, który rozwiązuje je na próbę ({service}). Nie wysyłamy do niego imienia, wieku ani odpowiedzi dziecka.”
  - `checkServiceInfoWithMaterial`: „Materiał lekcji i gotowe ćwiczenia trafiają też do drugiego modelu, który rozwiązuje ćwiczenia na próbę ({service}). Nie wysyłamy do niego imienia, wieku ani odpowiedzi dziecka.”
  - `generationGapsAlert`: „Generowanie zakończyło się częściowo: {n} zagadnienia do uzupełnienia. Użyj „Dogeneruj” przy zagadnieniu.”
  - `generationGapIncomplete`: „Niepełne po generowaniu”; `generationGapFailed`: „Nie udało się wygenerować”; `generationGapAddShort`: „Dodano {added} z {requested}”.
  `lessonCatalog`: dla przedmiotu z `lessonAgentPublic.subjects`: `generationServices` = `[generationService agenta]`, a gdy przedmiot ma temat dynamiczny bez `planCoverage` (etap zagadnień przez `UMIEM_LLM`) i usługa `UMIEM_LLM` jest inna — dopisz ją; `checkService`; `checkServiceIncludesMaterial = agentPolicy.checkerNeedsMaterial`. Formularz: przy takim przedmiocie komunikat o generowaniu z `generationServices.join(", ")`, wariant komunikatu checkera wg `checkServiceIncludesMaterial`, bez `reviewServiceInfo`.

- [ ] **Step 1: Testy:** kontrakty (pola opcjonalne, puste odrzucone, stare ładunki przechodzą); `lesson-api.test.ts` (`"przedmiot z agentem: usługi per przedmiot"`, `"szkoła: dwie usługi generowania i wariant z materiałem"`, `"przedmiot poza listą: bez pól"`); `new-lesson-form.test.tsx` (komunikat checkera w obu wariantach, brak komunikatu krytyka przy przedmiocie agenta, komunikat krytyka nadal przy przedmiocie potoku); edytor (`"alert generationGaps z liczbą zagadnień"`, znacznik przy zagadnieniu dla każdego `reason`).
- [ ] **Step 2:** Run `pnpm vitest run packages/contracts packages/server/src/modules/materials/lessons/lesson-api.test.ts apps/web/src/parent` — FAIL.
- [ ] **Step 3:** Implementuj.
- [ ] **Step 4:** Run — PASS; dopisz przypadki E2E `mocked` w istniejących specach formularza lekcji i edytora (fixture katalogu z `checkService`, szkic z `generationGaps`); `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test <specy> --project=mocked` — PASS.
- [ ] **Step 5:** Commit: `Panel rodzica: usługi generowania per przedmiot i informacja o niepełnej puli (#237)`.

### Task 11: Dokumentacja

**Files:**
- Modify: `docs/architecture.md` (§19.17, §23), `docs/provider-config.md`, `.env.example`, `AGENTS.md`, `docs/SPEC.md`, `docs/schema.sql` (jeśli nie w Task 5)

- [ ] **Step 1:** `architecture.md` §19.17: ścieżka agenta, wybór per przedmiot, terminy (rezerwa 30 s), punkt kontrolny i podsumowanie, wynik próby (tabela), tryb „dodaj N”, `generationGaps`; §23: operacje kosztów agenta, `RunCostSink` vs `UsageRecorder`, koszt 0 dla błędów HTTP.
- [ ] **Step 2:** `provider-config.md` i `.env.example`: wszystkie `UMIEM_LESSON_AGENT_*` (wartości domyślne z Global Constraints), klucz i kolejność, routing z dziedziczeniem, wymóg różnych rodzin modeli; bez sekretów.
- [ ] **Step 3:** `AGENTS.md`: zdanie o `ai`/`@openrouter/*` → „wyłącznie w `tests/probes` oraz w `providers/openai/lesson-pool-agent.ts` z jego testem (składany przez `@learning/server/lesson-agent`, tylko worker)”; w sekcji prywatności punkt o agencie (do checkera widok ćwiczenia, w szkole materiał; punkt kontrolny bez danych dziecka, po zapisie podsumowanie bez treści; logi bez treści).
- [ ] **Step 4:** `SPEC.md`: krótka informacja w sekcji generowania lekcji o niepełnej puli i usługach.
- [ ] **Step 5:** Commit: `Dokumentacja: agent puli lekcji w generowaniu — konfiguracja, punkt kontrolny i prywatność (#237)`.

### Task 12: Weryfikacja całości

- [ ] **Step 1:** `pnpm typecheck` — PASS.
- [ ] **Step 2:** `pnpm test:unit` — PASS.
- [ ] **Step 3:** `pnpm test:integration` — PASS.
- [ ] **Step 4:** `pnpm build` — PASS (worker importuje `@learning/server/lesson-agent`; web bez SDK — sprawdź `apps/web/.next/server` grepem na `@openrouter/ai-sdk-provider`: brak).
- [ ] **Step 5:** `pnpm test:e2e:shards` — PASS (645+ testów, zrzuty pominięte).
- [ ] **Step 6:** Raport: co sprawdzone, czego nie (brak płatnych przebiegów; brak odbioru na prawdziwym modelu — etap 3).
