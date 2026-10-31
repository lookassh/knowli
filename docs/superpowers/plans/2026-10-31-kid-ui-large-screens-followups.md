# Kid UI na dużych ekranach — poprawki po PR #200: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Odpowiedzi nie zmieniają rozmiaru ani położenia w chwili werdyktu, panel wyniku nie zasłania treści w żadnej klatce, zwarty układ dostaje odstęp od góry przy myszy i nie przeskakuje na tablecie z klawiaturą, tekst lekcji ma wiersz ok. 60 znaków; spłacone długi testów z #200.

**Architecture:** Wyłącznie CSS i `ExerciseFrame` w `packages/kid-ui` plus testy. Rezerwa stopki wyboru obrazków i odstęp to tokeny w bloku tokenów `styles.css`; rezerwa panelu `overlay` liczona w efekcie layoutu, z akcjami zadania poza `AnimatePresence`; zwarty układ to kolumna flex z odstępem ustępującym pierwszy.

**Tech Stack:** React 19 (`useLayoutEffect`, `flushSync` z `react-dom`), CSS Modules, Motion (`AnimatePresence`), Vitest + jsdom, Playwright (Chromium), pnpm przez `corepack`.

**Spec:** `docs/superpowers/specs/2026-10-31-kid-ui-large-screens-followups-design.md` (dalej „spec”), na tle `docs/superpowers/specs/2026-10-30-kid-ui-large-screens-design.md` („spec #200”).

## Global Constraints

- Zakres: `packages/kid-ui`, `tests/`, dokumentacja. Bez zmian API, DTO, kontraktów, serwera, MCP, `SKILL.md`.
- Reguły Kid UI z `AGENTS.md`: literały koloru, rozmiaru/wagi fontu i promienia tylko w bloku tokenów `.kid-theme, .kid-ui` w `styles.css`; żadnych surowych `vh/dvh/svh/vw` (tylko `calc(N * var(--kid-…))`); ruch tylko przez Motion; `KidPage` jedynym właścicielem `zoom`; tokenów nie rejestrować przez `@property`.
- Nowe tokeny (nazwy wiążące): `--kid-picture-dock-height`, `--kid-compact-frame-offset: 90px`, `--kid-reading-measure`.
- Warunek zwartego układu (wiążący, identyczny w obu plikach CSS): `@media (min-width: 840px) and (min-height: 781px), (min-width: 960px) and (min-height: 480px) and (pointer: coarse)`.
- Odstęp od góry tylko przy `(hover: hover) and (pointer: fine)`, poza `.kid-page[data-zoomed="true"]` i poza wyborem obrazków.
- Rezerwa stopki tylko: `(min-width: 600px)`, `data-prompt-kind="picture_listening"`, poza `data-zoomed="true"` i `data-viewport-very-short="true"`.
- Komentarze w kodzie produkcyjnym Kid UI po polsku (jak w `ExerciseFrame`), w testach po angielsku (jak w `kid-large-screen.spec.ts`).
- Nowy spec E2E (jeśli powstanie) dopisz do `MOCKED_SPECS` w `tests/e2e/spec-projects.ts`; preferuj rozszerzenie istniejących speców.
- Commity po polsku, zakończone `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; bez identyfikatorów modeli; nie pushuj do `main`.
- E2E równolegle z innymi worktree: `UMIEM_TEST_RUN_ID=<unikalny>` i `UMIEM_E2E_PORT=<wolny, np. 25700>`; po `corepack pnpm build` można dodać `UMIEM_E2E_SKIP_BUILD=1`.
- Bramka SonarCloud: duplikacja nowego kodu ≤ 3% — wspólne helpery zamiast kopii w testach.

## Review Focus

1. **Ponowna próba po błędnym werdykcie** (panel znika, akcje wracają): rezerwa wraca do 0, akcja główna jest widoczna i klikalna, a wypchnięty, wychodzący panel nie przechwytuje kliknięć → test w Task 3.
2. **Zmiana rozmiaru okna przy widocznym panelu** (obrót, klawiatura, przeciągnięcie okna): ścieżka `ResizeObserver` + `flushSync` trzyma zakładkę ≤ 8 px w każdej klatce → krok zmiany okna w sondzie klatek, Task 3.
3. **Większa czcionka główna** (powiększony tekst systemu): token panelu w `rem` nadal daje stałe kafelki → przypadek `html { font-size: 125% }` w Task 4.
4. **Powiększenie gestem** (`data-zoomed="true"`): bez rezerwy stopki i bez odstępu → asercje CSS przy ręcznie ustawionym atrybucie w Task 4 i Task 5.
5. **Zadanie mowy w zwartym układzie** (właściciel wymienił „mowę”): pełny odstęp i odpowiedź bez przesunięcia → przypadek mowy w teście odstępu, Task 5.

---

### Task 1: Wspólne helpery testów geometrii i długa karta lekcji (bez zmian zachowania)

**Files:**
- Modify: `tests/e2e/helpers/kid-frame.ts`, `tests/e2e/helpers/picture-fixtures.ts`, `tests/e2e/helpers/kid-fixtures.ts`
- Modify: `tests/e2e/kid-large-screen.spec.ts`, `tests/e2e/picture-choice-layout.spec.ts`, `tests/e2e/lesson-card-audio-layout.spec.ts`

**Interfaces:**
- Produces (w `helpers/kid-frame.ts`):
  - `type ScreenRect = { left: number; top: number; right: number; bottom: number; width: number; height: number }`
  - `boxes(page: Page, selector: string): Promise<ScreenRect[]>`
  - `nextFrames(page: Page): Promise<void>` (dwie klatki rAF)
  - `pictureTiles(page: Page): Promise<{ tiles: ScreenRect[]; container: { width: number; height: number } }>`
  - `expectRectsUnchanged(before: ScreenRect[], after: ScreenRect[], label: string, tolerance = 1): void`
  - `settledDockReserve(page: Page): Promise<{ inlineReserve: number; scrollTop: number; scrollHeight: number; clientHeight: number; contentBottom: number; dockTop: number }>` — `contentBottom` = maksimum `getBoundingClientRect().bottom` dzieci `.kid-material-content` (jak `ExerciseFrame`), `dockTop` = górna krawędź `.kid-feedback-overlay` (element bez transformacji); czeka do ustalenia (jak dziś, ≤ 60 klatek).
- Produces (w `helpers/picture-fixtures.ts`): `fourPictureTilesFixture(): KidUiFixture`, `openPictureChoice(page: Page, fixture?: KidUiFixture, viewport?: Viewport): Promise<void>` (zaślepia nagranie instrukcji `…0012` cichym WAV, otwiera zadanie `picture_listening`).
- Produces (w `helpers/kid-fixtures.ts`): `LONG_LESSON_CARD: { title: string; body: string; examples: string[] }` (treść z dzisiejszego `longLessonCardFixture`), używane przez `longLessonCardFixture`, `lesson-card-audio-layout.spec.ts` i zamiast `LONG_LESSON_TEXT` w `kid-large-screen.spec.ts`.

- [ ] **Step 1:** Przenieś `boxes`, `nextFrames`, `pictureTiles`, `settledDockReserve` z `kid-large-screen.spec.ts` do `helpers/kid-frame.ts` z sygnaturami jak wyżej; `settledDockReserve` mierzy maksimum dzieci (nie `lastElementChild`) i `.kid-feedback-overlay`. Dodaj `expectRectsUnchanged` i zastąp nim pętle porównania prostokątów w `kid-large-screen.spec.ts` (kafelki po werdykcie; opcje tekstowe po werdykcie).
- [ ] **Step 2:** Przenieś `fourPictureTilesFixture` i `openPictureChoice` do `helpers/picture-fixtures.ts`; `picture-choice-layout.spec.ts` używa `openPictureChoice` zamiast lokalnego `openPictureChoices` (ten sam przebieg, opcjonalny `viewport`).
- [ ] **Step 3:** Wydziel `LONG_LESSON_CARD` w `helpers/kid-fixtures.ts`; `lesson-card-audio-layout.spec.ts` (`LONG_BODY`, tytuł, przykłady) i `kid-large-screen.spec.ts` (`LONG_LESSON_TEXT`, jeśli to ta sama treść — inaczej zostaw z komentarzem dlaczego) używają go.
- [ ] **Step 4:** Usuń z komentarza nad `LONG_RECALL_PROMPT` zdanie o „znanym ograniczeniu” dopiero w Task 3 (tu bez zmian zachowania). Uruchom: `corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts tests/e2e/picture-choice-layout.spec.ts tests/e2e/lesson-card-audio-layout.spec.ts --project=mocked` — Expected: wszystkie przechodzą (ta sama liczba testów co przed zmianą). `corepack pnpm vitest run tests/e2e/spec-projects.test.ts` — PASS.
- [ ] **Step 5:** Commit: `Testy E2E: wspólne helpery geometrii i jedna długa karta lekcji`.

### Task 2: Długi w testach — strażnicy i brakujące przypadki

**Files:**
- Modify: `tests/kid-design-tokens.test.ts`, `tests/e2e/spec-projects.test.ts`, `tests/e2e/kid-large-screen.spec.ts`, `packages/kid-ui/src/layout/KidPage.test.tsx`, `packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx`, `AGENTS.md`

**Interfaces:** Consumes `waitForKidScale`, `expectFrameFillsViewport` (`helpers/kid-frame.ts`), `stubFinePointer` (`packages/kid-ui/src/test/fine-pointer-stub.ts`).

- [ ] **Step 1: Reguła jednostek okna.** W teście „uses zoom-aware viewport tokens…”: wyrażenie z flagą `i` i dopasowaniem także po interpolacji (`/(?:\d+(?:\.\d+)?|\})(?:[sld])?v(?:h|w|i|b|min|max)\b/gi`); skan plików `.ts` i `.tsx` (bez `*.test.ts(x)`) po usunięciu komentarzy `/* … */` i `// …`. Sprawdź czerwień tymczasowym wstawieniem `100VH` i `${n}vh` do kopii w pamięci testu (asercja na funkcji skanującej ciąg), potem zielono na repo.
- [ ] **Step 2: Reguła `@property`.** Nowy test „never registers the window-unit tokens or --kid-zoom as typed properties”: w surowym CSS pakietu (bez `styleRules`, z blokiem tokenów) brak `@property --kid-(vh|dvh|svh|vw|zoom)`; w `.ts/.tsx` brak `CSS.registerProperty`. PASS na repo.
- [ ] **Step 3: Strażnik `openDeckScreen`.** W `MOCK_SIGNALS` zastąp `/openDeckScreen\(/` sygnałem wymagającym jednocześnie importu z helpera i wywołania — np. funkcja `importsOpenDeckScreen(content)`: `/import\s*\{[^}]*\bopenDeckScreen\b[^}]*\}\s*from\s*["']\.\/helpers\/kid-fixtures["']/` oraz `/\bopenDeckScreen\(/`. Dodaj przypadek negatywny w teście (ciąg z lokalną funkcją `openDeckScreen` bez importu nie jest sygnałem). Run: `corepack pnpm vitest run tests/e2e/spec-projects.test.ts` — PASS.
- [ ] **Step 4: Zrzuty ekranu.** Owiń 10 testów `screenshot:` w `test.describe("screenshots", …)` z `test.skip(!process.env.UMIEM_E2E_SCREENSHOTS, "set UMIEM_E2E_SCREENSHOTS=1 to attach review screenshots")`; zaktualizuj komentarz na górze pliku. W `AGENTS.md` (Running and verifying) jedno zdanie: zrzuty z `kid-large-screen.spec.ts` tylko z `UMIEM_E2E_SCREENSHOTS=1` i reporterem `html`/`json`.
- [ ] **Step 5: Powrót do skali 1.** E2E „rescales on resize”: po kroku 1,2 ustaw 1280×800, `waitForKidScale(page, 1)`, asercje: `.kid-page` bez inline `zoom` i bez `--kid-zoom` (`element.style.zoom === ""`, `style.getPropertyValue("--kid-zoom") === ""`), `expectFrameFillsViewport`. Unit `KidPage.test.tsx` w „fine pointer change rescales”: po skali > 1 `setFine(false)` → brak `--kid-zoom`, `data-kid-scale="1"`, wysokość ramy = `innerHeight` px.
- [ ] **Step 6: Panel mikrofonu przy zoomie.** Nowy test w `MicrophoneSettingsButton.test.tsx` „places the panel in inner pixels under a 1.6 zoom”: `Element.prototype.currentCSSZoom` podstawione na 1,6 (`Object.defineProperty`, przywrócone w `afterEach`), `getBoundingClientRect` podstawione per element (przycisk przy prawej krawędzi wąskiego okna, panel szerszy niż miejsce), `visualViewport`/okno wąskie. Asercje: `top` panelu = `(button.bottom + 8 * 1.6) / 1.6`, `left` = `(viewport.width - panel.width - 16 * 1.6) / 1.6` (dociśnięcie do prawej krawędzi). Sprawdź czerwień, zamieniając w teście 1,6 na brak podstawienia (oczekiwania się nie zgadzają), potem zielono.
- [ ] **Step 7:** Run: `corepack pnpm vitest run tests/kid-design-tokens.test.ts tests/e2e/spec-projects.test.ts packages/kid-ui/src/layout/KidPage.test.tsx packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx` — PASS; `corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts --project=mocked` — PASS, testy `screenshot:` oznaczone jako skipped; z `UMIEM_E2E_SCREENSHOTS=1` — uruchamiają się.
- [ ] **Step 8:** Commit: `Testy: strażnicy jednostek okna i @property, powrót do skali 1, panel mikrofonu przy zoomie, zrzuty na żądanie`.

