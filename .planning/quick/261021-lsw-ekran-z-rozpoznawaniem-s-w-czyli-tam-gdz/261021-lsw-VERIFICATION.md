---
phase: quick-261021-lsw
verified: 2026-10-21T19:22:24Z
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
covered_digest: "v3:sha256:d751fcec502878212851e722b080c53c4869dba6feec81e991c1ccce6f56836f"
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
    expected: "Wszystkie zielone, włączając test auto-start/auto-stop (dokładnie jedna próba modality=audio w bazie dla taskId), cisza-bez-próby (zero prób) oraz nowy przypadek WR-02 prompt (bez auto-startu; przycisk działa). SUMMARY deklaruje 77 zielonych sprzed delty WR-02; weryfikator nie odtworzył przebiegu (global-setup stawia docker/serwery — poza ograniczeniami weryfikacji)."
    why_human: "E2E wymaga uruchomienia docker PostgreSQL, next dev i workera (serwery); weryfikator z założenia nie startuje usług. Poziom kontrolera jest pokryty 99 testami jednostkowymi, ale integracja przeglądarkowa (useEffect → autoCaptureSpeech → brama uprawnień) i asercje bazodanowe pozostają do odtworzenia na stacku."
  - test: "Sprawdzić kalibrację progów VAD (mowa >= 0.09, cisza < 0.05 w skali rms*4, grace ~300 ms) na urządzeniu docelowym z realnym dzieckiem (RESEARCH A1)"
    expected: "Realna wypowiedź dziecka domyka nagranie po ~1,2 s ciszy; tło/dom nie wyzwala fałszywego auto-stopu ani nie przeciąga nagrania do limitu 15 s."
    why_human: "Progi są stałymi kalibracyjnymi; jednostkowe testy operują na syntetycznych poziomach i nie mówią nic o realnym sygnale mikrofonu i akustyce pomieszczenia."
  - test: "Sprawdzić słyszalność bipu startu/końca i politykę autoplay na docelowym urządzeniu (iOS Safari / Android PWA), w tym realne stany Permissions API (Chrome granted/prompt/denied, Firefox brak API → unknown)"
    expected: "Dziecko słyszy wyraźny sygnał „teraz mów” po gotowości mikrofonu i niższy sygnał końca; na suspended AudioContext bip degraduje się po cichu bez zawieszenia przepływu; przy braku wcześniejszej zgody automat nie startuje ani nie wywołuje promptu — dopiero przycisk."
    why_human: "Ścieżka suspended i mapowanie Permissions API pokryte testami na fake'ach; realna słyszalność głośnika, polityka autoplay i zachowanie Permissions API wymagają fizycznego urządzenia."
  - test: "Przejrzeć UX przepływu z dzieckiem: bip → mowa → auto-stop → karta wyniku; przycisk jako retry/fallback; pierwsze nadanie zgody świadomym przyciśnięciem"
    expected: "Dziecko rozumie, że po bipie mówi od razu; brak wrażenia ucinania początku wypowiedzi; po „Nagraj jeszcze raz” mikrofon nie włącza się sam; przy pierwszym użyciu zgoda należy do naciśnięcia przycisku."
    why_human: "Subiektywny odbiór słuchowo-ustny przepływu i reakcja dziecka — niemożliwe do sprawdzenia programowo."
---

# Quick Task 261021-lsw: Automatyczne nagrywanie z VAD na ekranach mowy — Verification Report

**Phase Goal:** Automatyczny start nagrywania po wyświetleniu ekranu ćwiczenia mowy (speech/picture_speech), automatyczny stop po wykryciu wypowiedzianego słowa i ~1,2 s ciszy (VAD), syntetyczny bip WebAudio na początek (PRZED startem przechwytywania) i koniec (PO zatrzymaniu); cisza nie tworzy próby; przycisk pozostaje retry/fallbackiem.
**Verified:** 2026-10-21T19:22:24Z (re-verification delty db565e4/WR-02; poprzednie: 52c55c1 — 2026-10-21T18:54:47Z; pierwsza weryfikacja — 2026-10-21T18:44:10Z)
**Status:** human_needed
**Re-verification:** Yes — delta po właścicielowskim fixie WR-02 (commit db565e4); wcześniejsze pełne weryfikacje bez luk

## Delta Re-verification 2 (commit db565e4, WR-02)

