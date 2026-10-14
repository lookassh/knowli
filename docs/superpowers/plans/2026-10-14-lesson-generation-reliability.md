# Naprawa generowania lekcji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Naprawić sześć zgłoszonych grup błędów generacji Present Simple i ograniczyć czas oczekiwania oraz bezcelowe ponowienia, zachowując wiarygodną samodzielność prób i treść szkicu.

**Architecture:** Poprawiamy obecny moduł lekcji i adapter LLM. Przedmiot wybiera deduplikację ćwiczeń i określa reguły gramatyczne; silnik zachowuje kontrolę ekspozycji odpowiedzi. Zapis workera uczestniczy w optimistic locking, a wykonanie ma deadline, kontrolę aktualności i trwałe odroczenie przejściowych błędów.

**Tech Stack:** TypeScript strict, Zod, PostgreSQL/Drizzle, Node fetch/AbortSignal, Vitest, Playwright, pnpm `10.34.6`.

**Spec:** [Projekt naprawy](../specs/2026-10-14-lesson-generation-reliability-design.md), [źródłowy audyt](../reviews/2026-10-14-lesson-generation-deep-review.md), `.kiro/specs/grammar-module/requirements.md`, `docs/architecture.md` §19.

**Status:** Plan zaakceptowany przez właściciela 2026-10-14; rozpoczęto wykonanie przez bieżącego agenta. Projekt/plan acceptance nie zmienia PR #58 i nie upoważnia do squash-merge ani deploymentu.

## Global Constraints

- UI i dokumentacja po polsku, branding **Umiem!**; identyfikatory, kod i DTO po angielsku.
- Przedmiot dostarcza reguły przez `SubjectModule`; silnik i adapter nie zawierają warunków `subjectId === "english_grammar"` ani wiedzy o Present Simple.
- Opublikowana treść, zakończone oceny, ekspozycje i wydane zadania są niezmienne. Nie przeliczamy ani nie przepisujemy historii.
- Zachowujemy `target_key` i kwalifikację według wcześniejszego ujawnienia odpowiedzi. Powtórzona odpowiedź nie staje się niezależna tylko dlatego, że ma nowy bodziec.
- Pokrycie publikacji pozostaje **3 prowadzone / 4 produktywne / 2 tłumaczenia na cel**; domyślna pula i rozkład etapów pozostają bez zmian.
- Gramatyka pozostaje bez TTS; słówka zachowują swoje media i ocenianie.
- Materiał rodzica to dane; sekretów, surowych body błędów HTTP i danych dzieci nie logujemy. Testy używają fikcyjnego materiału, bez płatnych wywołań.
- Zewnętrzne wywołanie zawsze poza transakcją; kolejność blokad finalizacji/retry/edycji: wersja → run. CAS sprawdza także tożsamość wykonania.
- DTO i `schemaVersion` bez nowych pól; istniejące `409 conflict` i string `errorCode` obsługiwane przez rodzica. Raport MCP nadal wyklucza lekcje.
- Każda zmiana zachowania: znaczący test, odczytane **RED → minimalna zmiana → GREEN**, zapis dowodów i selektywny commit. Historyczne zielone logi nie są dowodem.

## Review Focus

1. Różne cele ze wspólną odpowiedzią `does`: poprawne zadania zostają, ujawnienie nadal wyklucza samodzielność — testy zadania 1.
2. Alternatywny provider zwraca `null`, błędną kopertę albo ignoruje AbortSignal: odrzucamy wadliwy element/kończymy wykonanie bez kolejnej partii i późnego zapisu — zadania 3, 5, 6.
3. Dwie przeglądarki lub dwa workery na starej edycji: żadnej utraty nowych ćwiczeń, żadnego ponownego zapisu zakończonego runu — zadanie 4.
4. Poprawne `Retry-After` dłuższe od domyślnego backoffu oraz 429 quota: respektujemy termin, nie blokujemy slotu i nie mnożymy błędów trwałych — zadanie 5.
5. Długi LLM i aktywna praca mediów: ograniczenia współbieżności, uczciwy dobór, brak nakładających się przelotów i zwolnienie zasobów przy shutdown — zadania 6–7.

## Mapa plików i odpowiedzialności

