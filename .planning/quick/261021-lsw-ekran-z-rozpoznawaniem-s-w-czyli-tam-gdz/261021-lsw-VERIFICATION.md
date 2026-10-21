---
phase: quick-261021-lsw
verified: 2026-10-21T18:54:47Z
status: human_needed
score: 7/7 must-haves verified
covered_files:
  - .planning/quick/261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz/261021-lsw-PLAN.md
  - .planning/quick/261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz/261021-lsw-SUMMARY.md
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
covered_digest: "v3:sha256:890b9a936b5ddf49baa494fd755ad1352c3a5b3d5a4f549d9033bf37cb01fcb6"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 7/7
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Uruchomić pięć adaptowanych speców e2e na stacku docker (corepack pnpm exec playwright test tests/e2e/speech-recording-ux.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/kid-ui-layout.spec.ts tests/e2e/picture-vocabulary.spec.ts tests/e2e/kid-layout-stability.spec.ts)"
    expected: "Wszystkie zielone, włączając test auto-start/auto-stop (dokładnie jedna próba modality=audio w bazie dla taskId) i cisza-bez-próby (zero prób). SUMMARY deklaruje 77 zielonych w 2,8 min; weryfikator nie odtworzył przebiegu (global-setup stawia docker/serwery — poza ograniczeniami weryfikacji)."
    why_human: "E2E wymaga uruchomienia docker PostgreSQL, next dev i workera (serwery); weryfikator z założenia nie startuje usług. Poziom kontrolera jest pokryty 94 testami jednostkowymi, ale integracja przeglądarkowa (useEffect → autoCaptureSpeech) i asercje bazodanowe pozostają do odtworzenia na stacku."
  - test: "Sprawdzić kalibrację progów VAD (mowa >= 0.09, cisza < 0.05 w skali rms*4, grace ~300 ms) na urządzeniu docelowym z realnym dzieckiem (RESEARCH A1)"
    expected: "Realna wypowiedź dziecka domyka nagranie po ~1,2 s ciszy; tło/dom nie wyzwala fałszywego auto-stopu ani nie przeciąga nagrania do limitu 15 s."
    why_human: "Progi są stałymi kalibracyjnymi; jednostkowe testy operują na syntetycznych poziomach i nie mówią nic o realnym sygnale mikrofonu i akustyce pomieszczenia."
  - test: "Sprawdzić słyszalność bipu startu/końca i politykę autoplay na docelowym urządzeniu (iOS Safari / Android PWA)"
    expected: "Dziecko słyszy wyraźny sygnał „teraz mów” po gotowości mikrofonu i niższy sygnał końca; na suspended AudioContext bip degraduje się po cichu bez zawieszenia przepływu."
    why_human: "Ścieżka suspended i awaria Web Audio są pokryte testami jednostkowymi na fake'ach; realna słyszalność głośnika i polityka autoplay wymagają fizycznego urządzenia."
  - test: "Przejrzeć UX przepływu z dzieckiem: bip → mowa → auto-stop → karta wyniku; przycisk jako retry/fallback"
    expected: "Dziecko rozumie, że po bipie mówi od razu; brak wrażenia ucinania początku wypowiedzi; po „Nagraj jeszcze raz” mikrofon nie włącza się sam."
    why_human: "Subiektywny odbiór słuchowo-ustny przepływu i reakcja dziecka — niemożliwe do sprawdzenia programowo."
---

# Quick Task 261021-lsw: Automatyczne nagrywanie z VAD na ekranach mowy — Verification Report

**Phase Goal:** Automatyczny start nagrywania po wyświetleniu ekranu ćwiczenia mowy (speech/picture_speech), automatyczny stop po wykryciu wypowiedzianego słowa i ~1,2 s ciszy (VAD), syntetyczny bip WebAudio na początek (PRZED startem przechwytywania) i koniec (PO zatrzymaniu); cisza nie tworzy próby; przycisk pozostaje retry/fallbackiem.
**Verified:** 2026-10-21T18:54:47Z (re-verification delty 52c55c1; pierwsza weryfikacja: 2026-10-21T18:44:10Z)
**Status:** human_needed
**Re-verification:** Yes — delta po fixie review WR-01 (commit 52c55c1); pełna weryfikacja początkowa bez luk

