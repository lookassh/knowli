# #30 — Przygotowanie do sprawdzianu: plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Konfigurowalna próbna kartkówka z zamrożoną porcją, odroczonym omówieniem i raportem rzeczywistych dowodów oraz braków.

**Architecture:** Osobny tryb istniejących sesji, z niezmiennym prywatnym planem oraz wspólną historią, blokadami, evaluator-em i projekcjami. Serwer finalizuje odpowiedzi bez ujawniania rozwiązań; dopiero zamknięcie umożliwia omówienie. Rodzic konfiguruje liczbę zadań na przypisaniu dziecko × zestaw.

**Tech Stack:** Obecne TypeScript/React/Next.js, Zod, Drizzle/PostgreSQL, Vitest i Playwright; bez nowych zależności produktu.

**Spec:** `docs/superpowers/specs/2026-10-10-test-readiness-design.md`, zaakceptowana 2026-10-10 z korektą właściciela: liczba zadań jest konfigurowalna.

**Status:** wykonano etapy 1–7 przez executing-plans, z niezależnym review i poprawkami RED→GREEN. Wyniki: unit376, PostgreSQL172, E2E66, typecheck/build PASS. Dostarczono PR https://github.com/lookassh/knowli/pull/33; scala właściciel przez squash.

## Global Constraints

- Cele `recall | spelling | listening`; materiał zatwierdzony i wcześniej poznany. Bez audio odpowiedzi dziecka, dyktanda, zdań, OCR, nowego schedulera i zmian długości zwykłego treningu.
- `mockTestTaskCount`: integer 1–100, domyślnie 10, konfiguracja rodzica per przypisanie. Brak pola w PUT zachowuje wartość; null/0/101/ułamek są błędami.
- Plan kopiuje `requestedTaskCount`; faktyczny budżet jest długością bezpiecznej porcji. Błędy, retry, resume i późniejsza zmiana konfiguracji nie powiększają porcji.
- Limit czasu 10 minut, okno resume 30 minut; jedna aktywna sesja na dziecko. Jawne zakończenie i timeout zachowują niepełny wynik.
- Jedna odpowiedź pisemna może ocenić Recall i pisownię; zajmuje jeden slot. Zadania pisemne przed słuchowymi.
- Oceny finalizowane w transakcji; pierwsza odpowiedź, 300 sekund, trzy sukcesy, inny dzień i minimum 12 godzin pozostają zgodne z przypiętą polityką. Nie kwalifikować prób na podstawie wyłącznie stanu ze startu.
- W trakcie kartkówki nie ujawniać rozwiązania, jego fragmentu ani oceny poprawności; także przez retry, polling, hint i stary endpoint. Po zakończeniu `AttemptDto` nadal nie zwraca feedbacku; rozwiązania przez osobne omówienie.
- Ekspozycje przed HTTP, również powtórny odsłuch i ponowny odczyt omówienia; raport rodzica nie tworzy ekspozycji dziecka.
- `mockTestPlan` i AnswerKey są prywatne. Kid DTO nie zawiera kryteriów, wariantów, technicznych score'ów ani rekordów DB.
- UI `pl-PL`, Umiem!, komunikaty w `packages/contracts/src/messages.ts`; Kid UI bez importów Next.js i serwera.
- Autoryzacja każdej operacji rodzica, usunięcie profilu usuwa jego historię; materiał wspólny zostaje.

## Review Focus

1. Retry zakończonej odpowiedzi i GET starej próby: żadnego rozwiązania ani nowego ujawnienia — testy zadania 3.
2. N=1, liczba nieparzysta, N większe od dostępnego materiału: prawdziwy budżet i pełny mianownik — zadania 2 i 4.
3. Kontekst nadpisany przez `contextOf` lub timeout: zachowana migawka, raport i rezerwacje — zadania 1, 2 i 4.
4. Audio przed Recall, warianty o wspólnym celu i kontakt z innego zestawu: brak fałszywej samodzielności — zadania 2 i 3.
5. Answer vs finish i dwie przeglądarki: jeden wynik, bez zmiany raportu już pokazanego — zadania 3, 4 i 5.

