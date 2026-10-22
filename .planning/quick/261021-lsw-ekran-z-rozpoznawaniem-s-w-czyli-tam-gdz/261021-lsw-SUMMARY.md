---
phase: quick-261021-lsw
plan: 01
subsystem: kid-ui
tags: [vad, mowa, media, kid-ui, e2e]
requires:
  - "session-controller: prepareMicrophone/startRecording/stopRecording/cancelRecording (ścieżka bez zmian)"
  - "BrowserRecorder: onLevel (AnalyserNode, rms×4, ~10 Hz), onLimitReached (15 s)"
provides:
  - "media/vad.ts: czysta maszyna stanów VAD (arming→listening→spoken→stopped) z eksportowanymi progami"
  - "PlatformMedia.playBeep(kind) + RecorderOptions.onMicrophoneReady — bip startu po getUserMedia, przed przechwytywaniem"
  - "LearningSessionController.autoCaptureSpeech() — auto-próba raz na nowe zadanie speech/picture_speech"
  - "messages.kid.autoCaptureNoSpeech — komunikat PL dla ciszy bez próby"
affects:
  - packages/kid-ui/src/screens/LearnScreen.tsx
  - docs/SPEC.md (§6, §12)
tech-stack:
  added: []
  patterns:
    - "reducer + fabryka bez DOM (wzorzec recording-gesture.ts) dla maszyny stanów VAD"
    - "krótkotrwały AudioContext na bip, zamykany w finally; degradacja po cichu bez rzucania"
key-files:
  created:
    - packages/kid-ui/src/media/vad.ts
    - packages/kid-ui/src/media/vad.test.ts
  modified:
    - packages/kid-ui/src/media/platform.ts
    - packages/kid-ui/src/media/browser.ts
    - packages/kid-ui/src/media/browser.test.ts
    - packages/kid-ui/src/session/session-controller.ts
    - packages/kid-ui/src/session/session-controller.test.ts
    - packages/contracts/src/messages.ts
    - packages/kid-ui/src/screens/LearnScreen.tsx
    - docs/SPEC.md
    - tests/e2e/speech-recording-ux.spec.ts
    - tests/e2e/kid-flow.spec.ts
    - tests/e2e/kid-ui-layout.spec.ts
    - tests/e2e/picture-vocabulary.spec.ts
    - tests/e2e/kid-layout-stability.spec.ts
decisions:
  - "Zero nowych zależności: VAD jako czysty moduł na poziomach istniejącego monitora RMS; @ricky0123/vad-web odrzucony (research)"
  - "Bip startu wewnątrz BrowserRecorder.start przez hook onMicrophoneReady — po udanym getUserMedia i PRZED MediaRecorder.start; odrzucenie hooka połykane (bip opcjonalny, nagrywanie obowiązkowe)"
  - "Cisza bez wykrytej mowy nie tworzy próby: limit 15 s w trybie auto anuluje nagrywanie z komunikatem autoCaptureNoSpeech"
  - "Auto-start wyłącznie na świeżo wyświetlonym zadaniu (latch taskId w kontrolerze + deps useEffect bez feedbacku) — nigdy po „Nagraj jeszcze raz”"
  - "WrittenView (recall/spelling) i mock_test pozostają trybem ręcznym"
metrics:
  duration: ~2h40m
  completed: 2026-10-21
estimate:
  tokens: 165000
  tasks: 3
actuals:
  tokens: 21700
  tasks: 3
  commits: 5
plan_head_before: 029469a
plan_head_after: e42acad
status: complete
---

# Quick Task 261021-lsw: Automatyczne nagrywanie z VAD na ekranach mowy — Summary

Automatyczna próba mowy na ekranach SpeechView/PictureSpeechView: nagrywanie startuje samo po wyświetleniu zadania (bip startu po uzyskaniu strumienia mikrofonu, tuż przed przechwytywaniem), kończy się samo po wykryciu wypowiedzi i ~1,2 s ciszy (bip końca po zebraniu bajtów), a cisza nie tworzy próby — czysty moduł VAD `media/vad.ts`, bip WebAudio i hook `onMicrophoneReady` w warstwie mediów, orkiestracja w kontrolerze sesji, wiring w LearnScreen, komunikat PL w contracts, zaktualizowany SPEC §6/§12 i zaadaptowane spece e2e.