| Obszar | Istniejące / nowe pliki |
| --- | --- |
| Tożsamość ćwiczeń | `domain/lessons/types.ts`, `pool-validation.ts`, nowy `exercise-identity.ts`, `subjects/english-grammar/module.ts` |
| Semantyka gramatyki | `subjects/english-grammar/prompts.ts`, `validators.ts`; istniejący temat i normalizator |
| Żądanie i odpowiedź LLM | `ports/ai.ts`, nowy `ports/generation-error.ts`, `providers/openai/llm.ts`; nowy `providers/openai/lesson-pool-schema.ts` |
| Zapis i bieżący run | `modules/lessons/lesson-drafts.ts`, `lesson-api.ts`, `modules/generation.ts` |
| Kontrola wykonania | nowy `modules/lessons/lesson-generation-control.ts`, nowy `lesson-generation-policy.ts`, `config.ts`, `providers/generation-env.ts` |
| Retry / dane | nowy `modules/lessons/lesson-generation-errors.ts`, `db/schema.ts`, migracja `drizzle/0009_lesson_generation_retry.sql` i metadata |
| Proces workera | `apps/worker/src/main.ts`, `tasks.ts`, nowy `loop.ts`; `packages/server/src/index.ts` dla użytych publicznych eksportów pakietu |
| Rodzic | `apps/web/src/parent/lessons/LessonEditor.tsx`, `packages/contracts/src/messages.ts` |

Ścieżki bez prefiksu w pierwszych sześciu wierszach tabeli są względem `packages/server/src/`, migracje względem `packages/server/`. Pliki testów i dokumenty podano przy zadaniach. Wyodrębniamy tylko schemat i kontrolę wykonania, bez ogólnego frameworka providerów.

## Zależności i rozpoczęcie

Kolejność: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**. Zadania 1–3 uzgadniają jakość treści; 4 chroni zapisy i dostarcza warunki anulowania; 5 definiuje błędy, które 6 i 7 wykorzystują. Nie rozdzielać edycji tych samych plików między wykonawców.

### Task 0: Przygotowanie wykonania

**Pliki:** odczyt `AGENTS.md`, spec i plan; utworzenie `docs/superpowers/progress/2026-10-14-lesson-generation-reliability.md` dopiero przy wykonaniu.

- [x] Uzyskać przegląd wymaganych artefaktów; użyć `executing-plans` i `using-git-worktrees`. Sprawdzić świeże `origin/main`, merge-base, Git i zakres zmian użytkownika. Utworzyć osobny worktree `feature/lesson-generation-reliability` na `0bb7ca4`; nie kontynuować kodu w PR #58. PR #58 nadal otwarty, baza główna nie zawiera jego zmian. TTS nie jest zależnością kodu tej poprawki; tę różnicę zachować w dzienniku.
- [x] Założyć dziennik. Dostępna wersja skill ma `sdd-workspace`, `task-brief` i `review-package`, ale nie ma skryptów `task-start` ani `task-done`. Na Windows używać `C:\Program Files\Git\bin\bash.exe` do istniejących skryptów, a rozpoczęcie/zakończenie zadania, pełne wyniki i zakres commitów zapisywać w ledgerze jako równoważny dowód.
- [x] Potwierdzić `pnpm --version`, istniejące skrypty i Docker PostgreSQL. Uruchomić baseline `pnpm test:unit`, `pnpm test:integration`, `pnpm typecheck`; rozdzielić istniejące problemy od nowych. Nadać unikalny `UMIEM_TEST_RUN_ID` i port E2E zgodnie z istniejącym runnerem. Unit 98/979 i typecheck PASS. Integration nie wystartowało: Docker daemon niedostępny (`dockerDesktopLinuxEngine` pipe); szczegół w ledgerze.
- [x] Zmierzyć baseline fake dla identycznego materiału i 1/3/7 celów, bez zmiany kodu produktu: czas runu, liczba wywołań, liczba przyjętych/odrzuconych i pokrycie. Zachować parametry i seed do porównania w zadaniu 7; wynik oznaczyć jako pomiar testowego providera. Wyniki w `.superpowers/sdd/2026-10-14-lesson-generation-reliability/progress.md`.

Nie uruchamiać komend testowych tego planu podczas jego sporządzania; stan checkboxów opisuje przyszłe wykonanie.

### Task 1: Deduplikacja zadań bez zmiany samodzielności

**Pliki:** nowe `packages/server/src/domain/lessons/exercise-identity.ts` i `.test.ts`; modyfikacja `types.ts`, `pool-validation.ts` i `.test.ts`, `subjects/english-grammar/module.ts`, `ports/ai.ts`, `providers/openai/llm.ts` i `.test.ts`, `modules/lessons/lesson-drafts.ts`, `providers/fake.ts`; testy `tests/integration/lesson-generation.test.ts`, `lesson-parent-api.test.ts`, `lesson-attempts.test.ts`, `domain/lessons/scheduler.test.ts`.

