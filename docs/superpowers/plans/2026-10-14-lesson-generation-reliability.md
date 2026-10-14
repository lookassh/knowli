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

- [x] Uzyskać przegląd wymaganych artefaktów; użyć `executing-plans` i `using-git-worktrees`. Sprawdzić świeże `origin/main`, merge-base, Git i zakres zmian użytkownika. Utworzyć osobny worktree `feature/lesson-generation-reliability` na `0bb7ca4`; nie kontynuować kodu w PR #58. Po akceptacji planu właściciel potwierdził wyłączenie TTS dla lekcji gramatycznych; portujemy tę decyzję do obecnego zakresu, PR #58 pozostaje oddzielny i nie jest scalany.
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

- [x] RED: `schemaAllowsOnlyBatchObjectiveTypes` dla celu third_person_s nie dopuszcza lesson_transform, lesson_card ani obcego objectiveId; `schemaPairsTypesWithObjectiveInMultipleObjectiveRequest` sprawdza powiązane gałęzie wewnętrzne. Pierwszy test RED wykazał dodatkowy `lesson_open_answer`, drugi brak powiązania multi-objective `anyOf`. Testy obejmują enum przykładów i transformId, wszystkie required/additionalProperties/nullable oraz pozytywne wyniki każdej dozwolonej gałęzi. `emptyAllowedTypesFailsBeforeFetch` i bramka kształtu przed dereferencją są sprawdzone; testy strukturalne zamiast snapshotów.
- [ ] RED: integracyjne `nullExerciseDoesNotRetryWholeRun` zostało dodane, ale nie można potwierdzić RED/GREEN ani uruchomić integracji: Docker API nieosiągalne (`dockerDesktopLinuxEngine` pipe). Jednostkowy odpowiednik w `lesson-drafts.test.ts` potwierdza zachowanie `[valid, null]`; uruchomić integrację z PostgreSQL po udostępnieniu Docker.
- [x] Wydzielić generator schematu i zawęzić go do danych żądania (D3). Sprawdzać kształt elementu przed odczytem answer/advisory oraz przed tablicami; wadliwy element policzyć tylko raz. Prompt, schema i serwer korzystają z tych samych dozwolonych typów, przy zachowaniu walidacji semantycznej.
- [x] GREEN: pełny `test:unit` 100 plików/1002 testy PASS, `typecheck` PASS, `git diff --check` PASS. Testy architektury są w pełnym suite; fixtures i strict output/null cases sprawdzone. Schemat używa ścisłych obiektów z `additionalProperties:false`, pełnym `required`, nullowalnymi opcjonalnymi polami i wspieranego `anyOf`; nie ma dowodu live alternatywnego endpointu OpenAI. Integracja pozostaje niezweryfikowana z powodu niedostępnego Docker.
- [x] Zapisać dowody i commit `fix(lessons): constrain generated batches and reject malformed items safely`.

### Task 4: Atomowy numer edycji i rezerwacja top-upu

**Pliki:** `packages/server/src/modules/lessons/lesson-drafts.ts`, `lesson-api.ts`, `packages/server/src/modules/generation.ts`; `apps/web/src/parent/lessons/LessonEditor.tsx`; `tests/integration/lesson-generation.test.ts`, `lesson-parent-api.test.ts`; nowy `tests/e2e/lesson-generation-conflicts.spec.ts`; komunikaty wyłącznie w `packages/contracts/src/messages.ts`.

**Interfaces:** sygnatury `regenerateObjective`, `editLessonDraft`, `publishLessonDraft`, `retryGeneration` i DTO pozostają. Rezerwacja active run pod blokadą wersji; powtórzony clientRequestId idempotentny. Worker po zapisie zwraca stan przez istniejący GET z nowym editNumber.

