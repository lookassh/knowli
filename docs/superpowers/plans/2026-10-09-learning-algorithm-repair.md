# Naprawa wszystkich ustaleń audytu algorytmu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
>
> **Repo override:** Delegacja wymaga wyraźnej zgody właściciela. Właściciel zaakceptował projekt i plan oraz wybrał wykonanie inline 9 października 2026. Nie uruchamiaj subagentów ani niezależnego agenta review bez osobnej zgody.

**Goal:** Naprawić wszystkie I01–I10 z audytu, odtworzyć wiarygodny postęp i zapewnić późniejsze sprawdzanie wszystkich dostępnych umiejętności bez zapętlania sesji.

**Architecture:** Zachować istniejący scheduler i Kid API; wydzielić scoped history/projection oraz czyste funkcje potrzeb treningu, cyklu wsparcia i opcji. Potrzeby treningu są odtwarzane z niezmiennej historii, osobno od opanowania. Bez nowej tabeli kolejki, zmiany publicznego DTO i zmiany progów pamięci; odbudowa zmienia tylko projekcje.

**Tech Stack:** TypeScript strict, React/Next.js, Drizzle + PostgreSQL, Zod, pnpm workspaces, Vitest i Playwright; dotychczasowe fake-adaptery i kontrolowany zegar.

**Spec:** `docs/superpowers/specs/2026-10-09-learning-algorithm-repair-design.md` — projekt zaakceptowany przez właściciela 9 października 2026. Źródło problemów: `docs/audits/2026-10-09-learning-algorithm-audit.md`.

## Global Constraints

- UI `pl-PL`, marka `Umiem!`, materiał `pl-PL → en-GB`; kod i identyfikatory po angielsku. Komunikaty tylko w `packages/contracts/src/messages.ts`.
- Samodzielność Recall/pisowni: `300` sekund od ostatniego ujawnienia, pierwsza odpowiedź bez podpowiedzi. Opanowanie: `3` ostatnie kwalifikujące sukcesy, inny dzień i minimum `12` godzin dla potwierdzenia. Odstępy sukcesów `1/3/7` dni.
- Pomoc po `2` błędnych próbach tego samego zadania; „Nie pamiętam” od razu. Techniczne wyniki i pominięcia nie są błędem wiedzy.
- Budżet `12` ocenianych zadań; `10` minut jako miękki limit; `30` minut dla resume; obiecane ostatnie `3` zadania nie rosną. Exposure bez attempt/assessment i bez zużycia budżetu.
- Historia, opublikowany materiał, polityka i wydany prompt są niezmienne. Nie przepisuj dawnych ocen ani zapisanych podsumowań.
- Rezerwacje celów i zapieczętowane ekspozycje przed treścią; wspólna blokada operacji sesji, także przy dwóch klientach.
- Kid UI nie importuje serwera/Next.js. Kid DTO bez answer key, score, polityki i danych administracyjnych. Brak mikrofonu nie blokuje pisania; surowe audio nie jest utrwalane.
- Testy na syntetycznych danych i fake-providerach; SQL na PostgreSQL. Nie używaj rodzinnej bazy jako fixture.
- Nie instaluj nowych runtime'ów: CLI odbudowy użyje `tsx` istniejącego w `apps/worker`.
- Właściciel zaakceptował projekt, plan, wykonanie inline i planowo ograniczone commity. Odbudowa na rodzinnej bazie, push, merge i deploy pozostają poza zakresem.

## Review Focus

- **RF1:** Dwoje aktywnie ćwiczących dzieci i ten sam klucz materiału w dwóch wersjach zestawu — cudza próba nie zmienia serii ani rekomendacji (zadania 1, 4, 11).
- **RF2:** Pierwszy Recall wspomagany, potem skip/technical/restart i ekspozycja w innym zestawie — późniejsze sprawdzenie nadal istnieje i respektuje 299/300 s (zadania 4, 11).
- **RF3:** Jeden element, identyczne znaczenia lub wszystkie dystraktory zarezerwowane — brak udawanego dowodu, ujawnienia zarezerwowanego celu i nieskończonych exposure (zadania 6, 7, 9, 11).
- **RF4:** Odsłuch na drugim kliencie przed odpowiedzią i 299 s + analiza mowy — kwalifikacja zamrożona przy received_at; późniejszy feedback nie zmienia jej wstecz (zadania 2, 4, 11).
- **RF5:** Skażone projekcje, różne polityki, processing, usuwanie profilu i przerwana odbudowa — apply odmawia przy aktywnej nauce, jest atomowe i idempotentne (zadania 1, 10, 11).

---

## Bramka workflow i zakres akceptacji

- [x] Odczyt skilla writing-plans, audytu i aktualnych kontraktów repo.
- [x] Zakres classified architectural: współpraca historii, projekcji, schedulera i odbudowy danych.
- [x] Pisemny projekt reguł, przypadków legacy i małych zestawów utworzony wraz z planem na polecenie właściciela.
- [x] Self-review projektu i planu: kompletność I01–I10, interfejsy, zależności, pięć RF.
- [x] Właściciel zaakceptował pisemny projekt, w tym reguły 24 h, jedną poprawkę, wyjątek małego zestawu, minimum dwóch opcji i zachowanie legacy.
- [x] Właściciel zaakceptował plan i wybrał wykonanie inline; delegacja nie została użyta zgodnie z repozytorium.
- [x] Wykonawca zastosował executing-plans, TDD, using-git-worktrees i verification-before-completion oraz użył istniejącego worktree.

Właściciel zaakceptował projekt i plan oraz polecił kontynuować implementację inline. Odpowiadające temu checklisty zaktualizowano; planowe commity obejmują tylko pliki zadania i dokumentację, bez niepowiązanych plików użytkownika.

## Mapa plików i odpowiedzialności