## Delta Re-verification (commit 52c55c1)

Zakres delty potwierdzony przez `git diff --name-only e42acad..52c55c1`: dokładnie `packages/kid-ui/src/session/session-controller.ts` i `packages/kid-ui/src/session/session-controller.test.ts` (drzewo implementacyjne czyste).

- **Zmiana:** `stopRecording` po odczycie lokalnej flagi `autoCapture` woła pełny `#resetAutoCapture()` (zero `#vad`, `#autoCaptureActive`, `#autoStartBeep`) zamiast samego `#autoCaptureActive = false`. Zgubny hook bipu startu i terminalny VAD nie przetrwały do ręcznej próby po udanej auto-próbie.
- **Bezpieczeństwo zmiany potwierdzone w kodzie:** (1) bip końca nadal gra z lokalnej flagi odczytanej PRZED resetem (`const autoCapture = this.#autoCaptureActive;` poprzedza `#resetAutoCapture()`); (2) `#recordingGeneration` awansuje przed resetem, więc spóźnione `onLevel` starego rejestratora ginie na guardzie generacji i nigdy nie widzi wyzerowanego VAD; (3) ścieżka 300 ms (za krótkie nagranie) również korzysta z pełnego resetu.
- **Dowód behawioralny:** nowy test regresyjny „po udanej auto-próbie ręczne «Nagraj jeszcze raz» nie gra bipu startu (reset stanu auto, D-04)” — pełny cykl auto → submit → retry → ręczne `startRecording` asercjonuje `onMicrophoneReady` undefined, `recorder.started === 2`, `beeps === ["start","end"]`. Zielony.
- **Werdykt delty:** obserwacja ℹ️ Info z pierwszej weryfikacji (zgubny `#autoStartBeep` po udanej auto-próbie) ZAMKNIĘTA; wszystkie 7 prawd must-have utrzymanych; brak regresji (128/128 celowanych testów zielonych, typecheck czysty).

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Ekran zadania speech/picture_speech z dostępnym mikrofonem sam rozpoczyna nagrywanie po wyświetleniu zadania — bez naciskania przycisku (D-01, D-02) | ✓ VERIFIED | Wiring: `packages/kid-ui/src/screens/LearnScreen.tsx:122-126` (useEffect, deps `[controller, autoTaskId, autoPromptKind]`, bez feedbacku) → `autoCaptureSpeech()` (`session-controller.ts:1128-1154`, straże `#autoCaptureAllowed`:1156-1163). Behavioral: test „auto-próba: bip startu po gotowości mikrofonu…” przechodzi, asercja `recordingPhase: "recording"`. E2e „automat na zadaniu mowy sam nagrywa i sam kończy…” (`speech-recording-ux.spec.ts:485`) z asercją DB — deklarowane zielone, odtworzenie należy do właściciela (docker). |
| 2 | Bip startu gra po udanym getUserMedia i PRZED MediaRecorder.start; bip końca PO zebraniu bajtów (D-04) | ✓ VERIFIED | `browser.ts:222` — `await Promise.resolve(this.#options.onMicrophoneReady?.()).catch(() => undefined)` po guardzie generacji (212-215), przed `new MediaRecorder` (229) i `recorder.start(250)` (259). Behavioral: `browser.test.ts:265` (kolejność getUserMedia→hook→MediaRecorder), `:292` (odrzucenie połykane), `:303` (brak opcji — brak hooka); kontroler: wspólny log `["prepareMicrophone","beep:start","capture"]` oraz `beeps ["start","end"]` po `recorder.stop()``, bip końca z lokalnej flagi `autoCapture` przed `submitSpeech` bez blokowania wysyłki (utrzymane po delcie 52c55c1 — flaga odczytana przed resetem). Wszystkie przechodzą. |
| 3 | Po wykryciu mowy (2× próg) i ~1,2 s ciszy nagrywanie zatrzymuje się samo i tworzy dokładnie jedną próbę audio (D-03) | ✓ VERIFIED | `vad.ts` (progi 0.09/0.05, grace 3, sustain 2, cisza 12, terminalny „stopped"); `session-controller.ts:1187-1194` onLevel→`#vad.sample`→`auto_stop`→`stopRecording`. Behavioral: „auto-stop po mowie i ~1,2 s ciszy: jedno stopRecording, jedna próba audio, bip końca" — `stopped=1`, `speechSubmissions` ma długość 1, modality audio; e2e z asercją `select modality from attempts` = `[{modality:"audio"}]`. Przechodzi. |
| 4 | Cisza bez wykrytej mowy nie tworzy próby: limit 15 s anuluje z komunikatem, przycisk pozostaje fallbackiem (SPEC §15) | ✓ VERIFIED | `session-controller.ts:1195-1205` — `#autoCaptureActive && !speechDetected` → `cancelRecording(messages.kid.autoCaptureNoSpeech)`; komunikat w `messages.ts:534`. Behavioral: „cisza bez mowy: limit 15 s anuluje nagrywanie z komunikatem i bez próby" (cancelled=1, stopped=0, 0 zgłoszeń) oraz „ręczne nagrywanie po cichym auto-anulowaniu działa" (przycisk-fallback). Przechodzą. |
| 5 | Przycisk działa jak dotąd (hold/toggle/retry); WrittenView pozostaje ręczny (D-02) | ✓ VERIFIED | Ręczna ścieżka bez hooka i bez bipu startu (`session-controller.ts:1186` — hook przekazywany wyłącznie przy ustawionym `#autoStartBeep`); test „ręczne startRecording nie przekazuje hooka i nie gra bipu startu" przechodzi. Po delcie 52c55c1 również ręczna próba PO udanej auto-próbie jest bez bipu startu (nowy test regresyjny: `onMicrophoneReady` undefined, `beeps === ["start","end"]`). WrittenView/mock_test: „autoCaptureSpeech nic nie robi dla zadania pisemnego i w kartkówce" przechodzi. Gesty hold/toggle/escape na ścieżce ręcznej w e2e (`speech-recording-ux.spec.ts:383,463`). |
| 6 | Po „Nagraj jeszcze raz" mikrofon nie startuje sam (SPEC §16) — auto-start raz na nowe zadanie | ✓ VERIFIED | Podwójna ochrona: latch `#autoCaptureTaskId` (`session-controller.ts:1132,1143`, czyszczony wyłącznie w `#loadNext`:639) + deps useEffect bez `feedback` (LearnScreen:122-126). Behavioral: „po powrocie do ćwiczenia z retry (Nagraj jeszcze raz) autoCaptureSpeech nie startuje samo" — `recorder.started` pozostaje 1 po `continueLearning()`; nowy test delty potwierdza pełny cykl retry bez auto-startu (`started=2` wyłącznie po ręcznym `startRecording`). Przechodzi. |
| 7 | Odmowa mikrofonu, błąd urządzenia, offline i wyjście z ekranu zwalniają strumień i bufory; brak pętli ponowień | ✓ VERIFIED | Straże `#autoCaptureAllowed` (offline/micDenied/mode); odmowa w sondzie `prepareMicrophone` → istniejąca ścieżka micDenied/storage/`#disableSessionMicrophone` bez pętli (`session-controller.ts:1135-1142`); `#teardownRecording` → `#resetAutoCapture` + `recorder.cancel()` (~1492). Behavioral: „odmowa mikrofonu w trybie auto: ścieżka micDenied, zero próby, brak pętli ponowień" i „teardown w trakcie auto-nagrywania anuluje bez próby" (RF5) przechodzą; 24 testy `browser.test.ts` pokrywają zwalnianie strumienia na każdej ścieżce. |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/kid-ui/src/media/vad.ts` | Czysta maszyna stanów VAD (reducer+fabryka, bez DOM, eksportowane progi) | ✓ VERIFIED | 105 linii; progi/grace/sustain/trailing zgodne z planem; fazy arming→listening→spoken→stopped, terminal; używany przez session-controller (import linia 22) |
| `packages/kid-ui/src/media/vad.test.ts` | Testy sekwencji próbek | ✓ VERIFIED | 152 linie, 10 testów, wszystkie przechodzą |
| `packages/kid-ui/src/media/platform.ts` | `playBeep` w PlatformMedia + `onMicrophoneReady` w RecorderOptions | ✓ VERIFIED | 63 linie; `BeepKind`, `playBeep(kind)`, hook z udokumentowanym kontraktem kolejności |
| `packages/kid-ui/src/media/browser.ts` | Implementacja playBeep (WebAudio) + hook w BrowserRecorder.start | ✓ VERIFIED | 534 linie; `playBeepViaWebAudio` (AudioContext zamykany w finally, obwiednia, 880/590 Hz, degradacja po cichu); hook na pozycji 222 |
| `packages/kid-ui/src/session/session-controller.ts` | Orkiestracja autoCaptureSpeech | ✓ VERIFIED | ~1502 linie (po delcie 52c55c1); pełna implementacja zgodna z planem + pełny reset stanu auto w `stopRecording` |
| `packages/kid-ui/src/session/session-controller.test.ts` | Testy kontrolera | ✓ VERIFIED | 94 testy (93 + nowy regresyjny delty), wszystkie przechodzą |
| `packages/kid-ui/src/screens/LearnScreen.tsx` | Jedyny punkt wiringu auto-startu | ✓ VERIFIED | useEffect 122-126 z komentarzem intencji; deps bez feedbacku |
| `packages/contracts/src/messages.ts` | `kid.autoCaptureNoSpeech` | ✓ VERIFIED | Linia 534, dokładnie planowany tekst PL; używany w kontrolerze i e2e |
| `docs/SPEC.md` | §6/§12 opisują auto-nagrywanie z datą | ✓ VERIFIED | Linie 147 i 317 — pełny opis (auto-start, bip przed przechwytywaniem, VAD ~1,2 s, cisza bez próby, przycisk, retry bez auto, ręczne tryby bez zmian), data 2026-10-21 |
| 5 speców e2e | Adaptacja do auto-przepływu | ✓ VERIFIED | speech-recording-ux (nowe testy auto z asercjami DB + `window.__kidMicLevel`), kid-flow (startFakeRecording czeka auto-start), kid-ui-layout (preparing bez kliku, wiszący getUserMedia), picture-vocabulary (oczekiwanie na idle przed skip), kid-layout-stability (iteracja speech na cyklu auto) |

Wszystkie 15 plików z `files_modified` istnieje i jest merytoryczne; `git diff --name-only 029469a..52c55c1` pokazuje dokładnie te 15 plików (bez unauthorized scope creep). Zero nowych zależności — `packages/kid-ui/package.json` wyłącznie `@learning/contracts` + peer react (T-261021-SC).

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| LearnScreen useEffect (taskId + prompt.kind) | autoCaptureSpeech → prepareMicrophone → startRecording → BrowserRecorder.start (getUserMedia → onMicrophoneReady → playBeep("start") → MediaRecorder.start) → onLevel → reduceVad → auto_stop → stopRecording → submitSpeech | ścieżka bez zmian kontraktu | ✓ WIRED | Każde ogniwo potwierdzone w kodzie (LearnScreen:122-126, controller:1128-1154/1146/1186, browser:203-259); kolejność potwierdzona testami jednostkowymi (wspólny log `["prepareMicrophone","beep:start","capture"]` — zielony) |
| BrowserRecorder onLevel (AnalyserNode, RMS×4, ~10 Hz) | session-controller → reduceVad → auto_stop → stopRecording → submitSpeech | ścieżka bez zmian | ✓ WIRED | `#startLevelMonitor` (browser.ts:390-420, fftSize 256, rms×4, throttling ≥100 ms); onLevel kontrolera próbuje VAD (controller:1187-1194); test auto-stopu zielony |
| onLimitReached | VAD słyszał mowę ? stopRecording : cancelRecording | cisza nigdy nie woła submitSpeech | ✓ WIRED | controller:1195-1205; testy „cisza bez mowy…"(0 zgłoszeń, cancel) i „limit po usłyszanej mowie…"(1 zgłoszenie, stop) zielone |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| LearnScreen / session-controller | inputLevel, VAD action | `BrowserRecorder.onLevel` → AnalyserNode RMS na realnym strumieniu | ✓ | FLOWING (poziom liczony ze strumienia mikrofonu, nie statyczny) |
| session-controller | recordingNotice (cisza) | `messages.kid.autoCaptureNoSpeech` z contracts | ✓ | FLOWING (katalog komunikatów PL, wspólny źródło) |
| browser.ts | beep frequency/duration | stałe kalibracyjne `BEEP_*` | n/d | Celowe stałe projektowe (dokumentowane), nie dane dynamiczne |