**Interfaces:**
- `SubjectModule.poolDeduplication?: "answer" | "exercise"`, domyślnie `answer`, gramatyka `exercise`.
- `lessonExerciseIdentity(ex: LessonExerciseDraft): string` — cel + typ + bodziec z D1, bez technicznych ID i wariantów prezentacji.
- `LessonPoolInput.deduplication?: "answer" | "exercise"` i `existingExercises?: readonly { objectiveId: string; exerciseType: string; stimulus: string }[]`. Istniejące `existingAnswers` pozostaje dla polityki `answer`; dawne runy gramatyki odczytują bieżące ćwiczenia zamiast traktować je jako zakazane odpowiedzi.
- `validatePool(...)` nadal zwraca `{valid,rejected}`; nie zmieniać kontraktu oceny ani `computeTargetKey`.

- [x] RED: dodać `keepsEightDifferentAuxiliaryGaps` z ośmioma reprodukcjami question/negative/short_answers; oczekiwać 8 valid i 4 produktywnych short_answers. `rejectsRepeatedStimulusDespiteOptionIdsOrChangedAnswer` oczekuje odrzucenia tego samego bodźca. `keepsAnswerPolicyForHistorySubject` dowodzi zgodności innych przedmiotów. RED: 4/8 luk zachowane, powtórzony bodziec akceptowany, tożsamość nie istnieje; zapisy z logu.
- [x] RED: `sameDoesExposureIsStillAssistedInAnotherObjective` i regresja schedulera sprawdzają brak niezależnego sukcesu po ujawnieniu tej samej odpowiedzi; R01/R05. Test żądania LLM sprawdza opisy istniejących ćwiczeń i brak zakazu powtarzania `does` przy polityce exercise. RED zarejestrowany dla dwóch walidatorów; test kontroli ekspozycji zachowany jako zielony istniejący kontrakt.
- [x] Wprowadzić politykę i jedną funkcję tożsamości, używaną przy walidacji, porównaniu z istniejącym szkicem i promptach. Rozdzielić porównanie ćwiczeń od równoważności odpowiedzi. Nie wyłączać deduplikacji w całości; nie zmieniać identyfikacji celów ekspozycji.
- [x] GREEN: unit 99/986, typecheck PASS. Integracje `lesson-generation`, `lesson-parent-api`, `lesson-attempts` nie mogły wystartować z powodu niedostępnego Docker Desktop; nie deklaruję ich jako zielonych. Uaktualnić wymagania unikalności w `.kiro/specs/grammar-module/design.md` i `docs/architecture.md` §19; usunąć twierdzenie, że niewidziane ćwiczenie zawsze oznacza nieujawnioną odpowiedź.
- [x] Zapisać dowody i commit `fix(lessons): deduplicate exercises instead of grammar auxiliaries`.

### Task 2: Polski bodziec tłumaczenia i walidacja całej luki

**Pliki:** `packages/server/src/domain/lessons/subjects/english-grammar/prompts.ts`, `validators.ts` i `.test.ts`; `providers/openai/llm.ts` i `.test.ts`; `modules/lessons/lesson-materialize.test.ts`; `tests/integration/lesson-generation.test.ts`, `lesson-parent-api.test.ts`; `.kiro/specs/grammar-module/requirements.md`, `docs/architecture.md`.

**Interfaces:** istniejące `SubjectPromptProfile.fieldRules` i `validateEnglishGrammarExercise(ex: LessonExerciseDraft, topic: LessonTopic): string[]`. Reguły operatora i tłumaczenia pozostają w przedmiocie, nie w silniku.

- [x] RED: `translationUsesPolishStimulusInProviderRequest` sprawdza kontrakt języków i poprawny przykład PL→EN w body adaptera; `translationCannotUseCanonicalOrAcceptedAnswerAsStimulus` sprawdza prompt równy odpowiedzi i wariantowi po normalizacji. RED: obie odmiany operatorowej luki, wyciek odpowiedzi i sprzeczny prompt systemowy odtworzone.
- [x] RED: tabelaryczne `auxiliaryGapWithHintUsesCompletedSentence` sprawdza does not/doesn't + do + `She ___ play tennis.` valid; `She ___ plays tennis.` invalid; plays/play valid; `Yes, he ___.` + does valid; hint po polsku invalid. RED: operatorowe luki i prompt translation field rules.
- [x] Zastąpić sprzeczną regułę językową, dopisać profil tłumaczenia i wariantów luki. Walidator sprawdza przypadki operatorowe według roli luki i celu oraz podstawionego zdania, nie wymaga czasownika głównego w samej odpowiedzi operatorowej. Deterministyczny guard `prompt ≠ answer/accepted variant`; nie deklarować pełnego wykrywania języka.
- [x] GREEN: wskazane testy 3/22 PASS; pełne unit 99/996 PASS; typecheck PASS. Integracje `lesson-generation` i `lesson-parent-api` nie wystartowały z powodu niedostępnego Docker Desktop. Sprawdzono warianty skrótów normalizatorem i prywatność Kid DTO; uaktualniono profile i dokumenty.
- [x] Zapisać dowody i commit `fix(grammar): align translation prompts and auxiliary gap validation`.

