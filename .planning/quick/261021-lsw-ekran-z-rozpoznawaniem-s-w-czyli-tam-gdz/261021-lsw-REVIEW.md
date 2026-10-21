---
phase: 261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz
reviewed: 2026-10-21T18:44:46Z
depth: quick
files_reviewed: 15
files_reviewed_list:
  - docs/SPEC.md
  - packages/contracts/src/messages.ts
  - packages/kid-ui/src/media/browser.test.ts
  - packages/kid-ui/src/media/browser.ts
  - packages/kid-ui/src/media/platform.ts
  - packages/kid-ui/src/media/vad.test.ts
  - packages/kid-ui/src/media/vad.ts
  - packages/kid-ui/src/screens/LearnScreen.tsx
  - packages/kid-ui/src/session/session-controller.test.ts
  - packages/kid-ui/src/session/session-controller.ts
  - tests/e2e/kid-flow.spec.ts
  - tests/e2e/kid-layout-stability.spec.ts
  - tests/e2e/kid-ui-layout.spec.ts
  - tests/e2e/picture-vocabulary.spec.ts
  - tests/e2e/speech-recording-ux.spec.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 261021-lsw: Code Review Report

**Reviewed:** 2026-10-21T18:44:46Z
**Depth:** quick (pattern scan + focused read of all changed source; diff range 029469a..HEAD, branch fix/speech-recognition)
**Files Reviewed:** 15
**Status:** issues_found

## Summary

The change adds automatic speech capture with VAD (voice activity detection), WebAudio start/end beeps, and an `onMicrophoneReady` hook, wired through `LearnScreen` → `LearningSessionController` → `media/vad.ts`/`browser.ts`, plus SPEC text, shared Polish messages, unit tests, and e2e coverage. The core design is solid: the VAD reducer is pure and terminal-state safe; the start beep fires after `getUserMedia` and before capture (so it cannot leak into the recording); silence never creates an attempt (SPEC §15); the auto-start latch implements "once per task display" (SPEC §16); recording buffers are zeroed on every discard path; and kid-ui stays free of Next.js imports and new runtime dependencies. All 127 unit tests in the touched modules pass.

Two warnings remain: a state-reset asymmetry that leaks the start beep into a subsequent manual recording, and an auto permission probe that runs outside any user-gesture context (a known WebKit/iOS constraint that can silently persist a `micDenied` flag the child never chose).

## Structural Findings (fallow)

No structural pre-pass was provided for this review.

## Narrative Findings (AI reviewer)

### Warnings

### WR-01: Po udanej auto-próbie `#autoStartBeep`/`#vad` nie są resetowane — ręczne „Nagraj jeszcze raz" na tym samym zadaniu gra bip startu i karmi terminalnym VAD

