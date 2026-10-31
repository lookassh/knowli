# Kid UI na dużych ekranach — poprawki po PR #200: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Odpowiedzi nie zmieniają rozmiaru ani położenia w chwili werdyktu, panel wyniku nie zasłania treści w żadnej klatce, zwarty układ dostaje odstęp od góry przy myszy i nie przeskakuje na tablecie z klawiaturą, tekst lekcji ma wiersz ok. 60 znaków; spłacone długi testów z #200.

**Architecture:** Wyłącznie CSS i `ExerciseFrame` w `packages/kid-ui` plus testy. Rezerwa stopki wyboru obrazków i odstęp to tokeny w bloku tokenów `styles.css`; rezerwa panelu `overlay` liczona w efekcie layoutu, z akcjami zadania poza `AnimatePresence`; zwarty układ to kolumna flex z odstępem ustępującym pierwszy.

**Tech Stack:** React 19 (`useLayoutEffect`, `flushSync` z `react-dom`), CSS Modules, Motion (`AnimatePresence`), Vitest + jsdom, Playwright (Chromium), pnpm przez `corepack`.

**Spec:** `docs/superpowers/specs/2026-10-31-kid-ui-large-screens-followups-design.md` (dalej „spec”; v2 + poprawki po review planu), na tle `docs/superpowers/specs/2026-10-30-kid-ui-large-screens-design.md` („spec #200”).

## Global Constraints

- Zakres: `packages/kid-ui`, `tests/`, dokumentacja. Bez zmian API, DTO, kontraktów, serwera, MCP, `SKILL.md`.
- Reguły Kid UI z `AGENTS.md`: literały koloru, rozmiaru/wagi fontu i promienia tylko w bloku tokenów `.kid-theme, .kid-ui` w `styles.css`; żadnych surowych `vh/dvh/svh/vw` (tylko `calc(N * var(--kid-…))`); ruch tylko przez Motion; `KidPage` jedynym właścicielem `zoom`; tokenów nie rejestrować przez `@property`.
- Nowe tokeny (nazwy wiążące): `--kid-picture-dock-height`, `--kid-compact-frame-offset: 90px`, `--kid-reading-measure`.
- Warunek zwartego układu (wiążący, identyczny w obu plikach CSS): `@media (min-width: 840px) and (min-height: 781px), (min-width: 960px) and (min-height: 480px) and (pointer: coarse)`.
- Odstęp od góry tylko przy `(hover: hover) and (pointer: fine)`, poza `.kid-page[data-zoomed="true"]` i poza `data-prompt-kind` ∈ {`exposure`, `picture_exposure`, `picture_recall`, `picture_speech`, `lesson_card`} (wybór obrazków nie ma zwartego układu).
- Rezerwa stopki tylko: `(min-width: 600px)`, `data-prompt-kind="picture_listening"`, poza `data-zoomed="true"` i `data-viewport-very-short="true"`.
- Komentarze w kodzie produkcyjnym Kid UI po polsku (jak w `ExerciseFrame`), w testach po angielsku (jak w `kid-large-screen.spec.ts`).
- Testy table-driven (pętle okien/rodzajów w jednym teście na stronę), łącznie ok. 15 nowych testów E2E; wspólne helpery zamiast kopii (bramka SonarCloud: duplikacja nowego kodu ≤ 3%).
- Commity po polsku, zakończone `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; bez identyfikatorów modeli; nie pushuj do `main`.
- E2E równolegle z innymi worktree: `UMIEM_TEST_RUN_ID=<unikalny>` i `UMIEM_E2E_PORT=<wolny, np. 25700>`; po `corepack pnpm build` można dodać `UMIEM_E2E_SKIP_BUILD=1`; szybka iteracja: `UMIEM_E2E_WEB_MODE=dev`.

## Review Focus

1. **Ponowna próba po błędnym werdykcie:** wychodzący panel nie przechwytuje kliknięcia akcji w trakcie animacji, rezerwa wraca do 0, drugi błędny werdykt znów ma poprawną rezerwę → Task 3 Step 3.
2. **Zmiana rozmiaru okna przy widocznym panelu** (obrót, klawiatura, przeciągnięcie okna): zakładka w każdej malowanej klatce w granicy progu → Task 3 Step 1 (krok zmiany okna).
3. **Ćwiczenie lekcji z panelem `overlay` na laptopie** (tekst z lukami z podpowiedzią lekcji, materiał przewijany): rezerwa i przewijanie → Task 3 Step 2.
4. **Karta słowa i zadania z ilustracją w zwartym układzie:** bez odstępu, bez przesunięcia przy werdykcie → Task 5 Step 1.
5. **Panel błędnego werdyktu na 34" w wyborze obrazków** (wyższy niż poprawny): kafelki stałe i ≥ 290 px → Task 4 Step 2.

---

### Task 1: Wspólne helpery testów geometrii i fixture (bez zmian zachowania)

**Files:**
- Modify: `tests/e2e/helpers/kid-frame.ts`, `tests/e2e/helpers/picture-fixtures.ts`, `tests/e2e/helpers/kid-fixtures.ts`, `tests/e2e/spec-projects.test.ts`
- Modify: `tests/e2e/kid-large-screen.spec.ts`, `tests/e2e/picture-choice-layout.spec.ts`, `tests/e2e/lesson-card-audio-layout.spec.ts`, `tests/e2e/lesson-cloze-layout.spec.ts`

**Interfaces:**
- Produces (`helpers/kid-frame.ts`):
  - `type ScreenRect = { left: number; top: number; right: number; bottom: number; width: number; height: number }`
  - `boxes(page: Page, selector: string): Promise<ScreenRect[]>`; `nextFrames(page: Page): Promise<void>` (dwie klatki rAF)
  - `pictureTiles(page: Page): Promise<{ tiles: ScreenRect[]; container: { width: number; height: number } }>`
  - `pictureTileLimit(container: { width: number; height: number }): { limit: number; heightBound: boolean }` — wzór z dzisiejszego testu: `min(300, (cw − 12)/2, max(112, (ch − 12)/2))`, `heightBound` gdy decyduje człon wysokości
  - `expectRectsUnchanged(before: ScreenRect[], after: ScreenRect[], label: string, tolerance = 1): void`
  - `settledDockReserve(page: Page): Promise<{ inlineReserve: number; scrollTop: number; scrollHeight: number; clientHeight: number; contentBottom: number; dockTop: number }>` — `contentBottom` = maksimum `getBoundingClientRect().bottom` dzieci `.kid-material-content` (jak `ExerciseFrame`), `dockTop` = górna krawędź `.kid-feedback-overlay`; czeka do ustalenia (≤ 60 klatek)
- Produces (`helpers/picture-fixtures.ts`): `fourPictureTilesFixture(): KidUiFixture`; `openPictureChoice(page: Page, fixture?: KidUiFixture, options?: { stubInstructionAudio?: boolean }): Promise<void>` — **nie ustawia okna** (wywołujący robi to wcześniej); domyślnie zaślepia nagranie instrukcji `…0012` cichym WAV.
- Produces (`helpers/kid-fixtures.ts`): `LONG_LESSON_CARD: { title: string; body: string; examples: string[] }`; `clozeTask` (przeniesione z `lesson-cloze-layout.spec.ts:35-58`, ten sam kształt) — eksportowane.
- Produces (`spec-projects.test.ts`): sygnał zaślepki „import helpera instalującego fixture + wywołanie” dla `openDeckScreen` (z `./helpers/kid-fixtures`) i `openPictureChoice` (z `./helpers/picture-fixtures`).

- [ ] **Step 1:** Przenieś `boxes`, `nextFrames`, `pictureTiles`, `settledDockReserve` z `kid-large-screen.spec.ts` do `helpers/kid-frame.ts` (sygnatury jak wyżej; `settledDockReserve` mierzy maksimum dzieci i `.kid-feedback-overlay`). Dodaj `pictureTileLimit` i `expectRectsUnchanged`; zastąp nimi pętle porównania prostokątów i wzór `limit` w `kid-large-screen.spec.ts`.
- [ ] **Step 2:** Przenieś `fourPictureTilesFixture` i `openPictureChoice` do `helpers/picture-fixtures.ts`. `picture-choice-layout.spec.ts` używa `openPictureChoice` zamiast lokalnego `openPictureChoices`; wywołania, które polegały na domyślnym oknie 360×640 (dziś ok. l. 122, 281, 460 — sprawdź wszystkie), wywołują przed nim `page.setViewportSize({ width: 360, height: 640 })` jawnie.
- [ ] **Step 3:** W `spec-projects.test.ts` zastąp `/openDeckScreen\(/` funkcją `usesFixtureHelper(content, name, module)`: dopasowanie importu `/import\s*\{[^}]*\bNAME\b[^}]*\}\s*from\s*["']MODULE["']/` (także wielowierszowego) **i** wywołania `/\bNAME\(/`; sygnały: `openDeckScreen` z `./helpers/kid-fixtures`, `openPictureChoice` z `./helpers/picture-fixtures`. Dodaj przypadek negatywny: lokalna funkcja `openDeckScreen` bez importu nie jest sygnałem.
- [ ] **Step 4:** Wydziel `LONG_LESSON_CARD` (używane przez `longLessonCardFixture`, `lesson-card-audio-layout.spec.ts` zamiast `LONG_BODY`/tytułu/przykładów i `kid-large-screen.spec.ts` zamiast `LONG_LESSON_TEXT`, jeśli to ta sama treść — inaczej zostaw z komentarzem dlaczego) i `clozeTask` (używane przez `lesson-cloze-layout.spec.ts`).
- [ ] **Step 5:** Run: `corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts tests/e2e/picture-choice-layout.spec.ts tests/e2e/lesson-card-audio-layout.spec.ts tests/e2e/lesson-cloze-layout.spec.ts --project=mocked` — Expected: wszystkie przechodzą, ta sama liczba testów co przed zmianą (zapisz obie liczby). `corepack pnpm vitest run tests/e2e/spec-projects.test.ts` — PASS.
- [ ] **Step 6:** Commit: `Testy E2E: wspólne helpery geometrii, fixture i strażnik helperów zaślepek`.

### Task 2: Długi w testach — strażnicy i brakujące przypadki

**Files:**
- Modify: `tests/kid-design-tokens.test.ts`, `tests/e2e/kid-large-screen.spec.ts`, `packages/kid-ui/src/layout/KidPage.test.tsx`, `packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx`, `AGENTS.md`

**Interfaces:** Consumes `waitForKidScale`, `expectFrameFillsViewport` (`helpers/kid-frame.ts`), `stubFinePointer` (`packages/kid-ui/src/test/fine-pointer-stub.ts`).

- [ ] **Step 1: Reguła jednostek okna.** Wydziel w teście funkcję `rawViewportUnits(source: string, kind: "css" | "ts"): string[]` z wyrażeniem `/(?:\d+(?:\.\d+)?|\})(?:[sld])?v(?:h|w|i|b|min|max)\b/gi`; dla `ts` najpierw usuwa komentarze `/* … */` i `// …`. Kontrola pozytywna w pamięci: `rawViewportUnits("height: 100VH", "css")` i ``rawViewportUnits("`${n}vh`", "ts")`` zwracają trafienia; skan repo obejmuje `.ts` i `.tsx` (bez `*.test.ts(x)`) — wynik pusty.
- [ ] **Step 2: Reguła `@property`.** Nowy test „never registers the window-unit tokens or --kid-zoom as typed properties”: funkcja `typedTokenRegistrations(css: string, ts: string): string[]` (surowy CSS z blokiem tokenów: `@property --kid-(vh|dvh|svh|vw|zoom)`; TS: `CSS.registerProperty`); kontrola pozytywna w pamięci + pusty wynik na repo.
- [ ] **Step 3: Zrzuty ekranu.** Owiń 10 testów `screenshot:` w `test.describe("screenshots", …)` z `test.skip(!process.env.UMIEM_E2E_SCREENSHOTS, "set UMIEM_E2E_SCREENSHOTS=1 to attach review screenshots")`; zaktualizuj komentarz na górze pliku. `AGENTS.md` (Running and verifying): jedno zdanie — zrzuty z `kid-large-screen.spec.ts` tylko z `UMIEM_E2E_SCREENSHOTS=1` i reporterem `html`/`json`.
- [ ] **Step 4: Powrót do skali 1.** E2E „rescales on resize”: po kroku 1,2 ustaw 1280×800, `waitForKidScale(page, 1)`; `.kid-page` ma `style.zoom === ""` i `style.getPropertyValue("--kid-zoom") === ""`; `expectFrameFillsViewport`. Unit `KidPage.test.tsx`, „fine pointer change rescales”: po skali > 1 `setFine(false)` → brak `--kid-zoom`, `data-kid-scale="1"`, wysokość ramy = `innerHeight` px.
- [ ] **Step 5: Panel mikrofonu przy zoomie.** Test „places the panel in inner pixels under a 1.6 zoom” w `MicrophoneSettingsButton.test.tsx`: `Object.defineProperty(Element.prototype, "currentCSSZoom", { configurable: true, get: () => 1.6 })` (usunięte w `afterEach`), `getBoundingClientRect` podstawione per element (przycisk przy prawej krawędzi wąskiego okna z `KidViewportProvider`, panel szerszy niż miejsce), `--kid-safe-*` → 16. Asercje (`toBeCloseTo` na sparsowanych px): `top = (button.bottom + 8 * 1.6) / 1.6`, `left = (viewport.width − panel.width − 16 * 1.6) / 1.6`. Czerwień sprawdź mutacją komponentu (tymczasowo usuń `/ panelZoom` — test FAIL), potem przywróć — PASS.
- [ ] **Step 6:** Run: `corepack pnpm vitest run tests/kid-design-tokens.test.ts packages/kid-ui/src/layout/KidPage.test.tsx packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx` — PASS; `corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts --project=mocked` — PASS, testy `screenshot:` jako skipped; z `UMIEM_E2E_SCREENSHOTS=1` — uruchamiają się i przechodzą.
- [ ] **Step 7:** Commit: `Testy: strażnicy jednostek okna i @property, powrót do skali 1, panel mikrofonu przy zoomie, zrzuty na żądanie`.

### Task 3: Rezerwa panelu przed malowaniem i przy przewijanym materiale (spec §3.2, §3.3)

**Files:**
- Create: `packages/kid-ui/src/layout/isomorphic-layout-effect.ts`
- Modify: `packages/kid-ui/src/layout/viewport.ts`, `packages/kid-ui/src/exercises/ExerciseFrame.tsx`, `packages/kid-ui/src/exercises/ExerciseFrame.module.css`, `docs/folder-structure.md`
- Modify: `tests/e2e/helpers/kid-frame.ts`, `tests/e2e/helpers/kid-fixtures.ts`, `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: `export const useIsomorphicLayoutEffect: typeof useLayoutEffect` (`layout/isomorphic-layout-effect.ts`; `viewport.ts` importuje go zamiast lokalnej stałej).
- Produces (helper E2E): `installDockOverlapProbe(page: Page, options?: { startNow?: boolean }): Promise<void>`, `readDockOverlapProbe(page: Page): Promise<{ samples: number[]; settled: number; scale: number }>`. Sonda w przeglądarce: `MutationObserver` na `document.body` wykrywa `.kid-feedback-overlay` (przy `startNow` — od razu, jeśli istnieje); wtedy tworzy własny `ResizeObserver` (po obserwatorze `ExerciseFrame`, więc widzi stan po korekcie) na `documentElement`, `.kid-material`, `.kid-material-content` i nakładce, i zapisuje próbkę w każdym jego callbacku oraz po malowaniu (`requestAnimationFrame` → `setTimeout(0)`) aż do 5 kolejnych identycznych próbek po malowaniu. Próbka = `max(bottom dzieci .kid-material-content) − top(.kid-feedback-overlay)`, px ekranu; `scale` = `currentCSSZoom` `.kid-page`.
- Produces (fixture, `helpers/kid-fixtures.ts`): `longSpellingHintFeedback` (przeniesione z `kid-large-screen.spec.ts`, `longSpellingHintFixture` z niego korzysta) i `overflowingRecallFixture(feedback?: FeedbackDto): KidUiFixture` — `completedRecallFixture` z poleceniem, przy którym materiał przewija się przed werdyktem na 1536×730 i 390×750; domyślnie `longSpellingHintFeedback`.
- `ExerciseFrame` (bez zmian sygnatury): `.materialContent` ma `data-dock-reserve` przy `dock !== undefined && dockPad > 0`.

- [ ] **Step 1: Testy czerwone — sonda klatek.** Test `result panel never covers the material in a painted frame` (pętla przypadków): (a) 3440×1440, zadanie pisemne, krótki błędny werdykt (`completedRecallFixture({ feedback: { kind: "incorrect", correctText: "cat" } })` albo inny feedback dający zwykły panel błędu), (b) 3440×1440 z `longSpellingHintFixture`, (c) 1536×730 z `longSpellingHintFixture`, potem w (c) przy widocznym panelu `resizeAndSettle` do 1280×600 z `installDockOverlapProbe(page, { startNow: true })` przed zmianą. Kryteria: każda próbka ≤ `8 * scale + 1`, `settled ≤ 1`; warunki wstępne po ustaleniu (`settledDockReserve`): `inlineReserve > 0`, w (c) także `scrollTop > 0`.
- [ ] **Step 2: Test czerwony — przewijany materiał.** Test `the reserve lengthens an already scrolling material` (pętla): `overflowingRecallFixture()` przy 1536×730 i 390×750 oraz tekst z lukami (`clozeTask` z feedbackiem `lesson_hint` — segmenty, poprawny tekst, nagranie zdania jak w `lesson-cloze-layout.spec.ts`/`lesson-kid.spec.ts`) przy 1280×600 i 1536×730. Warunek wstępny przed werdyktem: materiał `scrollHeight > clientHeight`. Po `settledDockReserve`: `contentBottom ≤ dockTop + 1`; po `material.scrollTop = material.scrollHeight` i `nextFrames`: nadal `contentBottom ≤ dockTop + 1`.
- [ ] **Step 3: Test ponownej próby (Review Focus 1).** Test `retry hands the footer back to the answer at once` przy 3440×1440 i 1536×730, `page.emulateMedia({ reducedMotion: "no-preference" })`: błędny werdykt z `taskState: "issued"` → „Spróbuj jeszcze raz” → wypełnij `kid-input` → w jednym `evaluate`: `.kid-feedback-overlay` jeszcze istnieje (animacja wyjścia trwa) i `document.elementFromPoint(środek kid-submit)` leży wewnątrz `kid-submit`; po zniknięciu nakładki `paddingBottom` treści = 0 (czytane wprost, nie przez `settledDockReserve`); drugi błędny werdykt → `settledDockReserve`: `contentBottom ≤ dockTop + 1`.
- [ ] **Step 4:** Run: `corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts --project=mocked -g "painted frame|already scrolling|retry hands"` — Expected: FAIL przynajmniej dla (a), (c), przewijanego materiału i `elementFromPoint` (zapisz liczby w raporcie); (b) może już przechodzić.
- [ ] **Step 5: Implementacja `ExerciseFrame.tsx`.**
  - akcje (`Fragment key="kid-actions"`) poza `AnimatePresence`; pod `AnimatePresence mode="popLayout" initial={false}` wyłącznie element panelu (kotwica `overlay` albo `flowDock`);
  - efekt rezerwy: `useIsomorphicLayoutEffect`, zależności `[hasDock, task.taskId, flowFeedback]`; `measure(mode: "layout" | "observer")` — w trybie `layout` zwykły `setDockPad` i korekta przewinięcia; w trybie `observer` (callback `ResizeObserver`, rAF) przy zmianie wartości `flushSync(() => setDockPad(v))` i `return` (korektę robi efekt `[dockPad]` na świeżym układzie), bez zmiany — korekta jak dotąd;
  - efekt `[dockPad]`: `useIsomorphicLayoutEffect`, `measureRef.current?.("layout")` synchronicznie (nigdy `flushSync` w efekcie layoutu) plus dotychczasowy rAF (`"observer"`);
  - `data-dock-reserve` przy `dock !== undefined && dockPad > 0`; komentarze po polsku (w tym o nieszkodliwym „ResizeObserver loop completed with undelivered notifications”).
- [ ] **Step 6: Implementacja CSS.** `ExerciseFrame.module.css`: `.materialContent[data-dock-reserve] { flex: 1 0 auto; }` (specyficzność 0,2,0 < reguła zwarta 0,3,0, komentarz); `.actions > [data-motion-pop-id] { pointer-events: none; }` (wypchnięty, wychodzący panel nie przechwytuje kliknięć; komentarz). Usuń z komentarza nad poleceniem testowym w `kid-large-screen.spec.ts` zdanie o „znanym ograniczeniu”. `docs/folder-structure.md`: wiersz dla `layout/isomorphic-layout-effect.ts`.
- [ ] **Step 7:** Run: testy z kroków 1–3 — PASS; cały `--project=mocked` (`corepack pnpm exec playwright test --project=mocked`) — PASS (w tym `kid-responsive.spec.ts` „exposure keeps the complete word card…”, `kid-feedback-dock.spec.ts`, `kid-feedback-layout.spec.ts`, `kid-motion.spec.ts`); `corepack pnpm vitest run packages/kid-ui` — PASS bez ostrzeżeń `flushSync`; `corepack pnpm typecheck` — PASS.
- [ ] **Step 8:** Commit: `Kid UI: rezerwa pod panelem wyniku przed malowaniem i przy przewijanym materiale`.

### Task 4: Stała rezerwa stopki w wyborze obrazków (spec §3.1)

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (blok tokenów), `packages/kid-ui/src/exercises/ExerciseFrame.module.css`, `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`; oczekiwania w innych specach geometrii tylko z uzasadnieniem
- Modify: spec #200 (adnotacja §2), `AGENTS.md`

**Interfaces:** Consumes `openPictureChoice` (z `stubInstructionAudio: false`), `fourPictureTilesFixture`, `pictureTiles`, `pictureTileLimit`, `expectRectsUnchanged` (Task 1). Produces token `--kid-picture-dock-height`.

- [ ] **Step 1: Pomiar zapasu (przed CSS).** Na obecnym kodzie przy 3440×1440 (bez komunikatu) zmierz wysokość panelu poprawnego i błędnego werdyktu oraz `container.height` kafelków po każdym; zapisz w raporcie, czy błędny werdykt już dziś schodzi poniżej 300 px.
- [ ] **Step 2: Test czerwony.** Test `picture tiles keep their size and place through every verdict` (pętla okien): fixture z czterema kafelkami, próba 1 błędna z `taskState: "issued"` (szablon podpowiedzi głosowej: `kid-feedback-dock.spec.ts:336-350`, klucze `listening`, `incorrect`, `correct`), próba 2 poprawna. Okna RED: 1536×730 (1), 1280×600 (1), 3440×1440 (1,6) z komunikatem — dla tego okna `openPictureChoice(page, fixture, { stubInstructionAudio: false })` i trasa `…0012` odpowiadająca 404 (nie `abort` — to daje ekran offline), przed pomiarem `await expect(page.getByTestId("kid-task-audio-error")).toBeVisible()`. Warunek wstępny: `pictureTileLimit(afterIncorrect.container).heightBound === true`. Asercje: `expectRectsUnchanged(before, afterIncorrect)`, `(before, afterRetry)`, `(before, afterCorrect)`. Strażnicy w tej samej pętli: 3440×1440 bez komunikatu — stałe przy obu werdyktach i `width / 1.6 ≥ 290` (zastępuje `limit === 300` w teście „use the new cap…”, Review Focus 5); 390×750 — przed = po; 1536×730 z `html { font-size: 125% }` (`page.addStyleTag`) — przed = po; 844×390 — `kid-exercise-actions` przed werdyktem ma wysokość 0 lub `display: none`, brak poziomego przepełnienia. Run — Expected: FAIL na oknach RED z różnicą prostokątów (zapisz liczby; upewnij się, że to różnica prostokątów, nie warunek wstępny).
- [ ] **Step 3: Token.** W bloku tokenów `styles.css`: `--kid-picture-dock-height: calc(20px + max(54px, 12px + 1rem * 1.3 + 4px + var(--kid-type-headline-sm-size) * 1.2, 48px));` — skład zweryfikuj z CSS (`ExerciseFeedbackDock.module.css` `.compact`, `styles.css` ok. l. 1682–1696, przycisk podpowiedzi) i pomiarem prawdziwego panelu (poprawny i błędny przy 1536×730); komentarz z rozbiciem. Tylko wartość od 600 px.
- [ ] **Step 4: CSS.** `ExerciseFrame.module.css`, w `@media (min-width: 600px)`: `:global(.kid-page:not([data-zoomed="true"]):not([data-viewport-very-short="true"])) .root[data-feedback-layout="flow"][data-prompt-kind="picture_listening"] .actions { display: flex; min-height: calc(var(--kid-picture-dock-height) + 12px); }` (0,7,0 > `.actions:empty` 0,4,0). `ExerciseFeedbackDock.module.css`, w `@media (min-width: 600px)`: `:global(.kid-page:not([data-zoomed="true"]):not([data-viewport-very-short="true"]) .kid-exercise-frame[data-prompt-kind="picture_listening"]) .compact { min-height: var(--kid-picture-dock-height); }`. Komentarze po polsku z odsyłaczem do spec §3.1.
- [ ] **Step 5:** Run test z kroku 2 — PASS.
- [ ] **Step 6: Istniejące testy.** Cały `--project=mocked`. Szczególnie: `picture-choice-layout.spec.ts:53` (okna [600,650] i [840,480] wobec minimum 112 px) i `:121` (bez przewijania przy 768×1024 i 727×953). Każdą zmienioną wartość uzasadnij w raporcie; telefony (< 600 px) i „Co to jest?” mają przejść bez zmian.
- [ ] **Step 7: Dokumentacja.** Spec #200 §2: adnotacja, że kurczenie kafelków rozwiązuje spec 2026-10-31 §3.1 (od 600 px; 34": stałe ≥ 290 zamiast limitu 300 przy obu werdyktach). `AGENTS.md` (punkt o dużym oknie): jedno zdanie o rezerwie stopki wyboru obrazków (`--kid-picture-dock-height`, od 600 px).
- [ ] **Step 8:** Commit: `Kid UI: kafelki obrazków nie kurczą się przy werdykcie (stała rezerwa stopki)`.

### Task 5: Zwarty układ — kolumna flex, odstęp przy myszy, gałąź dotykowa (spec §3.4, §3.5)

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (token `--kid-compact-frame-offset: 90px`), `packages/kid-ui/src/exercises/ExerciseFrame.module.css`, `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`; oczekiwania w specach `lesson-*-layout`, `kid-flow.spec.ts` i innych tylko z uzasadnieniem
- Modify: spec #200 (adnotacja §3.2), `AGENTS.md`

**Interfaces:** Consumes `boxes`, `nextFrames`, `expectRectsUnchanged` (Task 1), `expectDockCorners` (zostaje w `kid-large-screen.spec.ts`), `waitForKidScale`, `resizeAndSettle`, `taskFor` (`helpers/kid-fixtures.ts`).

- [ ] **Step 1: Testy czerwone — odstęp.** Test `compact frame top offset by task kind` (jedna strona na okno, pętla rodzajów przez kolejne zadania fixture lub osobne otwarcia — wybierz tańsze): przy myszy 3440×1440 (1,6), 3440×1300 (1,44), 1920×1080 (1,2): `kid-instruction.top − kid-exercise.top` = 90 × skala ± 2 dla `recall` (`completedRecallFixture`), wyboru tekstu (`completedTextChoiceFixture`), `letter_completion` (`letterTask`) i `speech` (`{ ...recallFixture(), tasks: [{ ...taskFor("speech"), prompt: { ...prompt, audioAssetId: null } }] }`, jak `kid-layout-stability.spec.ts:408`); = 0 ± 1 dla `exposure` (karta słowa) i wyboru obrazków; odpowiedź pisemna i opcje bez przesunięcia po werdykcie (`expectRectsUnchanged`). Powiększenie gestem: podstawione `visualViewport.scale` jak `picture-choice-layout.spec.ts:425-433` przy 3440×1440 → odstęp 0. Kontrolnie przy myszy 1536×730 i 1366×600: zwykły układ — `kid-exercise-actions.bottom ≈ kid-exercise.bottom` (± 6) i odstęp 0. Run — Expected: FAIL dla rodzajów z odstępem (dziś 0).
- [ ] **Step 2: Testy czerwone — tablet.** `test.describe` z `test.use({ hasTouch: true, isMobile: true })`, na początku `expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)`: 1366×1024, `completedRecallFixture`, fokus w `kid-input`; pozycje `kid-instruction`, `kid-input`, `kid-submit` względem `kid-exercise.top`; `resizeAndSettle` do 1366×600 → te same pozycje względem ramy ± 1, odstęp 0 ± 1; po werdykcie `expectDockCorners(page, "rounded")` i `kid-input` bez przesunięcia. 1280×720: zwarty — `kid-exercise-actions.top − max(bottom dzieci .kid-material-content) ≤ 8 + 4 + 1`. 844×390: zwykły. Run — Expected: FAIL dla 1366×600 i 1280×720.
- [ ] **Step 3: Token.** `--kid-compact-frame-offset: 90px` w bloku tokenów (komentarz: 10% wysokości projektowej 900 px wewnętrznych).
- [ ] **Step 4: CSS zwartego układu.** `ExerciseFrame.module.css`, pod nowym warunkiem (Global Constraints), dla `.root` poza wyborem obrazków: `display: flex; flex-direction: column;` zamiast `grid-template-rows`/`align-content`; dzieci `.root > * { flex: none; }`, ale `.material { flex: 0 1 auto; min-height: 0; }` musi wygrać (wyższa specyficzność albo późniejsza reguła o równej — sprawdź); `.root::before { content: ""; flex: 0 1000000 var(--frame-offset, 0px); margin-block-end: -8px; }` (kompensuje `gap: 8px`). `--frame-offset: var(--kid-compact-frame-offset)` tylko w `@media (hover: hover) and (pointer: fine)` (zagnieżdżone w warunku zwartym) dla `:global(.kid-page:not([data-zoomed="true"])) .root:not([data-prompt-kind="exposure"]):not([data-prompt-kind="picture_exposure"]):not([data-prompt-kind="picture_recall"]):not([data-prompt-kind="picture_speech"]):not([data-prompt-kind="lesson_card"])`. Reguła `.root[data-feedback-layout="overlay"] .materialContent { flex: none; min-height: 0; }` zostaje. Zaktualizuj komentarz bloku (spec #200 §3.2 + spec §3.4–3.5). `ExerciseFeedbackDock.module.css`: nowy warunek dla zaokrąglonego panelu.
- [ ] **Step 5:** Run testy z kroków 1–2 — PASS; natychmiast `-g "exposure keeps"` (`kid-responsive.spec.ts`) — PASS bez zmian; istniejące testy zwartego układu z #200 („no empty band”, „overlay dock reserve is exact”, „long lesson card scrolls inside the material”) i testy z Task 3 — PASS.
- [ ] **Step 6: Istniejące testy.** Cały `--project=mocked`, potem specy `real` z oknami ≥ 840×781 (`grep -lE "1280, height: 800|1440|1920|3440" tests/e2e/*.spec.ts` przecięte z `REAL_SPECS`, w tym `kid-flow.spec.ts`) przez `--project=real`. Specy `lesson-*-layout` przy 1280×800 mogą wymagać uwzględnienia odstępu — każda zmiana z uzasadnieniem w raporcie.
- [ ] **Step 7: Dokumentacja.** Spec #200 §3.2: adnotacja o nowym warunku, kolumnie flex i odstępie (odsyłacz do spec §3.4–3.5). `AGENTS.md`: w zdaniu o zwartym układzie nowy warunek z gałęzią dotykową i odstęp 90 px tylko przy myszy/touchpadzie (bez zadań z ilustracją i kart).
- [ ] **Step 8:** Commit: `Kid UI: odstęp od góry w zwartym układzie i zwarty układ tabletu z klawiaturą`.

### Task 6: Długość wiersza tekstu lekcji (spec §3.6)

**Files:**
- Modify: `packages/kid-ui/src/styles.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`, `tests/e2e/helpers/kid-frame.ts`
- Modify: spec #200 (adnotacja §3.1), `AGENTS.md`

**Interfaces:** Consumes `longLessonCardFixture`, `clozeTask` (Task 1). Produces helper E2E `lineLengths(page: Page, selector: string, exclude?: string): Promise<number[]>` — liczba znaków tekstu w każdym wierszu elementu (prostokąty znaków z `Range` na węzłach tekstowych, grupowane po pionowym środku z tolerancją pół wysokości wiersza; węzły wewnątrz `exclude`, np. `.kid-lesson-cloze__gap-number`, pominięte). Token `--kid-reading-measure`.

- [ ] **Step 1: Test czerwony.** Test `lesson text keeps about 60 characters per line in the 720 px column` przy 1536×730: karta lekcji (`longLessonCardFixture`) i tekst z lukami (`clozeTask`): `max(lineLengths(…))` w [45, 65] dla `.kid-lesson-card__body` i `.kid-lesson-cloze__text` (z `exclude: ".kid-lesson-cloze__gap-number"`); blok wyśrodkowany: `|lewy odstęp − prawy odstęp| ≤ 2` względem pudełka treści rodzica. Run — Expected: FAIL (zapisz obecne długości).
- [ ] **Step 2: Token i użycie.** `--kid-reading-measure` w bloku tokenów (w `ch`, wartość z pomiaru, ok. 45ch; komentarz: `ch` = szerokość `0` = 0,6 em w Nunito, średni polski znak ≈ 0,45 em, więc ok. 60 znaków); `.kid-lesson-card__body`, `.kid-lesson-card__examples` (zamiast `60ch`) i `.kid-lesson-cloze__text`: `max-inline-size: var(--kid-reading-measure); margin-inline: auto;` — sprawdź, że nie łamie istniejących marginesów (np. `margin: 0`); popraw komentarz „Running text of a card…”.
- [ ] **Step 3:** Run test z kroku 1 — PASS; cały `--project=mocked` — PASS (`lesson-*-layout`, `lesson-card-audio-layout`, `lesson-cloze-layout`).
- [ ] **Step 4: Dokumentacja.** Spec #200 §3.1: adnotacja — `60ch` zastąpione `--kid-reading-measure` (spec 2026-10-31 §3.6). `AGENTS.md` (punkt o dużym oknie): token długości wiersza.
- [ ] **Step 5:** Commit: `Kid UI: wiersz tekstu lekcji ok. 60 znaków (token długości wiersza)`.

### Task 7: Pełna weryfikacja i zrzuty dla właściciela

**Files:** poprawki wynikłe z przebiegu (z uzasadnieniem), `AGENTS.md` (liczby), `tests/e2e/kid-large-screen.spec.ts` (zrzuty).

- [ ] **Step 1:** `corepack pnpm typecheck` — exit 0; `corepack pnpm test:unit` — wszystkie przechodzą (zapisz liczbę).
- [ ] **Step 2:** `corepack pnpm test:e2e:shards` (z `--base-port=25600`, jeśli inny przebieg zajmuje porty) — 0 failed; zapisz liczbę testów i czas; zaktualizuj w `AGENTS.md` liczbę i czas w opisie `pnpm test:e2e:shards`. Jeśli czasy plików mocno się zmieniły, sprawdź `REAL_BUCKETS` (AGENTS.md).
- [ ] **Step 3: Zrzuty.** W bloku `screenshots` (Task 2) dodaj: wybór obrazków **przed** werdyktem przy 1280×600 i 1536×730; odpowiedź pisemna **przed** werdyktem przy 3440×1440. Uruchom z `UMIEM_E2E_SCREENSHOTS=1 … --reporter=html` i zapisz PNG w `.superpowers/sdd/2026-10-31-kid-ui-large-screens-followups/screenshots/`.
- [ ] **Step 4:** Commit: `Testy: zrzuty przed werdyktem i liczby przebiegu E2E`.

### Task 8: Review gałęzi trzema krytykami i PR (kontroler)

- [ ] **Step 1:** Trzech niezależnych krytyków na całej gałęzi (`git diff origin/main...HEAD`): mechanizm (React/CSS/zoom), UX na urządzeniach (telefon, laptop, 34", tablet), testy i regresje. Popraw uwagi, ponów weryfikację dotkniętych testów.
- [ ] **Step 2:** Push gałęzi `fix/kid-ui-large-screens-followups` i PR do `main` (polski opis): zmiany 1–6 i długi testów; świadome wyłączenia ze spec §2; zmiana limitu 300 → stałe ≥ 290 na 34"; wpływ API → MCP → skill: brak; wykonane sprawdzenia z liczbami; niezweryfikowane (fizyczny 34", laptop, tablet z klawiaturą, animacje Motion, duże czcionki Androida); zrzuty. Bez scalania.