### Task 3: Schemat konkretnej partii i strażnik przed dereferencją

**Pliki:** nowy `packages/server/src/providers/openai/lesson-pool-schema.ts` i `.test.ts`; `llm.ts` i `.test.ts`; `packages/server/src/modules/lessons/lesson-drafts.ts` i `.test.ts`; `tests/integration/lesson-generation.test.ts`; `ports/ai.ts` tylko jeżeli potrzebne doprecyzowanie istniejącego wejścia.

**Interfaces:** `lessonPoolJsonSchema(input: LessonPoolInput): Record<string, unknown>` w wydzielonym pliku; `isWellShapedRawExercise(raw: unknown)` pozostaje wspólną bramką przed konwersją.

- [ ] RED: `schemaAllowsOnlyBatchObjectiveTypes` dla celu third_person_s nie dopuszcza lesson_transform, lesson_card ani obcego objectiveId; `schemaPairsTypesWithObjectiveInMultipleObjectiveRequest` sprawdza powiązane gałęzie wewnętrzne. `emptyAllowedTypesFailsBeforeFetch` oczekuje zero HTTP. Testy obejmują enum przykładów i transformId, wszystkie required/additionalProperties/nullable oraz pozytywne wyniki każdej dozwolonej gałęzi. Użyć walidacji struktury i próbek JSON, nie samego snapshotu tekstu schematu; ewentualny walidator testowy pozostaje dev-only.
- [ ] RED: integracyjne `nullExerciseDoesNotRetryWholeRun` z `[validGap,null]` oczekuje succeeded, jednej zapisanej rewizji, rejectedCount=1, jednej próby. Osobne próbki: null options/items/acceptedAnswers/focus; zły top-level exercises rozlicza run jako validation/provider_output zamiast TypeError. Uruchomić `pnpm test:unit packages/server/src/providers/openai/llm.test.ts packages/server/src/providers/openai/lesson-pool-schema.test.ts packages/server/src/modules/lessons/lesson-drafts.test.ts` i `pnpm test:integration tests/integration/lesson-generation.test.ts`.
- [ ] Wydzielić generator schematu i zawęzić go do danych żądania (D3). Sprawdzać kształt elementu przed odczytem answer/advisory oraz przed tablicami; wadliwy element policzyć tylko raz. Prompt, schema i serwer korzystają z tych samych dozwolonych typów, przy zachowaniu walidacji semantycznej.
- [ ] GREEN: wskazane suite; `pnpm test:unit packages/server/src/domain/lessons/architecture.test.ts` potwierdza brak sprzężenia z gramatyką. Sprawdzić fixture historii oraz istniejące strict output z nullami. Udokumentować zgodność OpenAI i brak dowodu live alternatywnego endpointu.
- [ ] Zapisać dowody i commit `fix(lessons): constrain generated batches and reject malformed items safely`.

### Task 4: Atomowy numer edycji i rezerwacja top-upu

**Pliki:** `packages/server/src/modules/lessons/lesson-drafts.ts`, `lesson-api.ts`, `packages/server/src/modules/generation.ts`; `apps/web/src/parent/lessons/LessonEditor.tsx`; `tests/integration/lesson-generation.test.ts`, `lesson-parent-api.test.ts`; nowy `tests/e2e/lesson-generation-conflicts.spec.ts`; komunikaty wyłącznie w `packages/contracts/src/messages.ts`.

**Interfaces:** sygnatury `regenerateObjective`, `editLessonDraft`, `publishLessonDraft`, `retryGeneration` i DTO pozostają. Rezerwacja active run pod blokadą wersji; powtórzony clientRequestId idempotentny. Worker po zapisie zwraca stan przez istniejący GET z nowym editNumber.