Nie dotyczy renderowania danych statycznych — warstwa to orkiestracja sterowania; brak HOLLOW/STATIC ścieżek produkcyjnych.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Testy VAD + bip + hook + auto-przepływ kontrolera (po delcie 52c55c1) | `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/media/vad.test.ts packages/kid-ui/src/media/browser.test.ts` | 3 pliki, 128/128 zielonych (vad 10, browser 24, controller 94 — w tym nowy test regresyjny delty) | ✓ PASS |
| Pełna suita unit kid-ui + contracts (blok `<verification>` planu; pierwsza weryfikacja) | `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui packages/contracts` | 44 pliki, 484/484 zielonych — identycznie z deklaracją SUMMARY | ✓ PASS |
| Typy (po delcie) | `corepack pnpm typecheck` | wszystkie tsconfigi bez błędów (exit 0) | ✓ PASS |
| E2E (5 speców, docker via global-setup) | `corepack pnpm exec playwright test tests/e2e/{speech-recording-ux,kid-flow,kid-ui-layout,picture-vocabulary,kid-layout-stability}.spec.ts` | nie uruchomione przez weryfikatora — wymaga docker PostgreSQL + next dev + worker (start usług poza ograniczeniami weryfikacji); SUMMARY deklaruje 77 zielonych w 2,8 min | ? SKIP → Human Verification |

