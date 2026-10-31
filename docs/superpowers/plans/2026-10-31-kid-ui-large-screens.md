# Kid UI na dużych ekranach — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kid UI wykorzystuje duże ekrany: kolumna 720 px od 840 px szerokości, zwarty układ zadania na wysokim oknie, łamanie brakujących liter między słowami i proporcjonalne powiększenie (CSS `zoom`) na urządzeniach z myszą.

**Architecture:** Wyłącznie `packages/kid-ui`. `KidPage` (jedyny właściciel pomiaru okna) liczy skalę czystą funkcją z `layout/viewport.ts` i nakłada `zoom` + `--kid-zoom` na `.kid-page`; CSS korzysta z tokenów jednostek okna skorygowanych o zoom; dwa miejsca JS przeliczają prostokąty ekranu na piksele wewnętrzne helperem z `layout/`. Szerokości i progi to tokeny w bloku tokenów `styles.css`.

**Tech Stack:** React 19, CSS Modules + globalny `styles.css`, Motion, Vitest (jsdom), Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-30-kid-ui-large-screens-design.md` — czytaj razem z planem; numery sekcji (§) odnoszą się do specu.

## Global Constraints

- Zakres: `packages/kid-ui`, testy, dokumentacja. Bez zmian API, DTO, serwera, panelu rodzica, MCP, `SKILL.md`, manifestu PWA. Jeden PR.
- Skala: `min(innerWidth / 840, innerHeight / 900)`, przedział [1; 1,6], `Math.floor(s * 100 + 1e-9) / 100`; > 1 tylko gdy `matchMedia("(hover: hover) and (pointer: fine)")` pasuje; nieprawidłowe wejście → 1.
- Kolumna: `--kid-column-max-width` 560 px, przy `(min-width: 840px) and (min-height: 480px)` 720 px. Kafelki: `--kid-visual-choice-max-size` 260 px → 300 px przy tym samym warunku.
- Zwarty układ ramy: `(min-width: 840px) and (min-height: 781px)`, poza `picture_listening`/`picture_recognition`.
- Tokeny okna: `--kid-vh`, `--kid-dvh`, `--kid-svh`, `--kid-vw` = `calc(1<unit> / var(--kid-zoom, 1))` w bloku tokenów; zero surowych jednostek okna poza nim.
- Poza `KidPage` nic nie ustawia `zoom`; tokenów nie rejestrować `@property`.
- `data-testid`, nazwy dostępne, kolejność fokusu i wysyłane odpowiedzi bez zmian. Literały koloru/fontu/promienia tylko w bloku tokenów (`tests/kid-design-tokens.test.ts`). Ruch tylko `transform`/`opacity`.
- Kod i identyfikatory po angielsku, komentarze w stylu otaczającego kodu, dokumentacja po polsku.

## Review Focus

1. Przeciągnięcie okna między monitorami / zmiana rozmiaru w trakcie zadania — skala przelicza się na żywo, ramka sesji nadal równa oknu, bez przewijania dokumentu (Task 2, test „rescales on resize”).
2. Nawigacja klawiaturą (Tab) do pola poniżej krawędzi materiału przy skali 1,6 — pole przewija się do widoku i nie chowa pod panelem wyniku (Task 3, test „keyboard focus stays visible”).
3. Fraza z brakującymi literami ze słowem dłuższym niż wiersz (np. 20 liter na 390 px) — słowo łamie się wewnątrz, bez poziomego przepełnienia (Task 7).
4. Powiększenie gestem touchpada przy skali > 1 — tryb `zoomed` działa jak dziś, skala się nie zmienia (Task 2, unit „pinch zoom keeps scale”).
5. Zadanie z bardzo długą treścią (karta lekcji) w zwartym układzie na 3440×1440 — materiał przewija się wewnątrz, akcja osiągalna (Task 6).

---

### Task 1: Funkcja skali i pomiar okna

**Files:**
- Modify: `packages/kid-ui/src/layout/viewport.ts`
- Test: `packages/kid-ui/src/layout/viewport.test.ts`

**Interfaces:**
- Produces: `KID_SCALE_REFERENCE_WIDTH = 840`, `KID_SCALE_REFERENCE_HEIGHT = 900`, `KID_SCALE_MAX = 1.6`, `KID_FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)"`; `computeKidLayoutScale({ width, height, finePointer }: { width: number; height: number; finePointer: boolean }): number`; `KidViewport` z nowym polem `scale: number` (`SERVER_VIEWPORT.scale = 1`).