Zakres delty potwierdzony przez `git show db565e4 --stat`: dokładnie 11 opisanych plików (platform.ts, browser.ts, session-controller.ts, 2 pliki testów unit, 5 speców e2e, SPEC.md; dodatkowo SUMMARY.md zaktualizowany w drzewie roboczym — niezacommitowany, zgodnie z opisem). Drzewo implementacyjne czyste. Pliki .planning w zakresie 52c55c1..db565e4 pochodzą z osobnego commitu dokumentacyjnego 216bc26 (inertne dla odcisku).

**Cel delty (goal-backward):** automat NIE może wywołać getUserMedia poza gestem, gdy uprawnienie mikrofonu nie zostało jeszcze nadane (prompt/denied/unknown), i pominięty auto-start nie może zapamiętać micDenied.

- **Port:** `PlatformMedia.getMicrophonePermission(): Promise<"granted"|"prompt"|"denied"|"unknown">` (platform.ts). Adapter `queryMicrophonePermission` (browser.ts): wyłącznie `navigator.permissions.query({name:"microphone"})` w try/catch; brak API/niewspierana nazwa/awaria/niemożliwy-do-zmapowania stan → bezpieczne `unknown`; zero getUserMedia, zero efektów ubocznych (test adapteru asercjonuje mapowanie stanów i brak side-effectów).
- **Brama:** `autoCaptureSpeech` przy `!microphoneReady` najpierw odpytuje o STAN uprawnienia (try/catch → unknown); `permission !== "granted"` → **cichy skip** (return) — bez sondy getUserMedia, bez zapisu micDenied, bez blokady kolejnych zadań; `granted` → dotychczasowa sonda `prepareMicrophone` (nie może wywołać promptu, bo zgoda już nadana). Przy `microphoneReady` (mikrofon już używany w sesji) brama pominięta — nowe pytanie o zgodę nie jest możliwe. Ścieżka ręczna (przycisk → prepareMicrophone/startRecording) nietknięta — pierwsze nadanie zgody = świadome naciśnięcie.
- **Dowód behawioralny (uruchomiony przez weryfikatora):** 5 nowych testów kontrolera zielonych — „prompt” pomija auto-start (log wyłącznie `["permission:prompt"]`, recorder.started=0, `micDenied: false`, po czym przycisk działa), „denied” i „unknown” pomijają bez zapamiętania odmowy, „granted” — auto-start jak dotychczas (log `["permission:granted","prepareMicrophone","beep:start","capture"]`), mikrofon gotowy w sesji — zero zapytań o uprawnienie (log `["beep:start","capture"]`). Adapter: mapowanie granted/prompt/denied/inny→unknown, awaria→unknown. Suma: 134/134 zielonych (controller 99, browser 25, vad 10), typecheck PASS.
- **E2E (adaptowane, deklarowane):** sterowalny `window.__kidMicPermission` (domyślnie granted) w speech-recording-ux i kid-flow; statyczny fake granted w kid-ui-layout/picture-vocabulary/kid-layout-stability; nowy przypadek „prompt” w speech-recording-ux.spec.ts:570-593 — idle bez kliku przez 1,5 s, brak `kid-recording`, po świadomym kliku przygotowanie i nagrywanie ręczne.
- **Zgodność z planem:** WR-02 nie zawęża celu — implementuje mitigację T-261021-01 z rejestru zagrożeń PLANu („auto-start działa wyłącznie po uprzednio wydanej zgodzie”), czyli domyka odstępstwo od własnej specyfikacji bezpieczeństwa planu. SPEC §6/§12 dokumentuje warunek (2026-10-21).
- **Werdykt delty:** WR-02 ZAMKNIĘTE z dowodem; wszystkie 7 prawd utrzymanych; brak regresji; brak scope creep (dokładnie 11 plików commitu).

## Delta Re-verification 1 (commit 52c55c1) — zamknięta