### Probe Execution

Nie dotyczy — zadanie nie deklaruje sond `scripts/*/tests/probe-*.sh`; brak migracji/CLI w zakresie.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| QUICK-261021-LSW | 261021-lsw-PLAN.md | Cel zadania quick (auto-nagrywanie z VAD, bip, cisza bez próby, przycisk-fallback) | ✓ SATISFIED | Prawdy 1-7 VERIFIED; REQUIREMENTS.md nie mapuje tego ID (lokalny identyfikator quick-task, brak sierocych wymagań fazy) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | Brak markerów TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER we wszystkich 15 zmienionych plikach; brak skipped/todo testów; brak pustych implementacji na ścieżkach produkcyjnych (skan powtórzony po delcie — czysto) | — | Czysto |
| packages/kid-ui/src/session/session-controller.ts | ~1263 | ℹ️ Info z pierwszej weryfikacji (zgubny `#autoStartBeep` po udanej auto-próbie → bip startu na ręcznej reniecie) — ZAMKNIĘTE przez 52c55c1: `stopRecording` woła pełny `#resetAutoCapture()` po odczycie flagi; regresyjny test zielony (patrz Delta Re-verification) | ℹ️ Info (rozwiązane) | Brak otwartych pozycji |

### Decision Coverage

Decision coverage gate: skipped — „No trackable decisions in CONTEXT.md" (0 decisions, non-blocking). PLAN nie zawiera bloków `<verify><human-check>` do zebrania.