## Co zostało zrobione

1. **Task 1 (TDD, 0c0f3fa RED + 6433a33 GREEN)** — czysta maszyna stanów VAD (`reduceVadSample`/`createSpeechVad`, progi 0.09/0.05, grace 3, sustain 2, cisza 12 próbek), `PlatformMedia.playBeep("start"|"end")` (krótkotrwały AudioContext, obwiednia, degradacja po cichu), opcjonalny `RecorderOptions.onMicrophoneReady` wołany w `BrowserRecorder.start` PO udanym getUserMedia i PRZED `MediaRecorder.start`.
2. **Task 2 (TDD, 83f0079 RED + 4e27de5 GREEN)** — `autoCaptureSpeech()` w kontrolerze sesji: straże (tylko speech/picture_speech, nie mock_test, mikrofon włączony, idle, bez feedbacku), latch na taskId, sonda `prepareMicrophone` bez pętli ponowień, VAD w `onLevel` → `auto_stop` → `stopRecording`, limit 15 s przy braku mowy → `cancelRecording(autoCaptureNoSpeech)`, bip końca po zebraniu bajtów; komunikat PL w `packages/contracts/src/messages.ts`.
3. **Task 3 (e42acad)** — `useEffect` w LearnScreen (jedyny punkt wiringu, deps `[controller, taskId, prompt.kind]` bez feedbacku), SPEC §6/§12 z datą 2026-10-21, adaptacja pięciu speców e2e (szczegóły niżej).

## Wpływ API → MCP → SKILL.md: brak

Zmiana jest wewnętrzna dla pakietu kid-ui (orkiestracja po stronie klienta, warstwa mediów) oraz dokumentacji i testów e2e. Nie zmieniono żadnego endpointu, DTO, parametru, wartości domyślnej ani znaczenia danych w `/api/v1/kid` — kontrakt `submitSpeech`, ścieżka ekspozycji i reguły oceny pozostały nietknięte (potwierdzone testami jednostkowymi kontrolera bez zmian semantyki). Serwer MCP (`apps/web/src/integrations/`), wygenerowany schemat i `skills/umiem-learning/SKILL.md` nie wymagają aktualizacji; raport `learning-overview` nadal świadomie nie obejmuje lekcji/nagrań.

## Uruchomione sprawdzenia (wszystko zielone)

- **Unit**: `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui packages/contracts` — 484 testy, 44 pliki (nowe: vad.test.ts 10 testów, rozszerzony browser.test.ts o bip i onMicrophoneReady, session-controller.test.ts o pełny auto-przepływ — łącznie 93).
- **Typy**: `corepack pnpm typecheck` — bez błędów (wszystkie tsconfigi).
- **E2E (docker via global-setup, finalna weryfikacja)**: `playwright test` na pięciu zmienianych specach — **77 testów zielonych w 2,8 min**, w tym:
  - `speech-recording-ux.spec.ts` (6): nowy test auto-start + auto-stop po mowie i ciszy (dokładnie jedna próba `modality=audio` w bazie dla zadania) oraz nowy test ciszy (limit ~15 s → `data-phase=idle`, komunikat „Nie usłyszałem słowa…”, zero prób audio); gesty hold/toggle/escape na ścieżce ręcznej (zadanie recall — WrittenView osadza SpeechRecordButton) bez zmian intencji; odmowa mikrofonu bez zmian.
  - `kid-flow.spec.ts` (10): `startFakeRecording` najpierw czeka na auto-start (poll `test.recorderStarts`), klik inicjujący gotowość tylko fallbackiem ścieżki ręcznej; `settled` traktuje trwające nagrywanie jako stan stabilny; RF5 (opuszczenie widoku w trakcie nagrywania) zielony.
  - `kid-ui-layout.spec.ts` (31): blok „speech recording honors ${mode}” — `data-phase=preparing` pojawia się bez kliku (auto-przygotowanie wisi na getUserMedia); test ikony mikrofonu ustabilizowany wiszącym getUserMedia.
  - `picture-vocabulary.spec.ts` (7): „świadome pominięcie bez mikrofonu” czeka na auto-anulowanie ciszą (data-phase=idle, test.slow) przed `kid-skip` (celowo zablokowany podczas nagrywania).
  - `kid-layout-stability.spec.ts` (23): iteracja `speech` przepisana na cykl auto (preparing bez kliku → resolve sondy → recording bez drugiego kliku); iteracja `recall` pozostaje ręczna; pomiary prostokątów bez zmian.