- [ ] RED PostgreSQL: `stalePatchCannotDeleteWorkerTopUp` przechowuje formularz N, wykonuje top-up, oczekuje N+1 i 409 dla PATCH N; po odmowie wszystkie nowe ćwiczenia i przykłady zostają. `stalePublishDoesNotPublishWorkerChangesUnreviewed` oczekuje 409, dopóki rodzic nie odczyta nowej edycji.
- [ ] RED PostgreSQL: `onlyOneActiveGenerationPerDraft` używa dwóch równoległych requestów różnych kluczy (jeden run, drugie 409); `sameRequestReturnsSameRunWhileActive` potwierdza idempotencję. `legacyConcurrentTopUpsAreSuperseded` tworzy dawne zlecenia z jednej edycji: tylko pierwsze zapisuje, kolejne superseded. `parentEditWinsWithoutLateOverwrite`, `retryDoesNotAcceptOldAttempt` i `finishedRunDoesNotBumpAgain` korzystają z barier, nie losowych sleepów. Uruchomić `pnpm test:integration tests/integration/lesson-generation.test.ts tests/integration/lesson-parent-api.test.ts`.
- [x] Finalizacja pod wersja → run atomowo zapisuje ćwiczenia, przykłady, editNumber+1, media i succeeded; deduplikacja wobec aktualnej puli pod tą samą blokadą. Regenerate blokuje wersję przed aktywnym runem; zapis rodzica i zapis workera supersede starsze runy bez rebasingu. Zachować istniejące CAS na próbie i expectedEditNumber.
- [ ] GREEN i E2E dwóch kontekstów: testy integracyjne przygotowane (stary PATCH po top-upie, tylko jeden aktywny run, idempotentny klucz, edycja rodzica unieważnia queued run), ale PostgreSQL i E2E nie uruchomiły się z powodu zatrzymanego Docker Desktop (`com.docker.service` stopped; brak dockerDesktopLinuxEngine). UI ma synchroniczny guard na double click i blokadę przy `generating`; osobny test dwóch kontekstów oraz weryfikacja w bazie pozostają do wykonania po starcie Dockera. Aktualizować fixture `expectedEditNumber=1` po generacji do faktycznie odczytanej wersji, bez osłabiania asercji.
- [x] Zapisać dowody i commit `fix(lessons): version worker writes and serialize draft generation`.

### Task 5: Typowane błędy i odroczone, ograniczone ponowienia

**Pliki:** nowe `packages/server/src/ports/generation-error.ts`, `modules/lessons/lesson-generation-errors.ts` i `.test.ts`; `providers/openai/llm.ts` i `.test.ts`; `modules/lessons/lesson-drafts.ts`, `modules/generation.ts`; `db/schema.ts`; migracja `packages/server/drizzle/0009_lesson_generation_retry.sql` + metadata; `tests/integration/lesson-generation.test.ts`, nowy `lesson-generation-retry.test.ts`; `packages/contracts/src/messages.ts`, `apps/web/src/parent/lessons/LessonEditor.tsx`.

**Interfaces:**
- `GenerationProviderError extends Error` z `kind: "configuration" | "rate_limit" | "transient" | "timeout" | "refusal" | "incomplete" | "output"`, opcjonalnymi `status`, `retryAfterMs`, bez surowego body. Wiadomość techniczna to bezpieczny kod.
- `classifyLessonGenerationFailure(error: unknown): { errorCode: string; retryable: boolean; retryAfterMs?: number }`; Zod/domain validation terminalne. Dotychczasowe zachowanie providerów słówek i mediów chronione regresją, bez automatycznego rozszerzania tej polityki na inne porty.
- `lessonRetryDelayMs(attempt: number, retryAfterMs: number | undefined, random: () => number): number` — 1000/2000 ms + 0–20%, nie mniej niż poprawne Retry-After.
- `generationRuns.nextAttemptAt: Date | null`, nieobecne w DTO. Claim i selekcja lesson sprawdzają null lub termin ≤ clock.now, nie tylko odczyt w pollerze.

- [x] RED adaptera/klasyfikacji: adapter testy wykazały brak typu/statusu przy 400, brak Retry-After przy 429 oraz akceptację parsowalnego JSON po refusal/length; klasyfikacja i backoff miały brakujące moduły. Dodatkowe testy pokrywają 401/408/500, quota 429 i zły JSON. Jeden request dla HTTP 400 przez fake fetch.
- [ ] RED PostgreSQL: regressje są dodane w `lesson-generation.test.ts` dla pojedynczego requestu błędu trwałego, odroczenia retry i czyszczenia go przez retry ręczny. Testów z zegarem i migracji nie udało się wykonać, bo Docker API nieosiągalne. Uruchomić po udostępnieniu PostgreSQL.
- [x] Dodać kolumnę Drizzle i wygenerować migrację przez `npx --yes pnpm@10.34.6 --filter @learning/server db:generate --name lesson_generation_retry`; wygenerowano 0009 z metadata. Dodano typowany błąd, klasyfikację i odroczenie bez sleep. Refusal/content_filter i finish_reason sprawdzane przed JSON.parse; wynik musi być niepustą kopertą z tablicą exercises. Bez fallbacku do json_object.
- [ ] GREEN unit/integracja; pełny unit 101 plików / 1019 testów PASS, typecheck PASS, diffcheck PASS. Testy integracyjne migracji i regresji deck/media nie wystartowały z powodu Docker Desktop. Polskie komunikaty rodzica mapują kody generacji; body HTTP nie jest logowane ani serializowane do errorCode.
- [x] Zapisać dowody i commit `fix(lessons): classify provider failures and persist retry delays`.

### Task 6: Deadline i przerwanie nieaktualnego wykonania