| Ścieżka | Zmiana/odpowiedzialność |
| --- | --- |
| `packages/server/src/modules/skill-history.ts` | Nowy jedyny scoped reader historii i kwalifikacji dowodów |
| `packages/server/src/modules/skill-projections.ts` | Wydzielony zapis jednej projekcji, wspólny dla finalizacji i odbudowy |
| `packages/server/src/domain/projection-evidence.ts` | Korekta kwalifikacji historycznych pojedynczych opcji/audio, bez zmiany ocen |
| `packages/server/src/domain/task-assistance.ts` | Czysta interpretacja roli audio/podpowiedzi dla nowych prób |
| `packages/server/src/domain/support-cycle.ts` | Odtwarzanie ograniczonego cyklu pomocy z zadań i unikalnych prób |
| `packages/server/src/domain/learning-work.ts` | Potrzeba kolejnego sprawdzenia, daty dostępności i nieoceniona wymowa |
| `packages/server/src/modules/learning-snapshot.ts` | Batched snapshot materiału/historii/ekspozycji dla sesji i rekomendacji |
| `packages/server/src/domain/recognition-options.ts` | Wspólny dobór i deduplikacja bezpiecznych opcji |
| `packages/server/src/domain/letter-fragment.ts` | Deterministyczny fragment z co najmniej jedną ukrytą literą |
| `packages/server/src/domain/confusion-priority.ts` | Kierunkowe, unikalne wiarygodne mylone pary |
| `packages/server/src/modules/progress-rebuild.ts` | Dry-run i atomowe apply projekcji per dziecko |
| `apps/worker/src/rebuild-progress.ts` | Jednorazowe CLI, poza pętlą workera |
| `packages/server/src/domain/scheduler.ts` | Priorytety i prywatne snapshoty; bez kodu SQL |
| `packages/server/src/modules/{attempts,sessions,kid}.ts` | Użycie wspólnych funkcji pod istniejącymi blokadami |
| `packages/server/src/modules/reporting.ts` | Liczenie par raz per próbę i zgodny kierunek |
| `packages/kid-ui/src/exercises/WrittenView.tsx` | Istniejąca obsługa fragmentu; mała zmiana instrukcji tylko jeśli potrzebna |
| `tests/integration/fixtures/learning.ts` | Syntetyczny publikowany materiał i prawdziwe odpowiedzi; współdzielone fixture |
| `tests/integration/{learning-algorithm,progress-rebuild}.test.ts` | Regresje pełnej historii i odbudowy na PostgreSQL |
| `tests/e2e/learning-algorithm.spec.ts` | Mały zestaw i pełny cykl pomocy przez Kid UI |
| `docs/operations/progress-rebuild.md` | Weryfikowalna procedura serwisowa, backup/rollback |

Nowe funkcje domeny mają odpowiadające `*.test.ts`. Nie zmieniać `docs/schema.sql` niezależnie od Drizzle; ten projekt nie wymaga nowej kolumny/tabeli. Jeśli rzeczywiste wykonanie wykaże potrzebę migracji, wrócić do projektu przed zmianą zależnego kontraktu, zamiast dopisywać nieuzgodnioną kolejkę.

## Zależności

Wykonanie sekwencyjne: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11**. To jedna spójna naprawa przepływu uczenia, nie jedenaście niezależnych usług. Każde zadanie kończy własny cykl RED/GREEN i mały commit zadaniowy podczas zatwierdzonej implementacji.

### Task 1: Scoped history i współdzielony zapis projekcji — I01

**Files:** Create `packages/server/src/modules/skill-history.ts`, `packages/server/src/modules/skill-projections.ts`, `tests/integration/fixtures/learning.ts`, `tests/integration/learning-algorithm.test.ts`. Modify `packages/server/src/modules/attempts.ts:209–289,379`, `packages/server/src/index.ts`.

**Interfaces:**
- `HistoryScope = { childId: string; skillVersionId: string; skill: Skill }`.
- `skillHistoryKey(scope: HistoryScope): string`: `${childId}:${skillVersionId}:${skill}`.
- `readSkillHistory(exec: Executor, scope: HistoryScope): Promise<History>` i `readSkillHistories(exec: Executor, scopes: readonly HistoryScope[]): Promise<ReadonlyMap<string, History>>`. Bulk query grupuje przez powyższy klucz, nie per element; filtr obejmuje child i wersję/skill, kolejność received_at/attempt_id.
- `persistSkillProjection(tx: Tx, scope: HistoryScope, history: History, policy: Policy, now: Date, receivedAt: Date): Promise<void>`. Zachować semantykę finalizacji atomowej; brak wiarygodnej oceny dla tej polityki nie tworzy/nadpisuje wiersza.
- Fixture: `publishVocabularyDeck(services: Services, childIds: readonly string[], pairs: readonly {source: string; target: string; acceptedAnswers?: readonly string[]}[]): Promise<{deckId: string; versionId: string; revisionIds: string[]}>`; `answerTaskCorrectly(services: Services, task: TaskDto): Promise<AttemptDto>`; `nextExercise(services: Services, sessionId: string, type: TaskDto['exerciseType'], maxSteps?: number): Promise<TaskDto>`. Audio fake-ready, ilustracje omitted, maxSteps domyślnie 40; nie seedować projekcji.

- [x] **Step 1 — RED tests:** W `learning-algorithm.test.ts` prowadź A i B tym samym zestawem do pierwszego listening, oba odpowiadają poprawnie. Odczytaj projekcje B po jego odpowiedzi. Dodaj wariant błędnej odpowiedzi A oraz RF1: kosmetyczna nowa wersja wspólnego klucza. Asercje:
  ```ts
  expect(bListening.independentSuccessStreak).toBe(1);
  expect(bListening.status).toBe("practicing");
  expect(bAssessments.every(row => row.childId === childB.id)).toBe(true);
  ```
  W `history.test.ts` dodaj: usunięcie A nie zmienia historii ani odbudowy B; awaria zapisu projekcji cofa całą finalizację.
- [x] **Step 2 — run RED:** `$env:UMIEM_TEST_RUN_ID='repair-history'; pnpm test:integration tests/integration/learning-algorithm.test.ts tests/integration/history.test.ts`. Oczekiwana porażka: B ma serię 2; nie błąd setupu/importu.
- [x] **Step 3 — implement:** Przenieś obecny odczyt/zapis do wyżej opisanych funkcji; finalizacja przekazuje `session.childId`. Wszystkie joiny muszą zachować scope, nawet gdy tabela zawiera złożony FK. Żadnego odczytu „historia skill version wszystkich dzieci”. Czytnik widzi oceny właśnie wstawione w bieżącej transakcji, zanim finalizeAttemptRow zmieni attempt.state na completed; nie dodawaj filtra completed gubiącego bieżącą ocenę. W atomowej finalizacji odbiorca zewnętrzny nie zobaczy tego stanu pośredniego.
- [x] **Step 4 — GREEN:** Powtórz Step 2 oraz `pnpm test:integration tests/integration/attempts.test.ts tests/integration/sessions.test.ts`; zero failures.
- [x] **Step 5 — commit:** Stage tylko pliki zadania; `git commit -m "fix: scope learning history to each child"`.

### Task 2: Kwalifikacja audio i dawnych zadań bez dowodu — I06, legacy I07

**Files:** Create `packages/server/src/domain/task-assistance.ts`, `task-assistance.test.ts`, `projection-evidence.ts`, `projection-evidence.test.ts`. Modify `packages/server/src/modules/{attempts,skill-history,skill-projections}.ts`, `tests/integration/learning-algorithm.test.ts`, `tests/integration/speech.test.ts`.