## Niezweryfikowane

- **Kalibracja progów VAD na urządzeniu docelowym** (A1 z researchu: mowa ≥0.09 / cisza <0.05 w skali rms×4, grace 300 ms) — wymaga kontroli właściciela z dzieckiem na docelowym sprzęcie; progi są eksportowanymi stałymi `VAD_*` do szybkiej korekty.
- **Pełna suita `pnpm test:e2e`** (poza pięcioma zmienianymi specami) — bramka właścicielska po merdżu, celowo poza budżetem tego zadania.
- **Bip na realnym urządzeniu** (audibility, polityka autoplay na iOS Safari — ścieżka suspended pokryta testami jednostkowymi degradacji po cichu, nie urządzeniem).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Testy auto e2e nie dochodziły do zadania mowy w sesji tekstowej**
- **Found during:** Task 3 (nowe testy auto-start/auto-stop/cisza)
- **Issue:** Pierwotne podejście (fresh sesja tekstowa + pętla odpowiadająca na zadania) kończyła sesję budżetem w fazie rozpoznawania (28 zadań exposure/listening/reading/reverse_recognition) — scheduler wydaje wprowadzenie wymowy dopiero po sukcesie rozpoznawania i wprowadzeniu recall dla elementu (scheduler.ts:551-565).
- **Fix:** Testy auto używają ścieżki obrazkowej (profil nieczytający + zestaw picture + siecie sukcesu słuchowego `child_skill_progress` status `practicing`, streak 1, termin w przyszłości) — zgodnie z kontraktem udokumentowanym w `scheduler-picture-reader.test.ts` („nieczytający z włączonym mikrofonem po opanowaniu słuchania otrzymuje picture_recall i speech”): prezentacja → picture_recall (ręcznie domykane w pętli) → picture_speech z auto-startem. Diagnostyka SQL w komunikacie błędu pętli pozostaje w specu (uruchamia się tylko przy porażce).
- **Files modified:** tests/e2e/speech-recording-ux.spec.ts
- **Commit:** e42acad

**2. [Rule 1 - Bug] Dopasowanie poprawnej opcji obrazkowej w e2e**
- **Issue:** Zakotwiczony regex `hasText` na całym przycisku nie łapał opcji z wizualami (przycisk niesie cyfrę/obrazek obok etykiety „jeden”/„red”), a opcje różnych widoków renderują tekst różnie (aria-label vs textContent).
- **Fix:** Dokładne dopasowanie po `aria-label` (opcje obrazkowe słuchowe) lub `textContent` (rozpoznawanie obrazkowe) przez `page.evaluate`, bez kolizji podciągiem.
- **Files modified:** tests/e2e/speech-recording-ux.spec.ts
- **Commit:** e42acad

**3. [Rule 2 - odporność e2e] RF5: asercja braku nagrywania w drugiej sesji**
- **Issue:** `await expect(kid-recording).toHaveCount(0)` po wejściu w nową sesję zakładała, że nagrywanie startuje wyłącznie ręcznie — z auto-startem nowa sesja może zgodnie z produktem sama rozpocząć nagrywanie na zadaniu mowy.
- **Fix:** Asercja widoczności zadania (`[data-task-id]`); regresja zwalniania strumienia pozostaje pokryta przez `test.trackStops` w pierwszej sesji. Komentarz wyjaśnia intencję.
- **Files modified:** tests/e2e/kid-flow.spec.ts
- **Commit:** e42acad

**4. [Rule 3 - blokujący] kid-ui-layout: test ikony mikrofonu mógł stracić przycisk**
- **Issue:** Test „record control uses the shared microphone icon” włącza mikrofon bez fake API — auto-próba natychmiast woła realny getUserMedia, który w headless odmawia i usuwa przycisk (micDenied), czyniąc test wyścigiem.
- **Fix:** Wiszący stub getUserMedia utrzymuje fazę preparing — przycisk i ikona pozostają w DOM deterministycznie.
- **Files modified:** tests/e2e/kid-ui-layout.spec.ts
- **Commit:** e42acad