- [ ] RED PostgreSQL: `stalePatchCannotDeleteWorkerTopUp` przechowuje formularz N, wykonuje top-up, oczekuje N+1 i 409 dla PATCH N; po odmowie wszystkie nowe ćwiczenia i przykłady zostają. `stalePublishDoesNotPublishWorkerChangesUnreviewed` oczekuje 409, dopóki rodzic nie odczyta nowej edycji.
- [ ] RED PostgreSQL: `onlyOneActiveGenerationPerDraft` używa dwóch równoległych requestów różnych kluczy (jeden run, drugie 409); `sameRequestReturnsSameRunWhileActive` potwierdza idempotencję. `legacyConcurrentTopUpsAreSuperseded` tworzy dawne zlecenia z jednej edycji: tylko pierwsze zapisuje, kolejne superseded. `parentEditWinsWithoutLateOverwrite`, `retryDoesNotAcceptOldAttempt` i `finishedRunDoesNotBumpAgain` korzystają z barier, nie losowych sleepów. Uruchomić `pnpm test:integration tests/integration/lesson-generation.test.ts tests/integration/lesson-parent-api.test.ts`.
- [ ] Finalizacja pod wersja → run atomowo zapisuje ćwiczenia, przykłady, editNumber+1, media i succeeded; deduplikacja wobec aktualnej puli pod tą samą blokadą. Regenerate blokuje wersję przed aktywnym runem; zapis rodzica i zapis workera supersede starsze runy bez rebasingu. Zachować istniejące CAS na próbie i expectedEditNumber.
- [ ] GREEN i E2E dwóch kontekstów: A zostawia lokalną edycję, B dogenerowuje, A zapisuje → konflikt i zachowany formularz; świadome wczytanie aktualnego pokazuje nowe zadania. UI blokuje top-up podczas generating oraz double click refem; wymagania API testowane niezależnie od przycisku. Run: `pnpm test:e2e tests/e2e/lesson-generation-conflicts.spec.ts tests/e2e/lesson-real-flow.spec.ts`. Aktualizować fixture `expectedEditNumber=1` po generacji do faktycznie odczytanej wersji, bez osłabiania asercji.
- [ ] Zapisać dowody i commit `fix(lessons): version worker writes and serialize draft generation`.

### Task 5: Typowane błędy i odroczone, ograniczone ponowienia

**Pliki:** nowe `packages/server/src/ports/generation-error.ts`, `modules/lessons/lesson-generation-errors.ts` i `.test.ts`; `providers/openai/llm.ts` i `.test.ts`; `modules/lessons/lesson-drafts.ts`, `modules/generation.ts`; `db/schema.ts`; migracja `packages/server/drizzle/0009_lesson_generation_retry.sql` + metadata; `tests/integration/lesson-generation.test.ts`, nowy `lesson-generation-retry.test.ts`; `packages/contracts/src/messages.ts`, `apps/web/src/parent/lessons/LessonEditor.tsx`.

**Interfaces:**
- `GenerationProviderError extends Error` z `kind: "configuration" | "rate_limit" | "transient" | "timeout" | "refusal" | "incomplete" | "output"`, opcjonalnymi `status`, `retryAfterMs`, bez surowego body. Wiadomość techniczna to bezpieczny kod.
- `classifyLessonGenerationFailure(error: unknown): { errorCode: string; retryable: boolean; retryAfterMs?: number }`; Zod/domain validation terminalne. Dotychczasowe zachowanie providerów słówek i mediów chronione regresją, bez automatycznego rozszerzania tej polityki na inne porty.
- `lessonRetryDelayMs(attempt: number, retryAfterMs: number | undefined, random: () => number): number` — 1000/2000 ms + 0–20%, nie mniej niż poprawne Retry-After.
- `generationRuns.nextAttemptAt: Date | null`, nieobecne w DTO. Claim i selekcja lesson sprawdzają null lub termin ≤ clock.now, nie tylko odczyt w pollerze.