**Interfaces:**
- `TaskAssistanceInput = {exerciseType: ExerciseType; visibleLetterFragment: boolean; distinctChoiceCount: number | null; disclosureKinds: readonly ('audio_issued' | 'hint_issued')[]}`.
- `resolveTaskAssistance(input: TaskAssistanceInput): AssistanceKind[]`; reading/reverse audio → `model_audio`; listening/speech audio bez wsparcia; singleton → `options`; litery → `visible_letters`; hint → `answer_reveal`.
- `ProjectionEvidence = {entry: HistoryEntry; exerciseType: ExerciseType; distinctChoiceCount: number | null; audioIssuedBeforeAnswer: boolean}`.
- `qualifyProjectionEvidence(evidence: readonly ProjectionEvidence[]): History`: może tylko wyłączyć independent/confirmationEligible dla wadliwych wyborów i reading z audio. Nie zmienia wyniku ani czasu. `readSkillHistory/Histories` z Task 1 używają tego samego adaptera, a zapis ustawia `PROJECTION_VERSION = 'proj-2'`.

- [x] **Step 1 — RED tests:** Tablica wszystkich typów ćwiczeń i ról audio; integracja reading/reverse przed audio na drugim kliencie, potem choice. Legacy singleton ma nadal ten sam prompt i może się zakończyć. Projekcja pomija jego dowód, ale ocena pozostaje bitowo taka sama. Test timestampów odróżnia późniejszy odsłuch i konserwatywny remis.
  ```ts
  expect(readingGrade.independent).toBe(false);
  expect(listeningGrade.independent).toBe(true);
  expect(correctSpeech.skills.pronunciation?.independent).toBe(true);
  expect(projectedSingleton.streak).toBe(0);
  expect(afterRawAssessment).toEqual(beforeRawAssessment);
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit task-assistance projection-evidence` i `$env:UMIEM_TEST_RUN_ID='repair-evidence'; pnpm test:integration tests/integration/learning-algorithm.test.ts tests/integration/speech.test.ts`. Oczekiwana porażka reading independent=true i zachowany zawyżony streak.
- [x] **Step 3 — implement:** Użyj resolvera w `assistanceFor` podczas zamrożenia kontekstu. Czytnik historii pobiera opcje niezmiennego promptu i sealed `audio_issued` z `occurred_at <= received_at`; późniejszy czas nie wpływa wstecz. Licz opcje różne po normalizacji, nie liczbę ID. Nie włączaj 300 s do listening/reading.
- [x] **Step 4 — GREEN:** Powtórz Step 2; dołącz istniejące `pnpm test:unit independence evaluate` i test 299 s + opóźniona finalizacja mowy. Zero failures, historyczne rekordy bez zmian.
- [x] **Step 5 — commit:** `git commit -m "fix: qualify assisted and non-discriminating evidence"` po selektywnym stage.

### Task 3: Jedna próba, jeden błąd; zamykany cykl pomocy — I03, I04

**Files:** Create `packages/server/src/domain/support-cycle.ts`, `support-cycle.test.ts`. Modify `packages/server/src/domain/scheduler.ts:35–40,445–481`, `packages/server/src/modules/sessions.ts:297–306,395–456,770`, `packages/server/src/modules/attempts.ts:163–192`, `scheduler.test.ts`, `test-preparation-scheduler.test.ts` (fixture snapshotów), `tests/integration/learning-algorithm.test.ts`.

**Interfaces:**
- `SupportTask = {taskId: string; itemRevisionId: string; ordinal: number; exerciseType: ExerciseType; state: 'issued'|'answered'|'completed'|'skipped'; reason: string; supportCycleId?: string}`.
- `SupportAttempt = {attemptId: string; taskId: string; modality: string; outcomes: readonly {skill: Skill; outcome: SkillOutcome}[]}`; jeden obiekt per attempt, także przy dwóch ocenach.
- `SupportState = {phase: 'none'|'needed'|'waiting'|'retry_due'|'settled'; cycleId: string | null; sourceTaskId: string | null; retryType: 'listening'|'letter_completion'}`.
- `deriveSupportStates(tasks: readonly SupportTask[], attempts: readonly SupportAttempt[], supportAfterFailures: number): ReadonlyMap<string, SupportState>`, keyed itemRevisionId.
- `ScheduleCandidate.support: SupportState` zastępuje `failuresThisSession/supportedThisSession`; `TaskPlan.supportCycleId?: string` trafia wyłącznie do prywatnego context.
- Prywatne `nextTaskState(modality: AnyModality, grade: Grade, attemptNumber: number, incorrectAttemptCount: number): 'issued'|'answered'|'skipped'`. Gałąź błędu wiedzy zamyka po dwóch realnie błędnych odpowiedziach, nie dwóch podejściach z technicznym wynikiem.

- [x] **Step 1 — RED tests:** Jeden lowercase + poprawka nie tworzy pomocy; dwie oceny jednej złej odpowiedzi liczą się raz. Jedna pomyłka w każdym z dwóch zadań nie spełnia progu tego samego zadania. „Nie pamiętam” działa od razu. Technical → pierwszy błąd pozostaje issued. Po prezentacji dwa next nie omijają wymaganego innego zakończonego zadania. Odtwórz ślad audytu z poprawnymi dalszymi odpowiedziami i legacy context bez cycleId.
  ```ts
  expect(afterCapitalizationFix.reason).not.toBe("support");
  expect(firstErrorAfterTechnical.taskState).toBe("issued");
  expect(realTrace.filter(task => task.reason === "retry-after-support")).toHaveLength(1);
  expect(reducerAfterSkippedRetry.phase).toBe("settled");
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit support-cycle scheduler`; `$env:UMIEM_TEST_RUN_ID='repair-support'; pnpm test:integration tests/integration/learning-algorithm.test.ts tests/integration/attempts.test.ts`. Oczekiwana porażka: false support i wiele retry.
- [x] **Step 3 — implement:** Agreguj oceny przez attemptId przed reducerem. Próg per źródłowy task; one support + one retry per element/session. Przerwa wymaga zakończonego ocenianego task innego elementu. Retry technical w issued kontynuuje ten sam task; terminalne retry rozlicza cykl. Wyklucz settled element z kolejnej pomocy i natychmiastowego filler. Legacy odtwarzaj po ordinalach, nie modyfikuj context starego issued task.
- [x] **Step 4 — GREEN:** Powtórz Step 2. Sprawdź równoległe next/attempt i idempotentny complete-presentation: jedna pomoc, nie dwa nowe zadania. Bez zwiększenia budżetu.
- [x] **Step 5 — commit:** `git commit -m "fix: bound support cycles and count failed attempts once"`.

### Task 4: Zaplanowana praca po wspomaganym/pominiętym wprowadzeniu — I02