### Task 3: Rezerwa panelu przed malowaniem i przy przewijanym materiale (spec §3.2, §3.3)

**Files:**
- Create: `packages/kid-ui/src/layout/isomorphic-layout-effect.ts`
- Modify: `packages/kid-ui/src/layout/viewport.ts`, `packages/kid-ui/src/exercises/ExerciseFrame.tsx`, `packages/kid-ui/src/exercises/ExerciseFrame.module.css`
- Modify: `tests/e2e/helpers/kid-frame.ts`, `tests/e2e/helpers/kid-fixtures.ts`, `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: `export const useIsomorphicLayoutEffect: typeof useLayoutEffect` (w `layout/isomorphic-layout-effect.ts`; `viewport.ts` importuje go zamiast lokalnej stałej).
- Produces (helper E2E): `installDockOverlapProbe(page: Page): Promise<void>` i `readDockOverlapProbe(page: Page): Promise<{ samples: number[]; settled: number }>` — sonda w przeglądarce: `MutationObserver` na `document.body` wykrywa pierwsze pojawienie się `.kid-feedback-overlay` (tryb `overlay`) lub panelu w `flowDock`, zapisuje zakładkę w tym callbacku i w każdym `requestAnimationFrame` aż do 5 kolejnych identycznych próbek (min. 5 klatek). Zakładka = `max(bottom dzieci .kid-material-content) − top(.kid-feedback-overlay)`, px ekranu.
- Produces (fixture): `overflowingRecallFixture(feedback?: FeedbackDto): KidUiFixture` — `completedRecallFixture` z poleceniem na tyle długim, że materiał przewija się przed werdyktem na 1536×730 i 390×750; domyślny feedback = długa podpowiedź pisowni (przenieś `longSpellingHintFixture` i jego stałe do `helpers/kid-fixtures.ts` jako `longSpellingHintFeedback`).
- `ExerciseFrame` (bez zmian sygnatury): `.materialContent` dostaje `data-dock-reserve` gdy `dockPad > 0`.

- [ ] **Step 1: Testy czerwone — sonda klatek.** W `kid-large-screen.spec.ts` test `result panel never covers the material in any painted frame` z przypadkami: (a) 3440×1440, zadanie pisemne z krótkim błędnym werdyktem (`completedRecallFixture({ feedback: { kind: "incorrect", correctText: "cat" } })` lub odpowiednik dający zwykły panel błędu), (b) 3440×1440 z `longSpellingHintFeedback`, (c) 1536×730 z `longSpellingHintFeedback`. Dla każdego: `installDockOverlapProbe` przed „Sprawdź”, po werdykcie `readDockOverlapProbe`: każda próbka ≤ 8, `settled` ≤ 1; warunki wstępne po ustaleniu (`settledDockReserve`): `inlineReserve > 0`; w (c) także `scrollTop > 0`. Dodaj krok zmiany okna przy widocznym panelu (c: 1536×730 → 1280×600, ponowna sonda: każda próbka ≤ 8) — Review Focus 2.
- [ ] **Step 2: Test czerwony — przewijany materiał.** Test `the reserve lengthens an already scrolling material` dla 1536×730 i 390×750 z `overflowingRecallFixture()`: przed werdyktem `scrollHeight > clientHeight` materiału (warunek wstępny); po `settledDockReserve` `contentBottom ≤ dockTop + 1`; po `material.scrollTop = material.scrollHeight` i dwóch klatkach nadal `contentBottom ≤ dockTop + 1`.
- [ ] **Step 3: Test ponownej próby (Review Focus 1).** W tym samym bloku: błędny werdykt z `taskState: "issued"` (ponowna próba) na 3440×1440 i 1536×730 → „Spróbuj jeszcze raz” → `inlineReserve === 0`, `kid-submit` widoczny i klikalny (`click({ trial: true })` przechodzi), żaden element `.kid-feedback-overlay` nie zostaje w DOM po zakończeniu wyjścia (`toHaveCount(0)`).
- [ ] **Step 4:** Run: `corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts --project=mocked -g "painted frame|already scrolling|retry"` — Expected: FAIL na (a) i (c) sondy oraz na teście przewijania (zapisz liczby w raporcie zadania); (b) może już przechodzić — to dopuszczalne, (a) musi być czerwony.
- [ ] **Step 5: Implementacja `ExerciseFrame.tsx`.**
  - akcje (`Fragment key="kid-actions"`) renderowane poza `AnimatePresence`; pod `AnimatePresence mode="popLayout" initial={false}` zostaje wyłącznie element panelu (`kotwica overlay` albo `flowDock`);
  - efekt rezerwy: `useIsomorphicLayoutEffect`, zależności `[hasDock, task.taskId, flowFeedback]` (nie `dock`); pierwszy `measure()` synchronicznie zwykłym `setDockPad`;
  - `measure` wołany z `ResizeObserver` i `requestAnimationFrame` zatwierdza `setDockPad` przez `flushSync` (`react-dom`); z efektu layoutu — bez `flushSync` (parametr `measure(commit: "sync" | "flush")` albo dwie cienkie funkcje);
  - efekt `[dockPad]`: `useIsomorphicLayoutEffect`, `measureRef.current?.()` synchronicznie, plus dotychczasowy rAF;
  - `data-dock-reserve` na `.materialContent`, gdy `dockPad > 0`; zaktualizuj komentarze (polskie) przy efektach.
- [ ] **Step 6: Implementacja CSS.** `ExerciseFrame.module.css`: `.materialContent[data-dock-reserve] { flex: 1 0 auto; }` z komentarzem (specyficzność 0,2,0 < reguła zwarta 0,3,0). Usuń z komentarza nad `LONG_RECALL_PROMPT` zdanie o znanym ograniczeniu.
- [ ] **Step 7:** Run: testy z kroków 1–3 — PASS; cały `--project=mocked` (`corepack pnpm exec playwright test --project=mocked`) — PASS (w tym `kid-responsive.spec.ts` „exposure keeps the complete word card…”, `kid-feedback-dock.spec.ts`, `kid-feedback-layout.spec.ts`); `corepack pnpm vitest run packages/kid-ui` — PASS; `corepack pnpm typecheck` — PASS.
- [ ] **Step 8:** Commit: `Kid UI: rezerwa pod panelem wyniku przed malowaniem i przy przewijanym materiale`.

### Task 4: Stała rezerwa stopki w wyborze obrazków (spec §3.1)

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (blok tokenów), `packages/kid-ui/src/exercises/ExerciseFrame.module.css`, `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`, `tests/e2e/kid-responsive.spec.ts` (oczekiwania), inne specy geometrii tylko z uzasadnieniem
- Modify: `docs/superpowers/specs/2026-10-30-kid-ui-large-screens-design.md` (adnotacja §2), `AGENTS.md` (zdanie o rezerwie)

**Interfaces:** Consumes `openPictureChoice`, `fourPictureTilesFixture`, `pictureTiles`, `expectRectsUnchanged`, `boxes` (Task 1). Produces token `--kid-picture-dock-height` (wartość od `(min-width: 600px)`).

- [ ] **Step 1: Test czerwony.** `picture tiles keep their size and place through the verdict at ${w}x${h}` dla 1536×730 (skala 1), 1280×600 (1) i 3440×1440 (1,6) z komunikatem audio (dla tego okna nie zaślepiaj nagrania instrukcji — `openPictureChoice` z opcją bez zaślepki — i przed pomiarem `await expect(page.getByTestId("kid-question-audio-error").or(page.getByTestId("kid-task-audio-error"))).toBeVisible()`; użyj tego identyfikatora, który faktycznie pojawia się dla nagrania instrukcji). Fixture: cztery kafelki; próba 1 błędna z `taskState: "issued"` i podpowiedzią głosową (fixture z `uiAudio.ready`), próba 2 poprawna. Warunek wstępny: kafelki ograniczone wysokością — `limit` (wzór z istniejącego testu: `min(300, (cw − 12)/2, max(112, (ch − 12)/2))`) równy członowi wysokości. Asercje: `expectRectsUnchanged(before, afterIncorrect)` i `expectRectsUnchanged(before, afterCorrect)` (± 1 px). Run — Expected: FAIL (np. 258 → 220 przy 1536×730).
- [ ] **Step 2: Strażnicy.** W tym samym bloku: 3440×1440 bez komunikatu — kafelki 300 × 1,6 ± 2 przed i po werdykcie (istniejący test „use the new cap…” — zostaje, ma przejść); 390×750 — rozmiar przed = po; 844×390 — pusta stopka ukryta (`kid-exercise-actions` ma `display: none` lub wysokość 0 przed werdyktem), brak poziomego przepełnienia; `html { font-size: 125% }` (przez `page.addStyleTag`) przy 1536×730 — kafelki przed = po (Review Focus 3); `data-zoomed="true"` ustawione ręcznie na `.kid-page` przy 1536×730 — stopka bez `min-height` (Review Focus 4).
- [ ] **Step 3: Token.** W bloku tokenów `styles.css` dodaj `--kid-picture-dock-height` jako skład (komentarz z rozbiciem): padding panelu 2 × 10 px + `max(54px, <wysokość treści błędnego werdyktu: padding .kid-answer-feedback 2 × 6 px + dwa bloki tekstu w rem z line-height>, 48px przycisku podpowiedzi)`; zweryfikuj pomiarem prawdziwego panelu (poprawny i błędny, z podpowiedzią i bez) przy 1536×730 i wpisz wynik pomiaru do raportu. Token potrzebny tylko od 600 px — bez wartości dla telefonu.
- [ ] **Step 4: CSS.** `ExerciseFrame.module.css`, w `@media (min-width: 600px)`: `:global(.kid-page:not([data-zoomed="true"]):not([data-viewport-very-short="true"])) .root[data-feedback-layout="flow"][data-prompt-kind="picture_listening"] .actions { display: flex; min-height: calc(var(--kid-picture-dock-height) + 12px); }` (nadpisuje `.actions:empty { display: none }`; sprawdź specyficzność). `ExerciseFeedbackDock.module.css`, w `@media (min-width: 600px)`: panel `compact` w ramie `picture_listening` (z tym samym wyłączeniem zoomu i bardzo niskiego okna) ma `min-height: var(--kid-picture-dock-height)`. Komentarze po polsku z odsyłaczem do spec §3.1.
- [ ] **Step 5:** Run testy z kroków 1–2 — PASS. Jeśli 3440×1440 bez komunikatu spada poniżej 300 px: STOP i zgłoś liczby (spec §3.1) zamiast zmieniać test.
- [ ] **Step 6: Istniejące testy.** Cały `--project=mocked`. Oczekiwana zmiana: `kid-responsive.spec.ts` (ok. l. 346) `after.footer.height > before.footer.height` → równość ± 1, jeśli test dotyczy wyboru obrazków przy ≥ 600 px (inaczej bez zmian). Każdą inną zmienioną wartość uzasadnij w raporcie; telefonów (< 600 px) i „Co to jest?” zmiana nie dotyczy — ich testy mają przejść bez zmian.
- [ ] **Step 7: Dokumentacja.** Spec #200 §2: adnotacja, że kurczenie kafelków rozwiązuje spec 2026-10-31 §3.1 (od 600 px). `AGENTS.md` (punkt o dużym oknie): jedno zdanie o rezerwie stopki wyboru obrazków (`--kid-picture-dock-height`, od 600 px, kafelki stałe przy werdykcie).
- [ ] **Step 8:** Commit: `Kid UI: kafelki obrazków nie kurczą się przy werdykcie (stała rezerwa stopki)`.

### Task 5: Zwarty układ — kolumna flex, odstęp przy myszy, gałąź dotykowa (spec §3.4, §3.5)

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (token `--kid-compact-frame-offset: 90px`), `packages/kid-ui/src/exercises/ExerciseFrame.module.css`, `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`; oczekiwania w `kid-responsive.spec.ts`, specach `lesson-*-layout`, `kid-flow.spec.ts` tylko z uzasadnieniem
- Modify: spec #200 (adnotacja §3.2), `AGENTS.md`

**Interfaces:** Consumes `boxes`, `nextFrames`, `expectRectsUnchanged` (Task 1), `expectDockCorners` (zostaje w `kid-large-screen.spec.ts`), `waitForKidScale`, `resizeAndSettle`.

- [ ] **Step 1: Testy czerwone — odstęp.** `compact frame leaves the top offset above short tasks at ${w}x${h}` dla 3440×1440 (1,6), 3440×1300 (1,44), 1920×1080 (1,2), mysz: dla odpowiedzi pisemnej, wyboru tekstu, liter i mowy (zadanie `speech` z fixture bez nagrywania) — `instruction.top − exercise.top` = 90 × skala ± 2 (`kid-instruction`, `kid-exercise`); wybór obrazków = 0 ± 1; odpowiedzi pisemne/tekstowe bez przesunięcia po werdykcie (`expectRectsUnchanged` na polu/opcjach). Długa karta lekcji (`longLessonCardFixture`) na 3440×1440: odstęp ≤ 2 × skala i „Dalej” w oknie. Run — Expected: FAIL (dziś 0).
- [ ] **Step 2: Testy czerwone — tablet.** `describe("touch tablet keeps the compact frame with the keyboard open")` z `test.use({ hasTouch: true, isMobile: true })`: 1366×1024, tekstowe zadanie pisemne (`completedRecallFixture`), fokus w `kid-input`; zapamiętaj pozycje `kid-instruction`, `kid-input`, `kid-submit` względem `kid-exercise.top`; `resizeAndSettle` do 1366×600; pozycje względem ramy bez zmian ± 1; odstęp instrukcji = 0 ± 1; po werdykcie `expectDockCorners(page, "rounded")` i pole bez przesunięcia. 1280×720 dotykowo: zwarty (stopka tuż pod materiałem: `actions.top − material.bottom ≤ 8 + 1`). 844×390 dotykowo: zwykły. Kontrolnie bez dotyku 1366×600 i 1536×730: zwykły układ, odstęp 0. Run — Expected: FAIL dla 1366×600 i 1280×720.
- [ ] **Step 3: Token.** `--kid-compact-frame-offset: 90px` w bloku tokenów (komentarz: 10% wysokości projektowej 900 px wewnętrznych).
- [ ] **Step 4: CSS zwartego układu.** W `ExerciseFrame.module.css` reguła zwarta pod nowym warunkiem (Global Constraints): `.root:not(picture…)` → `display: flex; flex-direction: column;` (zamiast `grid-template-rows`/`align-content`), dzieci `flex: none`, `.material { flex: 0 1 auto; min-height: 0; }`, `::before { content: ""; flex: 0 1000 var(--frame-offset, 0px); margin-block-end: -8px; }` (kompensuje `gap: 8px`); `--frame-offset: var(--kid-compact-frame-offset)` ustawiane tylko w `@media (hover: hover) and (pointer: fine)` i poza `:global(.kid-page[data-zoomed="true"])`. Reguła `.root[data-feedback-layout="overlay"] .materialContent { flex: none; min-height: 0; }` zostaje. Zaktualizuj komentarz bloku (spec #200 §3.2 + spec §3.4–3.5). `ExerciseFeedbackDock.module.css`: ten sam nowy warunek dla zaokrąglonego panelu.
- [ ] **Step 5:** Run testy z kroków 1–2 — PASS; `data-zoomed="true"` ustawione ręcznie przy 3440×1440 → odstęp 0 (Review Focus 4); istniejące testy zwartego układu z #200 („no empty band”, „overlay dock reserve is exact”, „long lesson card scrolls inside the material”) i testy z Task 3 — PASS.
- [ ] **Step 6: Istniejące testy.** Cały `--project=mocked`, potem specy `real` dotknięte zwartym układem przy 1280×800 i większych (`kid-flow.spec.ts` i inne z wyniku `grep -l "1280, height: 800\|1280x800\|1440" tests/e2e/*.spec.ts`), uruchomione przez `corepack pnpm exec playwright test <pliki> --project=real`. Oczekiwane: `kid-responsive.spec.ts` (karta słowa przy 1440×960) przechodzi bez zmian, bo odstęp ustępuje długiej treści; specy `lesson-*-layout` przy 1280×800 mogą wymagać uwzględnienia odstępu — każda zmiana z uzasadnieniem w raporcie.
- [ ] **Step 7: Dokumentacja.** Spec #200 §3.2: adnotacja o nowym warunku, kolumnie flex i odstępie (odsyłacz do spec §3.4–3.5). `AGENTS.md`: w zdaniu o zwartym układzie nowy warunek z gałęzią dotykową i odstęp 90 px tylko przy myszy/touchpadzie.
- [ ] **Step 8:** Commit: `Kid UI: odstęp od góry w zwartym układzie i zwarty układ tabletu z klawiaturą`.

### Task 6: Długość wiersza tekstu lekcji (spec §3.6)

**Files:**
- Modify: `packages/kid-ui/src/styles.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`, `tests/e2e/helpers/kid-frame.ts`
- Modify: spec #200 (adnotacja §3.1), `AGENTS.md` (jeśli wymienia `60ch`)

**Interfaces:** Produces helper E2E `longestLineLength(page: Page, selector: string): Promise<number>` — dla tekstu elementu liczy znaki w każdym wierszu (prostokąty znaków z `Range` na węzłach tekstowych, grupowane po `top` ± 2 px), zwraca maksimum. Token `--kid-reading-measure`.

- [ ] **Step 1: Test czerwony.** `lesson text keeps about 60 characters per line in the 720 px column`: 1536×730; karta lekcji (`longLessonCardFixture`) — `longestLineLength(".kid-lesson-card__body") ≤ 65` i `≥ 45` (limit nie może zgnieść tekstu); tekst z lukami (fixture `lesson_cloze` z ≥ 200 znaków tekstu; zbuduj w `helpers/kid-fixtures.ts` na wzór istniejących fixture lekcji, np. z `lesson-kid.spec.ts`) — `longestLineLength(".kid-lesson-cloze__text") ≤ 65` i `≥ 45`. Run — Expected: FAIL (zapisz obecne długości).
- [ ] **Step 2: Token i użycie.** `--kid-reading-measure` w bloku tokenów (w `ch`, wartość dobrana pomiarem z kroku 1; komentarz: `ch` = szerokość `0` = 0,6 em Nunito, ok. 60 znaków polskiego tekstu); `.kid-lesson-card__body`, `.kid-lesson-card__examples` (zamiast `60ch`) i `.kid-lesson-cloze__text` → `max-inline-size: var(--kid-reading-measure)`; popraw komentarz „Running text of a card…”.
- [ ] **Step 3:** Run test z kroku 1 — PASS; cały `--project=mocked` — PASS (specy lekcji `lesson-*-layout`, `lesson-card-audio-layout`).
- [ ] **Step 4: Dokumentacja.** Spec #200 §3.1: adnotacja — `60ch` zastąpione tokenem `--kid-reading-measure` (spec 2026-10-31 §3.6). `AGENTS.md` — tylko jeśli opisuje `60ch`.
- [ ] **Step 5:** Commit: `Kid UI: wiersz tekstu lekcji ok. 60 znaków (token długości wiersza)`.

### Task 7: Pełna weryfikacja

**Files:** tylko poprawki wynikłe z przebiegu (z uzasadnieniem w raporcie).

- [ ] **Step 1:** `corepack pnpm typecheck` — exit 0.
- [ ] **Step 2:** `corepack pnpm test:unit` — wszystkie przechodzą (zapisz liczbę).
- [ ] **Step 3:** `corepack pnpm test:e2e:shards` (z `--base-port=25600`, jeśli inny przebieg zajmuje porty) — 0 failed; zapisz liczbę testów i czas. Gdy czasy plików mocno się zmieniły, sprawdź, czy `REAL_BUCKETS` nie wymaga przeliczenia (AGENTS.md).
- [ ] **Step 4:** Z `UMIEM_E2E_SCREENSHOTS=1` i reporterem `html` wygeneruj zrzuty `kid-large-screen.spec.ts` (1536×730 i 3440×1440) do katalogu raportu (`.superpowers/sdd/2026-10-31-kid-ui-large-screens-followups/screenshots/`) — dla właściciela w opisie PR.
- [ ] **Step 5:** Commit poprawek (jeśli były): `Testy: dostosowanie po pełnym przebiegu`.