**Pliki:** nowe `packages/server/src/modules/lessons/lesson-generation-control.ts` i `.test.ts`, `lesson-generation-policy.ts` i `.test.ts`; `lesson-drafts.ts`; `config.ts`, `providers/generation-env.ts` i `.test.ts`, `providers/openai/llm.ts` i `.test.ts`; nowy `tests/integration/lesson-generation-cancellation.test.ts`; `.env.example`, `docs/provider-config.md`.

**Interfaces:**
- `GenerationDeps.lessonExecution?: { requestTimeoutMs: number; runTimeoutMs: number; cancelPollMs: number }`, domyślne 90000/600000/1000; istniejące fake deps działają z defaults.
- `executeLessonGeneration(services: Services, runId: string, options?: { signal?: AbortSignal }): Promise<void>`; port `generateLessonPool(input,signal?)` bez zmiany.
- `withLessonGenerationControl<T>(services: Services, execution: { runId: string; attempts: number; expectedEditNumber: number }, work: (control: { assertCurrent(): Promise<void>; call<R>(request: (signal: AbortSignal) => Promise<R>): Promise<R> }) => Promise<T>, signal?: AbortSignal): Promise<T>`.
- `OpenAiLlmOptions.lessonRequestTimeoutMs?: number`; bezpośrednia generacja lekcji ma deadline adaptera także bez caller signal; orchestrator podaje mniejszy pozostały budżet.

- [x] RED: testy z fake timers miały oczekiwane RED z braku `lesson-generation-control`; po implementacji sprawdzają timeout żądania, wspólny budget wielopartowy, abort bieżącego requestu po supersede i bezpieczne rozliczenie późnego resolve. Test adaptera obejmuje deadline fetch/body bez sygnału zewnętrznego.
- [ ] RED PostgreSQL: integracyjne `parentEditCancelsOldRun` i `shutdownReturnsCurrentRunToQueueWithMonotonicAttempts` dodano do `lesson-generation.test.ts`; wymagają dwóch połączeń/DB i nie mogły się uruchomić. Manual retry z dwoma Services oraz konkurencyjne próby pozostają do sprawdzenia po udostępnieniu Dockera.
- [x] Zaimplementować guard deadline + poll aktualności, złożony AbortSignal, sprawdzenia przed/po każdej partii i końcowy CAS z zadania 4. Opcja shutdown oddaje nadal aktualny run do queued, zachowując attempts; timeout jest terminalnym `provider_timeout`. Timery/listenery są sprzątane w finally, transakcja nie obejmuje sieci.
- [x] GREEN: wskazane testy jednostkowe PASS; końcowy unit 107 plików/1057 testów, typecheck i build PASS. Walidacja env obejmuje 0, NaN, wartości ujemne, niecałkowite i request > run. Tokeny nie są logowane, gradering nie jest ruszany. Integracja PostgreSQL jest zablokowana przez niedziałający Docker. Ustawienia dopisane do `.env.example` i `docs/provider-config.md`.
- [x] Zapisać dowody i commit `fix(lessons): bound generation and cancel stale executions`.

### Task 7: Postęp innych zadań i diagnostyka czasu

**Pliki:** `packages/server/src/modules/generation.ts`, `packages/server/src/modules/lessons/lesson-drafts.ts`, `packages/server/src/index.ts`; `apps/worker/src/main.ts`, `tasks.ts`, nowy `loop.ts` i `.test.ts`; `tests/integration/generation.test.ts`; `.env.example`, `docs/provider-config.md`.

**Interfaces:** `runDueGenerationWork(services, limits?, options?: { signal?: AbortSignal }): Promise<{processed:number}>`; `processDueWork(services: Services, signal?: AbortSignal)` przekazuje sygnał. `createWorkerLoop({ pollMs, staleMs, processPass: (signal: AbortSignal) => Promise<void>, now: () => number }): { stop(): Promise<void>; health(): { healthy: boolean; lastPassAt: number | null; passStartedAt: number | null } }` — proste sterowanie bieżącą pętlą, bez frameworka zadań.