**Files:** Create `packages/server/src/domain/learning-work.ts`, `learning-work.test.ts`, `packages/server/src/modules/learning-snapshot.ts`. Modify `scheduler.ts`, `modules/{sessions,kid}.ts`, `scheduler.test.ts`, `test-preparation-scheduler.test.ts` (nowe pola snapshotów), `tests/integration/learning-algorithm.test.ts`.

**Interfaces:**
- `SkillWorkInput = {skill: 'recall'|'spelling'|'pronunciation'; progress: SkillSnapshot | undefined; hasQualifyingAssessment: boolean; firstIssuedAt: string | null; lastRelevantExposureAt: string | null; now: string; policy: Policy}`.
- `SkillWork = {reviewDueAt: string | null; eligibleAt: string | null; dueNow: boolean}`; `deriveSkillWork(input: SkillWorkInput): SkillWork`.
- `LearningSnapshotScope = {childId: string; revisionIds: readonly string[]; policy: Policy; now: string}`.
- `LearningSnapshotItem = {itemRevisionId: string; skillVersionIds: Partial<Record<Skill,string>>; progress: Partial<Record<Skill,SkillSnapshot>>; work: Partial<Record<'recall'|'spelling'|'pronunciation',SkillWork>>; introducedSkills: {recall:boolean;pronunciation:boolean}; ownPresentationCompleted: boolean; readingEvidenceDirections: Partial<Record<ReadingDirection,number>>; lastRelevantExposureAt: string | null}`.
- `readLearningSnapshot(exec: Executor, scope: LearningSnapshotScope): Promise<readonly LearningSnapshotItem[]>`: batch links, historie, zadania, sealed exposures; używa readera/kwalifikacji Task 1–2.
- `ScheduleCandidate.work` i `.ownPresentationCompleted`, `.readingEvidenceDirections` odpowiadają powyższym polom. `DeckWorkloadItem` dodaje `pendingCheckAt: string | null` i `recallIntroductionNeeded: boolean`; `hasScheduledWork(items, now)` zachowuje podpis i stosuje te same dueNow/introduction rules.

- [x] **Step 1 — RED tests:** First Recall z ekspozycją tuż wcześniej: brak sukcesu, praca firstIssued+24 h. Kolejne skip/technical nie odsuwają terminu. Po trzech sesjach co 24 h istnieje samodzielny Recall **i spelling**, bez seedowanych projekcji. RF2: ekspozycja innego zestawu tej samej odpowiedzi w t=299 blokuje sprawdzenie, t=300 pozwala. Nowy klucz kryteriów nie dziedziczy pracy/dowodu starego. Zakończony nieoceniony speech wraca w kolejnym dniu tylko z mic.
  ```ts
  expect(work.reviewDueAt).toBe("2026-10-10T16:00:00.000Z");
  expect(independentRecallCount).toBeGreaterThan(0);
  expect(independentSpellingCount).toBeGreaterThan(0);
  expect(at299.dueNow).toBe(false);
  expect(at300.dueNow).toBe(true);
  expect(deck.recommended).toBe(nextWorkExists);
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit learning-work scheduler`; `$env:UMIEM_TEST_RUN_ID='repair-work'; pnpm test:integration tests/integration/learning-algorithm.test.ts tests/integration/sessions.test.ts`. Oczekiwana porażka: independent count=0 i brak terminu pracy.
- [x] **Step 3 — implement:** Bez nowej tabeli: fallback firstIssuedAt+86_400_000 ms tylko bez kwalifikującej oceny; normalny nextReviewAt ma zastosowanie po kwalifikacji. Recall/spelling eligibleAt=max(due, latest canonical/accepted-variant exposure+policy.independenceAfterSeconds). Przypnij etap do skill_version; first issued pozostaje datą niezależnie od kolejnych skip. Scope sesji używa przypiętej policy, lista nowego startu policy profilu. Nie rezerwuj celu jeszcze niedostępnego, nie wydawaj settledChecks ponownie.
- [x] **Step 4 — GREEN:** Powtórz Step 2 i testy `independence`, `progress`, `test-preparation-scheduler`. Zweryfikuj brak samodzielnego sukcesu przy first assisted i niezablokowaną naukę przed terminem.
- [x] **Step 5 — commit:** `git commit -m "fix: retain pending checks after assisted introductions"`.

### Task 5: Historycznie brakujący kierunek reading — I05

**Files:** Modify `packages/server/src/domain/scheduler.ts:251–255,574,686`, `packages/server/src/modules/learning-snapshot.ts`, `scheduler.test.ts`, `progress.test.ts`, `tests/integration/learning-algorithm.test.ts`.

**Interfaces:** `chooseReadingDirection(evidence: Partial<Record<ReadingDirection,number>>, sessionCounts: Partial<Record<ReadingDirection,number>>): ReadingDirection`. Dane historyczne z `projectProgress(...).skills.reading?.directions`; bieżące `readingDirections` nadal oznacza liczbę wydanych zadań tej sesji.

- [x] **Step 1 — RED tests:** Trzy kwalifikujące en→pl z potwierdzeniem → nowy task pl→en. Brak en→pl działa symetrycznie. Gdy oba/brak obu, wybierz mniej ćwiczony w sesji, remis en→pl. Assisted/technical nie uzupełnia historii. Pełna wielodniowa integracja: jedno reading słowa na sesję może opanować oba kierunki.
  ```ts
  expect(chooseReadingDirection({target_to_source:3,source_to_target:0}, {})).toBe("source_to_target");
  expect(chooseReadingDirection({target_to_source:1,source_to_target:2}, {source_to_target:1})).toBe("target_to_source");
  expect(finalReading.status).toBe("mastered");
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit scheduler progress`; `$env:UMIEM_TEST_RUN_ID='repair-reading'; pnpm test:integration tests/integration/learning-algorithm.test.ts`. Oczekiwany zły kierunek przy nowej sesji.
- [x] **Step 3 — implement:** Jeden chooser dla due-review, filler, extra i przerw. Nie zmieniać wymogu obu kierunków; liczyć dane z bieżącej polityki/właściwego klucza.
- [x] **Step 4 — GREEN:** Powtórz Step 2; sprawdź rezerwacje dystraktorów w reverse_recognition i idempotentny prompt po reload.
- [x] **Step 5 — commit:** `git commit -m "fix: schedule missing reading evidence directions"`.

### Task 6: Bezpieczne opcje i pełna nauka małych zestawów — I07

**Files:** Create `packages/server/src/domain/recognition-options.ts`, `recognition-options.test.ts`. Modify `scheduler.ts`, `modules/{sessions,learning-snapshot}.ts`, `scheduler.test.ts`, `tests/integration/learning-algorithm.test.ts`. Publiczne `contracts/kid.ts` zachowuje min 1 dla zgodności legacy.