- [ ] **Step 0: Przygotuj worktree** — brak `node_modules`: `corepack pnpm install --prefer-offline --frozen-lockfile`; `.env`: `node scripts/setup-worktree.cjs --skip-install`.
- [ ] **Step 1: Test `computeKidLayoutScale`** — tabela (`finePointer: true`, o ile nie zaznaczono): 390×750 → 1; 1536×730 → 1; 1280×600 → 1; 1920×950 → 1.05; 1920×1080 → 1.2; 2560×1300 → 1.44; 3440×1300 → 1.44; 3440×1440 → 1.6; 1146×1300 → 1.36; 1720×1300 → 1.44; 3840×2050 → 1.6; 949.2×2000 → 1.13 (zaokrąglenie); 1366×1024 z `finePointer: false` → 1; 3440×1440 z `finePointer: false` → 1; `NaN`, `Infinity`, `-1` w każdym polu → 1.
- [ ] **Step 2:** `corepack pnpm vitest run packages/kid-ui/src/layout/viewport.test.ts` — FAIL (brak eksportu).
- [ ] **Step 3: Implementuj** funkcję i pole `scale`. `useKidViewport` liczy `scale` z `innerWidth`, `innerHeight` i `matchMedia(KID_FINE_POINTER_QUERY).matches` (brak `matchMedia` → `false`), nasłuchuje też `change` tego zapytania, a pomiar przenieś z `useEffect` na izomorficzny layout effect (`typeof window === "undefined" ? useEffect : useLayoutEffect`, lokalnie w pliku). `visualViewport === null` zamień na `== null` (jsdom nie ma `visualViewport`).
- [ ] **Step 4:** ten sam test — PASS; `corepack pnpm exec tsc --noEmit -p packages/kid-ui/tsconfig.json` — popraw miejsca tworzące `KidViewport` (np. `MicrophoneSettingsButton.test.tsx:76`, `KidPage.tsx`) o `scale: 1`.
- [ ] **Step 5: Commit** `Kid UI: skala dużego okna w pomiarze viewportu`.

### Task 2: `KidPage` nakłada zoom

**Files:**
- Modify: `packages/kid-ui/src/layout/KidPage.tsx`
- Create: `packages/kid-ui/src/layout/KidPage.test.tsx`
- Create: `tests/e2e/helpers/kid-frame.ts`
- Modify: `tests/e2e/kid-responsive.spec.ts:153`, `tests/e2e/picture-choice-layout.spec.ts:55,98`, `tests/e2e/helpers/lesson-reach.ts:40` (+ inne specy z `toHaveCSS("height", \`${…height}px\`)` na `kid-session-frame` — `grep -rn 'kid-session-frame").toHaveCSS("height"' tests/e2e`)
- Create: `tests/e2e/kid-large-screen.spec.ts`; Modify: `tests/e2e/spec-projects.ts` (`MOCKED_SPECS`)

**Interfaces:**
- Consumes: `useKidViewport()` z polem `scale` (Task 1).
- Produces: na `.kid-page` atrybut `data-kid-scale="<scale>"` zawsze; przy `scale > 1` inline `zoom: <scale>` i `--kid-zoom: <scale>`; ramka sesji inline `height: ${height/scale}px`, `top: ${offsetTop/scale}px`. Helper E2E `expectFrameFillsViewport(page: Page, viewport: Viewport): Promise<void>` (prostokąt `kid-session-frame` ≈ okno ± 1 px). Helper E2E `waitForKidScale(page: Page, expected: number): Promise<void>` (czeka na `data-kid-scale` i `currentCSSZoom` ± 0,005 na `.kid-page`; przy `expected === 1` `currentCSSZoom` = 1).