### Human Verification Required

### 1. Odtworzenie pięciu speców e2e na stacku docker

**Test:** `corepack pnpm exec playwright test tests/e2e/speech-recording-ux.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/kid-ui-layout.spec.ts tests/e2e/picture-vocabulary.spec.ts tests/e2e/kid-layout-stability.spec.ts`
**Expected:** Wszystkie zielone, w tym auto-start/auto-stop (dokładnie jedna próba `modality=audio` w bazie) i cisza-bez-próby (zero prób). SUMMARY deklaruje 77 zielonych w 2,8 min — weryfikator nie odtworzył (global-setup stawia serwery).
**Why human:** Wymaga docker PostgreSQL, next dev i workera; weryfikator nie startuje usług. Logika kontrolera jest pokryta 94 testami jednostkowymi, ale integracja przeglądarkowa (useEffect → autoCaptureSpeech) i asercje DB wymagają stacku.

### 2. Kalibracja progów VAD na urządzeniu docelowym (RESEARCH A1)

**Test:** Sesja z dzieckiem na docelowym sprzęcie: wypowiedź po bipie, potem cisza; obserwować moment auto-stopu oraz brak fałszywych stopów przy hałasie tła.
**Expected:** Stop ~1,2 s po zakończeniu wypowiedzi; tło nie wyzwala auto-stopu ani nie przeciąga do limitu 15 s.
**Why human:** Progi (0.09/0.05 w skali rms×4) to stałe kalibracyjne; testy jednostkowe używają syntetycznych poziomów i nic nie mówią o realnym sygnale mikrofonu dziecka.

