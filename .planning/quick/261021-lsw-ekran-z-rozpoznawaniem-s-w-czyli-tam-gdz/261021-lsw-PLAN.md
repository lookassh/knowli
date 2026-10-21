---
phase: quick-261021-lsw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/kid-ui/src/media/vad.ts
  - packages/kid-ui/src/media/vad.test.ts
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
autonomous: true
requirements:
  - QUICK-261021-LSW
estimate:
  tokens: 165000
  raw_tokens: 110000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Ekran zadania speech/picture_speech z dostępnym mikrofonem sam rozpoczyna nagrywanie po wyświetleniu zadania — bez naciskania przycisku (D-01, D-02)"
    - "Bip startu gra wewnątrz ścieżki startu rejestratora — po udanym getUserMedia i PRZED rozpoczęciem przechwytywania (MediaRecorder.start) — więc żaden bip nie trafia do materiału wysyłanego na STT; bip końca gra PO zebraniu bajtów nagrania (D-04; bip dopiero po gotowości mikrofonu usuwa ryzyko mówienia dziecka przed inicjalizacją rejestratora)"
    - "Po wykryciu mowy (2×100 ms powyżej progu) i ~1,2 s ciszy nagrywanie zatrzymuje się samo i tworzy dokładnie jedną próbę audio (D-03)"
    - "Cisza bez wykrytej mowy nie tworzy próby: limit 15 s anuluje nagrywanie z komunikatem, przycisk pozostaje fallbackiem (D-03, SPEC §15, AGENTS)"
    - "Przycisk działa jak dotąd: ręczne nagrywanie (hold/toggle) i „Spróbuj jeszcze raz” po próbie; WrittenView (recall/spelling) pozostaje w trybie ręcznym (D-02)"
    - "Po „Nagraj jeszcze raz” mikrofon nie startuje sam (SPEC §16) — auto-start odpala się raz na wyświetlenie nowego zadania"
    - "Odmowa mikrofonu, błąd urządzenia, offline i wyjście z ekranu zwalniają strumień i bufory; brak pętli automatycznych ponowień (AGENTS)"
  artifacts:
    - packages/kid-ui/src/media/vad.ts
    - packages/kid-ui/src/media/vad.test.ts
    - packages/kid-ui/src/media/platform.ts
    - packages/kid-ui/src/media/browser.ts
    - packages/kid-ui/src/session/session-controller.ts
    - packages/kid-ui/src/screens/LearnScreen.tsx
    - packages/contracts/src/messages.ts
    - docs/SPEC.md
  key_links:
    - "LearnScreen useEffect (taskId + prompt.kind) → LearningSessionController.autoCaptureSpeech() → prepareMicrophone → startRecording → [BrowserRecorder.start: getUserMedia → onMicrophoneReady → playBeep(\"start\") → MediaRecorder.start] → onLevel → reduceVad → auto_stop → stopRecording → submitSpeech (ścieżka bez zmian)"
    - "BrowserRecorder onLevel (AnalyserNode, RMS ×4, ~10 Hz) → session-controller → reduceVad → auto_stop → stopRecording → submitSpeech (ścieżka bez zmian)"
    - "onLimitReached → (VAD słyszał mowę ? stopRecording : cancelRecording) — cisza bez mowy nigdy nie wywołuje submitSpeech"
---

<objective>
Automatyczne nagrywanie mowy z detekcją aktywności głosowej (VAD) na ekranach SpeechView i PictureSpeechView: nagrywanie startuje samo po wyświetleniu zadania (sygnalizowane bipem WebAudio granym po uzyskaniu strumienia mikrofonu, tuż przed rozpoczęciem przechwytywania), kończy się samo po wykryciu wypowiedzianego słowa i ~1,2 s ciszy (bip końca po zatrzymaniu), a cisza nie tworzy próby. Przycisk nagrywania pozostaje jako „Spróbuj jeszcze raz" i fallback przy zawiedzionej autodetekcji.

