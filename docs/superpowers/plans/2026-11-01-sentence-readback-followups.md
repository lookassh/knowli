# „Posłuchaj zdania” — dalsze prace, etap 1 — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wskaźnik odtwarzania i przycisk „Posłuchaj wolniej” przy „Posłuchaj zdania”, sygnał nieudanego ręcznego odsłuchu oraz porządki techniczne i testy z issue #199.

**Architecture:** prawie cała zmiana jest w Kid UI. Adapter `AudioPlayer` dostaje tempo odtwarzania, kontroler sesji trzyma stan odczytu zdania w feedbacku ekranu nauki, a dok feedbacku pokazuje grupę przycisków zdania i region błędu. Serwer dostaje refaktoryzację bez zmiany zachowania (`withFeedbackSentenceAudio`), zaostrzenie domeny dla pustych klocków i testy integracyjne. Bez migracji i bez zmian kontraktów API.

**Tech Stack:** TypeScript strict, React 19, Motion (`motion/react`), CSS Modules, Vitest, Playwright, PostgreSQL (testy integracyjne).

**Spec:** `docs/superpowers/specs/2026-11-01-sentence-readback-followups-design.md` (przeczytaj w całości przed zadaniem).

## Global Constraints

- Wolne tempo: `SLOW_PLAYBACK_RATE = 0.75`, z zachowaną wysokością (`preservesPitch = true`).
- Teksty UI wyłącznie z `messages.kid` w `packages/contracts/src/messages.ts`:
  - `listenSlower: "Posłuchaj wolniej"`;
  - `sentenceAudioFailed: "Nagranie się nie włączyło. Dotknij jeszcze raz."`.
- Kid UI:
  - bez surowych `<button>`;
  - bez literałów koloru, rozmiaru i wagi fontu ani promienia poza blokiem tokenów;
  - jednostki okna jako `calc(N * var(--kid-vh))`;
  - pilnuje `tests/kid-design-tokens.test.ts`.
- Motion: tylko `transform` i `opacity`, komponenty `m.*`; ruch wyłącza `MotionConfig reducedMotion="user"`.
- Cele dotykowe ≥ 48 px, brak przepełnienia poziomego, „Dalej” zawsze osiągalne.
- Autoodczyt nigdy nie pokazuje błędu i nie gra wolno.
- Ponowne i wolne odsłuchy nie wysyłają zdarzeń nauki. Liczą się tylko w lokalnym raporcie aktywności.
- Komentarze i dokumentacja po polsku; identyfikatory po angielsku.
- Commity kończ linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Przed testami w worktree: gdy brak `.env`, uruchom `node scripts/setup-worktree.cjs --skip-install`. Nie instaluj zależności, jeśli `node_modules` istnieje.

## Review Focus

1. Szybkie dotknięcia: żółw tuż po autoodczycie, „Posłuchaj zdania” w trakcie wolnego. Wskaźnik ma być tylko na grającym przycisku, a po końcu żaden pierścień nie zostaje (Task 4, test „przełączenie tempa w trakcie”).
2. „Dalej” w trakcie wolnego odsłuchu. Następne zadanie nie dostaje wskaźnika ani tekstu błędu z poprzedniego (Task 4, test „Dalej gasi i nie przenosi stanu”).
3. Plik zdania zwraca 404 przy każdym dotknięciu. Dok nie skacze: tekst stoi, a ikona porusza się przy każdym kolejnym błędzie (Task 4, test rosnącego `seq`; Task 6, geometria ze stanem błędu).
4. Wąski telefon 320 px z długim feedbackiem. Przyciski zdania w kolumnie, „?” widoczne, „Dalej” osiągalne, bez poziomego scrolla (Task 6).
5. Przeglądarka ignoruje `playbackRate` (tempo zostaje 1). Brak błędu i limit aktywności z rzeczywistego tempa (Task 3, test „tempo nieprzyjęte”).

---

### Task 1: Serwer — bramka końca zadania i zaostrzenie `feedbackSentenceText`