## Setup wykonania

- [x] Przed pierwszą zmianą użyć `using-git-worktrees` i `executing-plans`. Zweryfikować obecny worktree; nie tworzyć nowego bez potrzeby. Wyjść z detached HEAD przez gałąź `feature/test-readiness`, o ile nazwa wolna i dozwolona w aktualnym środowisku.
- [x] Zapisać bieżący BASE_SHA i Git status. Przeczytać specyfikację, ten plan oraz AGENTS.md. Zachować obydwa dokumenty i niezwiązaną pracę.
- [x] Założyć `docs/superpowers/progress/2026-10-10-test-readiness.md`, używając artefaktów/scripts wymaganych przez aktualny `executing-plans`; dostosowania Windows opisać w dzienniku.
- [x] Zainstalować workspace przez `pnpm install --frozen-lockfile`, jeśli nadal brak `node_modules`. Sprawdzić dostępność Docker i wykonać baseline `pnpm test:unit` oraz `pnpm typecheck`; zapisać istniejące błędy. Każdy RED musi wynikać z nowego wymagania, nie braku zależności.

## Mapa plików i prywatnych typów

Nowe pliki publiczne: `packages/contracts/src/mock-tests.ts` oraz `mock-tests.test.ts`. Cel i limit mają jeden schemat Zod; nie duplikować definicji w domenie lub UI.

Nowe pliki serwerowe: `packages/server/src/domain/mock-test-types.ts`, `mock-test-plan.ts`, `mock-test-plan.test.ts`, `mock-test-report.ts`, `mock-test-report.test.ts`, `packages/server/src/modules/mock-tests.ts`. Nie przenosić niezwiązanego kodu z dużych modułów; wydzielić tylko logikę nowego trybu. Helpers transakcyjne tego modułu nie otwierają zagnieżdżonych transakcji i nie są eksportowane do przeglądarki.

Prywatne typy w `mock-test-types.ts`:

- `MockTestCandidate`: `itemId`, `itemRevisionId`, `position`, `source`, `target`, `targetKey`, `acceptedAnswers`, `known: boolean`, `audioAssetId: string | null`, `skills: Partial<Record<TestGoal, { skillVersionId: string; priority: 0 | 1 | 2 }>>`. Priorytety: bez wiarygodnego sprawdzenia / wymaga ćwiczeń lub ponownego potwierdzenia / pozostałe.
- `MockTestSlot`: `taskId`, `itemId`, `itemRevisionId`, `targetKey`, `exerciseType: "recall" | "listening"`, `goals: TestGoal[]`, `prompt: TaskPrompt`, `answerKey: AnswerKey`. Identyfikatory generuje serwer; kolejność opcji i klucz są zamrożone przed zapisem.
- `MockTestScopeItem`: identyfikatory elementu/rewizji, pozycja, source/target, mapowanie wybranych goals na skillVersionId i przyczyna niedostępności slotu (albo null).
- `MockTestPlanSnapshot`: `version: 1`, `testGoals`, `testDate: string | null`, `requestedTaskCount`, `scope: MockTestScopeItem[]`, `slots: MockTestSlot[]`. Timezone i previousContact pozostają w istniejącym kontekście; wersja i polityka w kolumnach sesji.
- `MockTestReportRow`: `itemId`, `skill: TestGoal`, `outcome: "correct" | "incorrect" | "skipped" | "unassessed" | "not_tested"`, `independent`, `reason: string | null`, `masteryStatus: ItemSkillStatus`. Wiersze powstają tylko dla wybranych umiejętności, także gdy evaluator zapisał dodatkowy wynik.

## Task 1: konfiguracja rodzica i trwała migawka

**Files:** Modify `packages/contracts/src/{decks,kid,index}.ts`, `packages/server/src/{db/schema,modules/decks,modules/events,modules/sessions}.ts`, `apps/web/src/parent/parent-router.ts`. Create pliki kontraktów i typów powyżej oraz wygenerowaną migrację `packages/server/drizzle/<next>_mock_tests.sql` z aktualnymi metadanymi. Test `tests/integration/mock-test-settings.test.ts`. Numer migracji wynika z dziennika Drizzle w momencie wykonania, obecnie kolejnym numerem jest 0004.