**File:** `packages/kid-ui/src/session/session-controller.ts:1262-1264` (konsumpcja bez resetu), `packages/kid-ui/src/session/session-controller.ts:1184-1187` (warunek hooka), kontrast: `cancelRecording` w `session-controller.ts:1302-1309` i `#loadNext` w `session-controller.ts:638-639` (obie ścieżki resetują)
**Issue:** `stopRecording()` konsumuje tylko `#autoCaptureActive` (`autoCapture` local), ale nie woła `#resetAutoCapture()` — `#autoStartBeep` i `#vad` przeżywają sukcesyjne domknięcie auto-nagrania aż do następnego zadania. Scenariusz: auto-próba → karta wyniku z `retry` → „Nagraj jeszcze raz" (`continueLearning`, ten sam `taskId`) → dziecko świadomie przyciska mikrofon. `startRecording()` widzi `this.#autoStartBeep !== null` i przekazuje hook `onMicrophoneReady`, więc **ręczne** nagranie gra bip „teraz mów" — wbrew własnemu invariantowi kodu („ścieżka ręczna (pole null) nie przekazuje hooka i nie gra bipu (D-04)"). Równolegle `onLevel` podaje próbki do starego `#vad` w stanie terminalnym (obojętne funkcjonalnie, ale potwierdza brakujący reset). Test jednostkowy „ręczne startRecording nie przekazuje hooka i nie gra bipu startu" mija tylko dlatego, że biegnie na świeżym kontrolerze, gdzie auto jeszcze nigdy nie wystartowało; ścieżka `cancelRecording` resetuje (test „ręczne nagrywanie po cichu auto-anulowania…" widzi `beeps: ["start"]`), co uwidacznia asymetrię.
**Fix:** W `stopRecording()` zaraz po odczytaniu `autoCapture` wywołaj `#resetAutoCapture()` — bezpieczne, bo `#recordingGeneration` jest już zwiększone na początku metody, więc spóźnione `onLevel` są i tak martwe:

```ts
const autoCapture = this.#autoCaptureActive;
this.#autoCaptureActive = false;
this.#resetAutoCapture(); // czyści też #vad i #autoStartBeep — ręczne retry bez bipu
```

### WR-02: Sonda uprawnień auto-nagrywania działa poza kontekstem gestu użytkownika — na WebKit/iOS ryzyko automatycznego zapamiętania `micDenied`, którego dziecko nie dokonało

**File:** `packages/kid-ui/src/screens/LearnScreen.tsx:122-126` (efekt po wyświetleniu zadania), `packages/kid-ui/src/session/session-controller.ts:1135-1141` (sonda `prepareMicrophone`), `packages/kid-ui/src/session/session-controller.ts:1099-1102` (trwałe `MIC_DENIED_KEY="1"` po `NotAllowedError`)
**Issue:** `autoCaptureSpeech()` startuje z efektu renderowania zadania, bez aktywacji użytkownika; gdy mikrofon nie jest gotowy, woła `prepareMicrophone()` → `getUserMedia`. WebKit (Safari/iOS — realny cel tabletowy tej aplikacji) wymaga wywołania `getUserMedia` z gestu użytkownika i poza nim odrzuca żądanie jako `NotAllowedError` ZANIM dziecko cokolwiek decidinguje. Kontroler potraktuje to jako świadomą odmowę: zapisze `micDenied` do storage, wyłączy auto-próbę i pokaże „Mikrofon niedostępny" — trwale, na kolejne zadania i sesje, mimo że dziecko nigdy nie odrzuciło promptu (prompt w ogóle się nie pokazał). Dodatkowo w tym samym kontekście świeży `AudioContext` dla bipu startu będzie `suspended` i bip wyciszy się z założenia (T-261021-02), więc na iOS dziecko może dostać ani sygnału „teraz mów", ani szansy na prompt. Ścieżka naprawcza istnieje (świadome dotknięcie przycisku nagrywania/przełącznika czyszczi flagę), ale wymaga, by dziecko zrozumiało, co się stało.
**Fix:** Minimalnie: w ścieżce auto nie persistuj `micDenied` z sondy uruchomionej bez gestu (rozróżnij „prompt odrzucony" od „wywołanie poza gestem" — np. flaga `probe: true` w `prepareMicrophone` i pominięcie zapisu `MIC_DENIED_KEY`, z komunikatem zachęcającym do dotknięcia przycisku); docelowo rozważ ograniczenie auto-startu do sesji, w których mikrofon ma już nadane uprawnienie (`microphoneReady` z poprzednich zadań), z pierwszym nadaniem zgody zawsze przez świadome dotknięcie przycisku.

### Info

### IN-01: Zadanie wyświetlone w stanie `processing`/`busy` nigdy nie dostaje auto-próby, nawet po ustąpieniu blokady

**File:** `packages/kid-ui/src/screens/LearnScreen.tsx:122-126`, `packages/kid-ui/src/session/session-controller.ts:1131-1132,1156-1163`
**Issue:** Efekt auto-startu odpala się raz na parę `(taskId, promptKind)`; zatrzask `#autoCaptureTaskId` jest ustawiany dopiero, gdy `#autoCaptureAllowed` przejdzie. Zadanie wznowionej sesji z `pendingAttemptId` (odświeżenie w trakcie oceny) renderuje się z `processing: true` → warunek failuje → po zakończeniu pollingu i feedbacku z `retry` efekt już nie odpali (taskId bez zmian) i auto-start dla tego zadania przepada. Zachowanie konserwatywne i zgodne z literą „nowo wyświetlone zadanie", ale wygląda na przypadkowe, niedecyzyjne.
**Fix:** Jeśli to zamierzone — dopisz do komentarza/invariantu przypadki `pendingAttemptId` i `busy`; jeśli nie — przelicz warunek w `continueLearning()` po zniknięciu feedbacku retry tego samego zadania.

### IN-02: `startFakeRecording` w kid-flow połyka niepowodzenie asercji auto-startu — regresja auto-startu w tym pliku przejdzie jako ręczna ścieżka

**File:** `tests/e2e/kid-flow.spec.ts:216-227`
**Issue:** Blok `try { await expect.poll(...)... } catch { started = false; }` treatuje TimeoutException z asercji auto-startu tak samo jak „auto nie było możliwe" i cicho degraduje do ścieżki ręcznej; test wtedy i tak przechodzi. Osłabia sygnał regresyjny auto-nagrywania w tym pliku (łagodzone przez dedykowane testy w `speech-recording-ux.spec.ts`).
**Fix:** Odróżnij oczekiwane warunki (np. sprawdź atrybut `data-prompt-kind` / `microphoneEnabled` fixture) od timeoutu asercji; przy nieoczekiwanym timeoutie rzuć.

### IN-03: Test „mówione ćwiczenie obrazkowe można świadomie pominąć bez mikrofonu" instaluje działający mikrofon i czeka pełny limit 15 s

**File:** `tests/e2e/picture-vocabulary.spec.ts:159-208`
**Issue:** Tytuł obiecuje scenariusz „bez mikrofonu", ale po wprowadzeniu auto-próby test instaluje sprawną atrapę `getUserMedia`/`MediaRecorder`, pozwala auto-nagrywaniu wystartować i realnie czeka ~15 s na anulowanie ciszą, dopiero potem klika „Pomiń". Scenariusz jest nadal wartościowy (pominięcie po auto-anulowaniu), ale nazwa i `test.slow()` z fixed 25 s waitem wprowadzają w błąd i wydłużają zestaw.
**Fix:** Przemianuj test (np. „…po cichym auto-anulowaniu limitem") albo skróć oczekiwanie przez sterowalny `__kidMicLevel`/sztuczny limit, jeśli infrastruktura na to pozwala.

---

_Reviewed: 2026-10-21T18:44:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