**Interfaces:**
- `RecognitionOptionsInput = {target: ScheduleCandidate; peers: readonly SchedulePeer[]; direction: ReadingDirection | 'listening'; reservedTargetKeys: readonly string[]; rotateBy: number; preferredRevisionIds?: readonly string[]}`.
- `buildRecognitionOptions(input: RecognitionOptionsInput): {options: PlannedOption[]; revealsTargetKeys: string[]} | null`; null oznacza <2 różnych opcji, a nie nowe oceniane zadanie singleton.
- `ScheduleCandidate.recognitionFallbackUsedThisSession: boolean` odczytywane z context reason; `ScheduleReason` dodaje `recognition-fallback`. `ownPresentationCompleted` z Task 4 służy wyjątkowi wprowadzania Recall.
- `SchedulePeer.acceptedAnswers: readonly string[]`: nowe wymagane pole dla sprawdzenia przecinających się zatwierdzonych wariantów; uzupełnij budowę peers w sessions i helpery `peer()` w `scheduler.test.ts` oraz `test-preparation-scheduler.test.ts` (`[]` dla braku wariantów).

- [x] **Step 1 — RED tests:** Jedno słowo, duplicate sources, casing/NFC, target równy accepted variant dystraktora, wszystkie bezpieczne dystraktory reserved. Poprawna opcja jest zawsze jedna, minimum dwie różne. Zestaw singleton: own exposure → Recall bez mic → późniejsza samodzielna próba; nie zwiększa listening/reading streak. Samo pokazanie jako dystraktora nie wystarcza. Powtarzane next/restart nie generuje nieskończonego fallback.
  ```ts
  expect(buildRecognitionOptions(singletonInput)).toBeNull();
  expect(valid.options.filter(option => option.correct)).toHaveLength(1);
  expect(new Set(valid.options.map(option => normalizeTargetText(option.text))).size).toBeGreaterThanOrEqual(2);
  expect(singletonTrace.some(task => task.exerciseType === "recall")).toBe(true);
  expect(singletonListeningStreak).toBe(0);
  expect(fallbacksForOneItemInOneSession).toBeLessThanOrEqual(1);
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit recognition-options scheduler`; `$env:UMIEM_TEST_RUN_ID='repair-options'; pnpm test:integration tests/integration/learning-algorithm.test.ts`. Oczekiwana pojedyncza opcja/fałszywy postęp lub brak Recall.
- [x] **Step 3 — implement:** Po filtrach reservation/duplicate wybierz opcje, potem sprawdź minimum. Null → raz nieoceniane exposure, dalej inna praca lub wcześniejszy koniec. Ukończona own exposure + trwale brak rozróżnialnych opcji umożliwia Recall introduction; brak safe opcji spowodowany tylko czasową rezerwacją nie jest dowodem „trwale małego zestawu”. Zachować niezmienny legacy task i ochronę Task 2.
- [x] **Step 4 — GREEN:** Powtórz Step 2; zaktualizuj świadomie test „talia z jednym elementem” w scheduler.test.ts na nowy kontrakt produktu, nie tylko usuń jego asercję. Nie dodawać obcych, niezatwierdzonych odpowiedzi jako dystraktorów.
- [x] **Step 5 — commit:** `git commit -m "fix: avoid single-option mastery evidence"`.

### Task 7: Wspomaganie pisowni przez letter_completion — I09

**Files:** Create `packages/server/src/domain/letter-fragment.ts`, `letter-fragment.test.ts`. Modify `scheduler.ts`, `modules/sessions.ts:608–613,684–686`, `support-cycle.ts`, `packages/kid-ui/src/exercises/WrittenView.tsx`, `packages/contracts/src/messages.ts`. Test `support-cycle.test.ts`, `scheduler.test.ts`, `evaluate.test.ts`, `tests/integration/learning-algorithm.test.ts`; create `tests/e2e/learning-algorithm.spec.ts`.

**Interfaces:** `buildLetterFragment(target: string): string` w `packages/server/src/domain/letter-fragment.ts`. `SupportState.retryType` z Task 3 wybiera letter_completion, gdy source task ma oceniony błąd spelling. Kid API używa istniejącego prompt `{kind:'letter_completion', prompt, fragment}` i istniejącego `answerText`. Dodaj komunikat `messages.kid.typeWholeWordWithLetters = 'Wpisz całe słowo. Pokazane litery Ci pomogą.'`; pozostaw inne instrukcje bez zmian.

- [x] **Step 1 — RED tests:** Dwie niepoprawne pisownie → exposure → inne zakończone zadanie → letter_completion. Poprawny cały wpisany wariant daje wynik wspomagany z zerowym przyrostem Recall/spelling streak. Krótki jednoznakowy target ma `_`, nie ujawnia całego rozwiązania. Brak mikrofonu nie blokuje. Fragment jest zarejestrowaną ekspozycją, endpoint choice nie może zastąpić text.
  ```ts
  expect(retry.exerciseType).toBe("letter_completion");
  expect(buildLetterFragment("A")).toBe("_");
  expect(letterGrade.skills.spelling?.independent).toBe(false);
  expect(after.spelling.streak).toBe(before.spelling.streak);
  ```
  E2E o nazwie `letter_completion completes supported spelling without a microphone`: widoczny fragment, instrukcja wpisania całego słowa, capitalisation feedback, zapis i next bez pętli; pole autocorrect/spellcheck/autocapitalize wyłączone. W wariancie mic-enabled letter_completion nadal nie ma przycisku nagrywania: serwer dopuszcza audio tylko dla recall/speech.
- [x] **Step 2 — run RED:** `pnpm test:unit letter-fragment support-cycle scheduler evaluate`; `$env:UMIEM_TEST_RUN_ID='repair-letters'; pnpm test:integration tests/integration/learning-algorithm.test.ts`; z wolnymi portami jak w bramkach końcowych: `pnpm test:e2e tests/e2e/learning-algorithm.spec.ts --grep letter_completion`. Oczekiwany listening zamiast letter_completion.
- [x] **Step 3 — implement:** Deterministycznie odsłaniaj co drugą literę, zachowaj separatory, ukryj co najmniej jedną literę; jedna litera → `_`. Ocena istniejącą ścieżką whole-word text. Cały target exposure konserwatywnie zapisz przed ujawnieniem fragmentu. Instrukcja tylko w katalogu messages. W WrittenView pokazuj mic wyłącznie dla promptu recall, zgodnie z istniejącym SPEECH_EXERCISES; letter_completion pozostaje pisemne.
- [x] **Step 4 — GREEN:** Powtórz Step 2; sprawdź Pomiń i utratę sieci bez lokalnego fałszywego sukcesu. Jeden terminalny retry rozlicza cykl Task 3.
- [x] **Step 5 — commit:** `git commit -m "fix: introduce supported spelling exercises"`.

### Task 8: Adaptacyjny dystraktor mylonej pary — I08