### 3. Słyszalność bipu i polityka autoplay na urządzeniu

**Test:** Uruchomić przepływ na iOS Safari / docelowym Androidzie (PWA); obserwować bip startu/końca i zachowanie przy braku interakcji.
**Expected:** Wyraźny wyższy bip „teraz mów" i niższy bip końca; na suspended AudioContext ścieżka degraduje się po cichu bez zawieszenia nagrywania.
**Why human:** Ścieżka suspended pokryta testami na fake'ach; realna słyszalność głośnika i polityka autoplay wymagają fizycznego urządzenia.

### 4. Przegląd UX przepływu z dzieckiem

**Test:** Przejść przez ekran mowy: bip → mowa → auto-stop → karta wyniku; potem „Nagraj jeszcze raz" i próba ręczna przyciskiem.
**Expected:** Dziecko rozumie sygnał; brak wrażenia ucinania początku wypowiedzi; po „Nagraj jeszcze raz" mikrofon nie włącza się sam.
**Why human:** Subiektywny odbiór słuchowy i reakcja dziecka — niemożliwe do sprawdzenia programowo.

### Gaps Summary

Brak luk blokujących. Wszystkie 7 prawd must-haves zweryfikowanych z dowodem behawioralnym (po delcie 52c55c1: 128/128 celowanych testów jednostkowych zielonych, w tym nowy regresyjny test ręcznej retry bez bipu startu; pełna suita 484/44 z pierwszej weryfikacji; typecheck czysty); wszystkie artefakty istnieją, są merytoryczne i podłączone; 3/3 kluczowych połączeń WIRED; zero markerów długu i zero nowych zależności; SPEC §6/§12 oraz wpływ API→MCP (brak) udokumentowane. Obserwacja ℹ️ Info z pierwszej weryfikacji zamknięta fixem 52c55c1 z testem regresyjnym. Status `human_needed` wynika wyłącznie z pozycji wymagających człowieka/środowiska: odtworzenia e2e na stacku docker (deklarowane zielone w SUMMARY, nieprzerobione tutaj z powodu ograniczenia na start usług) oraz planowych sprawdzeń urządzeniowych (kalibracja VAD, bip, UX z dzieckiem), których plan z góry nie obejmował budżetem weryfikacji automatycznej.

---

_Verified: 2026-10-21T18:54:47Z (delta 52c55c1)_
_Verifier: Claude (gsd-verifier)_
