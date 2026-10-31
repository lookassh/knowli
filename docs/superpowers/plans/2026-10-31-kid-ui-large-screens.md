# Kid UI na dużych ekranach — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kid UI wykorzystuje duże ekrany: kolumna 720 px od 840 px szerokości, zwarty układ zadania na wysokim oknie, łamanie brakujących liter między słowami i proporcjonalne powiększenie (CSS `zoom`) na urządzeniach z myszą.

**Architecture:** Wyłącznie `packages/kid-ui`. `KidPage` (jedyny właściciel pomiaru okna) liczy skalę czystą funkcją z `layout/viewport.ts` i nakłada `zoom` + `--kid-zoom` na `.kid-page`; CSS korzysta z tokenów jednostek okna skorygowanych o zoom; dwa miejsca JS przeliczają prostokąty ekranu na piksele wewnętrzne helperem z `layout/`. Szerokości i progi to tokeny w bloku tokenów `styles.css`.

**Tech Stack:** React 19, CSS Modules + globalny `styles.css`, Motion, Vitest (jsdom przez pragmę), Playwright 1.63 (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-30-kid-ui-large-screens-design.md` — czytaj razem z planem; numery sekcji (§) odnoszą się do specu.

## Global Constraints

- Zakres: `packages/kid-ui`, testy, dokumentacja. Bez zmian API, DTO, serwera, panelu rodzica, MCP, `SKILL.md`, manifestu PWA. Jeden PR.
- Skala: `min(innerWidth / 840, innerHeight / 900)`, przedział [1; 1,6], `Math.floor(s * 100 + 1e-9) / 100`; > 1 tylko gdy `matchMedia("(hover: hover) and (pointer: fine)")` pasuje; nieprawidłowe wejście → 1.
- Kolumna: `--kid-column-max-width` 560 px, przy `(min-width: 840px) and (min-height: 480px), (min-width: 960px)` 720 px (druga gałąź od review gałęzi 2026-10-31: tablet w poziomie z otwartą klawiaturą). Kafelki: `--kid-visual-choice-max-size` 260 px → 300 px przy tym samym warunku.
- Zwarty układ ramy: `(min-width: 840px) and (min-height: 781px)`, poza `picture_listening`/`picture_recognition`.
- Tokeny okna: `--kid-vh`, `--kid-dvh`, `--kid-svh`, `--kid-vw` = `calc(1<unit> / var(--kid-zoom, 1))` w bloku tokenów; zero surowych jednostek okna poza nim.
- Poza `KidPage` nic nie ustawia `zoom`; tokenów nie rejestrować `@property`.
- `data-testid`, nazwy dostępne, kolejność fokusu i wysyłane odpowiedzi bez zmian. Literały koloru/fontu/promienia tylko w bloku tokenów (`tests/kid-design-tokens.test.ts`). Ruch tylko `transform`/`opacity`.
- Kod i identyfikatory po angielsku, komentarze w stylu otaczającego kodu, dokumentacja po polsku.

## Uruchamianie

- Pojedynczy test jednostkowy: `corepack pnpm exec vitest run --config vitest.unit.config.ts <ścieżka>`. Nowe pliki testów komponentów zaczynają się od `// @vitest-environment jsdom` i używają `renderKid` z `packages/kid-ui/src/test/render-kid`.
- E2E (wymaga Dockera — global setup stawia Postgresa i workera także dla `mocked`): w PowerShell `$env:UMIEM_E2E_WEB_MODE='dev'; corepack pnpm exec playwright test <specy>`; w Git Bash `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test <specy>`. Cały projekt mockowany: `… playwright test --project=mocked`.
- Każdy pomiar E2E po zmianie rozmiaru okna: `resizeAndSettle` (`tests/e2e/helpers/kid-layout.ts`) i `waitForKidScale`, asercje geometryczne przez `expect.poll`/`toPass`, tolerancje ± 1 px (± 2 px dla pozycji panelu).

## Review Focus

1. Przeciągnięcie okna między monitorami / zmiana rozmiaru w trakcie zadania — skala przelicza się na żywo, ramka nadal równa oknu, dokument się nie przewija (Task 3, „rescales on resize”).
2. Nawigacja klawiaturą do pola poniżej widocznej części materiału przy skali 1,6 — pole przewija się do widoku i nie chowa pod panelem/akcją (Task 4, „keyboard focus stays visible”).
3. Fraza z brakującymi literami ze słowem dłuższym niż wiersz (20 liter na 390 px) — słowo łamie się wewnątrz, nic nie wychodzi poza materiał (Task 7).
4. Powiększenie gestem touchpada przy skali > 1 — tryb `zoomed` jak dziś, skala bez zmian (Task 3, unit „pinch zoom keeps scale”).
5. Długa karta lekcji w zwartym układzie na 3440×1440 — materiał przewija się wewnątrz, akcja osiągalna (Task 6).

---

### Task 1: Funkcja skali i pomiar okna

**Files:**
- Modify: `packages/kid-ui/src/layout/viewport.ts`, `packages/kid-ui/src/layout/KidPage.tsx:19` (przekazanie `scale` dalej)
- Test: `packages/kid-ui/src/layout/viewport.test.ts`; Modify: `packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx:76`

**Interfaces:**
- Produces: `KID_SCALE_REFERENCE_WIDTH = 840`, `KID_SCALE_REFERENCE_HEIGHT = 900`, `KID_SCALE_MAX = 1.6`, `KID_FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)"`; `computeKidLayoutScale({ width, height, finePointer }: { width: number; height: number; finePointer: boolean }): number`; `KidViewport.scale: number` (`SERVER_VIEWPORT.scale = 1`); `useKidPageViewport()` zwraca prawdziwą skalę.

- [ ] **Step 0: Przygotuj worktree** — brak `node_modules`: `corepack pnpm install --prefer-offline --frozen-lockfile`; `.env`: `node scripts/setup-worktree.cjs --skip-install`.
- [ ] **Step 1: Test `computeKidLayoutScale`** — tabela (`finePointer: true`, o ile nie zaznaczono): 390×750 → 1; 1536×730 → 1; 1280×600 → 1; 1440×900 → 1; 1920×950 → 1.05; 1920×1080 → 1.2; 1440×960 → 1.06; 1392×984 → 1.09; 922×1000 → 1.09; 2560×1300 → 1.44; 3440×1300 → 1.44; 3440×1440 → 1.6; 1146×1300 → 1.36; 1720×1300 → 1.44; 3840×2050 → 1.6; 949.2×2000 → 1.13; 1366×1024 i 3440×1440 z `finePointer: false` → 1; `NaN`, `Infinity`, `-1` w każdym polu → 1.
- [ ] **Step 2:** uruchom — FAIL (brak eksportu).
- [ ] **Step 3: Implementuj** funkcję i pole `scale`. `useKidViewport`: `scale` z `innerWidth`, `innerHeight` i `matchMedia?.(KID_FINE_POINTER_QUERY).matches ?? false`; nasłuch `change` tego zapytania; pomiar w izomorficznym layout effect (`typeof window === "undefined" ? useEffect : useLayoutEffect`, lokalnie w pliku); `visualViewport === null` → `== null`. `KidPage.tsx:19` przekazuje `scale: viewport.scale` (nie stałe 1). W `MicrophoneSettingsButton.test.tsx:76` literał dostaje `scale: 1`.
- [ ] **Step 4:** test — PASS; `corepack pnpm exec tsc --noEmit -p packages/kid-ui/tsconfig.json` — PASS.
- [ ] **Step 5: Commit** `Kid UI: skala dużego okna w pomiarze viewportu`.

### Task 2: Tokeny jednostek okna (bez zmiany wyglądu)

Idzie przed włączeniem `zoom`: tokeny bez `--kid-zoom` mają fallback 1, więc po tym commicie nic się nie zmienia, a po Task 3 ekrany flow od razu nie przewijają się pod zoomem.

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (blok tokenów + użycia), `layout/KidScreen.module.css:4`, `components/answer-controls.module.css:151`, `screens/ExerciseFeedbackDock.module.css:160,171`, `theme/kid-theme.module.css:6`
- Modify: `tests/kid-design-tokens.test.ts`

**Interfaces:**
- Produces: tokeny `--kid-vh`, `--kid-dvh`, `--kid-svh`, `--kid-vw` w bloku tokenów (§4.2).

- [ ] **Step 1: Test reguły** „uses zoom-aware viewport tokens”: w `styleRules(url)` każdego `.css` (komentarze i blok tokenów wycięte — tokeny same zawierają `1vh` itd.) oraz w plikach `.tsx` pakietu brak dopasowań `/\d(?:\.\d+)?(?:[sld])?v(?:h|w|i|b|min|max)\b/`.
- [ ] **Step 2:** uruchom — FAIL z listą 22 miejsc.
- [ ] **Step 3:** dodaj tokeny; zamień każde użycie na `calc(N * var(--kid-<unit>))` z zachowaniem rodzaju jednostki (`100dvh` → `--kid-dvh`, `36vh` → `--kid-vh`, `36svh` → `--kid-svh`, `6vw` → `--kid-vw`).
- [ ] **Step 4:** `kid-design-tokens.test.ts`, `tests/kid-tokens.test.ts` — PASS; `… playwright test --project=mocked` — PASS (zero różnic: skala jeszcze nie działa).
- [ ] **Step 5: Commit** `Kid UI: jednostki okna przez tokeny odporne na zoom`.

### Task 3: `KidPage` nakłada zoom

**Files:**
- Modify: `packages/kid-ui/src/layout/KidPage.tsx`
- Create: `packages/kid-ui/src/layout/KidPage.test.tsx`
- Create: `tests/e2e/helpers/kid-frame.ts`; Create: `tests/e2e/kid-large-screen.spec.ts`; Modify: `tests/e2e/spec-projects.ts` (`MOCKED_SPECS`)
- Modify (ramka — dokładny `toHaveCSS("height", …)`): `tests/e2e/kid-responsive.spec.ts:153`, `picture-choice-layout.spec.ts:55,98`, `helpers/lesson-reach.ts:40`, `lesson-calculation-layout.spec.ts:52`, `lesson-card-audio-layout.spec.ts:67`, `lesson-dictation-layout.spec.ts:178`, `lesson-precision-layout.spec.ts:112`, `lesson-question-audio-layout.spec.ts:71` (sprawdź kompletność: `grep -rn 'kid-session-frame").toHaveCSS("height"' tests/e2e`)
- Modify (asercje przy oknach, które teraz się skalują): `kid-responsive.spec.ts:151-164` (1440×960 → 1,06), `:237` (922×1000 → 1,09), `:387`, `:435`, `:456` (1920×1080 → 1,2); `kid-feedback-dock.spec.ts:172`; `kid-feedback-layout.spec.ts:58`; `picture-choice-layout.spec.ts:53,96` (1392×984 → 1,09)

**Interfaces:**
- Consumes: `useKidViewport()` z `scale` (Task 1); tokeny okna (Task 2).
- Produces: na `.kid-page` zawsze `data-kid-scale="<scale>"`; przy `scale > 1` w każdym trybie (sesja, flow, powiększenie gestem) inline `zoom: <scale>` i `--kid-zoom: <scale>`; ramka sesji inline `height: ${height/scale}px`, `top: ${offsetTop/scale}px`; progi `data-viewport-short/very-short` z prawdziwej wysokości. Helpery E2E w `kid-frame.ts`: `expectFrameFillsViewport(page, viewport)` (`expect.poll` prostokąta `kid-session-frame` ≈ okno ± 1), `waitForKidScale(page, expected)` (poll `data-kid-scale` i `currentCSSZoom` na `.kid-page` ± 0,005).

- [ ] **Step 1: Unit `KidPage.test.tsx`** (podstaw i przywróć w `afterEach` `innerWidth/innerHeight`, `visualViewport`, `matchMedia` ze stubem trzymającym listenery): 3440×1440 + fine → `data-kid-scale="1.6"`, `--kid-zoom` = `"1.6"`, ramka `style.height === "900px"`; 390×750 → `"1"`, brak `--kid-zoom`, `"750px"`; „pinch zoom keeps scale” — `visualViewport.scale = 2` → `data-zoomed="true"`, `data-kid-scale="1.6"`, `--kid-zoom` = `"1.6"`; „fine pointer change rescales” — start `matches: false` (skala 1), przełącz na `true` i wyślij `change` → `"1.6"`. (`zoom` w jsdom nie trafia do stylu — sprawdza go E2E.)
- [ ] **Step 2:** uruchom — FAIL.
- [ ] **Step 3: Implementuj** w `KidPage` (`zoom` przez `CSSProperties` jest bez jednostki).
- [ ] **Step 4:** unit — PASS.
- [ ] **Step 5: E2E `kid-large-screen.spec.ts`** (dopisz do `MOCKED_SPECS`): sesja z `pictureChoiceLayoutFixture()` dla 1280×600→1, 1536×730→1, 1920×1080→1.2, 1146×1300→1.36, 3440×1300→1.44, 3440×1440→1.6: `waitForKidScale`, `expectFrameFillsViewport`, `scrollWidth ≤ innerWidth`, `scrollHeight ≤ innerHeight`; „rescales on resize” 3440×1440 → 1920×1080 w jednym teście; „short flow screens do not scroll” przy 3440×1440 — ekran profili (jeden profil), ekran zestawów i podsumowanie: `scrollHeight ≤ innerHeight + 1`, `.kid-page` ≈ okno; „answer text scales” — pole odpowiedzi pisemnej: `rect.height / offsetHeight` ≈ 1,6 ± 0,01; „targets stay large” — `expectInteractiveTargets` (z `kid-responsive.spec.ts`, przenieś do `kid-frame.ts`) ≥ 48 px, główna akcja ≥ 54 px przy 3440×1440; „end-session sheet” przy 3440×1440 — scrim = okno ± 1, arkusz ≤ 560 × 1,6 + 1 (po Task 5: 720 × 1,6), wyśrodkowany.
- [ ] **Step 6:** zamień dokładne sprawdzenia ramki na `expectFrameFillsViewport`; przejdź asercje z listy „Modify (asercje…)”: dla każdej ustal, czy porównuje px ekranu (prostokąty) ze stałą w px układu lub z `clientHeight/scrollTop` — przelicz stałą × skala albo porównuj w jednym układzie; zapisz w komentarzu przy zmianie, dlaczego.
- [ ] **Step 7:** `… playwright test --project=mocked` — PASS.
- [ ] **Step 8: Commit** `Kid UI: KidPage powiększa duże okno (CSS zoom)`.

### Task 4: Prostokąty ekranu → piksele wewnętrzne w JS

**Files:**
- Create: `packages/kid-ui/src/layout/css-zoom.ts`, `packages/kid-ui/src/layout/css-zoom.test.ts`
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.tsx:136-166`, `packages/kid-ui/src/components/MicrophoneSettingsButton.tsx:30-41`
- Create: `tests/e2e/helpers/kid-fixtures.ts` — przeniesione `baseFixture()`, stałe ID i `completedRecallFixture` z `kid-feedback-dock.spec.ts:7-55` (z parametrem `feedback`, domyślnie jak dziś), `openDeckScreen` z `kid-decks-layout.spec.ts:26`; specy źródłowe importują z helpera; kopia w `kid-layout-stability.spec.ts:43` też przechodzi na helper.
- Modify: `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: `cssZoomOf(element: Element): number` (`currentCSSZoom`, gdy skończone i > 0, inaczej 1); `toLayoutPx(screenPx: number, element: Element): number` = `screenPx / cssZoomOf(element)`.

- [ ] **Step 1: E2E na czerwono**, 3440×1440:
  - „overlay dock reserve is exact” — `completedRecallFixture({ feedback: { kind: "spelling_hint", correctText: <ok. 200 znaków> } })` z promptem i materiałem dłuższym niż zwarty materiał (np. długi `prompt` źródłowy), tak by panel realnie nachodził na treść także po Task 6. Warunek wstępny: inline `paddingBottom` na `.kid-material-content` > 0. Asercja dwustronna: `dockTop − (8 × 1,6 + 3) ≤ lastChild.bottom ≤ dockTop + 1`.
  - „microphone panel opens under its button” — `openDeckScreen`, klik `kid-mic-settings`; `panel.top` ∈ [`button.bottom`, `button.bottom + 8 × 1,6 + 2`], `|panel.left − button.left| ≤ 2` (bezwarunkowo).
  - „keyboard focus stays visible” — fixture z polem startującym poniżej widocznej części materiału (lekcja z długą kartą przed polem, np. wzorzec z `lesson-card-audio-layout.spec.ts:25-30`); warunek wstępny `field.top > material.bottom`; Tab z poprzedniej kontrolki do pola → prostokąt pola wewnątrz prostokąta materiału i nad akcją/panelem.
- [ ] **Step 2:** uruchom te testy — FAIL (pierwsze dwa).
- [ ] **Step 3: Unit `css-zoom.test.ts`** — brak `currentCSSZoom` → 1; `{ currentCSSZoom: 1.5 }` → `toLayoutPx(300) === 200`; `0`, `NaN` → 1. Implementuj.
- [ ] **Step 4: `ExerciseFrame`** — `contentBottom` i dolną krawędź kotwicy przelicz `toLayoutPx(…, material)` przed odjęciem `offsetHeight` i dodaniem do `scrollTop`.
- [ ] **Step 5: `MicrophoneSettingsButton`** — licz w px ekranu: prostokąty, `viewport.*` i odstępy bezpieczne × `cssZoomOf(button)` (`--kid-safe-*` z computed style są w px układu); wynik `left/top` dziel przez `cssZoomOf(panel)`. Istniejące unity (16 px / 40 px przy skali 1) bez zmian.
- [ ] **Step 6:** unity `css-zoom`, `MicrophoneSettingsButton.test.tsx`, `feedback-dock-reveal.test.ts` — PASS; E2E kroku 1 — PASS; `kid-feedback-dock`, `kid-layout-stability`, `kid-decks-layout` — PASS.
- [ ] **Step 7: Commit** `Kid UI: pomiary JS w pikselach wewnętrznych pod zoomem`.

### Task 5: Kolumna 720 i kafelki 300

**Files:**
- Modify: `packages/kid-ui/src/styles.css` (blok tokenów, `.kid-learning`, `.kid-lesson-card__body` i pokrewne bloki ciągłego tekstu kart, komentarz o szerokości materiału ok. l. 2584-2586), `layout/KidScreen.module.css:3`, `components/EndSessionConfirm.module.css:21`, `components/answer-controls.module.css:175`
- Modify: `tests/e2e/kid-end-confirm.spec.ts:138,141`, `tests/e2e/kid-decks-layout.spec.ts:206-209` (asercja układania kart rekomendowanych przy kolumnie 720 — sprawdź i popraw, nie tylko komentarz), `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: tokeny `--kid-column-max-width`, `--kid-visual-choice-max-size` (§3.1).

- [ ] **Step 1: E2E** „column width follows the token” — `.kid-learning` (sesja) i `[data-kid-screen="true"]` (profile, zestawy): 1280×600 → 720; 1536×730 → 720; 1920×1080 → 864; 1146×1300 → 979,2; 3440×1300 → 1036,8; 3440×1440 → 1152 (± 1), środek ± 1 od środka okna; kontrolnie 390×750 (pełna szerokość minus marginesy), 844×390 i 768×1024 → 560; `describe` z `test.use({ isMobile: true, hasTouch: true })` dla 1366×1024 → skala 1, kolumna 720. „picture tiles use the new cap and keep their size after the verdict” — 4 opcje: przy 3440×1440 bok ≈ 480 ± 2; przy 1920×1080 bok = min(300 × 1,2, ograniczenie wysokością materiału) ± 2 (zmierz materiał); prostokąty przed i po odpowiedzi równe ± 1. W „end-session sheet” (Task 3) oczekiwanie → 720 × 1,6.
- [ ] **Step 2:** uruchom — FAIL.
- [ ] **Step 3:** tokeny + użycia; `EndSessionConfirm` → `min(var(--kid-column-max-width), 100%)`; `--visual-choice-size` → `min(var(--kid-visual-choice-max-size), …)`; tekst kart lekcji `max-inline-size: 60ch`.
- [ ] **Step 4:** popraw `kid-end-confirm.spec.ts` (scrim ± 1; arkusz ≤ token przy danym oknie) i `kid-decks-layout.spec.ts:206-209`.
- [ ] **Step 5:** `… playwright test --project=mocked` — PASS (obejmuje `lesson-*-layout` przy 1280×800 z nową kolumną).
- [ ] **Step 6: Commit** `Kid UI: kolumna 720 px i kafelki 300 px od szerokości expanded`.

### Task 6: Zwarty układ zadania na wysokim oknie

**Files:**
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.module.css`, `packages/kid-ui/src/exercises/ExerciseFrame.tsx:~200` (inline `minHeight: calc(100% + dockPad px)`)
- Modify: `tests/e2e/helpers/kid-fixtures.ts` (builder wyboru tekstowego z 4 opcjami; builder długiej karty lekcji na wzór `lesson-card-audio-layout.spec.ts:25-30`), `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Consumes: Task 4 (rezerwa `dockPad` w px wewnętrznych); `kid-fixtures.ts`.

- [ ] **Step 1: E2E** (1920×1080, 1146×1300, 3440×1300, 3440×1440): „text choice has no empty band” — 4 opcje, flow feedback: odstęp ostatnia opcja → panel ≤ 0,15 × wysokość okna, opcje bez przesunięcia po werdykcie (± 1); „written answer has no empty band” — odstęp pole → `kid-submit` ≤ 0,15 × wysokość okna przed odpowiedzią, po werdykcie pole niezakryte panelem; „picture choice has no empty band” (3440×1300, 3440×1440; `pictureChoiceLayoutFixture` to `picture_listening`, wyłączony z reguły — test pilnuje, że kafelki i panel są w oknie, a odstęp siatka → panel ≤ 0,15 × wysokość okna); „long lesson card scrolls inside the material” (3440×1440) — `kid-material` `scrollHeight > clientHeight`, główna akcja w oknie, dokument się nie przewija.
- [ ] **Step 2:** uruchom — FAIL (text choice, written answer).
- [ ] **Step 3: Implementuj** w `ExerciseFrame.module.css` regułę §3.2: `@media (min-width: 840px) and (min-height: 781px)` dla `.root:not([data-prompt-kind="picture_listening"]):not([data-prompt-kind="picture_recognition"])`: `grid-template-rows: auto minmax(0, max-content) auto; align-content: start`; w trybie overlay `.materialContent` nie rozciąga się do 100%. Rezerwę `dockPad` w zwartym układzie wyrażaj wyłącznie jako `paddingBottom` (bez inline `minHeight: calc(100% + …)`, którego CSS nie nadpisze) — warunek w `ExerciseFrame.tsx` na podstawie `matchMedia` tego samego zapytania albo atrybutu ustawianego z CSS-owego stanu; wybierz prostsze i opisz w komentarzu.
- [ ] **Step 4:** E2E kroku 1 i „overlay dock reserve is exact” z Task 4 — PASS. Jeśli „written answer” lub rezerwa są niestabilne, ogranicz regułę do `[data-feedback-layout="flow"]`, oznacz test overlay `test.fixme` z komentarzem i zapisz to do raportu PR (§3.2).
- [ ] **Step 5:** `… playwright test --project=mocked` — PASS.
- [ ] **Step 6: Commit** `Kid UI: zwarty układ zadania na wysokim oknie`.

### Task 7: Brakujące litery łamią się między słowami

**Files:**
- Modify: `packages/kid-ui/src/exercises/LetterCompletionView.tsx:59-112`, `packages/kid-ui/src/styles.css` (`.kid-letter-fragment`, nowa `.kid-letter-word`)
- Create: `packages/kid-ui/src/exercises/LetterCompletionView.test.tsx` (wzorzec: `screens/keyboard-navigation.test.tsx`)
- Modify: `tests/e2e/helpers/kid-fixtures.ts` (`letterTask(prompt: string, fragment: string)` na bazie przeniesionego `recallFixture`/`taskFor` z `kid-ui-layout.spec.ts:36-56`), `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Produces: DOM `.kid-letter-fragment > .kid-letter-word > (input.kid-letter-input | span.kid-letter-fixed)`, spacje jako `span.kid-letter-fixed` między słowami; indeksy pól i `kidStaggerDelay(index)` jak dziś.

- [ ] **Step 1: E2E na czerwono** (przed implementacją):
  - fraza 22 znaków z 5 lukami w ≥ 3 słowach (np. fragment `"I l_ke r_ading c_mic b__ks"` — dobierz tak, by naturalna szerokość wiersza wynosiła ok. 600–660 px); warunek wstępny: zmierzona naturalna szerokość fragmentu (suma szerokości elementów + odstępy) w przedziale (540; 680) px — inaczej test kończy się błędem z komunikatem o foncie. Przy 1536×730 (kolumna 720) jeden wiersz (wiersze po środkach pionowych `kid-letter-input` i `.kid-letter-fixed`, tolerancja 4 px); przy 768×1024 (kolumna 560) ≥ 2 wiersze i każde słowo w jednym wierszu (dziś czerwone — łamanie w środku słowa);
  - 390×750: słowo 9-literowe poprzedzone krótkim słowem (np. `"a str_wb_rry"` przycięte do szerokości, przy której dziś łamie się w środku) — litery słowa w jednym wierszu;
  - 390×750: słowo 20-literowe — każde pole i litera wewnątrz prostokąta `kid-material`, `scrollWidth ≤ innerWidth`, pola ≥ 48 px.
- [ ] **Step 2:** uruchom — FAIL (przypadki łamania w środku słowa).
- [ ] **Step 3: Unit** — fragment `"n_ce to m__t you"`: 4 `.kid-letter-word` z 4/2/4/3 znakami; pola w tej samej kolejności i z tymi samymi `aria-label`; po wpisaniu `i`, `e`, `e` wysłane `"nice to meet you"`; strzałki i Backspace przechodzą między słowami. Uruchom — FAIL.
- [ ] **Step 4: Implementuj** grupowanie (podział `characters` po `" "`, indeksy bez zmian); `.kid-letter-word { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 100% }`.
- [ ] **Step 5:** unit, `keyboard-navigation.test.tsx` i E2E kroku 1 — PASS; `… playwright test kid-ui-layout kid-responsive kid-large-screen` — PASS.
- [ ] **Step 6: Commit** `Kid UI: brakujące litery łamią się tylko między słowami`.

### Task 8: Dokumentacja, pełna weryfikacja, PR

**Files:**
- Modify: `AGENTS.md` (sekcja Kid UI), `docs/superpowers/specs/2026-10-29-kid-ui-zatoka-stage1-design.md` (adnotacja przy kolumnie 560 px), `docs/architecture.md:97`, `docs/folder-structure.md:85`

- [ ] **Step 1:** `AGENTS.md` — w punkcie o responsywności Kid UI zwięźle: skala dużego okna w `KidPage` (`zoom`, `--kid-zoom`, `data-kid-scale`, tylko `pointer: fine`); tokeny `--kid-vh/--kid-dvh/--kid-svh/--kid-vw` zamiast surowych jednostek okna (pilnuje `kid-design-tokens.test.ts`); prostokąty w JS przez `toLayoutPx`; brak `zoom` poza `KidPage` i `@property` dla tokenów; kolumna 560/720 i kafelki 260/300; Ctrl +/− na dużym monitorze prawie nie zmienia rozmiaru (§7). Pozostałe pliki — adnotacje z §6.
- [ ] **Step 2:** `corepack pnpm typecheck` — PASS.
- [ ] **Step 3:** `corepack pnpm test:unit` — PASS.
- [ ] **Step 4:** `corepack pnpm test:e2e:shards` — PASS (pełny zestaw na buildzie produkcyjnym).
- [ ] **Step 5: Zrzuty** z `kid-large-screen.spec.ts` (`testInfo.attach`) przy 1536×730 i 3440×1440: wybór obrazków, wybór tekstowy, odpowiedź pisemna, litery, ekran zestawów — do opisu PR.
- [ ] **Step 6: Commit** `Docs: Kid UI na dużych ekranach`; push gałęzi, PR do `main`: zmiana, wpływ API → MCP → skill (brak — tylko Kid UI), wykonane sprawdzenia, niezweryfikowane (fizyczny 34" i laptop, Motion pod zoomem, prawdziwe fonty, pierwsze malowanie bez testu E2E), ewentualne ograniczenie z Task 6 Step 4.