**Files:** Create `packages/server/src/domain/confusion-priority.ts`, `confusion-priority.test.ts`. Modify `modules/{attempts,learning-snapshot,reporting}.ts`, `scheduler.ts`, `recognition-options.ts`, `tests/integration/learning-algorithm.test.ts`, `tests/integration/reporting.test.ts`.

**Interfaces:**
- `ConfusionObservation = {attemptId:string; receivedAt:string; childId:string; expectedItemRevisionId:string; answeredItemRevisionId:string | null; exerciseType:ExerciseType; direction?:ReadingDirection; reliable:boolean}`. Poprawne wybory także są obserwacją okna (expected=answered); null oznacza brak jednoznacznego mapowania legacy.
- `ConfusionPair = {expectedItemRevisionId:string; answeredItemRevisionId:string; exerciseType:ExerciseType; direction?:ReadingDirection; count:number}`.
- `rankConfusions(observations: readonly ConfusionObservation[]): readonly ConfusionPair[]`: ostatnie 20 wiarygodnych prób rozpoznawania, dedup attemptId, ≥2 identyczne kierunkowe pomyłki; sort count desc, stable position rozstrzyga finalny dobór opcji. Okno obejmuje również poprawne odpowiedzi, nie tylko wiersze z details.confusion; dopiero po wyznaczeniu okna zlicz nierówne, nie-null IDs.
- `ScheduleInput.confusions?: readonly ConfusionPair[]`; scheduler przekazuje zgodną parę do `preferredRevisionIds` Task 6. Private details nowych ocen wyboru dodają `expectedItemRevisionId` i `answeredItemRevisionId`; dotychczasowe teksty expected/answered dla raportu zostają.

- [x] **Step 1 — RED tests:** Dwie Thursday→Tuesday dają Tuesday w pierwszym slocie dystraktora Thursday; jedna nie zmienia rotacji. Po 20 kolejnych poprawnych próbach dawna para wypada z okna. To nie implikuje Tuesday→Thursday. Reserved Tuesday, duplikat źródła lub accepted variant wyklucza parę. Dane drugiego dziecka, technical/uncertain STT, kapitalizacja i „Nie pamiętam” nie tworzą priorytetu. Stara para tekstowa działa tylko przy jednoznacznym dopasowaniu/kryteriach; raport count per attempt.
  ```ts
  expect(preferredDistractor.itemRevisionId).toBe(tuesdayRevisionId);
  expect(reversePairs).toHaveLength(0);
  expect(options.some(option => option.itemRevisionId === reservedTuesday)).toBe(false);
  expect(report.confusions[0]?.count).toBe(2);
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit confusion-priority recognition-options scheduler`; `$env:UMIEM_TEST_RUN_ID='repair-confusions'; pnpm test:integration tests/integration/learning-algorithm.test.ts tests/integration/reporting.test.ts`. Oczekiwana rotacja pomijająca częstą parę.
- [x] **Step 3 — implement:** Czytnik ogranicza dane do dziecka i kompatybilnych kluczy aktualnego materiału; nowe IDs pochodzą z zamrożonych opcji/klucza, nigdy klienta. Recognition target_to_source/listening mapuje polski tekst, reverse angielski; legacy ambiguity pomija. Rezerwacje i dedup wygrywają z priorytetem. Drugą opcję dobiera dotychczasowy obrót.
- [x] **Step 4 — GREEN:** Powtórz Step 2 i `pnpm test:integration tests/integration/speech.test.ts`; niewiarygodne STT nadal bez confusion i spadku wiedzy.
- [x] **Step 5 — commit:** `git commit -m "fix: prioritize reliable directional confusion pairs"`.

### Task 9: Należne powtórki przed nowymi porcjami, bez monopolizacji — I10

**Files:** Modify `scheduler.ts:445–658`, `scheduler.test.ts`, `test-preparation-scheduler.test.ts`, `modules/learning-snapshot.ts`, `modules/sessions.ts`; test `tests/integration/learning-algorithm.test.ts`, `tests/integration/sessions.test.ts`.

**Interfaces:** `ScheduleReason` dodaje `difficulty-break`; `ScheduleInput.recentAssessedTasks?: readonly {reason:ScheduleReason; skill:Skill | null; statusAtIssue:ProgressStatus | null}[]` (ostatnie 2). Dla wspólnego due-check wybierz skill z najwcześniejszym należnym terminem, remis recall; pozostały wynik odpowiedzi nadal może ocenić spelling. Zachowaj `recentAssessedReasons` dla przygotowania do sprawdzianu. `ScheduleCandidate.settledReviewSkills: readonly Skill[]` odtwarzane z terminalnych ocenianych zadań sesji. Status przy wydaniu zapisany tylko w nowym prywatnym context; legacy brak nie udaje trudności.

- [x] **Step 1 — RED tests:** Due listening/reading/speech wygrywa z całkowicie nowym słowem. Brak mic pomija speech i nie blokuje innych due. First unknown nadal exposure, porcje 2–3. Po dwóch trudnych due zadaniach bezpieczne łatwe recognition; jeśli wszystkie cele reserved, brak ujawnienia zamiast wymuszonej przerwy. Terminalny skip/technical nie wydaje tej samej due-review umiejętności wielokrotnie. Po trudności nie dokładaj task po obiecanych 3.
  ```ts
  expect(dueBeforeFresh.reason).toBe("due-review");
  expect(easyThird.reason).toBe("difficulty-break");
  expect(unprotectedRevealKeys).toEqual([]);
  expect(assessedIssued).toBeLessThanOrEqual(12);
  ```
- [x] **Step 2 — run RED:** `pnpm test:unit scheduler test-preparation-scheduler`; `$env:UMIEM_TEST_RUN_ID='repair-priorities'; pnpm test:integration tests/integration/learning-algorithm.test.ts tests/integration/sessions.test.ts`. Oczekiwany new-material przed due recognition.
- [x] **Step 3 — implement:** Kolejność z projektu §8; brak dowolnego score/losowego wybierania targetu. Easy-break tylko z bezpiecznymi opcjami, nie obchodząc rezerwacji due-check. Nadal test-preparation-break po dwóch przygotowaniach. `settledReviewSkills` różni się od settledChecks: reading nie rozlicza Recall i odwrotnie.
- [x] **Step 4 — GREEN:** Powtórz Step 2; due-check/assistance/reservation i due-review nie blokują ukończenia budżetu ani extra-practice. Przerwa przy braku safe kandydata może zostać pominięta wyłącznie w obronie niezależnego sprawdzenia.
- [x] **Step 5 — commit:** `git commit -m "fix: prioritize due skill reviews with safe breaks"`.

### Task 10: Odbudowa już zapisanych projekcji — I01/I06/I07 i RF5