**Interfaces:** Produces `TestGoalSchema`, `TestGoal`, `MockTestTaskCountSchema`; `AssignmentDto.testGoals: TestGoal[] | null`, `.mockTestTaskCount: number`; `AssignmentPut` opcjonalne pola celu/liczby; `SessionInput.mode?: "training" | "mock_test"`, `SessionDto.mode` zawsze obecne. `upsertAssignment(services: Services, childId: string, deckId: string, testDate: string | null, options?: { testGoals?: TestGoal[] | null; mockTestTaskCount?: number }): Promise<void>` zachowuje starych konsumentów. Baza i typy prywatne opisane w specyfikacji.

- [x] RED: `rejects_invalid_task_count` dla `[0, 101, 1.5, null]`; akceptuje `[1, 7, 10, 25, 100]`. Cel null dozwolony, pusty/duplikaty/nieznany odrzucane. `keeps_count_on_date_only_put`: ustaw 7, PUT z samą datą, nadal 7. Drugi profil może mieć 25. Nowy rekord ma 10 i brak celu.
- [x] Uruchomić `pnpm test:unit packages/contracts/src/mock-tests.test.ts` i `pnpm test:integration tests/integration/mock-test-settings.test.ts`; potwierdzić oczekiwany RED i zapisać wyniki.
- [x] Implementować kontrakty i aktualizację przypisania. W `mock-tests.ts` kontraktów zdefiniować także schematy/typy raportu i omówienia dokładnie według Interfaces zadania 4, aby `SessionContextShape` mógł korzystać z istniejącego typu. Drizzle: `test_goals` nullable text[], `mock_test_task_count` NOT NULL DEFAULT 10; CHECK zakresu, dozwolonych celów i unikalności. Sesje: `mode` DEFAULT training, nullable `mock_test_plan` JSONB, CHECK spójności trybu/planu. Trigger odrzuca zmianę planu i trybu po INSERT. Rozszerzyć `SessionContextShape`/`contextOf` o typowaną migawkę raportu, zachowując poprzednie pola. Mapowanie `sessionDto` już tutaj zwraca `row.mode`; sama implementacja zachowania mock następuje w zadaniu 2.
- [x] GREEN powyższych testów oraz test DB `rejects_plan_mutation_but_allows_session_close`: poprawny INSERT mock session, UPDATE plan/mode odrzucony, UPDATE state/endedAt dozwolony. Migracja zostawia legacy jako training/null. `pnpm typecheck` po aktualizacji wszystkich konstrukcji `SessionDto` w fake API/testach.
- [x] Commit `feat: add mock test goals and configurable task count`; stage tylko wymienione ścieżki i wygenerowane metadane, zapisać SHA i dowody w dzienniku.

## Task 2: zamrożony plan oraz start/next

**Files:** Create `packages/server/src/domain/mock-test-plan{,.test}.ts`, `packages/server/src/modules/mock-tests.ts`; Modify `packages/server/src/modules/sessions.ts`, `packages/server/src/index.ts`; Test `tests/integration/mock-tests.test.ts`.

**Interfaces:** Consumes typy zadania 1. Produces `buildMockTestPlan(input: { testGoals: TestGoal[]; testDate: string | null; requestedTaskCount: number; candidates: readonly MockTestCandidate[]; newId: () => string }): MockTestPlanSnapshot`; `createMockTestPlan(tx: Tx, services: Services, input: { childId: string; deckVersionId: string; testGoals: TestGoal[]; testDate: string | null; requestedTaskCount: number }): Promise<MockTestPlanSnapshot>`; `issueMockTestTask(tx: Tx, services: Services, session: typeof learningSessions.$inferSelect): Promise<TaskDto | null>`. Dwa ostatnie to wewnętrzne helpers modułu; istniejące startSession/nextTask obsługują dispatch.

