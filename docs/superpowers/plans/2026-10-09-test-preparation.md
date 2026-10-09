# Priorytety przed sprawdzianem — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Bez delegacji bez zgody właściciela.

**Goal:** Ćwiczyć znane słowa wymagające pisowni/Recall przed nowym materiałem w oknie sprawdzianu.

**Architecture:** Termin i strefa są przypięte do prywatnego kontekstu sesji. Czysta funkcja czasu i obecny scheduler wprowadzają priorytet po należnych sprawdzeniach i wsparciu. Obecne Recall oferuje wpisywanie i osobne oceny treści/pisowni; odpowiedź ustna pozostaje dostępna, ale nie dowodzi pisowni.

**Tech Stack:** TypeScript, Intl, Drizzle/PostgreSQL, Vitest, Playwright.

**Spec:** `../specs/2026-10-09-learning-and-parent-reliability-design.md` §3, §6. Wspólne ograniczenia i odbiór: `2026-10-09-learning-and-parent-reliability.md`.

## Global Constraints

- Początek lokalnego dnia sprawdzianu wyznacza okno 48 godzin; cały dzień sprawdzianu aktywny, przeszłość i null nie.
- Termin przypięty do nowej sesji; legacy bez pola zachowuje dotychczasowy scheduler.
- Bez migracji kolumn, nowych endpointów i typów ćwiczeń. Rezerwacje, 300 sekund, 12 godzin, budżet 12 i obietnica końca obowiązują.

## Review Focus

DST, historyczna prezentacja, skip, retry next i brak bezpiecznego łatwego
kandydata są pokryte poniżej; R01/R04/R05 testujemy wraz z istniejącymi regresjami.

### Task 1: Izolacja runnerów potrzebna integracji i E2E (A0) — wykonano w `40380ca`

**Files:** Create `tests/{test-run-config.ts,test-run-config.test.ts}`; Modify `vitest.unit.config.ts`, `playwright.config.ts`, `tests/integration/global-setup.ts`, `tests/e2e/{global-setup.ts,kid-flow.spec.ts}`.

**Interfaces:** `readTestRunConfig(env: Record<string,string|undefined>): {integrationContainerPrefix:string; e2eContainer:string; e2ePort:number; worldFile:string}`. `UMIEM_TEST_RUN_ID` = `[a-z0-9-]+`, `UMIEM_E2E_PORT` = integer 1024–65535. Brak env zachowuje obecne nazwy, port 24500 i `.world.json`; ID wyznacza unikalny prefiks/nazwę/world file. Port wspólny dla setup i Playwright; konfiguracja odczytywana tylko raz na proces.

- [x] Napisać test dwóch ID: różne kontenery/prefiksy/worldFile; przypisany port jest identyczny dla wszystkich odbiorców. Odrzucić niepoprawny ID i port; sprawdzić defaults. Dopisać tylko ten test do include konfiguracji unit.
  ```ts
  it("isolates runner resources by run ID", () => {
    const a = readTestRunConfig({UMIEM_TEST_RUN_ID:"run-a",UMIEM_E2E_PORT:"24510"});
    const b = readTestRunConfig({UMIEM_TEST_RUN_ID:"run-b",UMIEM_E2E_PORT:"24511"});
    expect(a.integrationContainerPrefix).not.toBe(b.integrationContainerPrefix);
    expect(a.worldFile).not.toBe(b.worldFile);
    expect(a.e2ePort).toBe(24510);
  });
  ```
- [x] RED: `pnpm test:unit tests/test-run-config.test.ts` (12 testów; 11 oczekiwanych porażek przed implementacją). Następnie implementować helper i podłączyć wszystkie miejsca. Stale cleanup integration ograniczyć do własnego prefiksu. `kid-flow` odczytuje skonfigurowany world file.
- [x] GREEN: unit 28 plików/258 testów, integration 13 plików/135 testów, E2E 35/35, typecheck; run ID `b2d0-reliability`, port 24510. Commit `test: isolate database and browser test runs`.

### Task 2: Okno terminu (A1)

**Files:** Create `packages/server/src/domain/{test-preparation.ts,test-preparation.test.ts}`.

**Interfaces:** `isTestPreparationWindow(input: {now:string; testDate:string|null; timezone:string}): boolean`; bez rzeczywistego zegara i nowych zależności.

- [x] Napisać granice:
  ```ts
  expect(isTestPreparationWindow({now:"2026-10-08T22:00:00.000Z",testDate:"2026-10-11",timezone:"Europe/Warsaw"})).toBe(true);
  expect(isTestPreparationWindow({now:"2026-10-08T21:59:59.999Z",testDate:"2026-10-11",timezone:"Europe/Warsaw"})).toBe(false);
  expect(isTestPreparationWindow({now:"2026-10-23T22:00:00.000Z",testDate:"2026-10-26",timezone:"Europe/Warsaw"})).toBe(false); // 49 h
  expect(isTestPreparationWindow({now:"2026-10-23T23:00:00.000Z",testDate:"2026-10-26",timezone:"Europe/Warsaw"})).toBe(true); // 48 h
  ```
  Dodać cały dzień i jego koniec, datę przeszłą, null, UTC, błędną datę/strefę oraz wiosenne DST: 2027-03-29 zaczyna się 2027-03-28T22:00Z.
- [x] RED: `pnpm test:unit packages/server/src/domain/test-preparation.test.ts`; moduł brakował zgodnie z oczekiwaniem. Skorygowano błędny fixture wiosennej granicy, który przypadkowo sprawdzał czas już wewnątrz okna.
- [x] Implementować wyznaczanie lokalnego początku dnia przez Intl na absolutnych instantach; bez parsowania dnia jako UTC i bez sztywnego dodawania 24 h. Wadliwe dane wewnętrzne wyłączają priorytet zamiast blokować sesję.
- [x] GREEN: test 5/5 i typecheck zakończone powodzeniem; commit `5ba5963 feat: define family test preparation window`.