### Świadomie nietknięte (sprawdzone)

- `kid-ui-layout.spec.ts` blok z wpisywanym „cat” (~linie 80-95) — fixture to zadanie pisemne recall (micAvailable, ale nie mowa): auto-próba nie dotyczy recall; odmowa i ręczne przygotowanie bez zmian.
- Testy „instruction is separated…” i „speech play action…” w kid-ui-layout — fixture z wyłączonym mikrofonem: straż `session.microphoneEnabled` wyklucza auto-próbę.
- Poza planem, zweryfikowane jako nietknięte auto-startem: `mock-test.spec.ts`, `lesson-kid.spec.ts`, `lesson-mock-test.spec.ts`, `learning-algorithm.spec.ts`, `test-preparation.spec.ts` — tryb mock_test, wyłączony mikrofon lub rodzaj zadania (letter_completion) wykluczają auto-próbę guardami kontrolera.

## Known Stubs

Brak — żadnych placeholderów, pustych danych ani pominiętych testów; wszystkie `<verify>` z planu wykonane (unit, typecheck, pięć speców e2e).

## Threat Flags

Brak nowej powierzchni poza modelem zagrożeń planu — mitigacje T-261021-01/02/03 zaimplementowane i pokryte testami (epoch/teardown zwalnia strumień; AudioContext bipu zamykany w finally z timeoutem; cisza bez próby; zerowe nowe zależności).

## Self-Check: PASSED

Wszystkie 15 plików z planu istnieje; wszystkie 5 commitów zadania (0c0f3fa, 6433a33, 83f0079, 4e27de5, e42acad) jest przodkami HEAD; SUMMARY.md utworzony.

## Review follow-up

### WR-01 resolved (commit 52c55c1)

`stopRecording()` po skonsumowaniu flagi auto wywołuje pełny `#resetAutoCapture()` — zgubny `#autoStartBeep` i terminalny `#vad` nie przetrwały do ręcznej próby „Nagraj jeszcze raz" (D-04: ścieżka ręczna bez hooka i bez bipu startu). Test regresyjny w session-controller.test.ts (RED bez fixu).

### WR-02 resolved (decyzja właściciela 2026-10-21)

**Decyzja:** automatyczna próba mowy woła getUserMedia wyłącznie przy już nadanym uprawnieniu mikrofonu (lub gdy mikrofon był już używany w tej sesji — wtedy nowy prompt nie jest możliwy). Pierwsze nadanie zgody dzieje się świadomym naciśnięciem przycisku nagrywania; automat nigdy sam nie wywołuje pytania o zgodę. Po nadaniu zgody przyciskiem kolejne zadanie mowy wystartuje samo.

**Implementacja:**
- Port `PlatformMedia.getMicrophonePermission(): Promise<"granted" | "prompt" | "denied" | "unknown">` (packages/kid-ui/src/media/platform.ts) — typ `MicrophonePermission`; pakiet nadal przenośny, zero nowych zależności.
- Adapter przeglądarkowy `queryMicrophonePermission` (browser.ts): wyłącznie `navigator.permissions.query({ name: "microphone" })` w try/catch, bez getUserMedia i bez efektów ubocznych; brak API (np. Firefox), niewspierana nazwa albo awaria → bezpieczne "unknown".
- Brama w `autoCaptureSpeech()` (session-controller.ts): przy niedostępnym mikrofonie najpierw zapytanie o STAN uprawnienia; "granted" → dotychczasowa sonda + auto-start; cokolwiek innego ("prompt"/"denied"/"unknown") → cichy skip dla tego zadania — bez sondy, bez getUserMedia i bez zapamiętania micDenied. Ścieżka ręczna (przycisk) bez zmian: naciśnięcie jest gestem użytkownika, przeglądarka może pokazać prompt, a po nadaniu zgody następne zadanie mowy startuje samo.
- Testy jednostkowe (session-controller.test.ts, RED-first): "prompt" → brak auto-startu, zero wywołań getUserMedia, micDenied niezapamiętane, ręczne startRecording działa; "denied" → skip; "unknown" → skip (bezpieczne domyślnie); "granted" → auto-start jak dotychczas; mikrofon gotowy → auto-start bez pytania o uprawnienie. Adapter: mapowanie stanów + awaria → "unknown" + brak dotykania getUserMedia (browser.test.ts).
- E2E: fake Permissions API w installFakeMicrophone/injectFakeMediaPlatform (sterowalny `window.__kidMicPermission`, domyślnie "granted" — istniejące spece auto bez zmian); initScripts w kid-ui-layout/kid-layout-stability/picture-vocabulary z "granted"; nowy przypadek w speech-recording-ux.spec.ts (fixture picture_speech, uprawnienie "prompt"): bez auto-startu (idle bez kliku, brak wskaźnika nagrywania), świadome naciśnięcie przygotowuje i rozpoczyna nagrywanie.
- SPEC §6/§12: dopisany warunek już nadanego uprawnienia dla automatycznego rozpoczęcia (2026-10-21).