- [x] RED: `uses_configured_count_and_single_written_slot` — 20 poznanych elementów, cele Recall+pisownia, N=7 → 7 slotów, każdy ma dwa goals. `allocates_odd_mixed_budget` — N=7 → 4 pisemne, 3 słuchowe. N=1 → pisemne; N=25 → więcej niż 10; N=100, 50 elementów i oba rodzaje → 100. Niedobór jednej puli przenosi wolne sloty do drugiej; sloty tej samej pary nie dublują się.
- [x] RED: niepoznana rewizja po zmianie znaczenia nie trafia do puli; identyczne polskie znaczenia nie tworzą dwóch opcji; brak audio/opcji pozostaje w scope jako niesprawdzone. 0 kandydatów daje validation z polskim komunikatem bez sesji; singleton bez listening ma poprawny pisemny slot. Wszystkie pisemne ordinaly poprzedzają słuchowe. Odpowiedzi poprawne nie mają stałej pozycji pierwszej w wyborze; shuffle następuje raz przed zapisem planu.
- [x] Uruchomić `pnpm test:unit packages/server/src/domain/mock-test-plan.test.ts` i integracyjny plik zadania, zapisać oczekiwany RED.
- [x] Implementować czysty dobór według priorytetów, pozycji i id; nie korzystać z bieżącego schedulera wsparcia. Reader kandydatów używa historii zamkniętych kontaktów właściwej wersji znaczenia/umiejętności, gotowych zatwierdzonych mediów i niezmiennych rewizji. Pełny scope powstaje przed odrzuceniem kandydatów.
- [x] W startSession pod dotychczasową blokadą profilu skopiować konfigurację, poprzedni kontakt, policy/version oraz plan; `taskBudget = plan.slots.length`. Domyślny training zachowuje istniejący budżet i priorytet 48h. Resume wymaga zgodnego deck/mode; inny aktywny tryb/zestaw daje konflikt zamiast automatycznego końca. Stale session zamknąć wspólną ścieżką zadania 4 przed nowym startem.
- [x] W nextTask wydać gotowy slot o następnej pozycji, zwracać ten sam aktywny task przy retry i nie dodawać support/exposure. Task otrzymuje zamrożony prompt/klucz. Ujawnienia promptu/audio zapisuje istniejący event writer; nie liczyć polskiego promptu jako ujawnienia angielskiego celu. Sloty o wspólnym `targetKey` nie powodują wcześniejszego audio dla oczekującego pisemnego slotu.
- [x] GREEN: restart/resume nie zmienia planu, także po zmianie liczby 7→25, daty, celów, polityki i publikacji; 2×next wydaje jedno zadanie; po N zamkniętych slotach next zwraca null. Uruchomić powyższe testy i `pnpm test:unit packages/server/src/domain/test-preparation-scheduler.test.ts`.
- [x] Commit `feat: plan fixed mock test portions from assignment settings`; zapisać dowody i faktyczny zakres w dzienniku.

## Task 3: jedna odpowiedź i brak ujawnienia

**Files:** Modify `packages/server/src/modules/{attempts,events}.ts`, `apps/web/src/kid/kid-router.ts`; Extend `tests/integration/mock-tests.test.ts`; existing `domain/evaluate.ts` bez zmiany reguł dopasowania.

**Interfaces:** Existing `submitAttempt`, `startAttempt`, `readAttempt`, `finalizeAttempt` rozpoznają `session.mode`. Publiczny `AttemptDto` mock: `state=completed`, `feedback=null`, `stepId=null`, task terminalny. Text tylko dla recall; choice tylko dla listening; skip/dont_remember w obu. Multipart/audio odrzucane przed analizą przez nowy tryb.