- [ ] **Step 1: Unit `KidPage.test.tsx`** (podstaw `innerWidth/innerHeight`, `visualViewport` i `matchMedia` jak w `MicrophoneSettingsButton.test.tsx:65-74`): 3440×1440 + fine → `data-kid-scale="1.6"`, `style.getPropertyValue("--kid-zoom") === "1.6"`, ramka `style.height === "900px"`; 390×750 → `data-kid-scale="1"`, brak `--kid-zoom`, `style.height === "750px"`; „pinch zoom keeps scale” — `visualViewport.scale = 2` przy 3440×1440 → `data-zoomed="true"` i nadal `data-kid-scale="1.6"`. (`zoom` w jsdom nie trafia do stylu — sprawdza go E2E.)
- [ ] **Step 2:** `corepack pnpm vitest run packages/kid-ui/src/layout/KidPage.test.tsx` — FAIL.
- [ ] **Step 3: Implementuj** w `KidPage`: atrybut, zmienna, `zoom` (przez `style` jako `CSSProperties` z kluczem `zoom`), wysokość/offset dzielone przez skalę.
- [ ] **Step 4:** unit — PASS.
- [ ] **Step 5: E2E szkielet `kid-large-screen.spec.ts`** (dopisz do `MOCKED_SPECS`): sesja z `pictureChoiceLayoutFixture()`; dla okien z oczekiwaną skalą 1536×730→1, 1920×1080→1.2, 3440×1300→1.44, 3440×1440→1.6: `waitForKidScale`, `expectFrameFillsViewport`, `document.documentElement.scrollWidth <= innerWidth`, `scrollHeight <= innerHeight`; „rescales on resize” — 3440×1440 → 1920×1080 w tym samym teście, ponowne asercje.
- [ ] **Step 6:** zamień dokładne `toHaveCSS("height", …)` ramki we wskazanych specach na `expectFrameFillsViewport`.
- [ ] **Step 7:** `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test kid-large-screen kid-responsive picture-choice-layout` — PASS (spodziewane czerwone w innych asercjach odnotuj do Task 5/6, nie poprawiaj ich tutaj, chyba że wynikają ze zmiany skali — wtedy przelicz na px ekranu).
- [ ] **Step 8: Commit** `Kid UI: KidPage powiększa duże okno (CSS zoom)`.

### Task 3: Prostokąty ekranu → piksele wewnętrzne w JS

**Files:**
- Create: `packages/kid-ui/src/layout/css-zoom.ts`, `packages/kid-ui/src/layout/css-zoom.test.ts`
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.tsx:136-166`, `packages/kid-ui/src/components/MicrophoneSettingsButton.tsx:30-41`
- Create: `tests/e2e/helpers/feedback-fixtures.ts` (przeniesiony `completedRecallFixture` z `kid-feedback-dock.spec.ts:25`, eksportowany; spec źródłowy importuje)
- Modify: `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: `cssZoomOf(element: Element): number` (`currentCSSZoom`, gdy skończone i > 0, inaczej 1); `toLayoutPx(screenPx: number, element: Element): number` = `screenPx / cssZoomOf(element)`.

- [ ] **Step 1: E2E na czerwono** w `kid-large-screen.spec.ts`, okno 3440×1440 (skala 1,6):
  - „overlay dock keeps the end of the answer visible” — zadanie z odpowiedzią pisemną i długim `correctText`/feedbackiem (fixture z `feedback-fixtures.ts`, wydłużony tak, by panel realnie nachodził na treść); po werdykcie dolna krawędź ostatniego dziecka `.kid-material-content` ≤ górna krawędź panelu wyniku + 1.
  - „microphone panel opens under its button” — otwórz `kid-mic-settings`; `panel.top` ∈ [`button.bottom`, `button.bottom + 8 × 1.6 + 2`], `|panel.left − button.left| ≤ 2` (o ile panel mieści się w oknie).
  - „keyboard focus stays visible” — Tab do pola odpowiedzi; jego prostokąt w oknie i nad panelem/akcją.