**Weryfikacja:** 491 testów jednostkowych zielonych (packages/kid-ui + contracts, w tym 99 kontrolera), `pnpm typecheck` czysty, pięć speców e2e zielonych — 78 testów (77 wcześniejszych + nowy przypadek "prompt").

## Codex review (PR #109) — findings addressed

Trzy atomowe commity na fix/speech-recognition (Request changes rozpatrzony w całości):

### P1 #1 fixed (commit fff468f) — VAD bez martwej strefy

- `VAD_GRACE_SAMPLES` 3→0: bip startu kończy się przed rozpoczęciem przechwytywania (`onMicrophoneReady` awaitowane przed konstrukcją MediaRecorder), więc tłumienie echa bipu nie wymaga ignorowanych próbek — krótkie słowo (~200 ms = 2 próbki) od t=0 wpadało wcześniej w grace i traciło próbę przez limit 15 s.
- Przejście arming→listening ocenia próbkę przejścia (fall-through): przy GRACE=0 sustain liczy się od próbki #0. Sustain 2 (strażnik pojedynczego impulsu szumu) i cisza 12 bez zmian; nagłówek modułu przepisany (stara racjonalizacja echa usunięta).
- Testy: słowo od t=0 wykrywane; początek po ~150 ms ciszy wykrywany; pojedynczy impuls szumu nie wykrywa mowy; pełny cykl bez próbek grace (zaktualizowane testy grace).

### P1 #2 fixed (commit bdfbf44) — martwy monitor poziomów przerywa auto-próbę zamiast gubić wypowiedź

