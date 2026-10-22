# Quick Task 261021-lsw: Automatyczne nagrywanie z VAD — Research

**Researched:** 2026-10-21
**Domain:** kid-ui media layer (WebAudio/MediaRecorder) + session controller
**Confidence:** HIGH (repo), MEDIUM (progi VAD, polityka autoplay na iOS)

## Summary

Objaw „ucinanego audio" ma dwie złote przyczyny w kodzie, obie w sekwencji przycisk → start. Po pierwsze, `startRecording()` bez wcześniejszego `prepareMicrophone()` tylko przygotowuje mikrofon i wraca — dziecko musi nacisnąć drugi raz [VERIFIED: packages/kid-ui/src/session/session-controller.ts:1106-1109 — `if (!screen.microphoneReady) { await this.prepareMicrophone(); return; }`]. Po drugie, nawet przy gotowym mikrofonie `#recordingStartedAt` i faktyczny `recorder.start(250)` następują dopiero po `getUserMedia` + konstrukcji `MediaRecorder`, więc pierwsze słowa wypowiedziane „do ziemi" nie trafiają do nagrania [VERIFIED: session-controller.ts:1133-1138; packages/kid-ui/src/media/browser.ts:147-205]. MediaRecorder z timeslice nie gubi danych — `stop()` domyka finalny chunk [CITED: developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start], więc winne jest wyłącznie opóźnienie startu.

Rekomendacja: **rozszerzyć istniejący monitor RMS w `BrowserRecorder` o maszynę stanów VAD jako czysty moduł + bip WebAudio jako helper w `media/`**, bez żadnej nowej zależności. Bip startu pełni rolę sygnału „teraz mów" umieszczonego ZA inicjalizacją rejestratora i tuż przed `recorder.start()` — to samo w sobie usuwa główną przyczynę ucinania. Auto-stop po mowie + 1,2 s ciszy prowadzi istniejący `stopRecording()`.

**Primary recommendation:** Bez bibliotek VAD — @ricky0123/vad-web niesie ~6,4 MiB kodu + `onnxruntime-web` i byłby pierwszą ciężką zależnością runtime pakietu, który dziś ma wyłącznie `@learning/contracts` [VERIFIED: packages/kid-ui/package.json — `"dependencies": { "@learning/contracts": "workspace:*" }`].

<user_constraints>
## User Constraints (z CONTEXT.md)

- Zakres: SpeechView i PictureSpeechView; wspólna logika autostartu + VAD w współdzielonym komponencie.
- Przycisk zostaje jako „Spróbuj jeszcze raz" po próbie oraz fallback przy zawiedzionej autodetekcji.
- Stop po wykryciu mowy i ~1,2 s ciszy; istniejący limit maks. długości zostaje jako zabezpieczenie.
- Cisza nie tworzy próby/oceny (SPEC, AGENTS.md).
- Bip startu PRZED włączeniem nagrywania, bip końca PO zatrzymaniu — aby nie wpadały do nagrania na STT.
- Bip syntetyczny WebAudio, bez plików audio.
- Claude's Discretion: progi VAD, debounce, wygląd wskaźnika, brzmienie bipów, przypadki brzegowe, ewentualna pre-inicjalizacja mikrofonu.
</user_constraints>

## Root causes objawu (do naprawy przy okazji)

| # | Przyczyna | Dowód |
|---|-----------|-------|
| R1 | Pierwsze naciśnięcie tylko przygotowuje mikrofon; nagrywanie dopiero po drugim | [VERIFIED: session-controller.ts:1106-1109] |
| R2 | `getUserMedia` + `new MediaRecorder` + `start(250)` po naciśnięciu — mowa przed startem jest niewidzialna dla MediaRecorder | [VERIFIED: browser.ts:149, 165, 195] |
| R3 | Brak pre-warmu: `prepareMicrophone` natychmiast zwalnia strumień (`stream.getTracks().forEach((track) => track.stop())`), każdy start płaci pełny koszt otwarcia urządzenia | [VERIFIED: browser.ts:461-464] |
| R4 | Timeslice NIE powoduje utraty pierwszego chunka — wszystkie bajty są deliverowane, `stop()` flushuje ostatni | [CITED: MDN MediaRecorder/start] |

Wniosek: fix polega na zmianie sekwencji (autostart po wyświetleniu ekranu + bip jako bramka czasowa), nie na modyfikacji timeslice.

## Architectural Responsibility Map