- [x] RED: `does_not_reveal_on_submit_read_retry_or_finalize` sprawdza wszystkie ścieżki i JSON oraz brak `feedback_issued` przy odpowiedzi. Odczyt i retry po końcu również bez rozwiązania. Test jawnego hint oraz wzorcowego audio pisowni daje conflict, brak ujawnienia; audio promptu listening dozwolone z ekspozycją przed HTTP.
- [x] RED: pierwsza błędna odpowiedź → answered, nowe clientAttemptId do tego task daje 409; ten sam id/ta sama treść zwraca to samo attemptId, inna treść daje 409. `dont_remember` zapisuje trudność bez ujawnienia/wsparcia; skip bez oceny; pusty tekst nieoceniony. Nietrafiona modality odrzucona bez próby.
- [x] Uruchomić `pnpm test:integration tests/integration/mock-tests.test.ts`; zapisać RED z właściwych asercji.
- [x] Implementować trybową finalizację bez `chooseFeedback`/`discloseFeedback` dla mock; terminalny task po pierwszym ukończonym podejściu. Retry sprawdza idempotencję przed odrzuceniem terminalnego zadania. Nie wywoływać providerów dla mock audio. Rezerwacje i settledChecks zachować zgodnie z wybraną ścieżką, bez resetowania pozostałego kontekstu.
- [x] GREEN: zapisane oceny `monday` mają recall correct i spelling incorrect; zatwierdzony wariant działa. Ekspozycja także w innym zestawie na 299 s → independent false; 300 s → kwalifikacja zgodna z polityką. Zamrożenie przy receivedAt, zero wielokrotnych ocen dla jednej umiejętności. Replay audio listening zapisuje kolejne ujawnienie, nie psuje już ukończonego pisemnego wyniku.
- [x] GREEN: `Promise.all` dwóch answerów → jeden merytoryczny wynik; retry utraconego HTTP nie duplikuje ocen. Uruchomić także `pnpm test:integration tests/integration/attempts.test.ts tests/integration/history.test.ts` i `pnpm test:unit packages/server/src/domain/evaluate.test.ts`.
- [x] Commit `feat: defer mock test feedback until review`; zapisać dowody.

## Task 4: zamknięcie i raport pełnego zakresu

**Files:** Create `packages/server/src/domain/mock-test-report{,.test}.ts`, `tests/integration/mock-test-reporting.test.ts`. Modify `packages/contracts/src/mock-tests.ts`, `packages/server/src/modules/{mock-tests,sessions,reporting,events}.ts`, `packages/server/src/index.ts`, oba routery `apps/web/src/{kid/kid-router,parent/parent-router}.ts`.

**Interfaces:** `summarizeMockTestRows(rows: readonly MockTestReportRow[], goals: readonly TestGoal[]): MockTestSkillReportDto[]`. Każdy skill report: `skill`, `totalItems`, `independentCorrect`, `practiceNeeded`, `correctNotIndependent`, `notTested`, `skipped`, `unassessed` (dwa ostatnie są podlicznikami notTested). `MockTestReportDto`: session/child/deck/version ids, date/goals, requestedTaskCount/taskBudget, state/completeness, startedAt/endedAt, per-skill reports i szczegółowe rows z przyczynami oraz masteryStatus. `MockTestSummaryDto`: sessionId, state, taskBudget, answeredCount, rozwiązania wyłącznie wydanych slotów (`taskId`, source/target, outcome per wybrany goal, audioAssetId nullable), bez technicznych statusów/score'ów. Te DTO mają schematy Zod.

**Services:** `closeMockTest(tx: Tx, services: Services, session: typeof learningSessions.$inferSelect, state: "completed" | "ended"): Promise<MockTestReportDto>`; `readMockTestSummary(services: Services, sessionId: string): Promise<MockTestSummaryDto>`; `getMockTestReport(services: Services, sessionId: string): Promise<MockTestReportDto>`; `listMockTests(services: Services, childId: string, deckId: string): Promise<MockTestReportDto[]>` (pierwsza wersja maksymalnie 20 najnowszych, deterministycznie startedAt/id; UI „Ostatnie 20 prób”). Close helper działa we wspólnej transakcji, read services blokują sesję. Autoryzację parent wykonuje router przed serwisem.