- [x] Testy integracyjne `slow deck does not block a lesson run` i anulowania po utracie lease dodano do `generation.test.ts`, ale PostgreSQL preflight nie uruchomił testów z powodu braku Docker Engine; brak dowodu RED/GREEN integracyjnego. Unit scheduler obejmuje rotację kolejek, dwa sloty, limit jednego obrazu i retry po błędzie/ręcznym resecie obok długiej pracy; nie udaje dowodu integracyjnego.
- [x] RED loop: test przed implementacją zgłosił brak modułu `./loop`; testy weryfikują brak nakładania przelotów, abort przy stop oraz progi health. Targeted unit loop + scheduler: 7 testów PASS.
- [x] Wprowadzić scheduler bieżących zadań z dwoma slotami i sprawiedliwym doborem rodzajów, zachowując CAS, per-draft rezerwację i limit obrazu. Następny poll po ukończeniu przelotu. `/health` wykorzystuje wynik loop i zwraca 200/503 (nieznana ścieżka nadal 404); dodać `WORKER_HEALTH_STALE_MS=900000` i walidację dodatniego progu. Zamknięcie procesu przerywa pracę i domyka pool po rozliczeniu.
- [x] GREEN i test logów: wyłącznie kody, liczby i czasy; żadnego body HTTP, materiału ani sekretu. Fake pool+validator (Node 22.19.0, identyczny materiał i 3/4/2): 1 cel = 1 call, 9 surowych, 6 przyjętych/3 odrzucone jako powtórzony bodziec, 4.31 ms; 3 cele = 3 calle, 27 surowych, 18/9, 0.96 ms; 7 celów = 7 calli, 63 surowe, 42/21, 1.18 ms. To sztuczny fake, który powtarza bodziec „Wybierz poprawną odpowiedź”; wyniki dowodzą zachowania deduplikacji ćwiczeń, nie jakości/tempa żywego modelu ani czasu pełnego runu/PostgreSQL.
- [x] Zapisać dowody w dzienniku; wcześniejsze zmiany są w commitach 490a2a3–ce1a638. Końcowe poprawki review pozostają do commitu zgodnie z bramką PR.

### Task 8: Pełna akceptacja, niezależne review i końcowy PR

**Pliki:** `tests/e2e/lesson-real-flow.spec.ts`, `lesson-kid.spec.ts`, `lesson-parent.spec.ts`, `lesson-parent-supervision.spec.ts`, `lesson-mock-test.spec.ts`; `tests/integration/grammar-without-tts.test.ts`; `docs/SPEC.md`, `docs/architecture.md`, `.kiro/specs/grammar-module/{requirements,design}.md`, `docs/provider-config.md`, dziennik i końcowy raport review. API/MCP tylko w razie rzeczywistego wpływu ustalonego poniżej.

- [x] E2E rozszerzono: rodzic tworzy Present Simple question/negative/short_answers przez rzeczywisty adapter/worker/domenę, przegląda i zapisuje, publikuje, dziecko odpowiada bez mikrofonu/audio, reload zachowuje sesję, rodzic widzi postęp. Odrębny istniejący test rodzica pokrywa konflikt starego formularza. Testy i lista Playwright parsują, lecz uruchomienie jest zablokowane przed testami przez brak Docker. Odpowiedzi 400/timeout pokrywają testy adaptera, kontroli generacji i integracyjne; w tym repo nie ma testowego E2E hooka do konfigurowania błędów fake providera, więc nie dodano takiego mechanizmu wyłącznie na potrzeby UI.
- [x] Końcowe sprawdzenia po poprawkach review: `test:unit` 107 plików/1057 testów, `typecheck`, `build`, MCP 8/8, `contracts:export-learning-overview --check` i `git diff --check` PASS. `test:integration` i `test:e2e` zatrzymały się przed testami, bo Docker API/`dockerDesktopLinuxEngine` jest niedostępne; nie uruchomiły żadnych testów PostgreSQL/Playwright.
- [x] API → MCP → skill: DTO, endpointy i `schemaVersion` bez zmian; `learning-overview` nadal wyklucza lekcje. `contracts:export-learning-overview --check` i `test:mcp` PASS; nie wymaga zmiany adaptera/skill ani wdrożenia u Hermesa.
- [x] Dokumentacja SPEC, architecture, provider-config i wymagania gramatyki aktualizują worker, retry i brak TTS. Test migracji, stary queued run i zachowanie całej bazy pozostają niezweryfikowane z powodu braku PostgreSQL. Zanotowano też ograniczenie braku checkpointów wcześniejszych partii po przejściowym błędzie.
- [x] `requesting-code-review`: dedykowany reviewer `gpt-6.1-sol xhigh` sprawdził całe BASE_SHA..HEAD i bieżący diff. Wynik końcowy 0 Critical, 0 Important, 0 otwartych Minor. Obsłużono wszystkie uwagi: scheduler/retry, testy partii, fake bodźce, walidator `base_form_after_does` i prompt pierwszej partii; nowe regresje przeszły RED→GREEN. Integracja/E2E pozostają zablokowane przez Docker i są jawnie ograniczeniem.
- [x] `verification-before-completion` i `finishing-a-development-branch`: weryfikacja końcowa zakończona, gałąź `feature/lesson-generation-reliability` wypchnięta, PR #60 do `main` utworzony i dołączony do czatu: https://github.com/lookassh/knowli/pull/60. Opis zawiera wynik, testy, niezależne review, wpływ API→MCP→skill, migrację `next_attempt_at` i wspólne wdrożenie web+worker. PR pozostaje otwarty do Squash and merge przez właściciela; agent nie scala ani nie wdraża.

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
