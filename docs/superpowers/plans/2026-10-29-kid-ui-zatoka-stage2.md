# Kid UI „Zatoka” — etap 2: ramka sesji, ćwiczenia i feedback — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przenieść język wizualny Zatoki na ekran sesji w kierunku „Ekran skupienia”: pasek z ✕ i kamykami, czytelny bodziec i pole wpisywania, karty odpowiedzi, panel wyniku w kolorze tonu.

**Architecture:** Zmiana wyłącznie prezentacyjna w `packages/kid-ui`. Wspólne komponenty (`SessionProgress`, `ExerciseInstruction`, `ExerciseFrame`, `AnswerField`, `AnswerGrid`, `ExerciseFeedbackDock`, `KidIcon`) dostają nowe warianty; widoki ćwiczeń tylko z nich korzystają. Odsłuch wskazówki trafia do ramki zadania przez kontekst React zamiast przez propsy każdego widoku.

**Tech Stack:** React 19, TypeScript strict, CSS Modules + `styles.css`, Motion (`motion/react`), Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-kid-ui-zatoka-stage2-design.md` (etap 1: `docs/superpowers/specs/2026-10-29-kid-ui-zatoka-stage1-design.md`).

## Global Constraints

- Tylko ciemny motyw; kolory wyłącznie z ról w bloku `.kid-theme,\n.kid-ui {` w `packages/kid-ui/src/styles.css`. Żadnych literałów koloru, rozmiaru fontu ani promienia poza tym blokiem (pilnuje `tests/kid-design-tokens.test.ts`; wyjątek `visuals/`, `illustrations/`).
- Fonty: `var(--kid-font-display)` (Fredoka) dla bodźca, odpowiedzi, tytułów; `var(--kid-font-body)` (Nunito) dla reszty.
- Motion animuje tylko `transform` i `opacity`; bez propsa `layout` i animacji wymiarów; `MotionConfig reducedMotion="user"` zostaje.
- `KidPage` jedynym miernikiem viewportu; cele dotykowe ≥48 px, główna akcja ≥54 px.
- Bez surowych `<button>`/`<input>`/`<textarea>`/`<select>` poza wnętrzem wspólnego komponentu.
- Bez zmian zachowania: API, kontrakty, ocenianie, kolejność ujawnień, budżet, `remainingFor`, `answerDockTone`, obsługa offline i nagrywania. Wszystkie istniejące `data-testid` zostają.
- Teksty UI po polsku w `packages/contracts/src/messages.ts`; kod po angielsku; komentarze w stylu otoczenia.
- E2E: `pnpm build`, potem `UMIEM_E2E_SKIP_BUILD=1 pnpm exec playwright test <pliki>` (tryb dev nie hydratuje pod Next 16.4). Geometria przez `tests/e2e/helpers/kid-layout.ts` (`resizeAndSettle`, `measure`, `expectInsideRoot`); rozmiary 360×800, 320×640, 844×390, 768×1024, 1280×800.
- Commit po każdym zadaniu; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nigdy nie commituj `apps/web/AGENTS.md`.

## Review Focus

1. Sesja z budżetem 20 na 320×640: 20 kamyków mieści się w pasku obok ✕ i mikrofonu, bez przepełnienia poziomego — test w Zadaniu 2.
2. Pole wpisywania po fokusie i z otwartą klawiaturą (wysokość viewportu ok. 400 px): tekst ≥24 px i kontrast ≥4.5:1, pole i „Sprawdź” osiągalne — test w Zadaniu 3.
3. Cztery krótkie opcje, z których jedna ma 14 znaków, na 320 px: siatka 2×2 bez przycięcia tekstu; 15 znaków → kolumna — testy w Zadaniu 4.
4. Panel wyniku w każdym tonie na 844×390 (`compact`): tytuł, ikona i akcja widoczne, tekst na tle tonu ≥4.5:1 — test w Zadaniu 5.
5. Zadanie z obrazkiem i wskazówką (picture listening) w trakcie feedbacku: dokładnie jeden przycisk `kid-guidance-play`, w panelu wyniku, nie w instrukcji — test w Zadaniu 2.

---

### Task 1: Ikony `almost` i `info`, kontrasty nowych par

**Files:**
- Modify: `packages/kid-ui/src/components/KidIcon.tsx`
- Modify: `tests/kid-tokens.test.ts`
- Test: `packages/kid-ui/src/components/KidIcon.test.tsx` (utwórz, jeśli nie istnieje)

**Interfaces:**
- Produces: `KidIconName` rozszerzony o `"almost" | "info"`.

- [ ] **Step 1: Testy.** W `KidIcon.test.tsx`: `it.each(["almost", "info"])("renders the %s icon as a decorative svg")` — `renderKid(<KidIcon name={name} />)`, oczekuj `svg` z `aria-hidden="true"` i co najmniej jednym `path` albo `circle`. W `tests/kid-tokens.test.ts` dopisz do tabeli 4.5:1 parę `["on-surface", "surface-container-highest"]`, a do tabeli 3:1 parę `["primary", "surface"]`.
- [ ] **Step 2:** `pnpm vitest run packages/kid-ui/src/components/KidIcon.test.tsx tests/kid-tokens.test.ts` — FAIL tylko dla nowych ikon (kontrasty mogą już przechodzić; jeśli nie, to błąd palety do zgłoszenia, nie do strojenia ról).
- [ ] **Step 3:** Dodaj ścieżki 24×24 w stylu obrysu pozostałych ikon: `almost` — pojedyncza falka „~” (np. `M4 13c2.5-3 5-3 8 0s5.5 3 8 0`), `info` — okrąg r=9 z kreską i kropką.
- [ ] **Step 4:** Ten sam przebieg — PASS.
- [ ] **Step 5:** Commit `feat(kid-ui): ikony almost i info dla tonów feedbacku`.

### Task 2: Ramka sesji — pasek z ✕, kamyki, wskazówka przy instrukcji

**Files:**
- Modify: `packages/kid-ui/src/components/SessionProgress.tsx`, `SessionProgress.module.css`, `SessionProgress.test.tsx`
- Create: `packages/kid-ui/src/exercises/exercise-guidance.tsx`
- Modify: `packages/kid-ui/src/components/ExerciseInstruction.tsx`, `ExerciseInstruction.module.css`
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.tsx`
- Modify: `packages/kid-ui/src/screens/ExerciseFeedbackDock.tsx` (tylko slot `guidance`)
- Modify: `packages/kid-ui/src/screens/LearnScreen.tsx`
- Modify: `packages/kid-ui/src/styles.css` (`.kid-header`, `.kid-end`, reguły `data-zoomed` dla nagłówka)
- Test: `tests/e2e/kid-responsive.spec.ts`, `tests/e2e/picture-vocabulary.spec.ts`

**Interfaces:**
- Produces: `SessionProgress({ remaining, total = 0, done = 0, milestone = 0 }: { remaining: number | null; total?: number; done?: number; milestone?: number })` — prop `fraction` znika; `PEBBLE_LIMIT = 24` eksportowany z `SessionProgress.tsx`.
- Produces: `ExerciseGuidanceProvider({ value: ReactNode | null, children })` i `useExerciseGuidance(): ReactNode | null` w `exercises/exercise-guidance.tsx`.
- Produces: `ExerciseInstruction` przyjmuje `guidance?: ReactNode` (renderowany po tekście); `ExerciseFeedbackDock` przyjmuje `guidance?: ReactNode` (renderowany obok tytułu, w górnym wierszu treści).

- [ ] **Step 1: Testy jednostkowe `SessionProgress`** (zastąp testy z `fraction`):
  - `renders one hidden pebble per assessed task with done and current states` — `total=5, done=2, remaining=null`: 5 elementów `[data-testid="kid-progress-pebble"]` w kontenerze z `aria-hidden="true"`; `data-state` = `done, done, current, upcoming, upcoming`.
  - `falls back to a continuous bar above the pebble limit` — `total=25, done=5`: brak kamyków, jest `kid-progress-fill`.
  - `keeps the remaining label as the accessible text next to the pebbles` — `total=20, done=18, remaining=2`: `kid-remaining` zawiera „2”, kamyki nadal są.
  - `drops a hidden star when a streak milestone is reached` — jak dziś, z `total=5, done=3, milestone=1`.
  - `shows no current pebble when the session is done` — `total=4, done=4`: wszystkie `done`.
- [ ] **Step 2:** `pnpm vitest run packages/kid-ui/src/components/SessionProgress.test.tsx` — FAIL.
- [ ] **Step 3: `SessionProgress`.** Kamyki dla `1 ≤ total ≤ PEBBLE_LIMIT`, inaczej obecny pasek z `scaleX(done/total)`. CSS: rząd `display:flex; gap:3px; flex:1 1 auto; min-width:0`, kamyk `flex:1 1 0; min-width:5px; max-width:16px; height:8px; border-radius: var(--kid-shape-full)`; `done` → `primary`, `current` → obrys 2px `primary` i `transform: scale(1.25)`, `upcoming` → `outline-variant`. Gwiazdka serii pozycjonowana nad ostatnim `done`. Etykieta „Jeszcze N” jako pigułka `warm-container`/`on-warm-container` pod rzędem (obok przy `.kid-page[data-viewport-very-short="true"]` — flaga `KidPage` dla wysokości ≤479 px). Przeliczenie przy wzroście `total` bez animacji wymiarów.
- [ ] **Step 4:** Ten sam przebieg — PASS.
- [ ] **Step 5: Kontekst wskazówki.** `exercise-guidance.tsx`: kontekst z wartością domyślną `null`. `ExerciseFrame` czyta `useExerciseGuidance()` i przekazuje do `ExerciseInstruction` jako `guidance`. W `LearnScreen`: `GuidanceButton` znika z `<header>`; gdy `feedbackGuidanceKey` jest ustawiony, przycisk idzie do `ExerciseFeedbackDock guidance=…` (zwykły i mowy), w przeciwnym razie przy `taskGuidanceKey` przez `ExerciseGuidanceProvider` do instrukcji. `testId="kid-guidance-play"` bez zmian.
- [ ] **Step 6: Pasek.** `kid-end` jako `IconActionButton` z `<KidIcon name="close" />`, `aria-label={messages.kid.end}`, `title={messages.kid.end}`, ta sama obsługa `busy`/`endNow`. `.kid-header`: siatka `48px 1fr 48px`, `min-height: 56px` (48px pod `.kid-page[data-viewport-very-short="true"]`), kamyki wyśrodkowane; mikrofon bez zmian.
- [ ] **Step 7: E2E.** W `kid-responsive.spec.ts` dodaj test `session header keeps close, pebbles and microphone in one row` dla wszystkich `SCREEN_VIEWPORTS`, z sesją o `remainingAssessed: 20` w fixture: prostokąty `kid-end`, kontenera kamyków (`[data-testid="kid-progress-pebbles"]`) i statusu mikrofonu mają środki w jednym rzędzie (różnica `top` ≤4 px), wszystko `expectInsideRoot`, `scrollWidth ≤ innerWidth`, `kid-end` ≥48×48, 20 kamyków o szerokości ≥5 px. W `picture-vocabulary.spec.ts` (Review Focus 5) dopisz asercję: po odpowiedzi `kid-guidance-play` ma `count` 1 i leży wewnątrz `kid-feedback-dock`; przed odpowiedzią leży wewnątrz `kid-instruction`.
- [ ] **Step 8:** `pnpm vitest run packages/kid-ui` oraz `pnpm build && UMIEM_E2E_SKIP_BUILD=1 pnpm exec playwright test tests/e2e/kid-responsive.spec.ts tests/e2e/picture-vocabulary.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/kid-motion.spec.ts tests/e2e/mock-test.spec.ts` — PASS (zaktualizuj asercje, które zakładały tekst „Koniec” w przycisku albo `fraction`).
- [ ] **Step 9:** Commit `feat(kid-ui): pasek sesji z kamykami i wskazówką przy instrukcji`.

### Task 3: Bodziec i pole wpisywania

**Files:**
- Modify: `packages/kid-ui/src/components/answer-controls.module.css` (`.input`, `.textarea`)
- Modify: `packages/kid-ui/src/styles.css` (`.kid-word`, `.kid-source`, usunięcie `.kid-written input` i `.kid-written input::placeholder`, przegląd 12 użyć `--kid-muted` przy bodźcach)
- Modify: `packages/kid-ui/src/exercises/PictureRecallView.tsx`
- Test: `tests/e2e/kid-answer-contrast.spec.ts`, `packages/kid-ui/src/components/answer-controls.test.tsx`

**Interfaces:** brak nowych sygnatur.

- [ ] **Step 1: E2E.** W `kid-answer-contrast.spec.ts` dodaj `written answer text is large and readable` dla 360×800 i 844×390: wpisz „leg” w pole zadania pisemnego, oczekuj obliczonego `font-size` ≥24 px, `font-weight` ≥600, `font-family` zawierającej `KnowliKidFredoka`, `ownColorContrast(input).ratio ≥ 4.5`. Drugi test `stimulus word uses the strongest text color`: `kid-source` i `kid-word` mają `color` równy `kidTokenColor(page, "--md-sys-color-on-surface")`. Trzeci (Review Focus 2): po `resizeAndSettle` do 360×400 z fokusem w polu — pole i `kid-primary-slot` są w viewporcie (`toBeInViewport`).
- [ ] **Step 2:** `pnpm build && UMIEM_E2E_SKIP_BUILD=1 pnpm exec playwright test tests/e2e/kid-answer-contrast.spec.ts` — FAIL na rozmiarze i kolorze.
- [ ] **Step 3: Pole.** `.input`: `font-family: var(--kid-font-display)`, `font-weight: 600`, `font-size: var(--kid-type-headline-sm-size)`, `text-align: center`, `min-height: 60px`, obramowanie 2px `outline`, tło `surface-container-highest`, `:focus-visible` pierścień 3px `primary` (`outline` + `outline-offset`), placeholder `on-surface-variant`. `.textarea`: `text-align: start`, `font-size: var(--kid-type-title-lg-size)`. Usuń martwe reguły `.kid-written input*` ze `styles.css`.
- [ ] **Step 4: Bodziec.** `.kid-word` i `.kid-source`: `font-family: var(--kid-font-display)`, `font-weight: 700`, `color: var(--md-sys-color-on-surface)`, rozmiar `clamp(var(--kid-type-headline-sm-size), 7vw, var(--kid-type-display-lg-size))` dla `.kid-word` i `clamp(var(--kid-type-headline-sm-size), 6vw, var(--kid-type-display-sm-size))` dla `.kid-source`. Obrazki bodźca: `border-radius: var(--kid-shape-xl)`. Zostaw `--kid-muted` tylko dla treści pomocniczych (`.kid-example`, podpowiedzi), nie dla bodźca.
- [ ] **Step 5: Odsłuch pod bodźcem.** `PictureRecallView`: przycisk odsłuchu przenieś z `actions` do `content`, bezpośrednio pod obrazkiem, jako `IconActionButton` tonalny 64×64 (`radius="50%"`, klasa `kid-audio-round`, `data-testid` bez zmian), `aria-label={messages.kid.listen}`.
- [ ] **Step 6:** Ten sam przebieg E2E i `pnpm vitest run packages/kid-ui tests/kid-design-tokens.test.ts` — PASS; dodatkowo `tests/e2e/kid-feedback-dock.spec.ts tests/e2e/spelling-diff-feedback.spec.ts tests/e2e/picture-recognition-layout.spec.ts`.
- [ ] **Step 7:** Commit `fix(kid-ui): czytelne pole wpisywania i bodziec`.

### Task 4: Karty odpowiedzi i siatka 2×2

**Files:**
- Create: `packages/kid-ui/src/exercises/choice-layout.ts`, `choice-layout.test.ts`
- Modify: `packages/kid-ui/src/components/AnswerGrid.tsx`, `answer-controls.module.css` (`.option`, `.choiceList`, nowa `.shortChoiceGrid`)
- Modify: `packages/kid-ui/src/exercises/ReadingView.tsx`, `ListeningView.tsx`
- Modify: `packages/kid-ui/src/components/WordChoiceButton.tsx`, `LessonBlockButton.tsx` (tylko style kart)
- Test: `tests/e2e/kid-responsive.spec.ts`

**Interfaces:**
- Produces: `isShortChoiceSet(labels: readonly string[]): boolean` — `true` dokładnie wtedy, gdy `labels.length === 4` i każda etykieta po `trim()` ma ≤14 znaków (`[...label].length`, by liczyć polskie znaki jako jeden).
- Produces: `AnswerGrid` przyjmuje `shortChoiceGrid?: boolean`.

- [ ] **Step 1: Test jednostkowy** `choice-layout.test.ts`: `["noga","ręka","głowa","oko"]` → true; etykieta 14 znaków `"abcdefghijklmn"` → true; 15 znaków → false; 3 opcje → false; 5 opcji → false; `"żółć"` liczy się jako 4 znaki.
- [ ] **Step 2:** `pnpm vitest run packages/kid-ui/src/exercises/choice-layout.test.ts` — FAIL.
- [ ] **Step 3:** Zaimplementuj `isShortChoiceSet`. W `ReadingView` i `ListeningView` przekaż `shortChoiceGrid={isShortChoiceSet(labels)}` obok `choiceList`. `.shortChoiceGrid` działa tylko w `@media (max-width: 599px)`: `display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px`; powyżej obowiązuje kolumna `choiceList`.
- [ ] **Step 4: Karty.** `.option`: tło `surface-container-high`, obramowanie 1px `outline`, `min-height: 56px`, `font-family: var(--kid-font-display)`, `font-weight: 600`, `font-size: var(--kid-type-title-md-size)`, `border-radius: var(--kid-shape-l)`. Stany `pending/correct/wrong` i ikony ✓/× bez zmian logiki (zostają w `AnswerGrid`); znak wyniku błędnego `×` zastąp `<KidIcon name="close" />`, poprawnego `✓` — `<KidIcon name="check" />`, zachowując `data-testid`. `WordChoiceButton` i `LessonBlockButton`: te same tło, obramowanie, font i promień.
- [ ] **Step 5: E2E** w `kid-responsive.spec.ts`: `short reading options form a 2x2 grid on phones` — 360×800 i 320×640, fixture czytania z 4 opcjami (jedna 14-znakowa): dwie kolumny (dwa różne `left` wśród `kid-option`), każda opcja `expectInsideRoot`, ≥56 px wysokości, tekst nieprzycięty (`scrollWidth ≤ clientWidth` etykiety). `long reading options stay in one column` — opcja 15-znakowa: jedno `left`. Na 768×1024: jedna kolumna.
- [ ] **Step 6:** `pnpm vitest run packages/kid-ui` i `UMIEM_E2E_SKIP_BUILD=1 pnpm exec playwright test tests/e2e/kid-responsive.spec.ts tests/e2e/kid-ui-layout.spec.ts tests/e2e/picture-choice-layout.spec.ts tests/e2e/lesson-kid.spec.ts` (po `pnpm build`) — PASS.
- [ ] **Step 7:** Commit `feat(kid-ui): karty odpowiedzi i siatka 2×2 dla krótkich opcji`.

### Task 5: Panel wyniku w tonie

**Files:**
- Modify: `packages/kid-ui/src/screens/ExerciseFeedbackDock.tsx`, `ExerciseFeedbackDock.module.css`
- Modify: `packages/kid-ui/src/screens/AnswerFeedback.tsx`, `SpeechFeedbackCard.tsx`
- Modify: `packages/kid-ui/src/styles.css` (`.kid-feedback-text`, `.kid-feedback-answer`, `.kid-spelling-*`)
- Test: `packages/kid-ui/src/screens/ExerciseFeedbackDock.test.tsx` (utwórz albo rozszerz), `tests/e2e/kid-feedback-dock.spec.ts`

**Interfaces:**
- Consumes: `KidIconName` `"almost" | "info"` (Task 1), slot `guidance` (Task 2).
- Produces: `FEEDBACK_TONE_ICONS: Record<FeedbackDockTone, KidIconName>` w `ExerciseFeedbackDock.tsx` = `{ correct: "check", partial: "almost", incorrect: "close", technical: "info", neutral: "info" }`.

- [ ] **Step 1: Test jednostkowy** `it.each(Object.entries(FEEDBACK_TONE_ICONS))("shows the %s tone with the %s icon badge")` — render z `tone`, oczekuj `[data-testid="kid-feedback-tone-icon"]` z `data-icon` równym nazwie i `aria-hidden="true"`; osobno: `guidance` renderuje się w doku.
- [ ] **Step 2:** `pnpm vitest run packages/kid-ui/src/screens/ExerciseFeedbackDock.test.tsx` — FAIL.
- [ ] **Step 3: Dok.** Odznaka 40 px (koło, `KidIcon` z mapy) na początku górnego wiersza treści, obok niej tytuł i opcjonalnie `guidance`. CSS: `border: 0`, górne rogi `var(--kid-shape-xxl)`; tła i kolory tekstu parami: `correct` `--kid-color-success-container`/`--kid-color-on-success-container`, `partial` `--kid-color-warm-container`/`--kid-color-on-warm-container`, `incorrect` `--md-sys-color-error-container`/`--md-sys-color-on-error-container`, `technical`/`neutral` `--md-sys-color-surface-container-high`/`--md-sys-color-on-surface`. Ruling wobec specu: tekst na tle tonu używa koloru `on-*-container` tej roli (spec mówi `on-surface` — na tłach tonów to `on-*-container` daje sprawdzony kontrast 4.5:1).
- [ ] **Step 4: Treść.** `.kid-feedback-text` Fredoka `headline-sm`, waga 700; `.kid-feedback-answer` Fredoka, waga 700, `headline-sm`; litery porównania pisowni (`.kid-spelling-*`) w Fredoce, błędne miejsca z `text-decoration: underline` 2px w kolorze tonu oprócz koloru. `SpeechFeedbackCard` dostaje ten sam układ (odznaka przez dok, tytuł, odpowiedź). `compact` zachowuje jeden wiersz: odznaka 32 px.
- [ ] **Step 5:** Ten sam test — PASS.
- [ ] **Step 6: E2E** w `kid-feedback-dock.spec.ts`: `each feedback tone keeps readable text and its icon` — dla fixture poprawnej, „prawie”, błędnej i nieocenionej odpowiedzi na 360×800 i 844×390: `kid-feedback-tone-icon` widoczny, `ownColorContrast(kid-feedback-text).ratio ≥ 4.5`, akcja główna w viewporcie i ≥54 px wysokości (Review Focus 4).
- [ ] **Step 7:** `pnpm build && UMIEM_E2E_SKIP_BUILD=1 pnpm exec playwright test tests/e2e/kid-feedback-dock.spec.ts tests/e2e/kid-feedback-layout.spec.ts tests/e2e/spelling-diff-feedback.spec.ts tests/e2e/speech-recording-ux.spec.ts` — PASS.
- [ ] **Step 8:** Commit `feat(kid-ui): panel wyniku w kolorze tonu z ikoną`.

### Task 6: Widoki lekcji

**Files:**
- Modify: style w `packages/kid-ui/src/styles.css` dotyczące `exercises/lesson/*` (luki, bloki kolejności, słowa kluczowe, skracanie, krótka odpowiedź, karta lekcji); widoki `exercises/lesson/*.tsx` tylko gdy omijają wspólne komponenty
- Test: `tests/e2e/lesson-*-layout.spec.ts`, `tests/e2e/lesson-kid.spec.ts`

**Interfaces:** Consumes: style kart i pola z Zadań 3–4.

- [ ] **Step 1:** Wylistuj reguły lekcji w `styles.css`, które nadpisują tło, obramowanie, font lub kolor kart/pól (`grep -n "lesson" packages/kid-ui/src/styles.css`). Każdą zastąp dziedziczeniem z `AnswerField`/`AnswerGrid`/`LessonBlockButton` albo tymi samymi rolami (karta `surface-container-high` + `outline`, pole jak w Zadaniu 3, bodziec lekcji jak `.kid-source`). Luka w zdaniu: obramowanie 2px `outline`, tekst Fredoka 600.
- [ ] **Step 2:** `pnpm build && UMIEM_E2E_SKIP_BUILD=1 pnpm exec playwright test tests/e2e/lesson-kid.spec.ts tests/e2e/lesson-precision-layout.spec.ts tests/e2e/lesson-dictation-layout.spec.ts tests/e2e/lesson-calculation-layout.spec.ts tests/e2e/lesson-mock-precision-layout.spec.ts` — PASS (geometria może wymagać aktualizacji wysokości kart; nie luzuj minimów 48/54 px).
- [ ] **Step 3:** `pnpm vitest run packages/kid-ui tests/kid-design-tokens.test.ts tests/kid-tokens.test.ts` — PASS.
- [ ] **Step 4:** Commit `feat(kid-ui): lekcje w stylu Zatoki`.

### Task 7: Weryfikacja i ustalenia

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-kid-ui-zatoka-stage2-design.md` (sekcja „8. Ustalenia z implementacji”)

- [ ] **Step 1:** `pnpm typecheck`, `pnpm test:unit`, `pnpm build`, `pnpm test:e2e:shards` — wszystko PASS.
- [ ] **Step 2:** Zrzuty 360×800 i 844×390: wybór, pisanie z wpisanym tekstem, mowa, lekcja (luka), panel wyniku w każdym tonie — do scratchpada, nie do repo.
- [ ] **Step 3:** Dopisz do specu sekcję 8 z rulingami z realizacji (w tym kolory tekstu na tłach tonów z Zadania 5) i jawną notą o braku odbioru na fizycznym urządzeniu.
- [ ] **Step 4:** Commit `docs(kid-ui): ustalenia z implementacji etapu 2`.