- [x] RED domeny: `partitions_full_scope_without_double_counting` dla 10 elementów/skill: 6 independent correct, 2 incorrect, skip + niewydany → 2 notTested; suma grup = totalItems. Poprawny niekwalifikujący przenosi się do oddzielnej grupy, unassessed/skip bez practiceNeeded. Recall i spelling liczone oddzielnie; samej pary item/skill nie liczyć dwukrotnie.
- [x] RED integracji: end po 3 z 7 slotów, timeout 10 minut, stale resume po 30 minutach i start innego zestawu zachowują wyniki i wymagany zakres. Zmiana ustawienia/publikacja później nie przepisuje raportu; SQL guards nadal chronią oceny. Aktywny raport/summary niedostępny bez rozwiązań.
- [x] Uruchomić `pnpm test:unit packages/server/src/domain/mock-test-report.test.ts` i `pnpm test:integration tests/integration/mock-test-reporting.test.ts`; zapisać RED.
- [x] Implementować rows przez LEFT JOIN scope → wydane tasks → ukończone attempts/assessments właściwej umiejętności; brak oceny odróżnić od skip i poza porcją. masteryStatus przypiąć z projekcji na zakończenie. Zamrozić raport w `context.mockTestReport` raz; kolejne odczyty używają zapisu. Pełna próba = wszystkie sloty terminalne, nie cały deck pokryty.
- [x] Podłączyć close helper do jawnego end, wyczerpania planu, timeoutu i zakończenia stale session przed startem kolejnej. Standardowy end zwraca wspólny `SessionSummaryDto`; dla mock `practiceItems=[]`, independentSuccesses z rzeczywistych ocen, bez rozwiązań. Kid UI następnie pobiera osobne omówienie. Nie wykonywać starego ujawnienia treningowego ani ponownego liczenia raportu dla mock.
- [x] Udostępnić dedykowane trasy specyfikacji. Read summary przed HTTP zapisuje zapieczętowane ekspozycje wszystkich zwracanych targetów i audio, również przy kolejnym odczycie/cache; nie dodawać niewydanych elementów. Parent report nie zapisuje ekspozycji dziecka. Audio omówienia odtwarzane po ponownym odczycie summary z serwera, także przy lokalnym cache bajtów.
- [x] GREEN: finish vs answer, 2×finish, read vs finish i restart → jeden raport; wynik wcześniejszego answer zależy od kolejności blokady, spóźniony answer po close odrzucony, pokazany raport stabilny. Sam jeden sukces nie tworzy mastered; naturalne wcześniejsze 2 sukcesy i potwierdzenie po przerwie mogą spełnić dotychczasową politykę. Delete profilu usuwa wszystkie nowe dane, drugi profil i wspólny materiał zostają; unauthorized parent routes 401.
- [x] Uruchomić także `pnpm test:integration tests/integration/sessions.test.ts tests/integration/reporting.test.ts tests/integration/progress-rebuild.test.ts`. Commit `feat: report mock test coverage and preserve partial results`; zapisać wyniki.

## Task 5: przepływ dziecka

**Files:** Modify `packages/kid-ui/src/api/{KidApi,client}.ts`, `session/{session-controller,session-controller.test,useLearningSession}.ts`, `screens/{DeckScreen,LearnScreen}.tsx`, `KidApp.tsx`, `packages/contracts/src/{kid,messages}.ts`, serwerowe `listKidDecks` w `packages/server/src/modules/kid.ts`; Create `packages/kid-ui/src/screens/MockTestSummaryScreen.tsx`; Test `tests/e2e/mock-test.spec.ts`.

**Interfaces:** `KidDeckDto.mockTestAvailable: boolean` (cel ustawiony); KidApi dodaje `readMockTestSummary(sessionId: string): Promise<MockTestSummaryDto>`. StartSession przekazuje wybrany mode, bez nadpisania liczby rodzica. Controller ma ekran `mockTestSummary` z DTO, publiczne `startMockTest(deckId: string): Promise<void>` i `reviewMockTest(sessionId: string): Promise<void>`; po odpowiedzi completed/null w mock od razu next, bez pollingu i dialogu poprawności. Trening zachowuje obecny przepływ.