`stopRecording` po odczycie lokalnej flagi `autoCapture` woła pełny `#resetAutoCapture()` — zgubny hook bipu startu i terminalny VAD nie przetrwały do ręcznej próby po udanej auto-próbie. Bezpieczeństwo: bip końca z lokalnej flagi odczytanej PRZED resetem; `#recordingGeneration` awansuje przed resetem, więc spóźnione `onLevel` starego rejestratora ginie na guardzie generacji. Regresyjny test (ręczne „Nagraj jeszcze raz” bez bipu startu: `onMicrophoneReady` undefined, `recorder.started === 2`, `beeps === ["start","end"]`) zielony. Obserwacja ℹ️ Info z pierwszej weryfikacji zamknięta.

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Ekran zadania speech/picture_speech z dostępnym mikrofonem sam rozpoczyna nagrywanie po wyświetleniu zadania — bez naciskania przycisku (D-01, D-02) | ✓ VERIFIED | Wiring: `packages/kid-ui/src/screens/LearnScreen.tsx:122-126` (useEffect, deps `[controller, autoTaskId, autoPromptKind]`, bez feedbacku) → `autoCaptureSpeech()` (straże `#autoCaptureAllowed`; od WR-02 dodatkowo warunek zgody: granted albo `microphoneReady` — zgodnie z mitigacją T-261021-01 planu). Behavioral: „granted — auto-start przebiega jak dotychczas” (log `["permission:granted","prepareMicrophone","beep:start","capture"]`) i „mikrofon już gotowy w sesji — auto-start bez pytania o uprawnienie” — zielone; e2e „automat na zadaniu mowy sam nagrywa…” z asercją DB — deklarowane zielone, odtworzenie na stacku docker należy do właściciela. |
| 2 | Bip startu gra po udanym getUserMedia i PRZED MediaRecorder.start; bip końca PO zebraniu bajtów (D-04) | ✓ VERIFIED | `browser.ts` — hook `onMicrophoneReady` po guardzie generacji, przed `new MediaRecorder` i `recorder.start`; kontroler: wspólny log `["permission:granted","prepareMicrophone","beep:start","capture"]` oraz `beeps ["start","end"]`, bip końca z lokalnej flagi `autoCapture` przed `submitSpeech` (utrzymane po obu deltach). Testy zielone. |
| 3 | Po wykryciu mowy (2× próg) i ~1,2 s ciszy nagrywanie zatrzymuje się samo i tworzy dokładnie jedną próbę audio (D-03) | ✓ VERIFIED | `vad.ts` (progi 0.09/0.05, grace 3, sustain 2, cisza 12, terminalny „stopped"); `session-controller.ts` onLevel→`#vad.sample`→`auto_stop`→`stopRecording`. Behavioral: „auto-stop po mowie i ~1,2 s ciszy: jedno stopRecording, jedna próba audio, bip końca" — zielony; e2e z asercją `select modality from attempts` = `[{modality:"audio"}]`. |
| 4 | Cisza bez wykrytej mowy nie tworzy próby: limit 15 s anuluje z komunikatem, przycisk pozostaje fallbackiem (SPEC §15) | ✓ VERIFIED | `session-controller.ts` — `#autoCaptureActive && !speechDetected` → `cancelRecording(messages.kid.autoCaptureNoSpeech)`; komunikat w `messages.ts`. Behavioral: „cisza bez mowy: limit 15 s anuluje nagrywanie z komunikatem i bez próby" oraz „ręczne nagrywanie po cichym auto-anulowaniu działa" — zielone. |
| 5 | Przycisk działa jak dotąd (hold/toggle/retry); WrittenView pozostaje ręczny (D-02) | ✓ VERIFIED | Ręczna ścieżka bez hooka i bez bipu startu, także PO udanej auto-próbie (reset z delty 52c55c1, regresyjny test zielony); od WR-02 ręczne przygotowanie/nagrywanie pozostaje JEDYNĄ ścieżką przy braku zgody — test „prompt pomija auto-start…" asercjonuje pełną ścieżkę ręczną przyciskiem (prepare → record). WrittenView/mock_test: „autoCaptureSpeech nic nie robi dla zadania pisemnego i w kartówce" — zielony. |
| 6 | Po „Nagraj jeszcze raz" mikrofon nie startuje sam (SPEC §16) — auto-start raz na nowe zadanie | ✓ VERIFIED | Latch `#autoCaptureTaskId` (czyszczony wyłącznie w `#loadNext`) + deps useEffect bez `feedback`. Behavioral: „po powrocie do ćwiczenia z retry autoCaptureSpeech nie startuje samo" oraz test delty 52c55c1 (`started=2` wyłącznie po ręcznym `startRecording`) — zielone. |
| 7 | Odmowa mikrofonu, błąd urządzenia, offline i wyjście z ekranu zwalniają strumień i bufory; brak pętli ponowień | ✓ VERIFIED | Realna odmowa urządzenia nadal → istniejąca ścieżka micDenied/storage/`#disableSessionMicrophone` (test „odmowa mikrofonu w trybie auto" zielony); od WR-02 pominięty auto-start przy prompt/denied/unknown NIE zapamiętuje micDenied (testy asercjonują `micDenied: false`) i nie tworzy pętli — skip jest terminalny dla zadania (latch); `#teardownRecording` → reset + `recorder.cancel()` (RF5); 25 testów `browser.test.ts` pokrywa zwalnianie strumienia. |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/kid-ui/src/media/vad.ts` | Czysta maszyna stanów VAD | ✓ VERIFIED | 105 linii; progi/grace/sustain/trailing zgodne z planem; nietknięty przez obie delty |
| `packages/kid-ui/src/media/vad.test.ts` | Testy sekwencji próbek | ✓ VERIFIED | 10 testów zielonych |
| `packages/kid-ui/src/media/platform.ts` | Porty mediów | ✓ VERIFIED | Po WR-02: `playBeep`, `onMicrophoneReady` + `getMicrophonePermission` z udokumentowanym kontraktem „bez getUserMedia, bez promptu, awaria → unknown" |
| `packages/kid-ui/src/media/browser.ts` | Adapter przeglądarkowy | ✓ VERIFIED | `playBeepViaWebAudio`; hook w `BrowserRecorder.start`; od WR-02 `queryMicrophonePermission` (wyłącznie Permissions API, try/catch → unknown) |
| `packages/kid-ui/src/session/session-controller.ts` | Orkiestracja autoCaptureSpeech | ✓ VERIFIED | Pełna implementacja planu + reset stanu auto w `stopRecording` (52c55c1) + brama uprawnień WR-02 |
| `packages/kid-ui/src/session/session-controller.test.ts` | Testy kontrolera | ✓ VERIFIED | 99 testów (93 bazowe + 1 regresyjny 52c55c1 + 5 WR-02), wszystkie zielone |
| `packages/kid-ui/src/screens/LearnScreen.tsx` | Jedyny punkt wiringu auto-startu | ✓ VERIFIED | useEffect 122-126; deps bez feedbacku; nietknięty przez delty |
| `packages/contracts/src/messages.ts` | `kid.autoCaptureNoSpeech` | ✓ VERIFIED | Tekst PL zgodny z planem; używany w kontrolerze i e2e |
| `docs/SPEC.md` | §6/§12 opisują auto-nagrywanie | ✓ VERIFIED | Auto-start, bip, VAD ~1,2 s, cisza bez próby, przycisk, retry bez auto; od WR-02 jawny warunek już nadanego uprawnienia (2026-10-21) |
| 5 speców e2e | Adaptacja do auto-przepływu | ✓ VERIFIED | Auto-testy z asercjami DB i `window.__kidMicLevel`; od WR-02 fake Permissions API (sterowalny w speech-recording-ux/kid-flow, statyczny granted w pozostałych trzech) + nowy przypadek „prompt" bez auto-startu |

Wszystkie 15 plików z `files_modified` istnieje i jest merytoryczne; łączny zakres implementacyjny 029469a..db565e4 (commity zadania + dwa fixy review) pozostaje w granicach tych 15 plików — brak scope creep. Zero nowych zależności (T-261021-SC).

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| LearnScreen useEffect (taskId + prompt.kind) | autoCaptureSpeech → [WR-02: getMicrophonePermission → granted?] → prepareMicrophone → startRecording → BrowserRecorder.start (getUserMedia → onMicrophoneReady → playBeep("start") → MediaRecorder.start) → onLevel → reduceVad → auto_stop → stopRecording → submitSpeech | ścieżka bez zmian kontraktu | ✓ WIRED | Każde ogniwo potwierdzone w kodzie; kolejność potwierdzona testami (log `["permission:granted","prepareMicrophone","beep:start","capture"]` — zielony); pominięcie przy niegranted potwierdzone testami (log `["permission:prompt"]`, recorder 0) |
| BrowserRecorder onLevel (AnalyserNode, RMS×4, ~10 Hz) | session-controller → reduceVad → auto_stop → stopRecording → submitSpeech | ścieżka bez zmian | ✓ WIRED | `#startLevelMonitor` (fftSize 256, rms×4, throttling ≥100 ms); onLevel kontrolera próbuje VAD; test auto-stopu zielony |
| onLimitReached | VAD słyszał mowę ? stopRecording : cancelRecording | cisza nigdy nie woła submitSpeech | ✓ WIRED | Testy „cisza bez mowy…"(0 zgłoszeń, cancel) i „limit po usłyszanej mowie…"(1 zgłoszenie, stop) zielone |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| LearnScreen / session-controller | inputLevel, VAD action | `BrowserRecorder.onLevel` → AnalyserNode RMS na realnym strumieniu | ✓ | FLOWING |
| session-controller | decyzja bramy auto | `navigator.permissions.query` (stan zgody) | ✓ | FLOWING (realny stan przeglądarki; brak statycznego założenia granted) |
| session-controller | recordingNotice (cisza) | `messages.kid.autoCaptureNoSpeech` z contracts | ✓ | FLOWING |
| browser.ts | beep frequency/duration | stałe kalibracyjne `BEEP_*` | n/d | Celowe stałe projektowe (dokumentowane) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Testy VAD + bip + hook + auto-przepływ + brama uprawnień (po delcie db565e4) | `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/media/vad.test.ts packages/kid-ui/src/media/browser.test.ts` | 3 pliki, 134/134 zielonych (vad 10, browser 25, controller 99 — w tym 5 testów WR-02 i 1 regresyjny 52c55c1) | ✓ PASS |
| Pełna suita unit kid-ui + contracts (blok `<verification>` planu; pierwsza weryfikacja, sprzed obu delt — delty dotknęły wyłącznie pokrytych plików) | `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui packages/contracts` | 44 pliki, 484/484 zielonych — identycznie z deklaracją SUMMARY | ✓ PASS |
| Typy (po delcie db565e4) | `corepack pnpm typecheck` | wszystkie tsconfigi bez błędów (exit 0) | ✓ PASS |
| E2E (5 speców, docker via global-setup; po WR-02 z nowym przypadkiem prompt) | `corepack pnpm exec playwright test tests/e2e/{speech-recording-ux,kid-flow,kid-ui-layout,picture-vocabulary,kid-layout-stability}.spec.ts` | nie uruchomione przez weryfikatora — wymaga docker PostgreSQL + next dev + worker (start usług poza ograniczeniami weryfikacji); SUMMARY deklaruje zielone przebiegi (77 sprzed WR-02; WR-02 z deklarowanym RED-first) | ? SKIP → Human Verification |

### Probe Execution

Nie dotyczy — zadanie nie deklaruje sond `scripts/*/tests/probe-*.sh`; brak migracji/CLI w zakresie.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| QUICK-261021-LSW | 261021-lsw-PLAN.md | Cel zadania quick (auto-nagrywanie z VAD, bip, cisza bez próby, przycisk-fallback) | ✓ SATISFIED | Prawdy 1-7 VERIFIED; REQUIREMENTS.md nie mapuje tego ID (lokalny identyfikator quick-task) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | Brak markerów TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER we wszystkich 15 zmienionych plikach; brak skipped/todo testów; brak pustych implementacji na ścieżkach produkcyjnych (skan powtórzony po obu deltach — czysto) | — | Czysto |
| packages/kid-ui/src/session/session-controller.ts | stopRecording | ℹ️ Info z pierwszej weryfikacji (zgubny `#autoStartBeep` po udanej auto-próbie) — ZAMKNIĘTE przez 52c55c1, regresyjny test zielony | ℹ️ Info (rozwiązane) | Brak otwartych pozycji |
| packages/kid-ui/src/session/session-controller.ts | autoCaptureSpeech | Ostrzeżenie review WR-02 (auto-ścieżka mogła wywołać getUserMedia/prompt poza gestem) — ZAMKNIĘTE przez db565e4 z dowodem: 5 testów jednostkowych + adapter + e2e przypadek prompt; brama zgodna z mitigacją T-261021-01 planu | ⚠️ Warning (rozwiązane) | Brak otwartych pozycji |

### Decision Coverage

Decision coverage gate: skipped — „No trackable decisions in CONTEXT.md" (0 decisions, non-blocking). PLAN nie zawiera bloków `<verify><human-check>` do zebrania.

### Human Verification Required

### 1. Odtworzenie pięciu speców e2e na stacku docker

**Test:** `corepack pnpm exec playwright test tests/e2e/speech-recording-ux.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/kid-ui-layout.spec.ts tests/e2e/picture-vocabulary.spec.ts tests/e2e/kid-layout-stability.spec.ts`
**Expected:** Wszystkie zielone, w tym auto-start/auto-stop (dokładnie jedna próba `modality=audio` w bazie), cisza-bez-próby (zero prób) oraz nowy przypadek WR-02 „prompt" (bez auto-startu; przycisk działa).
**Why human:** Wymaga docker PostgreSQL, next dev i workera; weryfikator nie startuje usług. Logika kontrolera (łącznie z bramą uprawnień) jest pokryta 99 testami jednostkowymi, ale integracja przeglądarkowa i asercje DB wymagają stacku.

### 2. Kalibracja progów VAD na urządzeniu docelowym (RESEARCH A1)

**Test:** Sesja z dzieckiem na docelowym sprzęcie: wypowiedź po bipie, potem cisza; obserwować moment auto-stopu oraz brak fałszywych stopów przy hałasie tła.
**Expected:** Stop ~1,2 s po zakończeniu wypowiedzi; tło nie wyzwala auto-stopu ani nie przeciąga do limitu 15 s.
**Why human:** Progi (0.09/0.05 w skali rms×4) to stałe kalibracyjne; testy jednostkowe używają syntetycznych poziomów.

### 3. Słyszalność bipu, polityka autoplay i realne Permissions API na urządzeniu

**Test:** Uruchomić przepływ na iOS Safari / docelowym Androidzie (PWA); obserwować bip startu/końca oraz zachowanie przy pierwszym użyciu (brak wcześniejszej zgody) i po nadaniu zgody.
**Expected:** Wyraźny wyższy bip „teraz mów" i niższy bip końca; suspended AudioContext degraduje się po cichu; przy braku zgody automat nie startuje i nie wywołuje promptu — dopiero świadomy przycisk; Firefox (brak Permissions API) traktowane jak brak zgody dla auto.
**Why human:** Ścieżka suspended i mapowanie Permissions API pokryte testami na fake'ach; realne urządzenie i przeglądarki wymagają fizycznej próby.

### 4. Przegląd UX przepływu z dzieckiem

**Test:** Przejść przez ekran mowy: bip → mowa → auto-stop → karta wyniku; potem „Nagraj jeszcze raz" i próba ręczna przyciskiem; przy pierwszym użyciu — nadanie zgody przyciskiem.
**Expected:** Dziecko rozumie sygnał; brak wrażenia ucinania początku wypowiedzi; po „Nagraj jeszcze raz" mikrofon nie włącza się sam; pierwsza zgoda należy do świadomego naciśnięcia.
**Why human:** Subiektywny odbiór słuchowy i reakcja dziecka — niemożliwe do sprawdzenia programowo.

### Gaps Summary

Brak luk blokujących. Wszystkie 7 prawd must-haves zweryfikowanych z dowodem behawioralnym (po delcie db565e4: 134/134 celowanych testów jednostkowych zielonych, typecheck czysty); wszystkie artefakty istnieją, są merytoryczne i podłączone; 3/3 kluczowych połączeń WIRED; zero markerów długu i zero nowych zależności; łączny zakres implementacyjny 029469a..db565e4 pozostaje w granicach 15 plików planu. Obie uwagi z review zamknięte z dowodami: WR-01 (52c55c1, pełny reset stanu auto w `stopRecording`) i WR-02 (db565e4, brama uprawnień zgodna z mitigacją T-261021-01 planu — automat woła getUserMedia wyłącznie przy granted lub mikrofonie już używanym w sesji; pominięty auto-start nie zapamiętuje micDenied; ścieżka ręczna nietknięta). Status `human_needed` wynika wyłącznie z pozycji wymagających człowieka/środowiska: odtworzenia e2e na stacku docker (włącznie z nowym przypadkiem prompt) oraz planowych sprawdzeń urządzeniowych (kalibracja VAD, bip + realne Permissions API, UX z dzieckiem).

---

_Verified: 2026-10-21T19:22:24Z (delta db565e4/WR-02; wcześniej 52c55c1 i weryfikacja początkowa)_
_Verifier: Claude (gsd-verifier)_