| Capability | Tier | Gdzie |
|---|---|---|
| Detekcja mowy/ciszy (VAD) | adapter mediów (poziom) + czysta maszyna stanów | `media/browser.ts` dostarcza poziomy; nowy moduł czysty (wzorzec `exercises/recording-gesture.ts`) |
| Orkiestracja auto-start/stop, blokady (offline, busy, epoch) | kontroler sesji | `session-controller.ts` (testowalne bez Reacta) |
| Bip WebAudio | adapter platformowy | helper w `media/browser.ts`, eksponowany przez `PlatformMedia` — kontroler nie zna WebAudio (zgodnie z media/platform.ts:40-46) |
| UI (wskaźnik, retry) | widoki | `SpeechRecordButton` + komunikaty z `@learning/contracts` |

## Recommended Approach

### 1. VAD — rozszerzenie istniejącego monitora poziomu

`#startLevelMonitor` już liczy RMS co 100 ms z AnalyserNode: `analyser.fftSize = 256`, `const level = Math.max(0, Math.min(1, rms * 4));`, emisja `onLevel` tylko gdy `this.#state === "recording"` [VERIFIED: browser.ts:331, 337, 346-347]. Maszyna stanów VAD jako **czysty moduł** (np. `media/vad.ts`, wzorcem `recording-gesture.ts` — reducer + testy bez DOM), zasilany `onLevel` z `RecorderOptions` [VERIFIED: platform.ts:25-31]:

```
arming (300 ms grace po starcie — tłumi echo bipu)
  → listening (czeka na mowę: level ≥ próg przez ≥2 próbki 100 ms)
  → spoken → trailing_silence (level < próg ciszy) → po 12 próbkach (1,2 s) → AUTO_STOP
  → brak mowy: bezterminowe czekanie (limit 15 s domyka z `onLimitReached`)
```

Proponowane stałe (do kalibracji na urządzeniu — patrz Assumptions): próg mowy `level ≥ 0.09`, próg ciszy `level < 0.05` (skala `rms*4`), grace 300 ms, sustain 2×100 ms, cisza 12×100 ms = 1,2 s.

### 2. Sekwencja auto-próby (nowa metoda kontrolera, np. `beginSpeechCapture()`)

```
task shown (kind speech|picture_speech, micAvailable, !busy, !offline, !processing, feedback===null)
  → ensure prepareMicrophone() (jeśli !microphoneReady; ścieżka odmowy zostaje jak dziś)
  → bip START (WebAudio; jeśli AudioContext suspended → pomiń, nie blokuj)
  → recorder.start() (już po getUserMedia — bip maskuje latencję)
  → VAD armed → AUTO_STOP → stopRecording() (reutilizuje 300 ms guard i wysyłkę)
  → audio gotowe → bip END → submitSpeech (istniejąca ścieżka session-controller.ts:1192-1202)
```

Wywołanie z UI: `useEffect` w `LearnScreen`/współdzielonym komponencie keyed na `task.taskId` + `prompt.kind` — logika i blokady w kontrolerze (testowalność jak reszta `session-controller.test.ts`). `microphoneReady` NIE jest resetowane przez `#loadNext` [VERIFIED: session-controller.ts:627-642 — pole nieobecne w obiekcie resetu], więc tylko pierwszy ekran mowy w sesji płaci koszt przygotowania.

### 3. Bip WebAudio

Krótki (100–200 ms) `OscillatorNode` → `GainNode` z szybką obwiednią (atak/decay ~10/50 ms — unika kliku), osobny krótkotrwały `AudioContext` na bip (zamykany po graniu) lub współdzielony z analyserem. Gwarancja czystości nagrania przez **kolejność**, nie przez echo-cancellation: bip startu kończy się przed `recorder.start()`; bip końca gra po zebraniu bajtów (`recorder.stop()` zwraca audio po flushu). Nie polegaj na AEC — MDN nie definiuje wartości domyślnej `echoCancellation` [CITED: developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation]. Echo bipu w mikrofonie additionally tłumi grace 300 ms w VAD.

Autoplay policy: AudioContext utworzony bez świeżego gestu startuje suspended i wymaga `resume()` po interakcji [CITED: developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices — "If however, you create the context outside of a user gesture, its state will be set to suspended"]. W praktyce sticky activation ze wcześniejszych tapów zwykle wystarcza, ale bip musi degradować się gracefullnie (brak dźwięku ≠ brak nagrywania); precedens: `playTaskAudio` już rozróżnia zablokowany autoplay (`taskAudioError: "blocked"`) [VERIFIED: session-controller.ts:1038].