- [ ] RED adaptera/klasyfikacji: 400/401/403/404/422 → configuration; 429 quota/spend → configuration; rate-limit429/408/5xx → retryable; refusal/content_filter → refusal; finish_reason=length → incomplete także dla parsowalnego JSON; zły JSON/koperta → output. Udowodnić jeden request dla 400 przez prawdziwy adapter z fake fetch, nie przez gotową klasyfikację fake.
- [ ] RED PostgreSQL: `permanent400IsNotRetried`, `retryAfterSurvivesWorkerRestart`, `claimBeforeNextAttemptDoesNotConsumeBudget`, `transientFailsAfterThreeCalls`, `manualRetryClearsDelay`. Kontrolowany zegar i jitter; odroczenie 60 s nie skraca się do 2 s. Wszystkie wyjątki rozliczają run i zachowują treść szkicu. Uruchomić `pnpm test:unit packages/server/src/providers/openai/llm.test.ts packages/server/src/modules/lessons/lesson-generation-errors.test.ts` oraz `pnpm test:integration tests/integration/lesson-generation-retry.test.ts`.
- [ ] Dodać kolumnę Drizzle i wygenerować migrację przez `pnpm --filter @learning/server db:generate --name lesson_generation_retry`; sprawdzić faktyczny numer przy świeżej bazie gałęzi, SQL i metadata (0009 jest numerem obecnego snapshotu). Implementować typowany błąd, klasyfikację i odroczenie bez sleep. Odczytać refusal i finish_reason przed JSON.parse. Dla brakującego finish_reason zgodnego częściowo endpointu akceptować tylko niepustą poprawną kopertę z walidacją; nie ignorować jawnej długości/odmowy. Nie fallbackować automatycznie do json_object.
- [ ] GREEN unit/integracja; test migracji na istniejącej bazie z lesson/deck/media runami: null zachowuje dotychczasową gotowość, deadline nie zmienia historii. `pnpm test:integration tests/integration/generation.test.ts tests/integration/media.test.ts tests/integration/lesson-schema.test.ts` sprawdza regresje R02/R06. Dopisać polskie przyczyny w katalogu komunikatów, bez pokazywania body HTTP.
- [ ] Zapisać dowody i commit `fix(lessons): classify provider failures and persist retry delays`.

### Task 6: Deadline i przerwanie nieaktualnego wykonania

**Pliki:** nowe `packages/server/src/modules/lessons/lesson-generation-control.ts` i `.test.ts`, `lesson-generation-policy.ts` i `.test.ts`; `lesson-drafts.ts`; `config.ts`, `providers/generation-env.ts` i `.test.ts`, `providers/openai/llm.ts` i `.test.ts`; nowy `tests/integration/lesson-generation-cancellation.test.ts`; `.env.example`, `docs/provider-config.md`.

**Interfaces:**
- `GenerationDeps.lessonExecution?: { requestTimeoutMs: number; runTimeoutMs: number; cancelPollMs: number }`, domyślne 90000/600000/1000; istniejące fake deps działają z defaults.
- `executeLessonGeneration(services: Services, runId: string, options?: { signal?: AbortSignal }): Promise<void>`; port `generateLessonPool(input,signal?)` bez zmiany.
- `withLessonGenerationControl<T>(services: Services, execution: { runId: string; attempts: number; expectedEditNumber: number }, work: (control: { assertCurrent(): Promise<void>; call<R>(request: (signal: AbortSignal) => Promise<R>): Promise<R> }) => Promise<T>, signal?: AbortSignal): Promise<T>`.
- `OpenAiLlmOptions.lessonRequestTimeoutMs?: number`; bezpośrednia generacja lekcji ma deadline adaptera także bez caller signal; orchestrator podaje mniejszy pozostały budżet.

- [ ] RED: `hangingRequestEndsAtConfiguredDeadline` i `runBudgetIncludesSeveralBatches` używają fake timers i krótkich testowych wartości, sprawdzają stan failed/provider_timeout, aborted signal, brak automatycznego retry. `providerIgnoringAbortCannotHoldOrWrite` sprawdza kończący się guard, brak kolejnej partii i ignorowanie późnego resolve/reject, bez unhandled rejection. Test deadline obejmuje oczekiwanie na body, nie tylko headers.
- [ ] RED PostgreSQL: `manualRetryAbortsOldBatchAcrossServices`, `parentEditCancelsOldRun`, `supersededQueuedRunDoesNotCallProvider`, `shutdownReturnsCurrentRunToQueueWithMonotonicAttempts`. Dwa niezależne Services/połączenia, bariery i kontrolowany zegar: retry aktualizuje istniejący run/edycję, stary sygnał jest aborted, nowe wykonanie może wygrać, stary wynik niczego nie zmienia. Shutdown nie cofa liczby attempts, aby nowy claim nie odziedziczył tożsamości starej próby. Uruchomić `pnpm test:unit packages/server/src/modules/lessons/lesson-generation-control.test.ts packages/server/src/providers/openai/llm.test.ts packages/server/src/providers/generation-env.test.ts` i `pnpm test:integration tests/integration/lesson-generation-cancellation.test.ts`.
- [ ] Zaimplementować guard deadline + poll aktualności, złożony AbortSignal, sprawdzenia przed/po każdej partii i końcowy CAS z zadania 4. Shutdown bez nowego retry rodzica oddaje bieżący nadal aktualny run do queued, bez nowego wpisu treści i bez resetu attempts; wykorzystana próba pozostaje w budżecie. Retry z web zwiększa edycję i zmienia tożsamość wykonania, więc stary worker nie zmienia stanu nowej próby. Usuwać wszystkie timery/listenery w finally; nie trzymać transakcji podczas sieci.
- [ ] GREEN wskazanych suite; sprawdzić walidację env (0, NaN, ujemne, request > run), niezależność gradera i brak tokenów w logach. Dopisać ustawienia oraz możliwe naliczenie po timeout do `.env.example` i `docs/provider-config.md`.
- [ ] Zapisać dowody i commit `fix(lessons): bound generation and cancel stale executions`.