- [x] RED kontrolera: mock po zakończonej próbie z feedback null przechodzi do next, nie readAttempt/polling i nie feedback; offline nie zwiększa licznika. Retry zachowuje clientAttemptId. Mic denied nie blokuje startu. Active mode conflict pokazuje powrót do sesji lub jej jawne zakończenie, bez nowej kartkówki w tle.
- [x] Uruchomić `pnpm test:unit packages/kid-ui/src/session/session-controller.test.ts`, zapisać RED.
- [x] W istniejącym wyborze deck dodać „Ćwicz” oraz „Próbna kartkówka” i świadomy start. Po serwerowym starcie pokazać rzeczywistą liczbę N oraz „Odpowiedzi omówimy na końcu”; preview przed utworzeniem sesji nie może podawać fikcyjnego N. Nie zmieniać nowej kartkówki w pierwsze zadanie przed potwierdzeniem startu. Tekst „Nie pamiętam” dla mock bez „pokaż”. Pisemne pole zachowuje wyłączenie autokorekty/kapitalizacji. Listening pozostaje audio → polskie opcje. Licznik i zakończenie bazują wyłącznie na serwerze.
- [x] Dodać podsumowanie oraz przycisk zwykłego treningu w tym samym zestawie. Pobranie/replay rozwiązania zawsze przez summary API przed pokazaniem/odtworzeniem. Cleanup odtwarzania przy wyjściu. Po end controller przechodzi przez dedicated summary, nie pokazuje pustego wspólnego podsumowania. Reload pyta serwer o aktywną próbę w zachowanym trybie.
- [x] GREEN unit. E2E testy: porcja 3 kończy się na 3 mimo błędów; porcja 13 przekracza 10, bez dodatkowych slotów; utrata odpowiedzi HTTP/reload po 2 slotach nie duplikuje; dwie przeglądarki; bez mikrofonu; brak answer/feedback w aktywnym JSON; omówienie dopiero po close. `pnpm test:e2e tests/e2e/mock-test.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/privacy.spec.ts`.
- [x] Commit `feat: add child mock test flow with deferred review`; zapisać dowody.

## Task 6: ustawienia i raport rodzica

**Files:** Modify `apps/web/src/parent/{DeckEditor,ProgressPanel}.tsx`, `packages/contracts/src/messages.ts`. Create `apps/web/src/parent/{AssignmentTestGoalFields,MockTestReportPanel}.tsx`; Test `tests/e2e/mock-test-parent.spec.ts`.

**Interfaces:** `AssignmentTestGoalFields(props: { testGoals: TestGoal[] | null; mockTestTaskCount: number; onChange: (value: { testGoals: TestGoal[] | null; mockTestTaskCount: number }) => void }): React.JSX.Element`; `MockTestReportPanel(props: { childId: string; deckId: string }): React.JSX.Element`. Fetch przez istniejące apiFetch. Formularz przypisania zapisuje datę, goals i liczbę w jednej operacji, nie zmienia ustawień innych dzieci.

- [x] RED E2E: dwa dzieci w jednym deck mają liczby 3 i 13 oraz różne goals/daty. Po zapisie/reload wartości zostają; 0/101/ułamek nie zapisują się. PUT tylko z datą nie resetuje liczby. UI wskazuje, że czas nadal ograniczony i większa porcja może pozostać niepełna.
- [x] Uruchomić `pnpm test:e2e tests/e2e/mock-test-parent.spec.ts`, potwierdzić RED z brakującego zachowania.
- [x] Implementować pole liczby przy celach, domyślnie 10 (1–100), bez sztywnego suwaka z jedyną opcją 10. Raport w panelu postępów: najnowsze 20 zakończonych prób, wybrana próba, state/wersja/data/cele/requested vs actual, grupy per skill, trudne słowa, niesprawdzone z przyczynami i osobno opanowanie na zakończenie. Bez agregowania starych i nowych rewizji jako jednego bieżącego dowodu.
- [x] GREEN E2E: zmiana 3→13 podczas aktywnej próby nie zmienia jej, nowa ma 13 jeśli materiał pozwala; stare wyniki po nowej publikacji nadal oznaczone starą wersją. Przykład 6/2/2 zgodny z faktami; correctNotIndependent nie znika z mianownika. Wynik nie obiecuje szkolnej oceny. `pnpm test:e2e tests/e2e/mock-test-parent.spec.ts tests/e2e/progress-panel.spec.ts tests/e2e/parent-edit-protection.spec.ts`.
- [x] Commit `feat: configure and inspect mock tests in parent mode`; zapisać wyniki.

