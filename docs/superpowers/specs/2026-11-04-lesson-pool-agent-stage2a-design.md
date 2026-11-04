# Agent generujący pulę lekcji — etap 2a: adapter AI SDK i integracja z generowaniem — design

Data: 2026-11-04. Issue: [#237](https://github.com/lookassh/knowli/issues/237).
Poprzedni etap: [spec etapu 1](2026-11-04-lesson-pool-agent-stage1-design.md)
(rdzeń domenowy, porty, kierownik `runLessonPoolAgent`; scalony w #256).

Decyzje właściciela (czat 2026-11-04):

- etap 2 idzie w **dwóch PR-ach**: **2a** (ten dokument) — adapter AI SDK,
  przełączanie przedmiotów, punkt kontrolny, wznawianie, wynik runu, panel
  rodzica, dla wszystkich przedmiotów z `agentPolicy` (szkoła z kontrolami
  deterministycznymi z etapu 1); **2b** (osobny spec) — kontrole modelem w
  szkole (sędzia podpowiedzi, sprawdzenie otwartych odpowiedzi graderem);
- przyjęte ćwiczenia zagadnień trafiają do **punktu kontrolnego w runie**
  (`generation_runs`), a do szkicu — **jeden atomowy zapis na końcu**, jak dziś;
  rodzic nie widzi zagadnień w trakcie runu;
- niepełny run: przejściowy błąd dostawcy → **ponowienie** runu i wznowienie
  brakujących zagadnień; po wyczerpaniu prób, przy terminie i budżecie →
  **zapis tego, co przyjęte** (`succeeded`); zero przyjętych ćwiczeń → `failed`;
- **„Dogeneruj”** jedno zagadnienie (+N) też idzie przez agenta — nowy tryb
  kierownika;
- agent włączany **listą przedmiotów** `UMIEM_LESSON_AGENT_SUBJECTS`
  (domyślnie pusta = wszędzie dzisiejszy potok);
- modele domyślne: generator **Gemini 3.8 Flash**, checker **DeepSeek V4.1
  Flash** (przebieg kontrolny 2026-11-04: 103 s, 0,142 USD, 74 z 94 przyjętych).

## 1. Problem i zakres

Etap 1 zbudował rdzeń agenta i kierownika w pamięci, a próba `pnpm probe:agent`
woła je przez tymczasowe adaptery AI SDK w `tests/probes`. Etap 2a przenosi
adaptery do kodu produkcyjnego i podpina kierownika do `executeLessonGeneration`
za przełącznikiem per przedmiot, z trwałym punktem kontrolnym, wznawianiem,
zapisem kosztów i informacją dla rodzica.

**W zakresie (jeden PR):**

1. Adapter `providers/openai/lesson-pool-agent.ts` — oba porty z etapu 1
   (`LessonPoolAgentProvider`, `LessonExerciseCheckerProvider`), przeniesione z
   `tests/probes/ai-sdk-lesson-agent.ts`, z `UsageRecorder` (§4).
2. Konfiguracja `UMIEM_LESSON_AGENT_*` w `config-defaults.ts` i składanie w
   workerze (§5).
3. Przykłady początkowe i tryb „dodaj N” w kierowniku (§6).
4. Ścieżka agenta w `executeLessonGeneration`: pełna generacja i dogenerowanie
   (§7), punkt kontrolny i wznawianie (§8), wynik runu (§9), wspólny zapis do
   szkicu (§10).
5. Informacja dla rodzica o usłudze checkera (§11).
6. Migracja `generation_runs.agent_checkpoint` (§8.1).
7. Testy (§12) i dokumentacja (§13).

**Poza zakresem:** kontrole modelem w szkole (2b); pomiar odbiorczy i
przełączenie domyślne (etap 3); usunięcie krytyka (etap 4); generowanie
historyjki (bez zmian); automatyczne odzyskiwanie runu `running` po twardej
awarii procesu (dziś też go nie ma — rodzic używa „Ponów”, §8.3); zmiany w
dzisiejszym potoku poza wydzieleniem wspólnego zapisu (§10).

**Moduł i zależności.** Obszar `materials`: ścieżka agenta i zapis w
`modules/materials/lessons/`, punkt kontrolny i ponowienie w
`modules/materials/` (`generation-runs.ts`, `generation.ts`), adapter w
`providers/openai/`, konfiguracja w `config.ts`/`config-defaults.ts`. Brak
nowych zależności między obszarami. Nowe zależności pakietu: `ai@7.0.162` i
`@openrouter/ai-sdk-provider@3.1.0` w `packages/server` (`dependencies`,
wersje dokładne; dziś są tylko devDependencies roota).

**Granice transakcji.** Bez zmian względem potoku: jedna transakcja końcowa
(blokada wersji, potem runu) zapisuje ćwiczenia, kontekst, `editNumber`,
anulowanie runów i kolejkę historyjki. Zapis punktu kontrolnego to osobny
`UPDATE` jednego wiersza runu ze strażą tożsamości (§8.2), poza transakcją
biznesową — punkt kontrolny nie jest stanem szkicu, a utrata zapisu oznacza
tylko powtórzenie pracy.

## 2. Słownik

- **Ścieżka agenta / potok** — generowanie puli przez kierownika
  `runLessonPoolAgent` albo dzisiejsze partie `generateLessonPool`.
- **Punkt kontrolny** — JSONB w wierszu runu z planem i rozliczonymi
  zagadnieniami (§8.1).
- **Próba** — jedno przejęcie runu (`claimQueuedRun`, `attempts + 1`).
- **Tryb „pula” / „dodaj N”** — pełna generacja lekcji albo dogenerowanie
  jednego zagadnienia (§6).

## 3. Wybór ścieżki

`executeLessonGeneration` po wspólnym początku (odczyt runu, gałąź historyjki,
`claimQueuedRun`, limit prób, sprawdzenie unieważnienia, rozwiązanie
przedmiotu) wybiera ścieżkę funkcją czystą:

```ts
lessonGeneratorFor(subject, agentSubjects: ReadonlySet<string>): "agent" | "pipeline"
```

`"agent"` wtedy i tylko wtedy, gdy `subject.id ∈ agentSubjects`,
`subject.agentPolicy !== undefined` i `services.generation.lessonAgent` jest
złożony (§5). Lista przedmiotów pochodzi wyłącznie z konfiguracji; silnik i
kierownik nadal nie znają identyfikatorów przedmiotów. Run zaczęty jedną ścieżką
i ponowiony po zmianie konfiguracji przechodzi ścieżką bieżącą; punkt kontrolny
innej ścieżki nie istnieje (potok go nie pisze), a ścieżka potoku ignoruje
kolumnę.

Gałąź agenta to nowa funkcja `executeLessonAgentGeneration(services, run,
attempts, …)` w nowym pliku `lesson-agent-generation.ts`. Potok zostaje w
`lesson-drafts.ts` bez zmiany zachowania.

## 4. Adapter AI SDK (`providers/openai/lesson-pool-agent.ts`)

Jedyny plik produkcyjny importujący `ai` i `@openrouter/ai-sdk-provider`
(test `tests/ai-sdk-scope.test.ts`, §12). Zawiera `AiSdkLessonPoolAgent` i
`AiSdkExerciseChecker` przeniesione z `tests/probes/ai-sdk-lesson-agent.ts`
razem z jego testami (`ai-sdk-lesson-agent.test.ts` →
`lesson-pool-agent.test.ts` obok adaptera). Próba importuje adapter
produkcyjny; plik w `tests/probes` znika.

Zachowanie (jak w próbie, zapisane w kontrakcie portów etapu 1):

- `ToolLoopAgent` z narzędziami `submit_exercises`, `remove_exercise`
  (podagent) i `propose_objectives` (planer); checker na `generateText` z
  `Output.object`;
- `stopWhen: [isStepCount(maxSteps), () => tools.shouldStop()]`;
- **`maxRetries: 0`** — jedno wywołanie modelu to jedno żądanie HTTP;
  przejściowy błąd ponawia run (§9), nie SDK;
- surowe rekordy materializowane jak w `generateLessonPool`
  (`materializeGeneratedCalculations`, `…Keywords`, `…Assignments`), bez
  walidacji treści; prompt produkcyjny (`lessonSystemPrompt`,
  `lessonUserMaterial`) plus dopisek przepływu narzędzi;
- `providerOptions.openrouter.reasoning.effort` z konfiguracji;
- przerwanie `signal` kończy wywołanie wyjątkiem przerwania; adaptery nic nie
  logują.

**Koszty.** Z `onLanguageModelCallEnd` (po odpowiedzi, przed narzędziami
kroku), raz na żądanie:

1. `RunCostSink.record(openRouterCostOf(providerMetadata))` — budżet runu;
2. `UsageRecorder.record({ feature: "lesson_generation", operation,
   provider: "openrouter.ai", model, outcome: "ok", inputTokens, outputTokens,
   providerCostUsd })` z `operation` ∈ `agent_plan`, `agent_objective`,
   `check_solve`, `check_variants`.

Żądanie rozpoczęte (`onLanguageModelCallStart`) i bez odpowiedzi (wyjątek,
przerwanie) → `RunCostSink.record(null)` i `UsageRecorder.record({ …, outcome:
"failed" })` bez kosztu — jak licznik `requestCostTracker` próby. Adapter
przyjmuje `usage?: UsageRecorder`; zakres (`withUsageScope` runu) ustawia już
`generation-worker.ts` wokół `executeLessonGeneration`.

**Inwentarz płatnych adapterów.** `providers/usage-recording.architecture.test.ts`
wykrywa dziś pliki z `fetch(`/`doFetch(`. Rozszerzam wykrywanie o import `ai`
lub `@openrouter/*`, dopisuję adapter do `PAID_ADAPTERS`, a sprawdzenie liczby
wywołań zapisu obejmuje oba zdarzenia (`record` w obsłudze końca i porażki
żądania).

## 5. Konfiguracja i składanie

**`config-defaults.ts`** (bez sekretów):

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `UMIEM_LESSON_AGENT_SUBJECTS` | `""` | Przedmioty generowane agentem (identyfikatory po przecinku) |
| `UMIEM_LESSON_AGENT_MODEL` | `google/gemini-3.8-flash` | Generator (planer i podagenci) |
| `UMIEM_LESSON_AGENT_REASONING` | `low` | Wysiłek rozumowania generatora |
| `UMIEM_LESSON_AGENT_CHECKER_MODEL` | `deepseek/deepseek-v4.1-flash-1017` | Ślepe rozwiązanie i sędzia wariantów |
| `UMIEM_LESSON_AGENT_CHECKER_REASONING` | `low` | Wysiłek rozumowania checkera |
| `UMIEM_LESSON_AGENT_MAX_STEPS` | `8` | Kroki na zagadnienie i planera |
| `UMIEM_LESSON_AGENT_CONCURRENCY` | `4` | Podagenci naraz |
| `UMIEM_LESSON_AGENT_CHECKER_CONCURRENCY` | `4` | Paczki checkera naraz |
| `UMIEM_LESSON_AGENT_OBJECTIVE_TIMEOUT_MS` | `300000` | Termin zagadnienia |
| `UMIEM_LESSON_AGENT_CHECKER_TIMEOUT_MS` | `90000` | Termin wywołania checkera |
| `UMIEM_LESSON_AGENT_RUN_BUDGET_USD` | `1.00` | Budżet runu (§8.4) |

Termin runu agenta = `UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS` (jak potok,
`LessonAgentPolicy.runTimeoutMs`). Pozostałe pola `LessonAgentPolicy` mają
wartości domyślne z kodu etapu 1.

**Klucz i host.** Adapter mówi wyłącznie z OpenRouter (provider
`@openrouter/ai-sdk-provider`), więc zmiennej adresu nie ma. Klucz:
`OPENROUTER_API_KEY`; inaczej `UMIEM_LLM_API_KEY`, gdy `UMIEM_LLM_BASE_URL`
jest bezpiecznym (https) adresem OpenRouter — ta sama reguła co
`endpointKeyFromEnv`/`isSecureOpenRouterEndpoint` w próbie. Klucz tylko w
adapterze, nigdy w logach.

**`lessonAgentFromEnv(env, usage)`** w `config.ts` zwraca
`LessonAgentDeps | undefined`:

```ts
interface LessonAgentDeps {
  readonly subjects: ReadonlySet<string>;
  readonly agent: LessonPoolAgentProvider;
  readonly checker: LessonExerciseCheckerProvider;
  readonly policy: Partial<LessonAgentPolicy>;
  /** `host · model` checkera dla panelu rodzica. */
  readonly checkerService: string;
}
```

- pusta lista → `undefined` (bez ostrzeżeń);
- niepusta lista bez klucza → `undefined` i jedno ostrzeżenie startowe
  (`[config] UMIEM_LESSON_AGENT_SUBJECTS bez klucza OpenRouter — lekcje
  generuje potok`), jak `reviewerFromEnv` w stanie `not_configured`;
- **błąd startu** (wyjątek z nazwą zmiennej): nieznany identyfikator na liście
  albo przedmiot bez `agentPolicy` (sprawdzane z rejestrem przedmiotów),
  niepoprawna liczba, nieznany wysiłek rozumowania, **generator i checker z tej
  samej rodziny** (ten sam prefiks dostawcy przed `/`, np. `google/…` i
  `google/…`).

`GenerationDeps` dostaje pole `lessonAgent?: LessonAgentDeps`, składane w
`createGenerationDepsFromEnv` (worker). Web składa wyłącznie nazwę usługi:
`lessonAgentPublicFromEnv(env)` → `{ subjects, checkerService } | undefined` z
tymi samymi regułami (bez tworzenia providerów), do katalogu przedmiotów
(§11). `UMIEM_FAKE_PROVIDERS=1` → fake'i z etapu 1 (`FakeLessonPoolAgent`,
`FakeExerciseChecker`) zamiast adaptera, żeby E2E i testy integracyjne mogły
przejść ścieżką agenta bez sieci.

**Zdrowie workera.** `reviewerHealthBudgetWarning` w `apps/worker/src/loop.ts`
liczy termin runu lekcji; ścieżka agenta nie wydłuża terminu runu (nie ma
fazy krytyka), więc ostrzeżenie zostaje bez zmian.

## 6. Zmiany kierownika: przykłady początkowe i tryb „dodaj N”

**Przykłady początkowe.** `LessonPoolAgentRunInput` dostaje
`initialExamples?: Readonly<Record<string, readonly string[]>>` — przykłady
kart wstawiane do stanu przed podagentami tak samo jak przykłady planu
(`createLessonAgentState({ examples })`); przy planie z tej samej próby
przykłady planu wygrywają dla zagadnień, które plan opisuje. Potrzebne przy
wznowieniu (§8.3) i w trybie „dodaj N”.

**Tryb „dodaj N”.** `LessonPoolAgentRunInput` dostaje pole:

```ts
readonly target?:
  | { readonly mode: "pool" }                                   // domyślnie
  | { readonly mode: "add"; readonly objectiveId: string; readonly count: number };
```

W trybie `add`:

- źródłem zagadnień jest `catalog` albo `input` (temat z kontekstu szkicu);
  `planner` → `AppError("validation")` bez wywołań;
- uruchamiane jest wyłącznie zagadnienie `objectiveId` (pozostałe jak w
  `skipObjectives`); nieznane zagadnienie → `AppError("validation")`;
- `fixed` = ćwiczenia szkicu (wszystkich zagadnień — reguły ujawnień i
  duplikatów działają na całej lekcji), `initialExamples` = przykłady szkicu;
  przykłady zagadnienia są stałe (`submit` ignoruje przykłady z notą
  „examples are fixed by the plan”, jak przy `examplesFromPlan`);
- limity zagadnienia: `targetCount` = liczba ćwiczeń zagadnienia w `fixed` na
  ścieżce etapów + `count`; `listenAllowance` jak dziś
  (`listenChoiceAllowance(subject, objective, fixed zagadnienia)`);
  `maxExercises` = `targetCount + listenAllowance + slack`;
- **warunek kompletu** = przyjęto co najmniej `count` nowych ćwiczeń
  (`poolExercises(state, objectiveId).length ≥ count`); `missing` dla modelu
  zaczyna się od `new exercises: k of count`, a dalej braki z
  `objectiveStatus` (etapy, wymagane typy, braki przedmiotu) jako wskazówki,
  które nie blokują kompletu; `shouldStop()` przy komplecie jak w trybie
  `pool`;
- `onObjectiveSettled`, kontrola końcowa i wynik jak w trybie `pool`.

Zmiana w domenie: `objectiveStatus` bez zmian; warunek kompletu trybu `add`
to nowa czysta funkcja `addModeStatus(status, added, count)` w
`domain/lessons/agent/status.ts`, wołana przez narzędzia kierownika zamiast
`status.complete`.

## 7. Ścieżka agenta w `executeLessonGeneration`

### 7.1. Wejście kierownika

| Pole | Pełna generacja | Dogenerowanie (`input.regenerate`) |
|---|---|---|
| `target` | `{ mode: "pool" }` | `{ mode: "add", objectiveId, count }` z `input.regenerate` |
| `objectiveSource` | w kolejności: punkt kontrolny ma temat → `input` z niego; `input.dynamicTopic` runu → `input`; `subject.buildDynamicTopic === undefined` → `catalog` (`resolveLessonTopic`); `agentPolicy.planCoverage` zdefiniowane (dziś rozdział) → `planner`; pozostałe dynamiczne (dziś szkoła) → `input` z wyniku `generateLessonObjectives` (wołanie i budowa tematu jak dziś w potoku: `buildDynamicTopicData`, `validateDynamicTopicData`, `withSubjectObjectiveKinds`) | `catalog` albo `input` z `input.dynamicTopic` runu / `lessonContext.dynamicTopic` szkicu |
| `fixed` | ćwiczenia z punktu kontrolnego (§8.3) | ćwiczenia szkicu (`existingDraftsOf`) |
| `draftExamples` (źródła ujawnień) | `{}` | `{}` |
| `initialExamples` (nowe, §6) | przykłady z punktu kontrolnego | `lessonContext.examples` szkicu |
| `skipObjectives` | zagadnienia `complete` z punktu kontrolnego | — (tryb `add`) |
| `familyScope` | `null` | `runId` (jak potok) |
| `initialSpentUsd` | `checkpoint.budgetSpentUsd` | `checkpoint.budgetSpentUsd` |
| `poolSize`, `material`, `instruction`, `interests`, `graderAvailable`, `topicTitle` | z `input` runu | z `input` runu |

Przedmiot z planerem rozpoznaję po polityce (`agentPolicy.planCoverage`), nie
po identyfikatorze — to ta sama cecha, którą kierownik etapu 1 używa dla
bramki pokrycia planu. Wynik planera i wynik
`generateLessonObjectives` trafiają do punktu kontrolnego przed podagentami
(§8.2), więc wznowienie nie planuje drugi raz.

### 7.2. Sterowanie

Całość (planowanie zagadnień i kierownik) działa pod
`withLessonGenerationControl` z `assertCurrent: runIsCurrent` i sygnałem
procesu, jak potok. Kierownik dostaje sygnał kontrolera; jego wyjątek
przerwania przechodzi jak dziś:

- `LessonGenerationCancelledError` z `shutdown` → `queued` (punkt kontrolny
  zostaje), inne powody (`superseded`, anulowanie) → bez zmiany stanu (run
  rozlicza ten, kto go unieważnił);
- inny wyjątek kierownika (błąd kodu, błąd haka zapisu) → klasyfikacja
  `classifyLessonGenerationFailure` i rozliczenie jak błąd partii potoku.

Kierownik ma własny termin runu (`runTimeoutMs`) równy terminowi kontrolera;
kontroler zostaje strażnikiem nadrzędnym (`assertCurrent`, anulowanie).

## 8. Punkt kontrolny i wznawianie

### 8.1. Kolumna i kształt

Migracja `0037_generation_run_agent_checkpoint.sql`: `ALTER TABLE
generation_runs ADD COLUMN agent_checkpoint jsonb` (nullable, bez domyślnej
wartości), Drizzle: `agentCheckpoint: jsonb("agent_checkpoint")`. Kształt
(wersjonowany, walidowany Zod przy odczycie — niepoprawny = brak punktu
kontrolnego i log `[lesson-agent] run=… checkpoint=invalid`):

```ts
interface LessonAgentCheckpoint {
  readonly version: 1;
  /** Temat dynamiczny po planie albo etapie zagadnień (nieobecny dla katalogu). */
  readonly dynamicTopic?: DynamicTopicData;
  readonly droppedObjectiveCount?: number;
  /** Przykłady kart z planu (rozdział). */
  readonly planExamples?: Record<string, string[]>;
  readonly objectives: Record<string, {
    readonly status: "complete" | "incomplete" | "failed";
    readonly failureCode?: string;
    /** Wszystkie przyjęte ćwiczenia zagadnienia ze wszystkich prób, w kolejności lekcji. */
    readonly exercises: LessonExerciseDraft[];
    readonly examples: string[];
  }>;
  /** Wydatek liczony do budżetu (zerowany przez „Ponów” rodzica). */
  readonly budgetSpentUsd: number;
  /** Łączny wydatek runu (tylko log). */
  readonly totalSpentUsd: number;
  readonly rejectedCount: number;
}
```

Punkt kontrolny zawiera wspólny materiał lekcji (szkice ćwiczeń, przykłady,
temat) — bez danych dziecka i bez `detail` odrzuceń. Nie trafia do DTO, MCP
ani logów. Rozmiar: rzędu 100 ćwiczeń × ok. 1 KB.

### 8.2. Zapis

Ścieżka agenta trzyma punkt kontrolny w pamięci i zapisuje **całą wartość**
funkcją `saveLessonAgentCheckpoint(db, { runId, attempts, expectedEditNumber },
checkpoint)` w `generation-runs.ts`:

```sql
UPDATE generation_runs SET agent_checkpoint = $1
WHERE id = $2 AND state = 'running' AND attempts = $3 AND expected_edit_number = $4
```

Zero zmienionych wierszy → `LessonAgentCheckpointLostError`; w haku
`onObjectiveSettled` przerywa run (kierownik rzuca błąd haka), a ścieżka
rozlicza go jak `superseded` bez zmiany stanu — run unieważniła edycja rodzica,
„Ponów” albo publikacja (każda z nich zmienia stan lub numer edycji runu).

Momenty zapisu:

1. po planie albo etapie zagadnień (temat, przykłady planu);
2. w `onObjectiveSettled` każdego zagadnienia (status, ćwiczenia = ćwiczenia
   zagadnienia z `fixed` + `settled.exercises`, przykłady, wydatek);
3. przed zakończeniem próby ponowieniem (§9) — po kontroli końcowej, z
   ćwiczeniami z wyniku kierownika (po usunięciach bezpiecznika).

Wydatek w punkcie kontrolnym = `initialSpentUsd` + koszty zgłoszone w próbie
do chwili zapisu (licznik kierownika udostępnia bieżący wydatek hakowi przez
nowe pole `SettledObjective.spentUsd`).

### 8.3. Wznowienie

Próba ze stanem `agent_checkpoint`:

- temat i przykłady planu z punktu kontrolnego (planer i etap zagadnień
  pomijane);
- `skipObjectives` = zagadnienia `complete`;
- `fixed` = ćwiczenia **wszystkich** zagadnień z punktu kontrolnego (także
  `incomplete`/`failed` — ich ćwiczenia zostają, podagent uzupełnia braki;
  `objectiveStatus` liczy `fixed`);
- `initialExamples` = przykłady z punktu kontrolnego (`planExamples` i
  przykłady zagadnień) — wchodzą do stanu jak przykłady planu, więc liczą się
  do statusu i są źródłami ujawnień; `submitExamples` zachowuje się wobec nich
  jak wobec przykładów już przyjętych w tej samej próbie (bez zmian względem
  etapu 1);
- `initialSpentUsd` = `budgetSpentUsd`.

**„Ponów” rodzica** (`retryGeneration` dla runu puli lekcji) zostawia
`agent_checkpoint`, a w tej samej transakcji zeruje `budgetSpentUsd` (świeży
budżet na świadomą decyzję rodzica; `totalSpentUsd` zostaje). Szkic między
porażką a „Ponów” się nie zmienił (edycja unieważnia run i „Ponów” kończy się
`conflict`), więc ćwiczenia punktu kontrolnego są nadal zgodne ze szkicem.
Ponowienie po twardej awarii workera (run w `running`) przechodzi tą samą
ścieżką.

Nowy run (nowa generacja, dogenerowanie) startuje bez punktu kontrolnego.

### 8.4. Budżet

Budżet `UMIEM_LESSON_AGENT_RUN_BUDGET_USD` obejmuje wszystkie automatyczne
próby runu (przez `budgetSpentUsd`). Planowanie zagadnień szkoły
(`generateLessonObjectives`, `LlmProvider`) jest poza licznikiem agenta —
koszt zapisuje jego adapter w `UsageRecorder` jak dziś.

## 9. Wynik próby

Po powrocie kierownika (bez wyjątku) ścieżka liczy wynik funkcją czystą
`lessonAgentRunOutcome(result, attempts, maxAttempts)`:

| Warunek | Wynik |
|---|---|
| `planStatus = plan_failed`, kod przejściowy (`classifyLessonGenerationFailure(…).retryable`), `attempts < MAX_AUTOMATIC_ATTEMPTS` | `requeue` (opóźnienie `lessonRetryDelayMs`) |
| `planStatus = plan_failed` w pozostałych przypadkach | `failed` z kodem planu (`validation`, gdy plan nigdy nie przeszedł bramek) |
| któreś zagadnienie `failed` z kodem przejściowym i `attempts < MAX_AUTOMATIC_ATTEMPTS` | `requeue` — punkt kontrolny zapisany (§8.2 pkt 3) |
| w pozostałych przypadkach, łącznie ≥ 1 przyjęte ćwiczenie (punkt kontrolny + próba) | `finalize` — zapis do szkicu (§10), `succeeded` |
| łącznie 0 przyjętych ćwiczeń | `failed` z kodem `validation` (zapis liczników do kontekstu jak `failValidation` potoku) |

Kod `failed` przy wyczerpanych próbach z błędem dostawcy i zerem ćwiczeń =
`attempts_exhausted`, jak potok. Zagadnienia `incomplete` (termin, budżet,
kroki) nie powodują ponowienia. Braki rodzic widzi w istniejących plakietkach
pokrycia etapów (`stageCoverage`) i dogenerowuje zagadnienie.

Log zakończenia: `[lesson-agent] run=… outcome=<requeue|finalize|failed>
complete=… incomplete=… failed=… accepted=… spentUsd=… attempt=…` — bez treści.

## 10. Wspólny zapis do szkicu

Z transakcji końcowej `executeLessonGeneration` (blokada wersji i runu,
straże, kolizje z historyjką, słowa kluczowe bez rodziny,
`applyLessonExercises`, `lessonContext`, `reconcileDraftAssetsTx`, podbicie
`editNumber`, `supersedeLessonRuns`, kolejka historyjki, stan `review`,
`succeeded`) wydzielam funkcję:

```ts
finalizeLessonPoolWrite(services, args: {
  runId; attempts; expectedEditNumber; deckVersionId; subject; topicVersion;
  regenerate: boolean;
  existingDrafts: readonly LessonExerciseDraft[];
  accepted: readonly LessonExerciseDraft[];
  context: { dynamicTopic?; newExamples; rejectedCount; rejectedReasons; droppedObjectiveCount };
  review?: (tx, versionId, previous, saved) => Promise<LessonReviewReport>;   // tylko potok
  assertFinalizationAllowed: () => void;
}): Promise<"succeeded" | "failed_validation" | "superseded" | "gone">
```

Potok woła ją bez zmiany zachowania (istniejące testy `lesson-drafts` i
integracyjne przechodzą bez zmian). Ścieżka agenta:

- `accepted` = ćwiczenia wszystkich zagadnień z punktu kontrolnego
  uzupełnionego wynikiem tej próby (po usunięciach bezpiecznika; w pamięci, bez
  dodatkowego zapisu), w kolejności lekcji; w trybie `add` — tylko nowe
  ćwiczenia (szkic zostaje, jak dziś przy dogenerowaniu);
- `existingDrafts` = szkic (tryb `add`) albo puste (pula);
- `context.newExamples` = przykłady zagadnień (plan albo `submit`; tryb `add` —
  brak);
- `context.rejectedCount` = liczba odrzuceń agenta (`rejections.length`,
  łącznie z punktem kontrolnym); `rejectedReasons` bez zmian — kody agenta są
  angielskimi kodami dla modelu, a lista powodów rodzica opisuje sprawdzanie
  słów z materiału;
- bez `review` — raport krytyka w kontekście zostaje bez zmian.

Reguła ujawnień, deduplikacja i walidacja puli działają już w kierowniku
(przyjmowanie i kontrola końcowa), więc ścieżka agenta **nie** woła
`acceptFreshLessonPool`, `resolveGenerationLeaks`, krytyka ani rundy pod etap.
Kolizje z historyjką (tryb `add` do lekcji z historyjką) sprawdza wspólny
zapis jak dziś.

## 11. Prywatność i panel rodzica

**Do modeli** (bez zmian względem potoku i etapu 1 §11): generator — materiał,
polecenie, tematy zdań (gramatyka, ogrodzony blok danych), zdania do unikania,
karty i przykłady; checker — widok ćwiczenia, liczba odpowiedzi, odpowiedź i
warianty (sędzia), a w szkole materiał. Nigdy imię, rok urodzenia,
identyfikatory ani odpowiedzi dziecka.

**Logi:** `[lesson-agent]` i `[lesson]` — liczniki, kody, statusy, slugi
zagadnień, koszty; bez treści ćwiczeń, materiału, kart, tematów i `detail`.

**Panel rodzica.** `SubjectCatalogDto` dostaje opcjonalne pole
`checkService?: string` (niepuste, jak `reviewService`) i pole przedmiotu
`agentGenerated?: true`. `NewLessonForm` i `SourcePage` pokazują przy
przedmiocie z `agentGenerated` komunikat `messages.lessons.checkServiceInfo`:
„Gotowe ćwiczenia trafiają też do drugiego modelu, który rozwiązuje je na
próbę ({service}). Nie wysyłamy do niego imienia, wieku ani odpowiedzi
dziecka.” Komunikat o usłudze generującej (`generationService`) zostaje; przy
przedmiocie z agentem jego wartość opisuje model agenta
(`UMIEM_LESSON_AGENT_MODEL`).

**API → MCP → `SKILL.md`:** zmiana dotyczy wyłącznie katalogu przedmiotów
panelu rodzica (pola opcjonalne, wstecznie zgodne). Generowanie lekcji, katalog
i koszty nie są wystawione w MCP ani w `learning-overview`, więc MCP i
`SKILL.md` bez zmian — uzasadnienie w opisie PR.

## 12. Testy

**Jednostkowe:**

- adapter (`MockLanguageModelV4`, `simulateReadableStream`): limit kroków,
  `shouldStop`, `maxRetries: 0`, koszt i `UsageRecorder.record` raz na
  żądanie (także nieudane — `outcome: "failed"`, `RunCostSink` `null`),
  przerwanie sygnałem, parsowanie i `null` checkera, `reasoning.effort` w
  opcjach — testy próby przeniesione i rozszerzone o `UsageRecorder`;
- `lessonAgentFromEnv` / `lessonAgentPublicFromEnv`: pusta lista, brak klucza
  (ostrzeżenie), klucz wspólny i `UMIEM_LLM_API_KEY` z OpenRouter, nieznany
  przedmiot, przedmiot bez polityki, ta sama rodzina modeli, niepoprawne
  liczby, `UMIEM_FAKE_PROVIDERS`;
- `lessonGeneratorFor`, `lessonAgentRunOutcome` (tabela §9, każdy wiersz),
  `addModeStatus`;
- kierownik w trybie `add` (fake'i etapu 1): tylko wybrane zagadnienie,
  komplet po `count` nowych, `fixed` z całej lekcji jako źródło ujawnień,
  przykłady stałe, `planner` odrzucony;
- schemat punktu kontrolnego: poprawny, uszkodzony → brak.

**Architektury:**

- `tests/ai-sdk-scope.test.ts`: SDK dozwolony w `tests/probes/` i w jednym
  pliku `packages/server/src/providers/openai/lesson-pool-agent.ts`;
  manifest `packages/server` może deklarować `ai` i `@openrouter/ai-sdk-provider`
  (dokładne wersje), pozostałe manifesty nie; dowód czułości dla drugiego pliku
  w `providers/`;
- `usage-recording.architecture.test.ts`: wykrywanie importu SDK, adapter w
  `PAID_ADAPTERS`;
- `module-boundaries.architecture.test.ts` i testy domeny lekcji bez zmian
  (domena nie importuje SDK).

**Integracyjne (Postgres, fake'i etapu 1 przez `GenerationDeps.lessonAgent`),**
nowy plik `lesson-agent-generation.integration.test.ts` w najlżejszym koszu
`INTEGRATION_BUCKETS`:

1. pełna generacja rozdziału (planer) → szkic z ćwiczeniami, `dynamicTopic`,
   przykładami, `editNumber + 1`, run historyjki w kolejce, `succeeded`;
2. gramatyka (katalog) i szkoła (`generateLessonObjectives` z fake'a LLM);
3. przejściowy błąd dostawcy jednego zagadnienia → `queued` z
   `nextAttemptAt`, punkt kontrolny z gotowymi zagadnieniami; kolejna próba nie
   woła gotowych zagadnień ani planera, przenosi wydatek, kończy zapisem;
4. wyczerpane próby → zapis części, `succeeded`;
5. budżet wyczerpany → zapis części bez ponowienia;
6. zero przyjętych → `failed`/`validation`, liczniki w kontekście;
7. edycja rodzica w trakcie → zapis punktu kontrolnego odrzucony, run
   `superseded`, szkic bez zmian;
8. `shutdown` → `queued`, punkt kontrolny zostaje;
9. „Ponów” rodzica po porażce → punkt kontrolny zostaje, budżet wyzerowany;
10. dogenerowanie +N → N nowych ćwiczeń dopisanych, szkic nietknięty,
    kolizja z historyjką odrzucona;
11. przedmiot spoza listy → potok (fake LLM `generateLessonPool` wołany, agent
    nie);
12. zapis kosztów: zdarzenia `UsageRecorder` w zakresie runu (fake recorder).

**E2E:** pełny `pnpm test:e2e:shards` przed PR (zmiana panelu rodzica i
wspólnego zapisu). Nowy przypadek w istniejącym specu formularza lekcji
(`mocked`): komunikat `checkServiceInfo` przy przedmiocie z `agentGenerated`.

**Płatne przebiegi:** brak w etapie 2a (pomiar to etap 3). Opcjonalny jeden
przebieg kontrolny ścieżki zintegrowanej tylko na wyraźne polecenie
właściciela.

## 13. Dokumentacja

- `docs/architecture.md` §19.17 — ścieżka agenta, punkt kontrolny, wynik próby,
  tryb „dodaj N”, przełącznik per przedmiot; §23 — operacje kosztów agenta;
- `docs/provider-config.md` i `.env.example` — `UMIEM_LESSON_AGENT_*`, klucz,
  rodziny modeli;
- `AGENTS.md` — zdanie o `ai`/`@openrouter/*` („wyłącznie w `tests/probes` i w
  jednym pliku adaptera”) oraz punkt o agencie w sekcji prywatności (usługa
  checkera, punkt kontrolny bez danych dziecka);
- `docs/SPEC.md` — bez zmian (zachowanie dla rodzica bez nowych wymagań poza
  informacją o usłudze).

## 14. Ryzyka i rozstrzygnięcia

| Ryzyko | Rozstrzygnięcie |
|---|---|
| Run trwa dłużej niż termin kontrolera | Termin kierownika = termin runu; zagadnienia w toku `incomplete`, zapis części |
| Utracony zapis punktu kontrolnego (np. błąd bazy) | Wyjątek haka → run rozliczony jak błąd (ponowienie); powtórzona praca, bez utraty szkicu |
| Wznowienie z innym materiałem | Niemożliwe: wejście runu niezmienne, edycja szkicu unieważnia run |
| Rozjazd ścieżek po zmianie listy przedmiotów | Wybór przy każdej próbie; potok ignoruje punkt kontrolny |
| Koszt nieznany z OpenRouter | Szacunek `unknownCallEstimateUsd` w budżecie; `UsageRecorder` bez `providerCostUsd` |