### Task 7: Postęp innych zadań i diagnostyka czasu

**Pliki:** `packages/server/src/modules/generation.ts`, `packages/server/src/modules/lessons/lesson-drafts.ts`, `packages/server/src/index.ts`; `apps/worker/src/main.ts`, `tasks.ts`, nowy `loop.ts` i `.test.ts`; nowy `tests/integration/lesson-worker-fairness.test.ts`; `.env.example`, `docs/provider-config.md`.

**Interfaces:** `runDueGenerationWork(services, limits?, options?: { signal?: AbortSignal }): Promise<{processed:number}>`; `processDueWork(services: Services, signal?: AbortSignal)` przekazuje sygnał. `createWorkerLoop({ pollMs, staleMs, processPass: (signal: AbortSignal) => Promise<void>, now: () => number }): { stop(): Promise<void>; health(): { healthy: boolean; lastPassAt: number | null; passStartedAt: number | null } }` — proste sterowanie bieżącą pętlą, bez frameworka zadań.

- [ ] RED: `pendingLessonDoesNotBlockOtherLessonOrVocabularyMedia` uruchamia przelot z jednym kontrolowanie zatrzymanym LLM; drugie zadanie kończy się przed jego zwolnieniem/deadline. Kolejna konfiguracja dwóch rodzajów pracy potwierdza brak starvation mediów. `limitsHoldAcrossTaskKinds` oczekuje peak ≤2 oraz images≤1 w procesie, bez równoległych partii jednej lekcji. Faktyczna praca PostgreSQL/fake providerów, nie tylko mock wywołania dispatchera.
- [ ] RED loop: 10 ticków podczas jednej długiej pracy nie tworzy 10 przelotów; stop abortuje bieżący sygnał i nie startuje następnej pracy. Health: healthy idle/working, niezdrowy po 900000 ms od początku aktywnego przelotu lub ostatniego zakończenia; brak fałszywego 503 przed pierwszym pollingiem (początek pętli jako punkt odniesienia). Run `pnpm test:unit apps/worker/src/loop.test.ts` i `pnpm test:integration tests/integration/lesson-worker-fairness.test.ts`.
- [ ] Wprowadzić scheduler bieżących zadań z dwoma slotami i sprawiedliwym doborem rodzajów, zachowując CAS, per-draft rezerwację i limit obrazu. Następny poll po ukończeniu przelotu. `/health` wykorzystuje wynik loop i zwraca 200/503 (nieznana ścieżka nadal 404); dodać `WORKER_HEALTH_STALE_MS=900000` i walidację dodatniego progu. Zamknięcie procesu przerywa pracę i domyka pool po rozliczeniu.
- [ ] GREEN i test logów: wyłącznie kody, liczby i czasy; żadnego body HTTP, materiału ani sekretu. Zmierzyć 1/3/7 celów na kontrolowanym fake providerze: liczba calli, przyjęte/odrzucone, kolejka, czas batch/run, postęp TTS słówek. Wynik zapisać jako fake, bez wniosku o szybkości żywego modelu.
- [ ] Zapisać dowody i commit `fix(worker): keep generation polling bounded and fair`.

### Task 8: Pełna akceptacja, niezależne review i końcowy PR

**Pliki:** `tests/e2e/lesson-real-flow.spec.ts` i konflikty; `docs/SPEC.md`, `docs/architecture.md`, `.kiro/specs/grammar-module/{requirements,design}.md`, `docs/provider-config.md`, dziennik i końcowy raport review. API/MCP tylko w razie rzeczywistego wpływu ustalonego poniżej.