- [ ] **Step 2:** `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test kid-large-screen -g "overlay dock|microphone panel|keyboard focus"` — FAIL (co najmniej dwa pierwsze).
- [ ] **Step 3: Unit `css-zoom.test.ts`** — element bez `currentCSSZoom` → 1; obiekt z `currentCSSZoom: 1.5` → `toLayoutPx(300) === 200`; `0`, `NaN` → 1. Implementuj `css-zoom.ts`.
- [ ] **Step 4: Popraw `ExerciseFrame`** — `contentBottom` i `anchor.getBoundingClientRect().bottom` przez `toLayoutPx(…, material)` przed odjęciem `offsetHeight` i dodaniem do `scrollTop`.
- [ ] **Step 5: Popraw `MicrophoneSettingsButton`** — obliczenia `left/top` bez zmian (px ekranu); wynik dziel przez `cssZoomOf(panel)` przed `setPanelPosition`. Istniejący unit (`top` 16 px / 40 px przy skali 1) bez zmian.
- [ ] **Step 6:** unit `css-zoom`, `MicrophoneSettingsButton.test.tsx`, `ExerciseFrame`-owe testy w `packages/kid-ui/src/exercises` — PASS; E2E z kroku 2 — PASS; `kid-feedback-dock` — PASS.
- [ ] **Step 7: Commit** `Kid UI: pomiary JS w pikselach wewnętrznych pod zoomem`.