**Files:** Create `packages/server/src/modules/progress-rebuild.ts`, `apps/worker/src/rebuild-progress.ts`, `tests/integration/progress-rebuild.test.ts`, `docs/operations/progress-rebuild.md`. Modify `packages/server/src/index.ts`, `apps/worker/package.json` (script `progress:rebuild: "tsx src/rebuild-progress.ts"`).

**Interfaces:**
- `RebuildProgressOptions = {childId?: string; apply: boolean}`; domyślnie apply=false.
- `RebuildProgressReport = {projectionVersion:'proj-2'; children:number; examined:number; inserted:number; updated:number; deleted:number; downgraded:number; unchanged:number}`; bez nazw/słów/transkrypcji/sekretów, wyniki opisują różnice semantyczne, nie timestamp aktualizacji.
- `rebuildProgress(services: Services, options: RebuildProgressOptions): Promise<RebuildProgressReport>`.
- CLI `pnpm --filter @learning/worker progress:rebuild -- [--child <UUID>] [--apply]`; DATABASE_URL z env, walidacja UUID/Zod, zamknięcie pool w finally. Nie uruchamiaj loop/main.ts ani providerów.

- [x] **Step 1 — RED tests:** Zasiej wyłącznie niepoprawną projekcję znanej historii po prawdziwych próbach dwóch dzieci, singleton i reading z audio. Dry-run nic nie zmienia, report podaje spadki; apply usuwa cudze sukcesy. RF5: dwa policyId bez mieszania, techniczna nowsza próba nie wybiera innej polityki zamiast ostatniej wiarygodnej oceny, profile deletion, restart po awarii. Hash/count/JSON historii, exposures i zapisanych summaries przed/po identyczne.
  ```ts
  expect(dryRun.downgraded).toBeGreaterThan(0);
  expect(afterDryRun).toEqual(beforeDryRun);
  expect(secondApply.updated + secondApply.inserted + secondApply.deleted).toBe(0);
  expect(rawHistoryAfter).toEqual(rawHistoryBefore);
  expect(activeSessionApplyError.code).toBe("conflict");
  ```
- [x] **Step 2 — run RED:** `$env:UMIEM_TEST_RUN_ID='repair-rebuild'; pnpm test:integration tests/integration/progress-rebuild.test.ts`. Oczekiwana nieobecna funkcja/procedura i niepoprawny wynik odtwarzania.
- [x] **Step 3 — implement:** Użyj scope/readers Task 1–2 oraz persistSkillProjection. Union istniejących projekcji i własnych ocen, wszystkie wersje kryteriów. Wybierz ostatnią wiarygodną zakończoną ocenę policy wg received_at/attempt_id. Brak własnych wiarygodnych ocen → usuń tylko projection row. Przed zapisem porównaj status, streak, nextReviewAt, lastReviewedAt i projectionVersion; bez różnicy nie aktualizuj updatedAt. Apply pod blokadą profilu/transakcją per child; sprawdź active sessions i processing, odmów bez samoczynnego kończenia. Wywołujący wymaga maintenance stop web/worker; transakcja/ponowne sprawdzenie chroni błędne użycie, nie zastępuje maintenance. CLI tworzy `createDatabase` i `createServices({db})`, nie używa worker composition wymagającego kluczy generowania.
- [x] **Step 4 — GREEN/runbook:** Powtórz Step 2; dwa apply nie zmieniają semantycznych wyników. Dokumentuj: backup PostgreSQL i test restore na osobnej DB, dry-run, zakończenie sesji przez użytkownika, stop usług, apply, weryfikację count/checksum/rekomendacji, restart, restore backupu przy rollback. Przykłady nie logują DATABASE_URL. **Nie wykonuj tej procedury na rodzinnej bazie w ramach samej implementacji/testu.**
- [x] **Step 5 — commit:** `git commit -m "fix: rebuild child progress from scoped reliable evidence"`.

### Task 11: Wielodniowa regresja całego algorytmu i dokumentacja

**Files:** Modify `tests/integration/learning-algorithm.test.ts`, `tests/e2e/learning-algorithm.spec.ts`, `tests/e2e/{kid-flow,privacy,progress-panel}.spec.ts` tylko gdy potrzebne asercje; `docs/{SPEC,architecture,folder-structure,implementation-plan}.md` i ten plan/checklist.

**Interfaces:** Wyłącznie istniejące server/Kid API i fixture Task 1. Testy domenowe/integracyjne używają `ManualClock`, prawdziwego submitAttempt i completePresentation; nie aktualizuj manualnie task.state/skill progress, aby „uzyskać” przejście etapów. Seed w Task 10 jest wyjątkiem odtwarzania celowo skażonej projekcji.

- [x] **Step 1 — testy regresji:** Zestaw 12 miesięcy i dwa profile. Symulacja 14 dni w kontrolowanym zegarze — maksymalnie jedna sesja dziennie na dziecko; każde otrzymuje niezależne Recall i pisownię dla wszystkich 12 słów, bez speech przy wyłączonym mikrofonie. E2E obejmuje błąd pisowni, ograniczoną poprawkę letter_completion i widok postępów na 390/768/1280 px.
  ```ts
  expect(monthsWithIndependentRecall.size).toBe(12);
  expect(monthsWithIndependentSpelling.size).toBe(12);
  expect(childBStreaks).toEqual(expectedFromChildBOnly);
  expect(eachSessionAssessedBudget.every(count => count <= 12)).toBe(true);
  expect(eachItemSupportRetries.every(count => count <= 1)).toBe(true);
  expect(tasksWithoutMic.some(task => task.exerciseType === "speech")).toBe(false);
  ```
  Symulacja wykonuje **maksymalnie 14 sesji na dziecko, jedną dziennie od t0**, ze sprawdzeniem wymienionych checkpointów, nie zwiększa budżetu; assert wszystkich 12 nadal obowiązuje na końcu, daty granic sprawdza osobny test. Plan nie obiecuje opanowania każdego słowa w cztery sesje.
- [x] **Step 2 — GREEN:** Scenariusz wielodniowy przeszedł po Task 1–10 i stanowi potwierdzenie integracji, nie dowód RED. Pierwsza pełna integracja ujawniła cztery wywołania starego fixture w `history.test.ts`, które wysyłały `text` do ćwiczenia wyboru; fixture poprawiono, a cały przebieg integracyjny przeszedł.
- [x] **Step 3 — docs:** SPEC doprecyśla dwie opcje, wyjątek singletona i 24-godzinny pierwszy termin; architektura opisuje scoped history, wsparcie, snapshot i priorytety; folder structure oraz implementation-plan wskazują nowe moduły, runbook i regresje. Nie zmieniono progów ani SQL.
- [ ] **Step 4 — full verification:** `pnpm test:unit` (328), `pnpm test:integration` (148), `pnpm typecheck`, `pnpm build` i celowane E2E algorytmu/panelu (4, w tym 390/768/1280 px) przeszły. Pełne `pnpm test:e2e` uruchomiło 56 scenariuszy, ale utknęło w `kid-flow.spec.ts` na mobilnym teście popupu po zrzucie `feedback-mobile-long.png`; proces zatrzymano po 10 minutach bez wyniku. Pełne E2E pozostaje otwartą bramką; nie twierdzimy, że przeszło.
- [x] **Step 5 — final review:** Diff sprawdzono selektywnie; nie użyto delegacji zgodnie z AGENTS.md. Commit `ce4de47` obejmuje tylko testy, dokumentację i fixture związane z tym zadaniem. Bramy real-data rebuild/deploy i test wymowy na urządzeniu pozostają osobne; merge/push nie zlecono.