- [ ] Dopiąć E2E: rodzic tworzy Present Simple obejmujące question/negative/short_answers, ogląda poprawne polskie tłumaczenia i powtarzalne operatory, zapisuje aktualną edycję, publikuje, dziecko odpowiada bez mikrofonu/głośnika, reload zachowuje zadanie, rodzic czyta wynik. Fixture przechodzi rzeczywisty adapter/worker/domain, zamiast bypassu walidacji lub samych insertów gotowej puli. Odrębne przypadki 400, timeout i konflikt pokazują właściwy polski komunikat.
- [ ] Uruchomić aktualne `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`, `git diff --check`. Weryfikować R01/R03/R05 dla ekspozycji/historii, R02/R06 dla zachowanych mediów; R04/R07 istniejącą pełną regresją, bez wymyślania nowych prób mowy dla zmiany LLM.
- [ ] API → MCP → skill: sprawdzić użycia zmienionych endpointów/DTO i potwierdzić wykluczenie lekcji z `learning-overview`. Wykonać `pnpm contracts:export-learning-overview --check`, `pnpm test:mcp` i istniejące E2E HTTP MCP. Jeśli brak wpływu, zapisać dowód/uzasadnienie; jeśli jest wpływ, ten sam zakres obejmuje adapter, walidację, schema i skill oraz plan aktualizacji konsumenta. Nie twierdzić, że wdrożono Hermesa.
- [ ] Uaktualnić dokumentację i kryteria D1–D7/A1–A12. Sprawdzić migrację istniejącej i pustej bazy, zgodność starego queued runu, niezmienność opublikowanych wersji i brak audio gramatyki (`grammar-without-tts.test.ts`). Zanotować, że pełny run wciąż może ponawiać wcześniejsze partie po błędzie przejściowym późniejszej partii, bo checkpointy są poza zakresem.
- [ ] Użyć `requesting-code-review`: dedykowany reviewer na najbardziej zaawansowanym dostępnym modelu poza GPT Astra, jawnie podany model/effort. Przegląd **całego** BASE_SHA..HEAD + uncommitted diff, spec, plan, Review Focus, logi testów i odstępstwa. `receiving-code-review`: potwierdzić uwagi, Critical/Important naprawić z RED→GREEN, Minor zapisać; po poprawkach właściwa ponowna weryfikacja/review.
- [ ] `verification-before-completion` i `finishing-a-development-branch`: po ukończonej implementacji i review wypchnąć osobną gałąź, otworzyć PR do main i dołączyć do czatu. W opisie: wynik, testy, independent review, API→MCP→skill, addytywna migracja next_attempt_at i web+worker. Scala właściciel przez Squash and merge; agent bez osobnego polecenia nie scala ani nie wdraża.

## Pomiar żywego endpointu — oddzielny dowód

Nie jest konieczny do reprodukcji i naprawy błędów domenowych. Po udostępnieniu/autoryzacji testu usługi: ten sam fikcyjny materiał, ten sam model i konfiguracja, po 5 prób dla 1 i 7 celów. Porównać medianę i zakres czasu batch/run, liczby HTTP, poprawne/odrzucone oraz pokrycie publikacji; nie łączyć wyniku z czasem TTS. Pokazać nieudane próby, nie samą najszybszą. Brak tego pomiaru to jawne ograniczenie oceny czasu produkcyjnego, nie powód do uznania napraw za niewykonane.

## Checklista przeglądu planu (wykonana przy sporządzeniu)

- [x] Sześć grup z polecenia: unikalność → 1; tłumaczenie → 2; timeout/retry starego runu → 6–7; stary formularz → 4; schema → 3; 400/null/hint → 5/3/2.
- [x] Każdy nowy interfejs ma zadanie producenta i test; warunki anulowania opierają się na CAS z zadania 4 i kodach z zadania 5.
- [x] Testy obejmują 5 pozycji Review Focus, stare queued runy i dwa realne połączenia PostgreSQL.
- [x] Nie obniżono pokrycia publikacji, nie zmieniono target_key ani definicji samodzielności, nie przywrócono TTS.
- [x] Zapisano wpływ na bazę, endpointy, MCP i rollout; wiadomo, które dowody dotyczą fake i które wymagają żywego endpointu.
- [x] Lokalny przegląd własny treści i ścieżek; brak wdrożenia, testów napraw, commita lub PR dla samego planowania.
- [ ] Zatwierdzenie projektu i planu przed wykonaniem.