### Task 4: Tokeny jednostek okna

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (blok tokenów + użycia), `layout/KidScreen.module.css:4`, `components/answer-controls.module.css:151`, `screens/ExerciseFeedbackDock.module.css:160,171`, `theme/kid-theme.module.css:6`
- Modify: `tests/kid-design-tokens.test.ts`
- Modify: `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: tokeny `--kid-vh`, `--kid-dvh`, `--kid-svh`, `--kid-vw` w bloku tokenów (spec §4.2).

- [ ] **Step 1: Test reguły** w `kid-design-tokens.test.ts`: „uses zoom-aware viewport tokens” — w `styleRules(url)` każdego `.css` oraz w plikach `.tsx` pakietu brak dopasowań `/\d(?:\.\d+)?(?:[sld])?v(?:h|w|i|b|min|max)\b/`.
- [ ] **Step 2:** `corepack pnpm vitest run tests/kid-design-tokens.test.ts` — FAIL z listą 22 miejsc.
- [ ] **Step 3:** dodaj tokeny; zamień każde użycie na `calc(N * var(--kid-<unit>))` z zachowaniem rodzaju jednostki (`100dvh` → `calc(100 * var(--kid-dvh))`, `36vh` → `--kid-vh`, `36svh` → `--kid-svh`, `6vw` → `--kid-vw`).
- [ ] **Step 4:** test reguły — PASS; `tests/kid-tokens.test.ts` — PASS.
- [ ] **Step 5: E2E** „short flow screen does not scroll at 1.6” — 3440×1440, ekran profili z jednym profilem i podsumowanie sesji: `scrollHeight <= innerHeight + 1`; ekran wypełnia okno (prostokąt `.kid-page` ≈ okno).
- [ ] **Step 6:** `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test kid-large-screen kid-responsive kid-ui-layout` — PASS.
- [ ] **Step 7: Commit** `Kid UI: jednostki okna przez tokeny odporne na zoom`.

### Task 5: Kolumna 720 i kafelki 300

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (blok tokenów, `.kid-learning`, `.kid-lesson-card__body` i pokrewne bloki ciągłego tekstu kart lekcji, komentarz o szerokości materiału ok. l. 2586), `layout/KidScreen.module.css:3`, `components/EndSessionConfirm.module.css:21`, `components/answer-controls.module.css:175`
- Modify: `tests/e2e/kid-end-confirm.spec.ts:138,141`, komentarz `tests/e2e/kid-decks-layout.spec.ts:209`, `tests/e2e/kid-large-screen.spec.ts`
- Create: `tests/e2e/helpers/deck-screen.ts` (przeniesiony `openDeckScreen` z `kid-decks-layout.spec.ts:26`)

**Interfaces:**
- Produces: tokeny `--kid-column-max-width`, `--kid-visual-choice-max-size` (spec §3.1).

- [ ] **Step 1: E2E** w `kid-large-screen.spec.ts`: „column width follows the token” — `.kid-learning` (sesja) i `.kid-screen`/`KidScreen` root (profile, zestawy) mają szerokość na ekranie: 1536×730 → 720; 1280×600 → 720; 1920×1080 → 864; 3440×1300 → 1036,8; 3440×1440 → 1152 (± 1), środek ± 1 od środka okna; kontrolnie 390×750 i 844×390 → jak dziś (≤ 560 i pełna szerokość minus marginesy), 768×1024 → 560; `describe` z `test.use({ isMobile: true, hasTouch: true })` dla 1366×1024 → skala 1, kolumna 720. „picture tiles keep their size after the verdict” — 4 opcje, 1920×1080 i 3440×1440: prostokąty kafelków przed i po odpowiedzi równe ± 1, bok ≤ 300 × skala + 1.
- [ ] **Step 2:** uruchom — FAIL.
- [ ] **Step 3:** tokeny + użycia; `EndSessionConfirm` → `min(var(--kid-column-max-width), 100%)`; `--visual-choice-size` → `min(var(--kid-visual-choice-max-size), …)`; tekst kart lekcji `max-inline-size: 60ch`.
- [ ] **Step 4:** popraw `kid-end-confirm.spec.ts` (scrim z tolerancją ± 1; szerokość arkusza ≤ token przy danym oknie), komentarz w `kid-decks-layout.spec.ts`.
- [ ] **Step 5:** `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test kid-large-screen kid-end-confirm kid-decks-layout kid-responsive kid-flow-screens picture-choice-layout` — PASS.
- [ ] **Step 6: Commit** `Kid UI: kolumna 720 px i kafelki 300 px od szerokości expanded`.

### Task 6: Zwarty układ zadania na wysokim oknie

**Files:**
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.module.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Consumes: Task 3 (rezerwa `dockPad` w px wewnętrznych).

- [ ] **Step 1: E2E** (1920×1080, 3440×1300, 3440×1440): „picture choice has no empty band” — 4 opcje, po odpowiedzi odstęp dół siatki → góra panelu wyniku ≤ 0,15 × wysokość okna; „text choice has no empty band” — wybór tekstowy (np. listening z 4 opcjami), odstęp ostatnia opcja → panel ≤ 0,15 × wysokość okna, opcje bez przesunięcia po werdykcie (± 1); „written answer has no empty band” — odstęp pole → `kid-submit` ≤ 0,15 × wysokość okna przed odpowiedzią i pole niezakryte panelem po werdykcie; „long lesson card scrolls inside the material” — karta lekcji z długim tekstem przy 3440×1440: `kid-material` ma `scrollHeight > clientHeight`, główna akcja w oknie, brak przewijania dokumentu.
- [ ] **Step 2:** uruchom — FAIL (text choice, written answer).
- [ ] **Step 3: Implementuj** w `ExerciseFrame.module.css` regułę z §3.2: `@media (min-width: 840px) and (min-height: 781px)` → `.root:not([data-prompt-kind="picture_listening"]):not([data-prompt-kind="picture_recognition"])` `grid-template-rows: auto minmax(0, max-content) auto; align-content: start`, a w trybie overlay `.materialContent` bez rozciągania (`min-height: auto`).
- [ ] **Step 4:** E2E z kroku 1 — PASS. Jeśli „written answer” nie przechodzi stabilnie (pętla `dockPad`), ogranicz regułę do `[data-feedback-layout="flow"]`, oznacz test overlay `test.fixme` z komentarzem i zapisz to do raportu PR (spec §3.2).
- [ ] **Step 5:** `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test kid-large-screen kid-feedback-dock kid-feedback-layout kid-layout-stability kid-responsive` — PASS.
- [ ] **Step 6: Commit** `Kid UI: zwarty układ zadania na wysokim oknie`.

### Task 7: Brakujące litery łamią się między słowami

**Files:**
- Modify: `packages/kid-ui/src/exercises/LetterCompletionView.tsx:59-112`, `packages/kid-ui/src/styles.css` (`.kid-letter-fragment`, nowa `.kid-letter-word`)
- Test: test jednostkowy widoku w `packages/kid-ui/src/exercises/` (istniejący plik testów `LetterCompletionView`, jeśli jest; inaczej nowy `LetterCompletionView.test.tsx`)
- Modify: `tests/e2e/kid-large-screen.spec.ts`; Create: `tests/e2e/helpers/letter-task.ts` (builder zadania `letter_completion` przeniesiony z `kid-ui-layout.spec.ts`)

**Interfaces:**
- Produces: struktura DOM `.kid-letter-fragment > .kid-letter-word > (input.kid-letter-input | span.kid-letter-fixed)`, spacje jako `span.kid-letter-fixed` między grupami słów.

- [ ] **Step 1: Unit** — fragment `"n_ce to m__t you"`: 4 elementy `.kid-letter-word` z kolejno 4/2/4/3 znakami; pola `kid-letter-input` w tej samej kolejności i z tymi samymi `aria-label` co dziś; po wpisaniu `i`, `e`, `e` wysłana odpowiedź `"nice to meet you"`; strzałki i Backspace przechodzą między słowami.
- [ ] **Step 2:** uruchom unit — FAIL.
- [ ] **Step 3: Implementuj** grupowanie (podział `characters` po `" "`, indeksy pól bez zmian); CSS `.kid-letter-word { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 100% }`, wewnątrz słowa łamanie tylko gdy słowo przekracza wiersz.
- [ ] **Step 4: E2E**: fraza ≥ 17 znaków z lukami w ≥ 3 słowach — przy 1536×730 (kolumna 720) jeden wiersz (wiersze liczone po środkach pionowych `kid-letter-input` i `.kid-letter-fixed`, tolerancja 4 px); przy 768×1024 (kolumna 560) ≥ 2 wiersze, a każde słowo w jednym wierszu; przy 390×750 słowo 9-literowe w jednym wierszu; słowo 20-literowe przy 390×750 — brak poziomego przepełnienia (`scrollWidth ≤ innerWidth`), pola ≥ 48 px.
- [ ] **Step 5:** unit + `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test kid-large-screen kid-ui-layout kid-responsive` — PASS.
- [ ] **Step 6: Commit** `Kid UI: brakujące litery łamią się tylko między słowami`.

### Task 8: Dokumentacja, pełna weryfikacja, PR

**Files:**
- Modify: `AGENTS.md` (sekcja Kid UI), `docs/superpowers/specs/2026-10-29-kid-ui-zatoka-stage1-design.md` (adnotacja przy kolumnie 560 px), `docs/architecture.md:97`, `docs/folder-structure.md:85` (jeśli opisuje pomiar okna)

- [ ] **Step 1:** `AGENTS.md` — w punkcie o responsywności Kid UI dopisz zwięźle: skala dużego okna w `KidPage` (`zoom`, `--kid-zoom`, `data-kid-scale`, tylko `pointer: fine`); tokeny `--kid-vh/--kid-dvh/--kid-svh/--kid-vw` zamiast surowych jednostek okna (pilnuje `kid-design-tokens.test.ts`); prostokąty z JS przez `toLayoutPx`; brak `zoom` poza `KidPage` i `@property` dla tokenów; kolumna 560/720 i kafelki 260/300; Ctrl +/− na dużym monitorze prawie nie zmienia rozmiaru (spec §7). Pozostałe pliki — adnotacje z §6 specu.
- [ ] **Step 2:** `corepack pnpm typecheck` — PASS.
- [ ] **Step 3:** `corepack pnpm test:unit` — PASS.
- [ ] **Step 4:** `corepack pnpm test:e2e:shards` — PASS (pełny zestaw na buildzie produkcyjnym).
- [ ] **Step 5: Zrzuty** z `kid-large-screen.spec.ts` przy 1536×730 i 3440×1440 (`testInfo.attach`) dla wyboru obrazków, wyboru tekstowego, odpowiedzi pisemnej, liter i ekranu zestawów — do opisu PR.
- [ ] **Step 6: Commit** `Docs: Kid UI na dużych ekranach`; push gałęzi, PR do `main` z sekcjami: zmiana, wpływ API → MCP → skill (brak — tylko Kid UI), wykonane sprawdzenia, niezweryfikowane (fizyczny 34" i laptop, Motion pod zoomem, prawdziwe fonty), ewentualne ograniczenie z Task 6 Step 4.