**Files:**
- Modify: `packages/server/src/modules/learning/lessons/lesson-attempts.ts` (`withFeedbackSentenceAudio` ok. :981-997, wywołania ok. :1135 i :1616)
- Modify: `packages/server/src/modules/learning/lessons/lesson-attempts.test.ts`
- Modify: `packages/server/src/domain/lessons/feedback-sentence-text.ts`
- Modify: `packages/server/src/domain/lessons/feedback-sentence-text.test.ts`

**Interfaces:**
- Produces: `withFeedbackSentenceAudio(feedback: FeedbackDto | null, key: LessonTaskAnswerKey, taskState: "issued" | "answered" | "skipped"): FeedbackDto | null`.

- [ ] **Step 1: Testy, które padną.**
  - W `lesson-attempts.test.ts` wszystkie istniejące wywołania dostają trzeci argument `"answered"`.
  - Nowy test `"zadanie zostaje otwarte (issued) — bez nagrania"`:
    `expect(withFeedbackSentenceAudio({ kind: "incorrect", correctText: "goes" }, key(ASSET), "issued")).toEqual({ kind: "incorrect", correctText: "goes" })`.
  - W `feedback-sentence-text.test.ts` testy `null` dla:
    - `answer` `""` i `"   "` przy `lesson_gap` (stem `"He ___ to school."`), `lesson_error_fix`, `lesson_transform` i `lesson_open_answer`;
    - `lesson_choice` z poprawną opcją o tekście `"  "`;
    - `lesson_order` z `items: []`;
    - `lesson_order` z `items` `[{id:"a",text:"I"},{id:"b",text:""},{id:"c",text:"go"}]`. Ten przypadek dziś zwraca `"I go"`, więc test pada.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/modules/learning/lessons/lesson-attempts.test.ts packages/server/src/domain/lessons/feedback-sentence-text.test.ts`. Oczekiwane: FAIL (typ albo asercja w nowych testach).
- [ ] **Step 3: Implementacja.**
  - `withFeedbackSentenceAudio`: dodaj parametr `taskState` i na początku zwróć `feedback` bez zmian, gdy `taskState === "issued"`.
  - Z komentarza funkcji usuń zdanie „Wywołujący stosuje ją tylko…”, a dopisz, że zadanie otwarte do ponowienia nie dostaje nagrania (odsłuch przed ponowieniem byłby wsparciem).
  - Oba wywołania: `const feedback = withFeedbackSentenceAudio(visibleFeedback, key, taskState);` z wyliczonym `taskState` (wynik `nextLessonTaskState`), nie `finalTaskState`. Komentarze przy wywołaniach skróć tak, żeby nie powtarzały reguły.
  - W `feedbackSentenceText` dla `lesson_order` zwracaj `undefined` (→ `null`), gdy lista jest pusta albo którykolwiek `text.trim()` jest pusty. Komentarz typu: „jak `lesson_cloze`”.
- [ ] **Step 4:** ta sama komenda → PASS. Następnie `pnpm vitest run packages/server/src/modules` (testy architektoniczne i obszaru) → PASS.
- [ ] **Step 5: Commit** `Serwer: bramka końca zadania w withFeedbackSentenceAudio, zdanie bez pustych klocków (#199)`.

---

### Task 2: Integracja — kartkówka, fixture, liczba runów, stara lekcja w sesji

**Files:**
- Modify: `tests/fixtures/lesson-world.ts` (`attachLessonFeedbackAudio` :534, opcja `withFeedbackAudio` :58)
- Modify: `tests/integration/lesson-sentence-audio.test.ts`
- Modify: `tests/integration/grammar-without-tts.test.ts` (:106-120)

**Interfaces:**
- Consumes: Task 1 (zachowanie bez zmian).
- Produces: `attachLessonFeedbackAudio(pool, versionId, state: "ready" | "ready-approved" | "pending")`; `lessonWorld({ withFeedbackAudio?: "ready" | "ready-approved" | "pending" })`.

- [ ] **Step 1: Fixture.** `"ready-approved"` tworzy ten sam gotowy zasób co `"ready"`, ale wiersz `revision_assets` ma `state = 'approved'`. Komentarz funkcji wyjaśnia, że `"ready"` z wierszem `pending` to najczęstszy stan produkcji (publikacja nie czeka, a wiersz opublikowanej rewizji jest niezmienny).
- [ ] **Step 2: Parametryzacja po obu stanach wiersza.** W `play()` typ parametru `feedbackAudio` rozszerz o `"ready-approved"`. Pętlę `WITH_AUDIO` uruchamiaj dla `"ready"` i `"ready-approved"`, z nazwą testu zawierającą wariant.
- [ ] **Step 3: Kartkówka nie pyta o `feedback_audio`.** Nowy test `"kartkówka nie odpytuje feedback_audio; trening tak (kontrola)"`:
  - podmień `pool.query` jak w `grammar-without-tts.test.ts:149-160` i zbieraj teksty zapytań;
  - `startSession(..., mode: "mock_test")` na `lessonWorld(..., withFeedbackAudio: "ready", testDate)`: żaden tekst nie zawiera `'feedback_audio'` ani parametru o tej wartości;
  - kontrola: `startSession` treningu na drugiej lekcji widzi takie zapytanie;
  - przywróć `pool.query` w `finally`.

  Jeśli Drizzle przekazuje rolę jako parametr, sprawdzaj `args[1]` zawierające `"feedback_audio"`.
- [ ] **Step 4: Stara lekcja w sesji.** Nowy test `"nowa wersja starej lekcji: po workerze odczyt działa w sesji"`:
  - jak istniejący test z :68: stara lekcja bez flagi, potem `createLessonDraftFromPublished` i `publishLessonDraft` z domyślnym rejestrem;
  - `runDueGenerationWork(current, { lesson: 0, deck: 0, tts: 50, images: 0 })` w pętli do `processed === 0`;
  - dziecko (`createChild`) i przypisanie, jeśli sesja tego wymaga (wzorzec z innych testów pliku);
  - `startSession` treningu, `issueUntil(..., "lesson_choice")`, odpowiedź `choiceCorrect`;
  - asercje: `attempt.feedback?.correctAudioAssetId` równe `feedbackAssetOf(task.taskId)`, a `audioEvents(task.taskId)` ma jeden wpis z `occurredAt > receivedAt`.
- [ ] **Step 5: Dokładna liczba runów.** W `grammar-without-tts.test.ts` zastąp `toBeGreaterThanOrEqual(20)`:
  - `distinct` = `select count(distinct ra.asset_id)::int from learning_app.revision_assets ra join learning_app.item_revisions ir on ir.id = ra.item_revision_id where ir.deck_version_id = $1 and ra.role in ('target_audio','feedback_audio')` z `draft.id`;
  - asercja: `expect(runs.length).toBe(distinct)`.
- [ ] **Step 6:** `pnpm test:integration -- tests/integration/lesson-sentence-audio.test.ts tests/integration/grammar-without-tts.test.ts` (sprawdź w `package.json`, jak przekazać pliki). Oczekiwane: PASS. Jeśli nowy test kartkówki przechodzi także po chwilowym usunięciu `{ feedbackAudio: false }` w `lesson-mock-tests.ts:61`, test jest pusty i trzeba go poprawić. Zmianę zawsze cofnij.
- [ ] **Step 7: Commit** `Testy: kartkówka bez feedback_audio, fixture approved, dokładne runy TTS, stara lekcja w sesji (#199)`.

---

### Task 3: Odtwarzacz — tempo, `preservesPitch`, czas i spóźnione zdarzenia

**Files:**
- Modify: `packages/kid-ui/src/media/platform.ts` (`AudioPlayer` :72)
- Modify: `packages/kid-ui/src/media/browser.ts` (`BrowserAudioPlayer` :573-642)
- Modify: `packages/kid-ui/src/media/browser.test.ts`
- Modify: `packages/kid-ui/src/session/activity-report.test.ts`

**Interfaces:**
- Produces:
  - `export interface AudioPlaybackOptions { rate?: number }`;
  - `AudioPlayer.play(url: string, onStarted?: (durationMs: number | null) => void, options?: AudioPlaybackOptions): Promise<void>`;
  - `export const SLOW_PLAYBACK_RATE = 0.75` w `platform.ts`, eksportowane z `media` tam, gdzie dziś są eksporty platformy.

- [ ] **Step 1: Testy w `browser.test.ts`** (wzorzec istniejącego `describe("BrowserAudioPlayer…")`, fałszywy `Audio` i `fetch`):
  - `"tempo 0.75: ustawia playbackRate, defaultPlaybackRate i preservesPitch"`: element ma `playbackRate === 0.75`, `defaultPlaybackRate === 0.75`, `preservesPitch === true`;
  - `"bez opcji tempo 1"`;
  - `"durationMs dzieli przez faktyczne tempo elementu"`: `duration = 3`, rate 0.75 → `onStarted(4000)`;
  - `"tempo nieprzyjęte"`: fałszywy element ignoruje zapis `playbackRate` (zostaje 1) → `onStarted(3000)`, bez błędu;
  - `"prefiks webkitPreservesPitch, gdy brak preservesPitch"`: element bez `preservesPitch`, z `webkitPreservesPitch` → ustawione `true`;
  - `"playing po stop() nie woła onStarted"`: `play`, potem `stop()`, potem ręczne wywołanie przechwyconego handlera `onplaying` (albo `dispatchEvent`) → `onStarted` niewywołany.
- [ ] **Step 2: Test w `activity-report.test.ts`.** `"wolny odsłuch: limit z wydłużonego durationMs"`: `playbackStarted(id, 4000)` i koniec po 3900 ms → zapis 3900 ms, nie ucięty do 3000.
- [ ] **Step 3:** `pnpm vitest run packages/kid-ui/src/media/browser.test.ts packages/kid-ui/src/session/activity-report.test.ts` → FAIL.
- [ ] **Step 4: Implementacja.**
  - Port w `platform.ts`, komentarz: brak opcji = tempo 1.
  - `BrowserAudioPlayer.play(url, onStarted, options)`:
    - po `new AudioCtor(objectUrl)` ustaw `defaultPlaybackRate` i `playbackRate` na `options?.rate ?? 1`;
    - ustaw `preservesPitch = true` (albo prefiks, gdy właściwości standardowej nie ma: `"preservesPitch" in audio`);
    - w `onplaying` najpierw `if (generation !== this.#generation) return;`, potem `durationMs = round(duration * 1000 / (audio.playbackRate || 1))`;
    - `#releaseAudio` zeruje `onplaying`, `onended` i `onerror` przed `pause()`.
- [ ] **Step 5:** ta sama komenda → PASS. Następnie `pnpm vitest run packages/kid-ui/src/session/guidance-audio.test.ts` → PASS (fake z mniejszą liczbą parametrów).
- [ ] **Step 6: Commit** `Kid UI: tempo odtwarzania w AudioPlayer z zachowaną wysokością (#199)`.

---

### Task 4: Kontroler sesji — stan odczytu zdania, wolne tempo i błąd

**Files:**
- Modify: `packages/kid-ui/src/session/session-controller.ts`:
  - typ `LearningScreen.feedback` (:77);
  - `#stopPlayback` (:344);
  - `#playCountedAudio` (:351);
  - `playSentenceAudio` (:1290-1306);
  - wywołanie autoodczytu w `#showResult` (:1277).
- Modify: `packages/kid-ui/src/session/session-controller.test.ts` (fake `player` w `makeMedia` :178-188 i nowe testy)

**Interfaces:**
- Consumes: Task 3, czyli `AudioPlayer.play(url, onStarted, { rate })` i `SLOW_PLAYBACK_RATE`.
- Produces (używa Task 5):
  - `export type SentenceRate = "normal" | "slow"`;
  - `LearningScreen.feedback` dostaje `sentencePlaying?: SentenceRate | null` i `sentenceAudioError?: { rate: SentenceRate; seq: number } | null`;
  - `playSentenceAudio(rate?: SentenceRate): Promise<void>`, domyślnie `"normal"`.

- [ ] **Step 1: Fake odtwarzacza.** W `makeMedia`:
  - `play(url, onStarted, options)` zapisuje `media.playOptions.push(options)`;
  - czeka na `Promise.race([playGate, interrupted])`, gdzie `interrupted` to nowa obietnica każdego wywołania, rozwiązywana przez `stop()` (jak `#settle` adaptera);
  - dodaj opcję `media.rejectNextPlays: number`: kolejne wywołania rzucają `Error("autoplay blocked")` przed `onStarted`;
  - istniejące pola i zachowanie zostają.

  Uruchom `pnpm vitest run packages/kid-ui/src/session/session-controller.test.ts` → PASS (bez regresji).
- [ ] **Step 2: Testy, które padną** (`describe("odczyt zdania: stan, wolne tempo, błąd")`, lekcja z `correctAudioAssetId` jak istniejące testy odczytu):
  - `"wskaźnik od startu do końca"`: po wyniku `feedback.sentencePlaying === "normal"`; po zwolnieniu bramki `null`;
  - `"zablokowany autoodczyt nie zapala wskaźnika i nie ustawia błędu"`: `rejectNextPlays = 1` → `sentencePlaying` i `sentenceAudioError` są `null`;
  - `"wolno: rate 0.75 i wskaźnik slow"`: `playSentenceAudio("slow")` → ostatnie `playOptions` to `{ rate: 0.75 }`, `sentencePlaying === "slow"`;
  - `"przełączenie tempa w trakcie"`: w trakcie normalnego wołamy `"slow"` → `"slow"`; spóźnione zakończenie pierwszego nie zmienia `"slow"`;
  - `"przerwanie przez komunikat gasi synchronicznie"`: w trakcie odczytu `playGuidance("correct")` → zaraz po wywołaniu (przed `await`) `sentencePlaying === null`;
  - `"Dalej gasi i nie przenosi stanu"`: w trakcie wolnego `continueLearning()` → następny ekran ma `feedback === null`, a `onStarted` poprzedniego przebiegu niczego nie ustawia;
  - `"ręczny błąd: tempo i rosnący seq"`: `rejectNextPlays = 2`, dwa razy `playSentenceAudio("slow")` → `sentenceAudioError` to najpierw `{ rate: "slow", seq: 1 }`, potem `{ rate: "slow", seq: 2 }`;
  - `"błąd znika przy udanym starcie, nie przy próbie"`: po błędzie wołamy `"normal"`, które startuje; przed `onStarted` błąd jest nadal ustawiony, po starcie `null`.
- [ ] **Step 3:** `pnpm vitest run packages/kid-ui/src/session/session-controller.test.ts` → FAIL w nowych testach.
- [ ] **Step 4: Implementacja.**
  - `#sentenceRun` (number, prywatny) i `#sentenceErrorSeq` (number).
  - `#playCountedAudio(url, assetId, options?: { rate?: number; onStarted?: () => void })` woła callback aktywności i `options.onStarted` w tym samym `onStarted` odtwarzacza oraz przekazuje `{ rate }`.
  - `#stopPlayback` dodatkowo: gdy ekran nauki ma feedback z `sentencePlaying` ≠ `null`, zapisuje `sentencePlaying: null` (spread z bieżącego feedbacku) i emituje.
  - `playSentenceAudio(rate = "normal")`:
    - warunki wejścia bez zmian;
    - `const run = ++this.#sentenceRun`, zapamiętaj `attemptId`, potem `#beginPlayback()`;
    - `onStarted`: gdy `run === this.#sentenceRun`, przebieg niezakończony i bieżący `feedback.attemptId === attemptId` → zapis `{ sentencePlaying: rate, sentenceAudioError: null }`;
    - po zakończeniu: przy tych samych warunkach zapis `sentencePlaying: null`;
    - przy błędzie ręcznym (parametr `manual`) dodatkowo `sentenceAudioError: { rate, seq: ++this.#sentenceErrorSeq }`.

    Autoodczyt w `#showResult` woła prywatne `#playSentence("normal", { manual: false })`, a publiczne `playSentenceAudio(rate)` woła `#playSentence(rate, { manual: true })`. Każdy zapis robi spread z `this.#learning()!.feedback` w chwili zapisu.
  - Komentarz przy `#sentenceRun`: licznik jest niezależny od `#playbackGeneration`, bo `#stopPlayback` podbija tę generację przy każdym innym odtwarzaniu.
- [ ] **Step 5:** ta sama komenda → PASS, potem `pnpm vitest run packages/kid-ui` → PASS.
- [ ] **Step 6: Commit** `Kid UI: stan odczytu zdania w kontrolerze, wolne tempo i błąd ręcznego odsłuchu (#199)`.

---

### Task 5: Kid UI — żółw, grupa przycisków w doku, region błędu

**Files:**
- Modify: `packages/contracts/src/messages.ts` (`kid`: `listenSlower`, `sentenceAudioFailed` obok `listenExample` :513)
- Modify: `packages/kid-ui/src/components/KidIcon.tsx` (+ `KidIcon.test.tsx`): ikona `turtle`
- Modify: `packages/kid-ui/src/motion/kid-motion.ts` (+ `kid-motion.test.ts`): `kidListenFailWobble`, `kidListenFailWobbleTransition`
- Modify: `packages/kid-ui/src/components/ListenButton.tsx` (+ test w `answer-controls.test.tsx` albo nowy `ListenButton.test.tsx`)
- Modify: `packages/kid-ui/src/screens/ExerciseFeedbackDock.tsx`, `.module.css`, `ExerciseFeedbackDock.test.tsx`
- Modify: `packages/kid-ui/src/screens/LearnScreen.tsx` (:117-125, :277)

**Interfaces:**
- Consumes: Task 4 (`SentenceRate`, `feedback.sentencePlaying`, `feedback.sentenceAudioError`, `controller.playSentenceAudio(rate)`).
- Produces:
  - `ListenButton` z `icon?: "volume" | "turtle"` i `failKey?: number`;
  - prop doku `sentenceAudio?: { playing: SentenceRate | null; error: { rate: SentenceRate; seq: number } | null; disabled: boolean; onPlay: (rate: SentenceRate) => void } | null`.

- [ ] **Step 1: Testy, które padną.**
  - **`ListenButton`:**
    - `icon="turtle"` renderuje `KidIcon` `turtle` (`data-icon` albo klasa, zgodnie z testem `KidIcon`);
    - zmiana `failKey` z 1 na 2 montuje ikonę z nowym kluczem (`data-fail-key="2"` na `m.span`);
    - domyślnie `volume`.
  - **`ExerciseFeedbackDock.test.tsx`:**
    - z `sentenceAudio` dok ma `kid-sentence-audio-group` z `kid-sentence-audio` i `kid-sentence-audio-slow` (aria-label „Posłuchaj zdania” i „Posłuchaj wolniej”);
    - `playing: "slow"` → `data-sound-active` tylko na żółwiu;
    - `error: { rate: "slow", seq: 3 }` → żółw ma `data-audio-failed="3"`, a region `kid-sentence-audio-error` (`aria-live="polite"`) ma tekst `messages.kid.sentenceAudioFailed`;
    - `error: null` → region pusty, ale obecny;
    - `disabled` → oba przyciski `disabled`;
    - bez `sentenceAudio` → brak grupy i regionu.
  - **`KidIcon.test.tsx`:** `turtle` na liście ikon.
- [ ] **Step 2:** `pnpm vitest run packages/kid-ui/src/components packages/kid-ui/src/screens/ExerciseFeedbackDock.test.tsx` → FAIL.
- [ ] **Step 3: Implementacja.**
  - **Komunikaty:** wpisy w katalogu.
  - **Ikona `turtle`:** liniowa ścieżka SVG w siatce 24×24 (skorupa jako półkole z deseniem, głowa, dwie nóżki), `stroke` dziedziczony; bez `fill` w kolorze literałem.
  - **Token:** `kidListenFailWobble = { rotate: [0, -16, 12, -6, 0] }` i `kidListenFailWobbleTransition` o czasie i `times` `kidWrongIconTransition`. Komentarz: to samo „nie”, bez wejścia z obrotu −30°.
  - **`ListenButton`:** ikona w `m.span` (`key={failKey}`, `data-fail-key`, `animate={failKey ? kidListenFailWobble : undefined}`). Gdy `failKey` jest ustawione, przycisk dostaje `data-audio-failed={failKey}`.
  - **Dok:** `.dock` dostaje `container-type: inline-size`. W `.scroll` zamiast obecnego `div.guidance` z jednym przyciskiem stoi `div.sentenceGroup` (`data-testid="kid-sentence-audio-group"`) z dwoma `ListenButton`. Region błędu to `div.sentenceError` (`role` brak, `aria-live="polite"`, `data-testid`) między `.scroll` a `.actions`, renderowany zawsze, gdy jest `sentenceAudio`.
  - **CSS:**
    - `.sentenceGroup { flex: none; display: flex; gap: 8px; }`;
    - `@container (max-width: 479px) { .sentenceGroup { flex-direction: column; } }`;
    - `.sentenceError:empty { display: none; }`;
    - kolor `inherit` (dopisz selektor do listy `color: inherit` w CSS doku);
    - typografia przez `--kid-type-*`.

    Reguł nie dopisuj pod `.compact`.
  - **`LearnScreen`:** `sentenceAudio` budowany z `feedback.sentencePlaying ?? null`, `feedback.sentenceAudioError ?? null`, `disabled: busy || offline` (pola ekranu) i `onPlay: (rate) => void controller.playSentenceAudio(rate)`. `GuidanceButton icon="question"` bez zmian.
- [ ] **Step 4:** ta sama komenda → PASS. Następnie:
  - `pnpm vitest run tests/kid-design-tokens.test.ts tests/kid-no-mantine.test.ts` → PASS;
  - `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Kid UI: przycisk Posłuchaj wolniej, wskaźnik odtwarzania i sygnał błędu w doku (#199)`.

---

### Task 6: E2E — zachowanie, geometria, skala i ruch

**Files:**
- Modify: `tests/e2e/lesson-sentence-audio.spec.ts`
- Modify: `tests/e2e/kid-large-screen.spec.ts`
- Modify: `tests/e2e/kid-motion.spec.ts`

**Interfaces:**
- Consumes: test-id z Task 5 (`kid-sentence-audio`, `kid-sentence-audio-slow`, `kid-sentence-audio-group`, `kid-sentence-audio-error`), `data-sound-active`, `data-audio-failed`.

- [ ] **Step 1: `spyAudio` w `lesson-sentence-audio.spec.ts`.**
  - Podmieniony `play` zapisuje dla każdego wywołania `{ rate: this.playbackRate, pitch: this.preservesPitch }` w `__audio.calls`.
  - Nowy tryb `"reject-after-first"`: pierwsze `play` (autoodczyt) się udaje, kolejne odrzucają.
- [ ] **Step 2: Testy zachowania.**
  - `"the sentence button shows the playing ring during readback"`: po odpowiedzi `kid-sentence-audio` ma `data-sound-active="true"`; po „Dalej” następne zadanie nie ma grupy.
  - `"„Posłuchaj wolniej” replays the same file at 0.75 with preserved pitch"`: klik żółwia → ostatnie `calls` to `{ rate: 0.75, pitch: true }`, media zawiera `sentencePath` drugi raz, a żółw ma `data-sound-active`.
  - `"a failed manual replay shows the message, a blocked autoplay does not"`:
    - tryb `"reject"`: po odpowiedzi region błędu jest pusty;
    - klik żółwia: region ma `messages.kid.sentenceAudioFailed`, a żółw ma `data-audio-failed="1"`;
    - drugi klik: `data-audio-failed="2"`.
- [ ] **Step 3: Geometria.** Rozszerz `"sentence button fits the feedback dock on every form factor"`:
  - dodaj viewport 320×640;
  - dla obu przycisków: box ≥ 48×48, wewnątrz doku, bez przecięcia z `kid-guidance-play`;
  - `document.documentElement.scrollWidth <= innerWidth`;
  - „Dalej” w viewporcie.

  Drugi przebieg w stanie błędu (tryb `"reject"`, klik żółwia): region widoczny wewnątrz doku i „Dalej” w viewporcie.

  W pętli `CLOZE_VIEWPORTS` dopisz asercje obu przycisków (box ≥ 48, wewnątrz doku). Istniejące `MIN_VISIBLE_MATERIAL` ma nadal przejść.
- [ ] **Step 4: Skala > 1.** W `kid-large-screen.spec.ts` nowy test `"sentence audio group in the dock at scale 1.6"`:
  - fixture lekcji jak w `lesson-sentence-audio.spec.ts` (helpery `lessonAudioFixture` i `openLessonTask` z `./helpers/lesson-audio`);
  - viewport 1920×1080, `waitForKidScale(page, <wartość>)`, wpisaną na sztywno po pomiarze `computeKidLayoutScale`;
  - w pikselach ekranu: przyciski ≥ 48 × skala, wewnątrz doku, w jednym wierszu (równe `y`).
- [ ] **Step 5: Ruch.** W `kid-motion.spec.ts` (bez reduced-motion, jak inne testy pliku) nowy test `"a failed sentence replay wobbles the turtle icon"`: klik żółwia przy odrzucanym `play` → w ciągu 200 ms ikona `[data-fail-key]` ma `transform` różny od `none`. Drugi przebieg z `page.emulateMedia({ reducedMotion: "reduce" })` → `transform` `none`.
- [ ] **Step 6:** `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test tests/e2e/lesson-sentence-audio.spec.ts tests/e2e/kid-large-screen.spec.ts tests/e2e/kid-motion.spec.ts` → PASS.
- [ ] **Step 6b:** zrzut doku z żółwiem na 375×812 (Playwright `screenshot`) zapisany w scratchpadzie do oceny czytelności ikony w przeglądzie (nie commitujemy).
- [ ] **Step 7: Commit** `E2E: Posłuchaj wolniej, wskaźnik, błąd odsłuchu, geometria grupy przycisków (#199)`.

---

### Task 7: Dokumentacja

**Files:**
- Modify: `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md` (§2 „Poza zakresem”, §11)
- Modify: `docs/architecture.md` (akapit „Odczyt zdania po odpowiedzi”, ok. :702)
- Modify: `docs/SPEC.md` (Etap 3 rozdziału, akapit o „Posłuchaj zdania”, ok. :1014)

- [ ] **Step 1:** design #194 dostaje notę „Uzupełnienie (#199, 2026-11-01)”: wskaźnik odtwarzania i wolniejsze odtwarzanie zrobione, odnośnik do nowego specu. Przy „Powtórz za lektorem” bez zmian.
- [ ] **Step 2:** `architecture.md`, w akapicie odczytu dopisz:
  - „Posłuchaj wolniej” (0,75×, `preservesPitch`, tylko ręcznie, bez zdarzeń; w raporcie aktywności rzeczywisty czas słuchania);
  - wskaźnik odtwarzania od faktycznego startu;
  - cichy autoodczyt i sygnał ręcznego błędu;
  - bramkę `taskState` wewnątrz `withFeedbackSentenceAudio`;
  - `lesson_order` z pustym klockiem → bez nagrania.
- [ ] **Step 3:** `SPEC.md`, jedno zdanie przy opisie „Posłuchaj zdania”: przycisk „Posłuchaj wolniej” odtwarza to samo nagranie wolniej.
- [ ] **Step 4:** `grep -rn "correctAudioAssetId\|listenSlower\|playbacks" apps/web/src/integrations integrations` → brak trafień w kontraktach MCP. Wynik zapisz do opisu PR.
- [ ] **Step 5: Commit** `Dokumentacja: Posłuchaj wolniej i stan odczytu zdania (#199)`.

---

## Weryfikacja końcowa (po wszystkich zadaniach)

- `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e:shards` (build produkcyjny) — wszystko zielone; liczby do opisu PR.
- Końcowy przegląd gałęzi przez trzech niezależnych krytyków, dopiero potem PR (`Refs #199`).