### Task 3: Scheduler (A2) — wykonano w `e9c548e`

**Files:** Modify `packages/server/src/domain/{scheduler.ts,scheduler.test.ts}`; Create `packages/server/src/domain/test-preparation-scheduler.test.ts`.

**Interfaces:** `ScheduleInput.testPreparation?: {testDate:string|null; timezone:string}`, `recentAssessedReasons?: readonly ScheduleReason[]` = ostatnie dwa chronologicznie; `ScheduleCandidate.hasBeenPresented?:boolean`, `testPreparationIssued?:boolean`. Brak nowych pól oznacza dotychczasowe zachowanie. `ScheduleReason` rozszerzyć o `test-preparation` i `test-preparation-break`. `recognitionPlan` akceptuje dodatkowy reason break.

- [x] Test: znana karta z wcześniejszą prezentacją, sukcesem listening i spelling learning + unseen wcześniejsze w liście. W oknie oczekiwać `{itemRevisionId:known.id,exerciseType:"recall",reason:"test-preparation",revealsTargetKeys:[]}`; bez terminu dotychczasowego new-material.
- [x] Dodać kolejność needs_reconfirmation → spelling → recall → position; nieznane nie jest przepytywane; mastered Recall+spelling nie jest kandydatem. Brak wcześniejszego recall nie blokuje przygotowania po prezentacji i rozpoznaniu.
- [x] Dodać due-check i support przed preparation, odstęp po wsparciu, wykluczenie settled i preparation-issued; wszystkie ujawniane cele/dystraktory chronią rezerwacje. Dwa ostatnie assessed reasons preparation → łatwe rozpoznawanie przed nowym materiałem, jeśli istnieje bezpieczny znany kandydat. Brak takiego kandydata wraca do zwykłych bezpiecznych priorytetów. Budżet zero daje null.
- [x] RED: `pnpm test:unit packages/server/src/domain/test-preparation-scheduler.test.ts`; 3 oczekiwane porażki potwierdziły brak priorytetu i przerwy.
- [x] Implementować priorytet po retry-after-support, przed stage-introduction. Deterministyczne sortowanie i istniejące recognitionPlan, bez osobnej oceny wiedzy lub luzowania kwalifikacji.
- [x] GREEN: domain 12 plików/147 testów, typecheck; commit `e9c548e feat: prioritize written practice before family tests`.

### Task 4: Sesje, historia i HTTP (A3)

**Files:** Modify `packages/server/src/modules/{sessions,events}.ts`, `tests/integration/sessions.test.ts`; Create `tests/e2e/test-preparation.spec.ts`; Modify `docs/{SPEC,architecture,folder-structure,implementation-plan}.md`.

**Interfaces:** `SessionContextShape.testDate?:string|null`; contextOf zachowuje pole, jeśli było, ale nie dopisuje go legacy sesji. Nowy start przypina assignment.testDate. W planNext historyczne exposure daje hasBeenPresented, task z reason preparation daje preparation-issued, ostatnie dwa oceniane taski (sortowane ordinal) dają recentAssessedReasons. Termin/strefa przekazywane tylko wewnętrznie, bez nowych Kid DTO.

- [x] Integracja: start przypina datę; zmiana przypisania nie zmienia resume, end+nowy start pobiera nową. Legacy bez pola nadal bez priorytetu po zapisach events/next. ManualClock i istniejące query/helpery.
- [x] Integracja: historyczne exposure i sukces rozpoznania → preparation przed unseen; równoległe next zwracają ten sam ID; retry nie zwiększa budżetu. Skip wyklucza dodatkowe preparation tego celu, „Nie pamiętam” daje wsparcie, unassessed nie zmienia reguł; odpowiedź pisemna ocenia osobno Recall/spelling, recent exposure nie daje niezależności.
  Asercje testu `pins_test_date_across_resume_and_new_start`:
  ```ts
  expect(resumed.sessionId).toBe(started.sessionId);
  expect(resumedContext.testDate).toBe("2026-10-11");
  expect(newContext.testDate).toBe("2026-10-12");
  expect(retriedTask.taskId).toBe(firstTask.taskId);
  ```
- [x] Przed wiring napisać E2E z seedingiem syntetycznej known/unseen i dzisiejszej daty: polskie pytanie i pole wpisywania przed nową kartą, także bez mikrofonu. RED `pnpm test:e2e tests/e2e/test-preparation.spec.ts`; expected pytanie pisemne zamiast prezentacji nowego słowa.
- [x] RED: `pnpm test:integration tests/integration/sessions.test.ts` z izolacją A0; 2 oczekiwane porażki pokazały brak przypięcia daty i priorytetu.
- [x] Implementować kontekst oraz odczyt historycznych tasków, zachowując wszystkie pola przy aktualizacji przez events. Nie pobierać późniejszego assignment.testDate dla legacy next. Issued prompt i zakończone oceny bez zmian.
- [x] GREEN: integracja 37/37, domain 147/147, E2E nowego scenariusza 1/1; typecheck.
- [x] `pnpm test:e2e tests/e2e/test-preparation.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/privacy.spec.ts` 9/9; typecheck, docs (SPEC A18 i architecture §9.3); commit `feat: pin test preparation context to learning sessions`.

## Checklista

- [x] Self-review: §3, interfejsy, DST, współbieżność i Review Focus.
- [x] Akceptacja planu i wykonania.
- [x] A0–A3 wykonane z RED/GREEN i commitami.\n- [ ] Pełny odbiór wspólnego pakietu.