## Task 7: pełna regresja i dostarczenie

**Files:** Modify `docs/SPEC.md`, `docs/architecture.md`, `docs/folder-structure.md`, ten plan i dziennik. Review artifact `docs/superpowers/reviews/2026-10-10-test-readiness.md`. Testy z zadań 1–6 oraz istniejące suites. Brak sztucznego RED dla samej dokumentacji.

- [x] Odwzorować finalne DTO, trasy, ustawienie 1–100/default 10, semantykę końca i zakresu. Zachować SPEC reguł opanowania oraz trening 48h. Sprawdzić każde kryterium #30 względem implementacji i dziennika; wyjątki R01–R07 opisane w specyfikacji.
- [x] `pnpm test:unit`, `pnpm test:integration`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `git diff --check`. Wymagany brak nowych błędów; istniejące baseline failures nie usprawiedliwiają regresji. Zachować pełne wyniki i rozróżnić wykonane testy od urządzenia rodziny. Ręcznie potwierdzić klawiaturę i audio na telefonie/tablecie albo jawnie opisać brak tego dowodu.
- [x] `requesting-code-review`: dedykowany niezależny subagent-recenzent według aktualnego `code-reviewer.md`. Przekazać wymagania #30 z korektą właściciela, spec, plan, Review Focus, **cały BASE_SHA..HEAD_SHA** plus niezacommitowany diff, wyniki i odstępstwa. Zgoda na delegowanie implementacji nie jest potrzebna do recenzenta wymaganego w AGENTS.md; nie delegować wykonania zadań.
- [x] `receiving-code-review`: zweryfikować uwagi; rozwiązać Critical/Important, poprawki zachowania RED/GREEN. Wynik i decyzje zapisać w review artifact/dzienniku, Minor jawnie odłożyć. Wykonać adekwatne ponowne sprawdzenia po poprawkach, nie deklarować niezależnego review na podstawie self-review planu.
- [x] `verification-before-completion` i `finishing-a-development-branch`: świeży Git/diff i niezbędne wyniki; push gałęzi roboczej oraz PR do main z udokumentowanym niezależnym review i walidacją. W treści PR `Closes #30`. Po stworzeniu zawsze `attach_artifact` URL PR. Właściciel scala przez squash; agent nie scala bez osobnego polecenia. Nie usuwać worktree z niepołączonymi zmianami.
- [x] Raport końcowy: co zmieniono, rzeczywiste sprawdzenia, zakres/niezależność review, pozostałe ograniczenia i URL PR. Aktualizacja checklisty to dowód, nie zastępstwo wykonania.

## Self-review planu

- [x] Pokrycie projektu i korekty liczby: konfiguracja/legacy/DB (1), budżet i migawka (2), bezpieczeństwo odpowiedzi (3), zakres i trwałe wyniki (4), dwa interfejsy (5–6), regresje/review/PR (7).
- [x] Spójne nazwy: `mockTestTaskCount` na przypisaniu, `requestedTaskCount` w planie/raporcie, rzeczywisty `taskBudget = slots.length`; liczba ocen nie jest liczbą slotów.
- [x] Każdy punkt Review Focus ma test we wskazanym zadaniu; retry, nieparzysty N, cross-deck exposure, kontekst i wyścigi są jawne.
- [x] Sygnatury i typy przekazywane między zadaniami zdefiniowane; prywatny plan nie jest eksportem contracts. Plan nie zawiera gotowych implementacji algorytmów.
- [x] Zadania mają RED/GREEN, komendy, rezultat i commit; setup i dokumentacja są częścią dostarczenia, nie osobną funkcją.
- [x] Review szczegółowego planu przez właściciela przed realizacją. Domyślny tryb: bieżący agent inline przez executing-plans, zgodnie z AGENTS.md.