## Polecenia końcowej weryfikacji — PowerShell

Istniejące skrypty sprawdzono w `package.json`. Ustaw odrębny runId; runner sprząta tylko jego kontenery. Wybierz wolne porty przed uruchomieniem E2E; podane wartości są kandydatami, nie potwierdzeniem ich dostępności.

```powershell
$env:UMIEM_TEST_RUN_ID = 'learning-repair-7ba3'
$env:UMIEM_E2E_PORT = '24731'
$env:UMIEM_WORKER_HEALTH_PORT = '34731'
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm typecheck
pnpm build
git diff --check
git status --short
```

Nie utrwalać sekretów w poleceniu. W trakcie zadań uruchamiać tylko celowane pliki; pełne bramki raz po finalnej zmianie i ponownie tylko po nowych poprawkach lub nieuzasadnionym wcześniej failure. Nowe regresje domenowe mają RED przed implementacją; istniejące testy i finalny cały scenariusz mogą być GREEN od pierwszego uruchomienia i nie stanowią wtedy dowodu TDD.

## Mapa pokrycia i warunki zakończenia

| Issue/RF | Zadania | Dowód akceptacji |
| --- | --- | --- |
| I01 | 1, 10, 11 | B jedna odpowiedź → streak 1; naprawione stare projekcje |
| I02 | 4, 6, 11 | Wspomagane wprowadzenie → późniejsze independent Recall/spelling |
| I03 | 3, 7, 11 | Jedna pomoc i jeden terminalny retry per element/session |
| I04 | 3 | Lowercase + poprawka bez fałszywego progu; technical nie zużywa dwóch błędów |
| I05 | 5, 11 | Brakujący kierunek wybrany; oba w ostatnim oknie sukcesów |
| I06 | 2, 10 | Reading+audio assisted; legacy bez przepisania ocen |
| I07 | 2, 6, 10, 11 | ≥2 różne opcje lub bezpieczna inna ścieżka; singleton bez fake mastery |
| I08 | 8 | Kierunkowa wiarygodna para preferowana, reserved zawsze wygrywa |
| I09 | 7, 11 | Wydane i ukończone letter_completion, bez independent streak |
| I10 | 9, 11 | Due recognition przed nowym materiałem; bezpieczny miks |
| RF1 | 1, 4, 11 | Dzieci i wersje nie mieszają dowodów |
| RF2 | 4, 11 | Skip/technical nie gubi pracy; 299/300 s cross-deck |
| RF3 | 6, 7, 9, 11 | Mały zestaw działa, fallback kończy się, zero leaks |
| RF4 | 2, 4, 11 | Drugi klient i delayed speech respektują received_at |
| RF5 | 1, 10, 11 | Dry-run read-only; apply odmowa/atomowość/idempotencja/restore |

Regresje z bazowego implementation-plan pozostają jawnie pokryte:

| Regresja | Zadania / sprawdzenie |
| --- | --- |
| R01 | 2, 4, 11: utracony ACK, cache replay, reload i dwa klienty; kwalifikacja przy received_at |
| R02 | Pełna integracja Task 11, istniejące `tests/integration/media.test.ts`: brak zmian bajtów gotowego audio; media jobs poza zakresem naprawy |
| R03 | 1, 10, 11: niezmienność historycznych danych i CASCADE profilu; odbudowa zmienia tylko projekcje |
| R04 | 3, 6, 7, 11: exposure completion jest idempotentne i nie tworzy ocen/budżetu |
| R05 | 4, 6, 8, 9, 11: należny kwalifikujący się sprawdzian przed ujawnieniem, także fragment i dystraktor |
| R06 | Pełna integracja Task 11, istniejące testy media/decks: zachowanie zgodnych mediów przy edycji; mechanizm regeneracji poza zakresem |
| R07 | 2, 8, 11: istniejąca integracja speech z zatwierdzonym wariantem; wymowa dla zgodnego tekstu albo unevaluated |

- [ ] Wszystkie nowe zachowania mają przejście RED→GREEN z opisem powodu porażki; nie użyto samego późniejszego PASS jako dowodu RED.
- [x] Publiczny DTO, prywatność audio, klucze odpowiedzi i ekspozycje zachowane. Pełne testy jednostkowe, integracyjne, typowanie i build mają wynik PASS; pełne E2E nie ma wyniku i jest jawnie opisane powyżej.
- [x] Zaktualizowane dokumenty odpowiadają faktycznej implementacji; żadnego pozostawionego `TBD` ani „dopisz testy”.
- [x] Procedura odbudowy przetestowana na sztucznej skażonej bazie; produkcyjne apply/deploy pozostaje jawnie osobnym krokiem po zleceniu właściciela.

## Self-review przygotowanego planu

- [x] Wszystkie dziesięć ustaleń audytu ma zadanie i kryterium, w tym trzy dodatkowe luki.
- [x] Typy, nazwy i zależności między zadaniami opisane; minimum opcji nie blokuje singleton Recall.
- [x] Nie dodano nowej bazy, tabeli training queue, publicznych pól ani wymogu mikrofonu.
- [x] Legacy evidence, różne polityki i niezmienne oceny mają osobną procedurę naprawy projekcji.
- [x] Review Focus przypisany do testów; zakres końcowej symulacji nie obiecuje nierealnych 12 słów × wszystkie umiejętności w cztery sesje.
- [x] Plan zawiera RED, implementację, GREEN i selektywny commit dla każdego wdrażanego fragmentu; końcowa integracja odróżnia dowód GREEN od prawdziwego RED.
- [x] Review projektu/planów przez właściciela i wybór wykonania — zaakceptowane w rozmowie 2026-10-09.

Naprawa I01–I10 została wdrożona i zweryfikowana na syntetycznej bazie. Pełny przebieg E2E pozostał nieukończony po zawieszeniu w mobilnym teście popupu; celowane E2E algorytmu i panelu postępów przeszło. Odbudowa na danych rodzinnych, wdrożenie i kalibracja wymowy z prawdziwym nagraniem nie zostały wykonane.