## Alternatives Considered + Package Legitimacy Audit

| Pakiet | Registry | Wiek/rozmiar | Werdykt | Disposition |
|---|---|---|---|---|
| @ricky0123/vad-web | npm | v0.0.31, unpacked 6 755 237 B, dep `onnxruntime-web ^1.17.0` [VERIFIED: npm view, 2026-10-21] | nazwa spoza autorytatywnego źródła → [ASSUMED] | ODRZUCONY — rozmiar, wasm/onnx w bundlerze, model do pobrania w runtime; nazwa niezaakceptowana wg protokołu |

**Packages removed:** @ricky0123/vad-web (użycie nieuzasadnione rozmiarem i polityką zero-deps kid-ui).
Zero nowych zależności — całość WebAudio/MediaRecorder już używana w `media/browser.ts`.

## Integration Constraints (planner musi uwzględnić)

1. **Cisza ≠ próba — konflikt z limitem 15 s.** Dziś `onLimitReached` → `stopRecording()` → **wysyła** attempt (nawet ciszę) [VERIFIED: session-controller.ts:1119-1121 + 1178-1202]. W trybie auto limit/brak mowy musi anulować (`cancelRecording`) i wracać do fallbacku przycisku, NIE tworzyć próby (SPEC/AGENTS).
2. **Zakres auto-startu: tylko `prompt.kind === "speech" | "picture_speech"`.** `WrittenView` (recall/spelling) też osadza `SpeechRecordButton` [VERIFIED: packages/kid-ui/src/exercises/WrittenView.tsx:58] — tam mowa jest opcjonalnym wejściem obok pisanego; zostaje tryb ręczny.
3. **Guard 300 ms** w `stopRecording()` (`Date.now() - this.#recordingStartedAt < 300` → cancel „za krótko") [VERIFIED: session-controller.ts:1178-1183] — auto-stop po mowie + 1,2 s ciszy zawsze go przekracza; grace VAD chroni przed false-triggerem echa bipu.
4. Odmowa mikrofonu: istniejąca ścieżka `prepareMicrophone` (NotAllowedError → `micDenied`, storage, `#disableSessionMicrophone` dla obrazkowych) [VERIFIED: session-controller.ts:1082-1100] — auto-start używa jej 1:1; bez retry-loopów.
5. Blokady wejścia: `micAvailable` wyklucza mock_test i sesje bez mikrofonu [VERIFIED: packages/kid-ui/src/screens/LearnScreen.tsx:65]; dodatkowo `!offline && !busy && !processing && feedback === null`.
6. Teardown/RF5: `#teardownRecording` + epoch guards już zwalniają mikrofon przy wyjściu [VERIFIED: session-controller.ts:1396-1404] — auto-flow musi być odporny na te same epoki (retry po powrocie z tła nie wznawia nagrywania sam).
7. `playGuidance` odmawia gdy `recordingPhase !== "idle"` [VERIFIED: session-controller.ts:270] — natychmiastowy auto-start blokuje instrukcję głosową picture_speech; do uzgodnienia w planie (np. auto-start po skończonym guidance albo świadomy trade-off).
8. Nowe komunikaty PL do `packages/contracts/src/messages.ts` (np. status „Słucham…", podpowiedź po bezczynności) — jeden wspólny katalog komunikatów (AGENTS.md).
9. `MAX_RECORDING_MS = 15_000` [VERIFIED: browser.ts:4] pozostaje jako zabezpieczenie; dopuszczalne skrócenie „cisza bez mowy" do ~10 s w trybie auto z anulowaniem.

## Test Map

**Zostawić zielonymi:**
- `packages/kid-ui/src/media/browser.test.ts` — cały lifecycle BrowserRecorder; wzorzec fake AudioContext/analyser z injectowanymi deps (linie 218-249) do rozszerzenia o callbacki VAD.
- `packages/kid-ui/src/session/session-controller.test.ts` — ~20 testów przepływu prepare/start/stop (linie 514+, 1140+); istniejące metody mają zachować kontrakt, auto-flow jako dodatki.
- `tests/e2e/speech-recording-ux.spec.ts` — gesty hold/toggle, odmowa mikrofonu, feedback inline. **Uwaga:** `installFakeMicrophone` tworzy FakeAudioContext BEZ `createAnalyser` [VERIFIED: tests/e2e/speech-recording-ux.spec.ts:145-148] → VAD w e2e nigdy nie dostanie poziomów; fake musi zostać rozszerzony o sterowalny analyser, a asercje „Włącz mikrofon"/fazy przycisku dostosowane do auto-flow.
- `kid-record` występuje w 10 plikach e2e (kid-flow, learning-algorithm, picture-vocabulary, mock-test, lesson-*) — regresja UI przycisku ma szeroki zasięg.
- `apps/web/src/kid/learn-microphone-status.test.ts`, `recording-gesture.test.ts` — nietknięte przy zachowaniu manualnego trybu.

**Nowe (Wave 0):**
- `packages/kid-ui/src/media/vad.test.ts` (lub obok modułu) — czysta maszyna stanów: grace, sustain, 1,2 s ciszy → AUTO_STOP, brak mowy → brak stopu, re-arm; fake timers, zero DOM.
- Test beep-helpera — fake AudioContext (osc/gain scheduling, resume, graceful skip przy suspended).
- Testy kontrolera auto-flow: start po zadaniu speech, odmowa → ścieżka micDenied bez próby, AUTO_STOP → jeden `submitSpeech`, limit 15 s w trybie auto → cancel bez próby, teardown w trakcie auto (epoch).
- E2E: rozszerzony fake analyser (poziomy sterowane z testu) + scenariusz auto-start/auto-stop/retry-button.

## Common Pitfalls

1. **iOS/Safari:** MediaRecorder od 14.5 [CITED: caniuse.com/mediarecorder], ale `PREFERRED_MIME_TYPES` ma tylko webm [VERIFIED: browser.ts:7] — na iOS `isTypeSupported` prawdopodobnie odrzuci oba i nagrywanie w ogóle nie wystartuje (istniejące ograniczenie; kontener audio/mp4 [ASSUMED]). Autostart nie może zawieszać ekranu na `getUserMedia`, który nigdy nie da strumienia.
2. **Autoplay bipu:** bez świeżego gestu AudioContext bywa suspended [CITED: MDN Best practices] — beep opcjonalny, nagrywanie obowiązkowe.
3. **Echo bipu startu:** grace 300 ms + sustain 2 próbek; nie polegać na AEC (brak domyślnej gwarancji).
4. **Liczba AudioContextów:** obecnie nowy kontekst na nagranie (analyser) [VERIFIED: browser.ts:329] + nowe na bipy — zamykać każdorazowo (iOS limituje równoczesne konteksty); rozważyć jeden współdzielony per kontroler.
5. **Pętla auto-retry:** odmowa/błąd urządzenia nie może odpalać autostartu w kółko — po błędzie tylko przycisk.

## Assumptions Log

| # | Claim | Risk |
|---|-------|------|
| A1 | Progi VAD (mowa ≥0.09, cisza <0.05 w skali rms*4, grace 300 ms) działają dla głosu dziecka w typowym pomieszczeniu | Za nisko: fałszywe auto-stop; za wysoko: brak stopu → limit. Wymaga kalibracji na urządzeniu docelowym (kontrola właściciela) |
| A2 | iOS Safari nagrywa audio/mp4, nie webm (stąd brak wsparcia w obecnym kodzie) | Nie blokuje zadania (Android/desktop PWA), ale „automatyzacja" nie pomoże na iPadzie |
| A3 | Echo-cancellation bywa domyślnie włączony, ale nie jest gwarantowany | Neutralizowane kolejnością bip→start; brak ryzyka dla planu |

## Sources

- Repo: `packages/kid-ui/src/media/browser.ts`, `media/platform.ts`, `session/session-controller.ts`, `exercises/{SpeechView,PictureSpeechView,SpeechRecordButton,WrittenView,recording-gesture}.tsx/ts`, `screens/LearnScreen.tsx`, `tests/e2e/speech-recording-ux.spec.ts`
- MDN: MediaRecorder/start (timeslice + final flush), Web Audio API Best practices (autoplay/suspended), MediaTrackConstraints/echoCancellation (brak domyślnej wartości)
- caniuse.com/mediarecorder (iOS Safari 14.5+)
- npm registry: @ricky0123/vad-web 0.0.31 (6 755 237 B, onnxruntime-web)

**Valid until:** 2026-11-21 (fakty przeglądarkowe stabilne; progi VAD do walidacji na urządzeniu)