- Kontrakt: auto-próba nigdy nie nagrywa „głuchy" — bez poziomów VAD słyszy ciszę i limit anuluje dobrą wypowiedź mimo działającego MediaRecordera.
- Port: `RecorderOptions.requireLevelMonitor` + `LevelMonitorUnavailableError` (platform.ts). BrowserRecorder inicjalizuje monitor (AudioContext + AnalyserNode, JEDNA próba `resume()` dla suspended) PRZED sygnałem „teraz mów" i PRZED MediaRecorder; brak konstruktora, rzut konstruktora albo suspended po resume → `LevelMonitorUnavailableError` ze zwolnieniem strumienia. Ścieżka ręczna bez flagi — monitor best-effort (miernik poziomu), bez zmian.
- Kontroler: auto przekazuje `requireLevelMonitor`; błąd mapowany na nowy komunikat `kid.autoCaptureListenUnavailable` („Nie udało się nasłuchiwać mowy. Nagraj przyciskiem.") — bez próby, bez zapamiętania odmowy, stan auto zerowany; przycisk ręczny działa bez analizatora.
- Testy: kontroler — czysta przerwa auto (bez bipu, `recorder.started === 0`, komunikat, zero prób, ręczne nagrywanie działa); przeglądarka — trzy kształty awarii + suspended-z-udanym-resume przebiega normalnie + tryb ręczny bez flagi nieblokowany. kid-layout-stability dostał fake AudioContext z analizatorem (realny `createMediaStreamSource` odrzuciłby strumień-testowy).

### P2 #3 fixed (commit a542cf4) — onError zeruje stan auto

`onError` (awaria urządzenia w trakcie auto-nagrania) woła teraz `#resetAutoCapture()` — zgubny `#autoStartBeep`/`#vad` nie przetrwają do ręcznej próby (ta sama klasa defektu co WR-01). Test regresyjny RED-first: auto-start → `recorder.fail()` → ręczne startRecording bez hooka i bez kolejnego bipu startu.

### P2 #4 — design kept + documented (w commicie fff468f)

Beep-w-całości-przed-przechwytywaniem pozostaje celową decyzją (czysty payload STT; okno ryzyka = czas trwania bipu; dziecko uczy się mówić po sygnale). Przycinanie prowadzącego bipu z webm/opus rozważono i odrzucono jako nieproporcjonalne. SPEC §12 doprecyzowuje kontrakt: dziecko mówi po zakończeniu sygnału startu, a pomiar rzeczywistego odstępu sygnał–przechwytywanie na urządzeniu docelowym pozostaje na liście kontrolnej właściciela.

### Weryfikacja całości (po trzech commitach)

- 501 testów jednostkowych zielonych (packages/kid-ui + contracts; kontroler 101, przeglądarka 31, VAD 13), `corepack pnpm typecheck` czysty.
- Pięć speców e2e zielonych na Dockerze (global-setup): speech-recording-ux, kid-flow, kid-ui-layout, picture-vocabulary (wariant IN-03 pominięcia), kid-layout-stability — łącznie 78 testów (2,5 min).

## Codex review round 2 (inline) — findings addressed

Jeden atomowy commit **a95f1a2** na fix/speech-recognition; wszystkie trzy uwagi dotyczyły `#initializeLevelMonitor` (browser.ts), każda potwierdzona w kodzie:

### R2 #1 fixed — wiszące resume() blokowało start w obu trybach

Tryb RĘCZNY nigdy nie czeka na resume(): monitor podłączany best-effort dokładnie jak przed PR #109 (kontekst + analizator + interwał; dla suspended wyłącznie fire-and-forget `void context.resume().catch(…)`) — ręczne nagrywanie startuje niezależnie od monitora. Tryb AUTO ściga resume() z limitem `LEVEL_MONITOR_RESUME_TIMEOUT_MS = 750` (eksportowana stała) na wstrzykniętych timerach — upłynięcie limitu albo odrzucenie rozstrzyga się jak niedostępny monitor (LevelMonitorUnavailableError: strumień zwolniony, bez bipu, bez nagrania, bez próby, ekran wraca do idle z komunikatem).

### R2 #2 fixed — auto akceptuje wyłącznie state "running"

Po (ograniczonej) próbie resume auto wymagające monitora akceptuje wyłącznie `state === "running"`; „suspended", „interrupted" (Safari/iOS) i każdy inny stan zamyka kontekst i przerywa próbę czysto — koniec trybu awarii „VAD głuchy przez niedziałający kontekst". Tryb ręczny zachowuje nieblokujący best-effort z R2 #1.

### R2 #3 fixed — zbieganie kontekstów audio przy awarii analizatora

Kontekst przypisywany do `#levelContext` natychmiast po konstrukcji, więc sprzątanie (catch → #stopLevelMonitor) zamyka go na KAŻDEJ ścieżce awarii (createAnalyser, createMediaStreamSource(…).connect, dalsza inicjalizacja) — `close()` dokładnie raz na próbę, bez wycieków przy powtórnych próbach.

### Testy i e2e (runda 2)

- RED-first potwierdzone (stash implementacji): oba testy wiszącego resume zawieszały się na starym kodzie (timeout 5 s). Nowe przypadki w browser.test.ts: ręczny startuje bez czekania; auto przerywa po limicie na wstrzykniętych timerach (resume wołane raz, close raz, strumień zwolniony); „interrupted" — auto odrzuca, ręczny nagrywa; awarie createAnalyser/connect zamykają kontekst dokładnie raz. Kontrakt przerwania po stronie kontrolera (notice, zero prób, przycisk działa) pokryty testem z P1 #2 — wyścig resume żyje w adapterze, więc jego limity testowane są na poziomie przeglądarki.
- E2E: fake AudioContext w speech-recording-ux, kid-flow i kid-layout-stability dostały `state: "running"` (auto akceptuje tylko działający nasłuch); picture-vocabulary (wariant IN-03, bez mikrofonu) i kid-ui-layout (auto nie dosięga rejestratora — wiszące getUserMedia) bez zmian.
- Weryfikacja po commicie: 149 testów w targeted suite (kontroler + VAD + przeglądarka, przeglądarka 35), 506 jednostkowych w packages/kid-ui + contracts, typecheck czysty, pięć speców e2e zielonych na Dockerze — 78 testów (2,5 min).

## Review round 3 — findings addressed

Trzy commity na fix/speech-recognition (CodeRacket/właściciel, wszystkie potwierdzone w kodzie):

### R3 — obwiednia bipu (commit efd37eb)

Poprzednia obwiednia schodziła do zera już po ~50 ms (decay liczony od ataku), zostawiając 80 ms ciszy — dziecko łatwo przegapiało jedyny sygnał „teraz mów". Teraz atak ~10 ms do szczytu 0.3, plate wytrzymuje do BEEP_DURATION_S − BEEP_DECAY_S (80 ms), a decay ~50 ms domyka sygnał na końcu — bip słyszalny niemal pełne 130 ms. Częstotliwości (880/590 Hz), długości i pozostałe stałe bez zmian; test weryfikuje kolejność i argumenty obwiedni (setValueAtTime ×2, rampy ×2).

### R3 — P1: późny auto-start A kasował VAD nowego zadania B (commit fa8d129)

Wyścig: auto-start A wisi na getUserMedia → użytkownik anuluje A i przechodzi dalej → B startuje własną auto-próbę (własny VAD/bip, faza starting) → późne rozwiązanie A widziało starting ≠ recording i bezwarunkowo wołało #resetAutoCapture(), kasując stan auto B → B nagrywało bez VAD → onLimitReached (autoCaptureActive=false) pchało ciszę przez stopRecording jako PRÓBĘ — naruszenie SPEC §15. Fix: ogon autoCaptureSpeech bada własność (#autoCaptureTaskId === taskId) przed sprawdzeniem fazy — obcy ogon jest no-opem; latch przeżywa resety (cyklem życia zarządza wyświetlanie zadań), generacje izolują rekordery jak dotychczas. Testy RED-first (oba zawodziły na starym kodzie): wiszący start A na bramce + pełne przejście na B → mowa B daje dokładnie jedną próbę audio (dawniej: zero auto-stopów); cisza B → anulowanie z komunikatem i zerem zgłoszeń (dawniej: 1 zgłoszenie ciszy).

### R3 — literówka w SPEC §6 (commit 106d04d)

„obrazkowe mówi one" → „obrazkowe mówione" — jednowierszowa zmiana dokumentacyjna.

### Weryfikacja po rundzie 3

- Targeted suite (kontroler + VAD + przeglądarka): 151 testów zielonych (kontroler 103, przeglądarka 35, VAD 13).
- packages/kid-ui + contracts: 508 testów jednostkowych zielonych; typecheck czysty (0 błędów; unia KidScreen w nowych testach zawężana pomocnikami phaseOf/taskIdOf).
- Pięć speców e2e zielonych na Dockerze (global-setup): speech-recording-ux, kid-flow, kid-ui-layout, picture-vocabulary, kid-layout-stability — 78 testów (2,9 min).

## Review round 4 — findings addressed

Dwa commity na fix/speech-recognition (po scaleniu origin/main, merge 31ad823); trzecie znalezisko nie wymagało zmiany:

### R4 — P1 (gitar-bot): monitor niedostępny nie wyłącza mikrofonu obrazkowej sesji (commit 7ad259f)

Wspólny catch startRecording liczył disableForPicture (nieczytający + picture) i wyłączał mikrofon sesji serwerowo ZANIM obsłużono LevelMonitorUnavailableError — w głównym przypadku picture_speech awaria monitora (autoplay/interrupted) zabierała dziecku przycisk mimo komunikatu „Nagraj przyciskiem.". Fix: LMUE obsługany PIERWSZY, z wczesnym powrotem (idle + autoCaptureListenUnavailable, bez micDenied i bez #disableSessionMicrophone; strażniki generacji/epoki zachowane); pozostałe błędy bez zmian. Test RED-first (stary kod wpisował się do disabledSessions): obrazkowa sesja nieczytającego, picture_speech, awaria monitora → zero prób, zero wyłączeń sesji, mikrofon sesji włączony, przycisk i ręczne nagrywanie działają.

### R4 (codacy): startFakeRecording nie połyka regresji auto-startu (commit 64e15fc)

Timeout polla auto-startu w helperze kid-flow był cicho łapany i test schodził do klików ręcznych — regresja auto mowy przechodziła niezauważona (powrót IN-02). Teraz fallback ręczny zostaje tylko przy jawnie ustawionym braku zgody w teście (window.__kidMicPermission = prompt/denied); przy domyślnym granted timeout jest twardą porażką z kontekstem expect.poll. Wszystkie testy kid-flow zielone — auto-start realnie działa we wszystkich ścieżkach, które go oczekują.

### R4 (codacy): przeterminowana dokumentacja „~300 ms grace" w vad.ts — nieaktualne, pominięto commit

Pełny grep vad.ts (nagłówek włącznie), vad.test.ts, session-controller(.test).ts i docs/SPEC.md nie znajduje żadnego „300 ms"/„grace 3"/„martwa strefa" jako OPISU zachowania — pozostałe wzmianki „grace" to żywe pole stanu (graceUsed) i stała VAD_GRACE_SAMPLES=0 z poprawnym uzasadnieniem z rundy 3 (bip kończy się przed przechwytywaniem). Zgodnie z instrukcją commit pominięto.

### Weryfikacja po rundzie 4

- Targeted suite (kontroler + VAD + przeglądarka): 152 testy zielone (kontroler 104).
- packages/kid-ui + contracts: 509 testów jednostkowych; typecheck czysty.
- Pięć speców e2e zielonych na Dockerze (global-setup): speech-recording-ux, kid-flow, kid-ui-layout, picture-vocabulary (7/7 po scaleniu #110), kid-layout-stability — 78 testów (2,6 min).

## Review round 5 — poprawki PR #109 (2026-10-22)

- Anulowanie podczas zapytania o uprawnienia lub przygotowania mikrofonu unieważnia oczekujący auto-start przez `recordingGeneration`. Spóźnione przygotowanie nie zmienia gotowości mikrofonu ani nie zapisuje odmowy.
- Przycisk w trybie przełącznika zatrzymuje nagranie uruchomione automatycznie po pierwszym kliknięciu; Escape anuluje je także bez wcześniejszego gestu.
- Synchroniczny wyjątek `onMicrophoneReady` jest obsługiwany tak samo jak odrzucona obietnica: opcjonalny bip nie przerywa startu i nie pozostawia porzuconego strumienia.
- Bip próbuje wznowić nowy zawieszony AudioContext z limitem 750 ms; gra wyłącznie przy stanie `running`, a przy blokadzie lub timeout zamyka kontekst i kończy się bez błędu.
- Test pomijania `picture_speech` liczy wywołania getUserMedia, także przy braku natywnego mediaDevices, i sprawdza zero wywołań przez 1,5 s przy uprawnieniu `prompt`.

Weryfikacja: pięć nowych testów jednostkowych odtworzyło błędy przed poprawką (RED), po zmianie 514/514 testów kid-ui + contracts zielonych; pełny `pnpm typecheck` i `git diff --check` bez błędów. E2E na izolowanym PostgreSQL/Docker: 14 istniejących scenariuszy w speech-recording-ux i picture-vocabulary zielonych, dwa nowe scenariusze kliknięcia/Escape zielone w celowanym powtórzeniu. Pierwsza wersja testu kliknięcia kończyła nagranie przed minimalnymi 300 ms; po uwzględnieniu minimum test potwierdza dokładnie jedną wysyłkę, a Escape zero wysyłek.

API → MCP → skill: brak wpływu; zmiany dotyczą wyłącznie obsługi nagrywania i testów klienta, bez zmian endpointów, DTO, autoryzacji ani znaczenia danych raportu. Kalibracja i odsłuch na fizycznym urządzeniu pozostają do sprawdzenia przez właściciela.