Purpose: Usunięcie objawu ucinania początku wypowiedzi (dziecko mówi, zanim inicjalizacja rejestratora się zakończy — przyczyny R1–R3 w RESEARCH) i uproszczenie UX: dziecko słyszy bip i mówi od razu, bez koordynacji palce–usta. Bip startu gra dopiero po udanym getUserMedia w ścieżce startu rejestratora, więc szybka reakcja dziecka nie wyprzedza gotowości rejestratora również na zimnym urządzeniu.
Output: Czysty moduł VAD + helper bipów i hook gotowości mikrofonu w warstwie mediów, orkiestracja auto-próby w kontrolerze sesji, wiring w LearnScreen, komunikaty PL w contracts, zaktualizowane SPEC §6/§12 oraz testy jednostkowe i e2e.

Świadoma akceptacja przekroczenia budżetu kontekstowego (scope_sanity): projekcja estimate to 165k tokenów wobec strefy 100k (ratio 1,65; confidence low — 0 próbek kalibracji, projekt nie ma jeszcze actuals). Tryb quick wiąże to zadanie JEDNYM planem o 1–3 zadaniach w JEDNYM pliku (executor czyta wyłącznie 261021-lsw-PLAN.md), a zakres wprost wynika z decyzji D-01–D-04 — nie może być okrojony ani przeniesiony do osobnego planu bez złamania kontraktu quick. Plan jest zamiast tego pocięty na sekwencyjne, atomowo commitowane plastry odzyskiwalne na granicach commitów: zadania 1–2 (media/VAD + kontroler — wyłącznie praca unit) i zadanie 3 (wiring + e2e + SPEC). Koszt trzymają w ryzach celowane odczyty sekcji (AGENTS „Celowane czytanie dokumentacji"), targetowane spece e2e zamiast pełnej suity oraz weryfikatory per zadanie.
</objective>

<execution_context>
@$HOME/.zcode/gsd-core/workflows/execute-plan.md
@$HOME/.zcode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz/261021-lsw-CONTEXT.md
@.planning/quick/261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz/261021-lsw-RESEARCH.md
@AGENTS.md

Kluczowe źródła (wzorce i kontrakty, czytaj sekcjami według potrzeby):
@packages/kid-ui/src/media/browser.ts
@packages/kid-ui/src/media/platform.ts
@packages/kid-ui/src/session/session-controller.ts
@packages/kid-ui/src/exercises/recording-gesture.ts
@packages/kid-ui/src/exercises/SpeechRecordButton.tsx
@packages/kid-ui/src/screens/LearnScreen.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Czysta maszyna stanów VAD + bip WebAudio w warstwie mediów</name>
  <precondition>Zależności worktree sprawne: [ -f node_modules/vitest/vitest.mjs ] || corepack pnpm install --prefer-offline --frozen-lockfile (przy planowaniu shims vitest/playwright były zerwane; .env już istnieje). Nigdy npm install.</precondition>
  <files>packages/kid-ui/src/media/vad.ts, packages/kid-ui/src/media/vad.test.ts, packages/kid-ui/src/media/platform.ts, packages/kid-ui/src/media/browser.ts, packages/kid-ui/src/media/browser.test.ts, packages/kid-ui/src/session/session-controller.test.ts</files>
  <behavior>
    - Test VAD (RED, nowy plik vad.test.ts, zero DOM, bez fake timers wystarczy sekwencja próbek): 3 próbki grace ignorują poziomy (tłumienie echa bipu startu); przejście arming→listening po wyczerpaniu grace; mowa = level ≥ 0.09 przez 2 kolejne próbki → speechDetected true; po mowie 12 kolejnych próbek &lt; 0.05 → akcja auto_stop i stan terminalny (dalsze próbki nie zmieniają stanu ani nie powtarzają akcji); poziomy poniżej progu mowy w fazie listening nie stopują nigdy; poziom ≥ progu ciszy w fazie spoken resetuje licznik ciszy (mowa przedłużona nie stopuje przedwcześnie); reset/re-arm po auto_stop tworzy świeżą instancję.
    - Test bipu (RED, rozszerzenie browser.test.ts, wzorzec fake AudioContext z istniejących testów linii 218–249): playBeep("start") i playBeep("end") tworzą OscillatorNode podłączony przez GainNode z obwiednią ( setValueAtTime / exponentialRampToValueAtTime lub odpowiednik w fake), startują i zatrzymują oscylator; AudioContext jest zamykany (close) po zagraniu; brak AudioContext w otoczeniu albo state "suspended" → obietnica rozstrzyga się natychmiast, bez rzucania i bez czekania na resume().
    - Test portu onMicrophoneReady (RED, browser.test.ts): rejestrator z opcją onMicrophoneReady wywołuje hook PO udanym getUserMedia i PRZED konstrukcją MediaRecorder/startem przechwytywania (kolejność we wspólnym logu fake'ów: getUserMedia-rozwiązany → hook → MediaRecorder-start); odrzucenie hooka jest połykane przez rejestrator — start nagrywania mimo to kończy się sukcesem (bip opcjonalny, nagrywanie obowiązkowe); brak opcji → hook nie jest wołany i start przebiega jak dotychczas.
    - Test regresji portu: makeMedia w session-controller.test.ts zyskuje playBeep — wszystkie istniejące testy kontrolera przechodzą bez zmian semantyki.
  </behavior>
  <action>Nowy czysty moduł packages/kid-ui/src/media/vad.ts według wzorca exercises/recording-gesture.ts (reducer + fabryka, bez DOM): eksport stałych VAD_SPEECH_LEVEL_THRESHOLD = 0.09, VAD_SILENCE_LEVEL_THRESHOLD = 0.05, VAD_GRACE_SAMPLES = 3 (~300 ms), VAD_SUSTAIN_SAMPLES = 2, VAD_TRAILING_SILENCE_SAMPLES = 12 (~1,2 s przy próbkowaniu ~10 Hz z onLevel — udokumentuj to założenie w docstringu; skala poziomów to rms×4 z browser.ts). API: reduceVadSample(state, level) zwracające { state, action } gdzie action ∈ "none" | "auto_stop", fazy "arming" → "listening" → "spoken" → "stopped" (terminal), oraz createSpeechVad() kapsułkujące reducer z metodą sample(level) → "none" | "auto_stop" i getterem speechDetected (reachnięta faza spoken). W packages/kid-ui/src/media/platform.ts dodaj do interfejsu PlatformMedia metodę playBeep(kind: "start" | "end"): Promise&lt;void&gt; — sygnał „teraz mów"/„koniec", kontroler nie zna WebAudio (zgodnie z istniejącym komentarzem portu). Dodaj też opcjonalny hook w RecorderOptions: onMicrophoneReady?: () => Promise&lt;void&gt; | void — BrowserRecorder.start woła go PO udanym getUserMedia i przejściu guardu generation/cancelled (bezpośrednio po zabezpieczeniu strumienia, przed new MediaRecorder i recorder.start), aby sygnał startu zagrał dopiero po gotowości mikrofonu: await Promise.resolve(this.#options.onMicrophoneReady?.()).catch(() => undefined) — odrzucenie hooka rejestrator połyka (bip opcjonalny, nagrywanie obowiązkowe; T-261021-02). W browser.ts zaimplementuj playBeep w createBrowserMedia: krótkotrwały AudioContext (zamykany w finally), OscillatorNode → GainNode, czas ~120–150 ms, obwiednia ataku/decay ~10/50 ms przeciw klikowi, bip startu wyższy (~880 Hz), końcowy niższy (~590 Hz); całość w try/catch — brak konstruktorów Web Audio lub kontekst suspended oznacza natychmiastowe resolve (bip jest opcjonalny, nagrywanie obowiązkowe; polityka autoplay — patrz RESEARCH „Common Pitfalls" 2). Nie modyfikuj timeslice ani MAX_RECORDING_MS. W session-controller.test.ts uzupełnij fake makeMedia o async playBeep() {} (wymóg nowego portu) — to jedyne dotknięcie tego pliku w tym zadaniu. Zero nowych zależności: packages/kid-ui/package.json zostaje wyłącznie z @learning/contracts (D-04; research odrzucił @ricky0123/vad-web).</action>
  <verify>
    <automated>corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/media/vad.test.ts packages/kid-ui/src/media/browser.test.ts packages/kid-ui/src/session/session-controller.test.ts</automated>
  </verify>
  <done>Nowe testy VAD, bipów i hooka onMicrophoneReady zielone; cała istniejąca suita session-controller.test.ts i browser.test.ts zielona bez zmian zachowania; vitest, nie npm; kid-ui bez nowych zależności; commit test([…]) przed implementacją (RED) i feat([…]) po (GREEN).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Orkiestracja auto-próby w kontrolerze sesji + komunikat PL</name>
  <precondition>Task 1 zmergowany (port playBeep i moduł vad.ts istnieją); [ -f node_modules/vitest/vitest.mjs ].</precondition>
  <files>packages/kid-ui/src/session/session-controller.ts, packages/kid-ui/src/session/session-controller.test.ts, packages/contracts/src/messages.ts</files>
  <behavior>
    - Test kolejności (RED): po wywołaniu autoCaptureSpeech() na świeżym zadaniu speech z gotowym mikrofonem fake-recorder przechwytuje options.onMicrophoneReady z opcji createRecorder i awaits go w swoim start() PRZED markerem rozpoczęcia przechwytywania; wspólny log fake'ów (media + recorder) potwierdza kolejność: prepareMicrophone → playBeep("start") → marker przechwytywania — bip startu zawsze po gotowości mikrofonu i przed rozpoczęciem przechwytywania (D-04); gdy media.playBeep odrzuca, start nagrywania mimo to się powiedzie; przy ręcznym startRecording opcja onMicrophoneReady jest nieobecna i playBeep("start") nie pojawia się w logu.
    - Test auto-stopu: poziomy z onLevel (fake makeRecorder zyskuje setLevelHandler przechwytujący options.onLevel, symetrycznie do setLimitHandler): 3 próbki grace, 2 próbki mowy ≥ 0.09, 12 próbek ciszy &lt; 0.05 → dokładnie jedno stopRecording → dokładnie jeden submitSpeech z modality audio, playBeep("end") po zebraniu audio, recordingPhase wraca do idle z processing true.
    - Test ciszy (D-03/SPEC §15): żadnych poziomów mowy, recorder.hitLimit() → cancelRecording z komunikatem messages.kid.autoCaptureNoSpeech, recorder.cancel wywołany raz, ZERO wywołań submitSpeech, recordingPhase idle, recordingNotice ustawiony (przycisk dostępny jako fallback).
    - Test limitu po usłyszanej mowie: poziomy mowy bez ciszy, hitLimit() → ścieżka stopRecording → jeden submitSpeech (realna mowa nie zostaje porzucona).
    - Test odmowy mikrofonu w auto: prepareMicrophone rzuca NotAllowedError → istniejąca ścieżka micDenied/storage/#disableSessionMicrophone, zero próby, brak kolejnych automatycznych wywołań.
    - Test epok/RF5: controller.teardown() w trakcie auto-nagrywania → recorder.cancel, zero submitSpeech; drugie wywołanie autoCaptureSpeech podczas aktywnego nagrywania → no-op.
    - Test zakresu: zadanie recall (WrittenView) i sesja mock_test → autoCaptureSpeech nic nie robi; manualne startRecording/stopRecording (hold/toggle) działa jak dotychczas — bez bipu końca.
    - Test retry: po próbie i powrocie do ćwiczenia (feedback null po continueLearning z retry) autoCaptureSpeech wywołane ponownie z tego samego taskId NIE startuje samo — auto-start wyłącznie na świeżo wyświetlonym zadaniu (SPEC §16 „nie uruchamia mikrofonu po «Nagraj jeszcze raz»").
  </behavior>
  <action>W session-controller.ts dodaj pola #vad (SpeechVad | null) i #autoCaptureActive (boolean) oraz publiczną metodę autoCaptureSpeech(): strażnicy — screen.kind learning, task.prompt.kind ∈ { "speech", "picture_speech" }, session.mode !== "mock_test", session.microphoneEnabled, !micDenied, !offline, !busy, !processing, feedback === null, reveal === null, recordingPhase === "idle", recorder === null; przy niegotowym mikrofonie await this.prepareMicrophone() i ponowna weryfikacja straży + epochu (odmowa zostawia istniejącą ścieżkę z prepareMicrophone — bez nowych pętli retry). Następnie ustaw #autoCaptureActive = true, #vad = createSpeechVad() oraz #autoStartBeep = () => this.#media.playBeep("start").catch(() => undefined), po czym await this.startRecording() (reuzycie istniejącej metody: 300 ms guard, generacje, obsługa błędów); jeśli po powrocie recordingPhase ≠ "recording", wyzeruj #autoCaptureActive, #vad i #autoStartBeep. W startRecording przy budowie RecorderOptions (okolice linii 1114) dołącz warunkowo onMicrophoneReady: this.#autoStartBeep — wyłącznie gdy pole jest ustawione — dzięki czemu bip startu gra wewnątrz BrowserRecorder.start już PO udanym getUserMedia, a PRZED MediaRecorder.start (usuwa ryzyko mówienia dziecka przed inicjalizacją rejestratora na zimnym urządzeniu; sonda prepareMicrophone wcześniej rozgrzewa ścieżkę uprawnień); ścieżka ręczna: pole null → brak hooka, brak bipu startu. W istniejącym onLevel (tworzonym w startRecording) po setLearning inputLevel dodaj: const action = this.#vad?.sample(level); przy "auto_stop" wywołaj void this.stopRecording() (istniejący guard generacji chroni przed stall). W onLimitReached zmień gałąź: gdy #autoCaptureActive i #vad.speechDetected === false → this.cancelRecording(messages.kid.autoCaptureNoSpeech) (cisza nie tworzy próby), w przeciwnym razie dotychczasowe void this.stopRecording(). W stopRecording po udanym await recorder.stop() i przejściu testów generation/epoch/task: gdy tryb pochodził z auto (#autoCaptureActive skonsumowane na początku metody) → void this.#media.playBeep("end").catch(() => undefined) przed wysyłką (nie blokuje submitSpeech). Zeruj #vad, #autoCaptureActive i #autoStartBeep w cancelRecording, #teardownRecording oraz w resetze ekranu w #loadNext (miejsce resetu recordingPhase). Dodaj klucz kid.autoCaptureNoSpeech do packages/contracts/src/messages.ts: „Nie usłyszałem słowa. Dotknij mikrofonu i powiedz je jeszcze raz." (krótki, naturalny PL dla dziecka, jeden wspólny katalog komunikatów). Nie zmieniaj kontraktu submitSpeech, ścieżki resume ani ekspozycji; WrittenView pozostaje ręczny (D-02). Świadomy trade-off (RESEARCH, constraint 7): #loadNext nie odtwarza automatycznie audio dla zadań speech/picture_speech, więc auto-start nie koliduje z auto-odtwarzaniem; tap w instrukcję głosową podczas TRWAJĄCEGO nagrywania pozostaje ignorowany przez istniejący guard playGuidance (recordingPhase !== "idle") — to status quo każdego nagrywania, nie nowa klasa konfliktu; auto-anulowanie ciszą i przycisk przywracają dostęp do instrukcji.</action>
  <verify>
    <automated>corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/media/vad.test.ts</automated>
  </verify>
  <done>Wszystkie nowe testy auto-przepływu zielone, cała istniejąca suita kontrolera zielona; dokładnie jeden submitSpeech na auto-stop, zero przy ciszy; bip startu po gotowości mikrofonu i przed rozpoczęciem przechwytywania (hook onMicrophoneReady; ścieżka ręczna bez bipu startu), bip końca po stop; komunikat autoCaptureNoSpeech w contracts; typecheck bez błędów (corepack pnpm typecheck).</done>
</task>

<task type="auto">
  <name>Task 3: Wiring LearnScreen, dokumentacja SPEC i adaptacja e2e</name>
  <precondition>Task 2 zmergowany; docker dostępny dla global-setup Playwright (e2e stawia PostgreSQL, next dev i worker); [ -f node_modules/vitest/vitest.mjs ].</precondition>
  <files>packages/kid-ui/src/screens/LearnScreen.tsx, docs/SPEC.md, tests/e2e/speech-recording-ux.spec.ts, tests/e2e/kid-flow.spec.ts, tests/e2e/kid-ui-layout.spec.ts, tests/e2e/picture-vocabulary.spec.ts, tests/e2e/kid-layout-stability.spec.ts</files>
  <action>W LearnScreen.tsx dodaj useEffect (import z react): gdy task.prompt.kind ∈ { "speech", "picture_speech" } wywołuj void controller.autoCaptureSpeech(); deps wyłącznie [controller, task?.taskId, task?.prompt.kind] — celowo BEZ screen.feedback, żeby auto-start odpalał się raz na wyświetlenie nowego zadania i nigdy po „Nagraj jeszcze raz" (SPEC §16); dodaj komentarz wyjaśniający ten zamiar i bezpieczeństwo podwójnego wywołania (synchroniczne ustawienie fazy preparing w prepareMicrophone czyni drugie wywołanie no-opem). Ten jeden effect jest JEDYNYM punktem wiringu auto-startu, wspólnym dla SpeechView i PictureSpeechView (decyzja „wspólna logika autostartu + VAD w współdzielonym komponencie"): logika autostartu i VAD żyje raz — w session-controller.autoCaptureSpeech oraz media/vad.ts — i nie jest duplikowana per widok. W docs/SPEC.md zaktualizuj akapit §6 (okolice linii 147, „Nagrywanie w zadaniach mowy…") i §12 (okolice linii 317): opisz, że na ekranach mowy (speech/picture_speech) nagrywanie rozpoczyna się automatycznie po wyświetleniu zadania, po sygnale dźwiękowym bip (WebAudio, bip startu przed nagrywaniem, bip końca po zatrzymaniu), kończy automatycznie po wykryciu mowy i ok. 1,2 s ciszy (VAD na poziomie mikrofonu), cisza nie tworzy próby (limit 15 s anuluje z komunikatem), przycisk pozostaje do ręcznej próby i ponowień, a po „Nagraj jeszcze raz" mikrofon nie startuje sam; zadania pisemne i tryb przytrzymania/przełącznika jako ścieżka ręczna pozostają bez zmian; dopisz datę zmiany 2026-10-21 w formacie przyjętym w dokumencie. E2E — najpierw rozszerz oba lokalne fake'i medium o sterowalny analyser: w installFakeMicrophone (speech-recording-ux.spec.ts) i injectFakeMediaPlatform (kid-flow.spec.ts) FakeAudioContext zyskuje createMediaStreamSource() → { connect() {} } oraz createAnalyser() → { fftSize: 256, getFloatTimeDomainData: (samples) => samples.fill((window.__kidMicLevel ?? 0) / 4), disconnect() {} } — poziom kontrolowany z testu przez window.__kidMicLevel (domyślnie 0; skala rms×4 z browser.ts), co daje VAD-owi deterministyczne próbki co ~100 ms; createOscillator/createGain nie są wymagane (bip degraduje się po cichu — to też jest asercja pośrednia); pamiętaj, że auto-przepływ wykonuje DWA wywołania getUserMedia (sonda prepareMicrophone + start rejestratora), więc fake'i liczące lub bramkujące wywołania muszą to uwzględnić. Następnie: w speech-recording-ux.spec.ts dodaj testy auto-przepływu — (1) auto-start: po wejściu w zadanie speech kid-recording widoczne bez kliknięcia i data-phase=recording; (2) auto-stop: __kidMicLevel=0.2 na ~400 ms, potem 0 → poll na wzroście test.recorderStops (lub recorderStarts/kid-recording znika), feedback/processing widoczny, w bazie exactly one próba modality audio dla taskId; (3) cisza: poziom 0 → po ~15,5 s (test.slow) data-phase=idle, status zawiera treść autoCaptureNoSpeech, zero próby audio w bazie; (4) odmowa mikrofonu (deny) — dotychczasowe asercje ścieżki micDenied; testy gestów hold/toggle/escape przenieś na ścieżkę ręczną (zadanie pisemne/recall z włączonym mikrofonem — WrittenView osadza SpeechRecordButton — albo po wyczerpaniu auto), zachowując ich intencję regresyjną; asercje „Włącz mikrofon"/data-ready dostosuj do auto-przygotowania. W kid-flow.spec.ts zmień startFakeRecording: najpierw czekaj na auto-start (poll test.recorderStarts > startsBefore lub aria-pressed=true), klik inicjujący gotowość zostaje tylko jako fallback; stopFakeRecording bez zmian semantyki (klik w trybie toggle kończy także auto-nagranie); bloki testów obrazkowych i RF5 (~linie 757, 943, 986) dostosuj do auto-startu. W kid-ui-layout.spec.ts blok z wiszącym getUserMedia i zadaniem speech (~linie 545–565): data-phase=preparing pojawia się bez kliku; blok z wpisywanym „cat" (~linie 80–95) to zadanie pisemne — sprawdź i dotknij tylko, jeśli fixture jest mowy; screenshoty baseline mogą zarejestrować wskaźnik nagrywania — odśwież za zgodą zasad repo. W picture-vocabulary.spec.ts (~linie 170–190, picture_speech + kid-skip): przed kliknięciem kid-skip poczekaj na powrót data-phase=idle (auto-anulowanie ciszą ~15 s, test.slow), bo skip jest blokowany podczas nagrywania. W kid-layout-stability.spec.ts (~linie 257–340, pętla recall/speech): iterację speech przepisz na cykl auto — data-phase=preparing pojawia się bez kliku (auto prepareMicrophone wisi na pierwszym wywołaniu fake'owego getUserMedia), resolveMicrophonePreparation zwalnia sondę, po czym bez drugiego kliku następuje auto-start i data-phase=recording (fake getUserMedia bramkuje tylko pierwsze wywołanie, więc wywołanie rejestratora przechodzi od razu; bip degraduje się po cichu); iteracja recall zostaje przy ręcznym klikaniu, a pomiary prostokątów w każdej fazie pozostają bez zmian. Utrzymuj polskie komunikaty i istniejące testidy; nie zmieniaj API/DTO — w SUMMARY odnotuj jawne uzasadnienie braku wpływu na MCP/SKILL.md (AGENTS: sekcja MCP). Jeśli którykolwiek spec okazał się nietknięty (np. toHaveCount(0) bez mikrofonu), odnotuj to w SUMMARY zamiast zmieniać go bez potrzeby.</action>
  <verify>
    <automated>corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui packages/contracts &amp;&amp; corepack pnpm typecheck &amp;&amp; corepack pnpm exec playwright test tests/e2e/speech-recording-ux.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/kid-ui-layout.spec.ts tests/e2e/picture-vocabulary.spec.ts tests/e2e/kid-layout-stability.spec.ts</automated>
  </verify>
  <done>Wszystkie pięć zmienianych speców e2e zielonych w &lt;automated&gt; (docker via global-setup), w tym nowy przypadek auto-start/auto-stop i cisza-bez-próby; kid-flow zielony po adaptacji helperów; kid-layout-stability zielony po przepisaniu iteracji speech na cykl auto; unit i typecheck zielone; SPEC §6/§12 opisuje auto-nagrywanie; SUMMARY zawiera wpływ API→MCP (brak) i listę dostosowanych speców e2e.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| dziecko → mikrofon (getUserMedia) | zgoda i strumień urządzenia; auto-start działa wyłącznie po uprzednio wydanej zgodzie |
| kid-ui → /api/v1/kid (submitSpeech) | bajty nagrania opuszczają przeglądarkę; kontrakt bez zmian |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261021-01 | Information Disclosure | autoCaptureSpeech (session-controller.ts) | medium | mitigate | Auto-start wyłącznie na widocznym zadaniu speech/picture_speech z wydaną zgodą (session.microphoneEnabled, !micDenied, tryb ≠ mock_test); widoczność zbierania strumienia zapewnia istniejący wskaźnik fazy nagrywania (kid-record z data-phase=preparing/recording — bez dodawania nowego statusu); epoch/#teardownRecording (RF5) zwalnia strumień przy wyjściu z ekranu; nagranie krótkotrwale w pamięci, cisza bez próby (AGENTS: prywatność nagrań). |
| T-261021-02 | Denial of Service | playBeep + analyser (media/browser.ts) | low | mitigate | Krótkotrwały AudioContext zamykany w finally (limit równoczesnych kontekstów na iOS — RESEARCH „Common Pitfalls" 4); porażka bipu nigdy nie blokuje nagrywania — odrzucenie hooka onMicrophoneReady jest połykane zarówno w kontrolerze (.catch), jak i w samym rejestratorze. |
| T-261021-03 | Tampering | progi VAD po stronie klienta (media/vad.ts) | low | accept | Fałszywy auto-stop wysyła krótsze nagranie — serwer waloryzuje czas trwania i transkrypcję niezmiennie; anulowanie przy ciszy zapobiega wysyłce pustych nagrań; progi są stałymi eksportowanymi do kalibracji przez właściciela (RESEARCH A1). |
| T-261021-SC | Tampering | instalacje pakietów (npm/pnpm) | high | mitigate | Zero nowych zależności — research odrzucił @ricky0123/vad-web (6,4 MiB + onnxruntime-web); packages/kid-ui/package.json zostaje wyłącznie z @learning/contracts; brak instalacji, więc brak pakietów [ASSUMED]/[SUS] do weryfikacji. |
</threat_model>

<verification>
- Unit: corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui packages/contracts — wszystkie pliki zielone (istniejące bez zmian semantyki, nowe: vad, beep, auto-przepływ kontrolera).
- Typy: corepack pnpm typecheck.
- E2E (docker via global-setup): speech-recording-ux (auto-start, auto-stop, cisza-bez-próby, odmowa, gesty na ścieżce ręcznej), kid-flow (helpery + RF5), kid-ui-layout, picture-vocabulary, kid-layout-stability (iteracja speech na cyklu auto).
- Pełne pnpm test:e2e pozostaje bramką właścicielską po merdżu (czasochłonne; poza budżet tego zadania) — odnotować w SUMMARY.
- Kolejność getUserMedia → bip startu → MediaRecorder.start jest gwarantowana ustrukturowanym hookiem onMicrophoneReady i pokryta testami unit; przerwa bip→przechwytywanie oraz progi VAD na urządzeniu docelowym (RESEARCH A1) wymagają kontroli właściciela z dzieckiem — wpisy do SUMMARY jako „niezweryfikowane na urządzeniu".
</verification>

<success_criteria>
- Na ekranie speech/picture_speech z dostępnym mikrofonem nagrywanie startuje samo po wyświetleniu zadania; bip startu gra po uzyskaniu strumienia mikrofonu (hook onMicrophoneReady) i kończy się przed rozpoczęciem przechwytywania, więc nie trafia do nagrania.
- Po wypowiedzeniu słowa i ~1,2 s ciszy nagrywanie kończy się samo (bip końca po zebraniu bajtów) i powstaje dokładnie jedna próba audio.
- Cisza przez pełny limit 15 s anuluje nagrywanie z komunikatem PL i bez próby; przycisk pozostaje funkcjonalny (hold/toggle/retry); WrittenView i mock_test nietknięte trybem auto.
- Po „Nagraj jeszcze raz" mikrofon nie włącza się sam; odmowa/błąd/wyjście z ekranu zwalniają strumień bez pętli ponowień.
- Zero nowych zależności; SPEC §6/§12 odzwierciedla nowe zachowanie; SUMMARY uzasadnia brak wpływu na MCP.
</success_criteria>

<output>
Utwórz .planning/quick/261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz/261021-lsw-SUMMARY.md po ukończeniu (szablon: gsd-core/templates/summary.md; wpisz wpływ API→MCP=brak, uruchomione testy, niezweryfikowane: kalibracja progów VAD na urządzeniu, pełna suita e2e).
</output>
