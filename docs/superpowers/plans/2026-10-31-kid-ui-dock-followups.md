# Kid UI: panel wyniku po #205 — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**

- Karta wyniku zajmuje wolne miejsce pod odpowiedzią.
- Panel w trybie przewijanej strony zastępuje akcje.
- Korekta przewinięcia działa od 1 px ekranu.
- Test odstępu nie zależy od łamania tekstu.

**Architecture:**

- Czysta funkcja `feedbackCardMax` liczy limit karty z geometrii niezależnej od panelu.
- `ExerciseFrame` mierzy tę geometrię raz na klucz (nakładka, rozmiar ramy, tryb strony, odstęp, `overhead`). Zapisuje `--kid-feedback-card-max` na nakładce przed malowaniem i obserwuje także ramę.
- CSS panelu bierze `max(dotychczasowy limit, zmienna)`.
- Panel w trybie przewijanej strony to wyłącznie CSS modułu ramy.
- Próg korekty, próg bramki i ułamkowa górna krawędź panelu to zmiany w `measure()`.

**Tech Stack:** React 19, CSS Modules, Vitest (`vitest.unit.config.ts`), Playwright (projekt `mocked`).

**Spec:** `docs/superpowers/specs/2026-10-31-kid-ui-dock-followups-design.md` (wersja 2), dalej „spec”.

**Wykonanie:** natywnie, w tej sesji. Spec i plan przeszły review trzech krytyków każde; całą gałąź przed PR przejrzy trzech niezależnych krytyków (Task 6).

## Global Constraints

- Zakres zmian: tylko `packages/kid-ui`, `tests/`, `docs/`, `AGENTS.md`. Bez zmian API, DTO, kontraktów, serwera, MCP i `SKILL.md`.
- Reguły Kid UI:
  - żadnych literałów koloru, rozmiaru fontu ani promienia poza blokiem tokenów;
  - żadnych surowych `vh/dvh/svh/vw`, tylko `calc(N * var(--kid-vh))`;
  - zoom ustawia wyłącznie `KidPage`;
  - prostokąty to px ekranu, a `offset*`/`client*`/`scroll*` i style to px wewnętrzne; przeliczenie przez `toLayoutPx` / `cssZoomOf` (`layout/css-zoom.ts`).
- Ruch: tylko Motion na `transform`/`opacity`; nic nie animuje wysokości.
- Komentarze w kodzie produkcyjnym po polsku jak w otoczeniu. Testy E2E po angielsku jak w `kid-large-screen.spec.ts`.
- Nowe przypadki E2E: tabele, jedno wspólne ciało testu (helper), osobny `test`/`describe` tylko tam, gdzie potrzebny inny kontekst (dotyk). Helpery w `tests/e2e/helpers/` zamiast kopii (bramka duplikacji SonarCloud ≤ 3%).
- Commity: po polsku, z linią atrybucji z bieżącego przypomnienia sesji.
- Iteracja E2E: `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test <plik> --project=mocked --grep "<tytuł>"`.
- Przebieg obciążeniowy: najpierw `corepack pnpm build`, potem `UMIEM_E2E_SKIP_BUILD=1 corepack pnpm exec playwright test tests/e2e/kid-large-screen.spec.ts --project=mocked --repeat-each=15 --grep "<tytuły>"`.
- Przed PR: `pnpm typecheck`, `pnpm test:unit`, `pnpm test:e2e:shards`.

## Review Focus

1. **Zamknięcie klawiatury po werdykcie na tablecie.** Karta rośnie po powrocie okna, bez skoku pola i bez treści pod panelem w żadnej klatce. Task 3, wiersze „klawiatura” i „deterministyczny wzrost”.
2. **Pętla przez odstęp od góry w zwartej ramie.** Ponowny pomiar po ustąpieniu odstępu nie powiększa karty. Task 2 (niezmienność) i Task 3 (pole ± 1, odstęp bez zmian).
3. **Zmiana wysokości samej ramy w zwartym układzie** (komunikat, małe zmniejszenie okna). `ResizeObserver` ramy musi przeliczyć kartę, zanim odstęp ustąpi. Task 3, krok 840×1000 → 840×960.
4. **Wychodzący panel przy ponownej próbie.** Zatrzask resetuje się bez usuwania zmiennej. Istniejący test „retry hands the footer back to the answer at once” przechodzi bez zmian.
5. **Testy projektu `real` zależne od przepełnienia karty** (`speech-recording-ux.spec.ts`, `kid-flow.spec.ts`). Pełne shardy w Task 5.

---

### Task 1: Próg 1 px ekranu (korekta i bramka), ułamkowa górna krawędź panelu

**Files:**
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.tsx` (`measure()`, komentarze przy progu)
- Modify: `tests/e2e/kid-large-screen.spec.ts` (`expectPanelNeverCovers`, nowy test, komentarze o progu 8 px)

**Interfaces:**
- Produces: w `measure()` lokalne `const zoom = cssZoomOf(material)` i `const dockTop = toLayoutPx(overlay.getBoundingClientRect().top, material)`. Task 3 wstawia swój blok przed nimi.

- [ ] **Step 1: Test na czerwono:** `test("a first overlap of a few pixels is corrected", …)`.
  1. `SMALL_LAPTOP`, `openWrittenRecall(page, completedRecallFixture())`, `waitForKidScale(page, 1)`, `document.fonts.ready`, `nextFrames`.
  2. W px ekranu:
     - `contentBottom` to maksimum dolnych krawędzi dzieci `.kid-material-content`;
     - `footerTop` to górna krawędź `[data-testid='kid-exercise-actions']`;
     - `actionsBefore` to wysokość tego elementu.
  3. `X = footerTop + 8 − contentBottom + 5`. Styl `.kid-feedback-overlay { height: calc(100% + ${X}px) !important; }`.
  4. `fill("cat")`, `installDockOverlapProbe(page)`, klik `kid-submit`, `toBeVisible` docka, `settledDockReserve`.
  5. Oczekiwane:
     - wysokość `kid-exercise-actions` po werdykcie = `actionsBefore` (± 0,5), co zastępuje warunek „wiersz 54 px”;
     - `inlineReserve > 0`;
     - `|scrollTop − 13| ≤ 1`;
     - `expectPanelNeverCovers`.
- [ ] **Step 2: FAIL:** `scrollTop` = 0.
- [ ] **Step 3: `measure()`:**
  - `dockTop = toLayoutPx(overlay.getBoundingClientRect().top, material)`;
  - `const corrects = overlap * cssZoomOf(material) >= 1`;
  - bramka: `{ overlay, enabled: corrects }` i `else if (corrects) …enabled = true` zamiast `overlap > 0`;
  - korekta przy `corrects`, przewinięcie bez zmian (`overlap + 8`);
  - `excess` bez zmian;
  - `cssZoomOf` dochodzi do importu z `../layout/css-zoom`;
  - komentarze (blok nad efektem i przy warunku) mówią o 1 px ekranu, spec 2026-10-31-kid-ui-dock-followups §3.3.
- [ ] **Step 4: Sonda.** `expectPanelNeverCovers`: próbki `≤ 2`, po ustaleniu `≤ 1` (px ekranu, bez skali); zwraca wynik sondy. JSDoc i komentarz przy przypadku „panel 20 px over the footer” opisują nowy próg.
- [ ] **Step 5: PASS:** `--grep "first overlap|never covers|lengthens|retry hands|reserve is exact"`.
- [ ] **Step 6: Cały projekt `mocked`** (dev): `corepack pnpm exec playwright test --project=mocked`. Każda porażka poza tym plikiem to zmiana zachowania zwykłej ramy. Opisz ją w commicie i zdecyduj: oczekiwanie testu albo poprawka.
- [ ] **Step 7: Commit:** `Kid UI: korekta przewinięcia i bramka rezerwy od 1 px ekranu`.

### Task 2: Czysta funkcja limitu karty

**Files:**
- Create: `packages/kid-ui/src/exercises/feedback-card-space.ts`
- Test: `packages/kid-ui/src/exercises/feedback-card-space.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FeedbackCardGeometry = {
    frameHeight: number;    // offsetHeight ramy (px wewnętrzne)
    contentBottom: number;  // maks. dolna krawędź dzieci treści względem górnej krawędzi ramy (px wewnętrzne)
    scrollTop: number;      // material.scrollTop
    offsetGiven: number;    // max(0, pełny odstęp − bieżący odstęp)
    overlayHeight: number;  // wysokość nakładki (px wewnętrzne, ułamkowa)
    cardHeight: number;     // card.offsetHeight
  };
  export const FEEDBACK_FOOTER_CLEARANCE = 24;
  export const FEEDBACK_CARD_SLACK = 8;
  export function feedbackCardMax(geometry: FeedbackCardGeometry): number | null;
  ```
  Wynik: `Math.floor(frameHeight − (contentBottom + scrollTop + offsetGiven) − 24 − 8 − (overlayHeight − cardHeight))`, `null` gdy ≤ 0. JSDoc: wzór, uzasadnienie 24 (4 + 8 + 8 + 4), 8 i niezmienność ze spec §3.1.

- [ ] **Step 1: Testy na czerwono.** Przypadek bazowy `B = { frameHeight: 780, contentBottom: 300, scrollTop: 0, offsetGiven: 0, overlayHeight: 382, cardHeight: 300 }` → `366`. Pozostałe przypadki:
  - `{ ...B, contentBottom: 250, scrollTop: 50 }` → `366`;
  - `{ ...B, contentBottom: 260, offsetGiven: 40 }` → `366`;
  - `{ ...B, contentBottom: 300.6 }` → `365`;
  - `{ ...B, contentBottom: 666 }` → `null`;
  - `{ ...B, contentBottom: 665.5 }` → `null`;
  - `{ ...B, contentBottom: 700 }` → `null`.
- [ ] **Step 2: FAIL:** `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises/feedback-card-space.test.ts`.
- [ ] **Step 3: Implementacja.**
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit:** `Kid UI: czysta funkcja limitu karty wyniku`.

### Task 3: Karta rośnie w wolne miejsce

**Files:**
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.tsx`
- Modify: `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css` (obie reguły z `max-height`)
- Modify: `tests/e2e/helpers/kid-fixtures.ts` (średnia podpowiedź)
- Modify: `tests/e2e/helpers/kid-frame.ts` (opcja sondy `cardHeight`)
- Modify: `tests/e2e/kid-large-screen.spec.ts`

**Interfaces:**
- Consumes: `feedbackCardMax` (Task 2); `dockTop`, `zoom` w `measure()` (Task 1).
- Produces:
  - `mediumSpellingHintFeedback: FeedbackDto` (`spelling_hint`):
    - każdy wiersz `given`/`expected` to trzy segmenty po ok. 18–20 znaków (plain, pill, plain);
    - `correctText` = złączone segmenty `expected`;
    - komentarz podaje zmierzoną naturalną wysokość karty przy kolumnie 720.
  - `installDockOverlapProbe(page, { startNow?, until?, cardHeight?: boolean })`:
    - w stanie `firstCardHeight: number | null`, zainicjowane `null` przy każdej instalacji;
    - przy `cardHeight: true` odczyt w `start()` razem z pierwszą próbką: `overlay.querySelector(".kid-answer-feedback, .kid-speech-feedback")?.offsetHeight ?? null`, raz, w px wewnętrznych;
    - `readDockOverlapProbe` zwraca to pole;
    - wartość domyślna `false`.

- [ ] **Step 1: Fixture i helper sondy.** Istniejące wywołania bez zmian.
- [ ] **Step 2: Testy na czerwono.** Lokalny helper `cardState(page)` zwraca w px wewnętrznych:
  - `card` = `offsetHeight` karty;
  - `scrollHeight`/`clientHeight` obszaru przewijania karty (`.kid-feedback-content`; dla mowy `.kid-speech-feedback`);
  - `variable` = `--kid-feedback-card-max` ze `style` nakładki;
  - `zoom`;
  - prostokąty ramy, nakładki, `kid-next`, `kid-input`, `kid-instruction` względem górnej krawędzi ramy.

  Warunek wstępny w każdym wierszu: `[data-testid='kid-session-status']` pusty albo nieobecny. Wspólne ciało w helperze, dwa testy:
  - `test("result card takes the free space under the answer")` (mysz);
  - `test("result card takes the free space on a touch tablet")` w `describe` z `test.use({ isMobile: true, hasTouch: true })`, z warunkiem `matchMedia("(pointer: coarse)").matches`.

  Tabela `CARD_SPACE_CASES` (`touch`, `viewport`, `scale`, `feedback`, oczekiwania) wg spec §5. Fixture wszędzie: `completedRecallFixture({ feedback })` z poleceniem „kot”. Średnia podpowiedź: warunek wstępny naturalnej wysokości `> 300` i `< expectedCardMax − 10`, gdzie `expectedCardMax` test liczy z geometrii przed werdyktem wzorem ze spec §3.1 (jedno miejsce w helperze).

  Pierwsza klatka: dla 3440×1440 ze średnią podpowiedzią sonda z `cardHeight: true`. Oczekiwane: `firstCardHeight` > 300 i = karta po ustaleniu (± 1).

  Osobne testy (mysz, długa podpowiedź, krótkie polecenie):
  - `"result card follows the frame size"` na 840 px szerokości (skala 1 przy każdej wysokości; zwarta rama od 781):
    - 840×1000 → 840×960. Warunek wstępny: zmienna > 300 przed i po, czyli w obu oknach wygrywa zmienna, a nie limit CSS. Przy 1600×860 limit 300 wygrałby z ok. 284 i odstęp by ustąpił. Oczekiwane: zmienna niższa o 40 (± 2); odstęp 90 (± 2) przed i po; `kid-input` względem ramy ± 1;
    - potem → 840×800: zmienna niższa; sonda `startNow` + `until`; `expectPanelNeverCovers`; dolna krawędź nakładki ≤ dolna krawędź ramy.
  - Strażnik 1536×730: zmienna > 0 i karta = `0.36 × 730` (± 1).
  - Powiększenie gestem po wzroście (3440×1440): warunek wstępny karta > 300; po `emulatePinchZoom` brak zmiennej i karta = 300 (± 1); odsłonięcie raz (szpieg `scrollIntoView` jak w `kid-feedback-dock.spec.ts:233-241`).

  Dotykowo, w tym samym `describe`:
  - Deterministyczny wzrost 1024×900 → 1024×1366: przy 900 karta > 300 i treść karty się przewija; po `resizeAndSettle` brak przewijania w karcie, a zmienna się zmieniła.
  - Klawiatura: 1024×700 przed wpisaniem; sonda z `until: 1024×1366`; wysłanie; `resizeAndSettle(1024×1366)`; `expectPanelNeverCovers(…, {1024×1366})`; zmienna inna niż przy 700; brak przewijania w karcie.
- [ ] **Step 3: FAIL** przypadków wzrostu, zmiennej i przejść.
- [ ] **Step 4: CSS** w obu regułach: `max-height: max(min(calc(36 * var(--kid-vh)), 300px), var(--kid-feedback-card-max, 0px));` plus komentarz (spec §3.1, zmienną ustawia `ExerciseFrame`).
- [ ] **Step 5: `ExerciseFrame`.**
  - `const cardSpaceRef = useRef<{ overlay: HTMLElement; key: string } | null>(null);`. Reset do `null` obok `gatedDockRef`, bez usuwania zmiennej. Komentarz: nakładka nie może dostać propsa `style` (zmienna jest stylem inline ustawianym z pomiaru).
  - Na początku `measure()`, przed liczeniem `excess`, wywołanie `syncCardSpace(overlay, material)`: funkcja w tym samym pliku, poza komponentem, przyjmuje i zwraca stan zatrzasku.
    - `frame = overlay.closest(".kid-exercise-frame")`, `page = overlay.closest(".kid-page")`, `card = overlay.querySelector(".kid-answer-feedback, .kid-speech-feedback")`, `content = material.querySelector(".kid-material-content")`, `first = frame?.firstElementChild`.
    - `pageScroll` = `data-zoomed` albo `data-viewport-very-short` strony = `"true"`.
    - `fullOffset = parseFloat(getComputedStyle(frame, "::before").flexBasis) || 0`.
    - `overlayHeight = toLayoutPx(overlay.getBoundingClientRect().height, material)`.
    - `key = ${frame.offsetWidth}x${frame.offsetHeight}:${pageScroll}:${fullOffset}:${Math.round(overlayHeight − card.offsetHeight)}`.
    - Przy niezmienionym kluczu (ta sama nakładka) nic nie robi.
    - Inaczej zapisuje klucz i:
      - usuwa zmienną, gdy `pageScroll`, brak `frame`/`card`/`content`/`first`, `content.children.length === 0` albo `frame.scrollHeight > frame.clientHeight + 1`;
      - w przeciwnym razie `feedbackCardMax({ frameHeight: frame.offsetHeight, contentBottom: toLayoutPx(maxChildBottom − frameRect.top, material), scrollTop: material.scrollTop, offsetGiven: Math.max(0, fullOffset − toLayoutPx(first.getBoundingClientRect().top − frameRect.top, material)), overlayHeight, cardHeight: card.offsetHeight })` i `setProperty`/`removeProperty`.
  - W efekcie pomiaru `observer.observe(frameRoot)`, gdzie `frameRoot = overlay.closest(".kid-exercise-frame")`. Komentarz: w zwartej ramie zmiana wysokości ramy nie zmienia żadnego z pozostałych obserwowanych elementów.
  - Komentarz nad `syncCardSpace`: spec §3.1, czyli klucz, dlaczego nie liczyć przy każdym pomiarze i dlaczego geometria nie zależy od panelu.
- [ ] **Step 6: PASS** nowych testów oraz `--grep "reserve is exact|never covers|retry hands|lengthens|compact frame top offset|first overlap|keeps its layout while the keyboard|no empty band"`.
- [ ] **Step 7: Kalibracja.** Gdy średnia podpowiedź łamie się inaczej niż 3 + 3 linie, skróć segmenty. Stałych produkcyjnych nie zmieniaj.
- [ ] **Step 8: Przebieg obciążeniowy** (build produkcyjny, `--repeat-each=15`): `--grep "first overlap|never covers|lengthens|retry hands|free space|frame size|pinch"`. Zero porażek.
- [ ] **Step 9: Commit:** `Kid UI: karta wyniku rośnie w wolne miejsce pod odpowiedzią`.

### Task 4: Panel zastępuje akcje w trybie przewijanej strony; deterministyczny test odstępu

**Files:**
- Modify: `packages/kid-ui/src/exercises/ExerciseFrame.module.css`
- Modify: `tests/e2e/kid-large-screen.spec.ts`

- [ ] **Step 1: Test na czerwono:** `test("result panel takes the place of the actions when the page scrolls")`, tabela `PAGE_SCROLL_DOCK_CASES` wg spec §5.
  - Warunek wstępny: `.kid-page` ma `data-viewport-very-short="true"`.
  - Pomiar „przed” tuż przed kliknięciem wysłania, przez `topsInFrame`: górna krawędź `kid-primary-slot` i `kid-input` (dla luk `.kid-lesson-cloze__text`), a do tego szerokość `kid-exercise-actions`.
  - Wysłanie: dla zadania pisemnego `fill("dog")` i klik `kid-submit` (fixture z błędnym werdyktem); dla luk cztery kliknięcia `kid-lesson-cloze-option` i `kid-lesson-check`.
  - Po werdykcie, też przez `topsInFrame`:
    - |górna krawędź `.kid-feedback-overlay` − slot przed| ≤ 1;
    - |szerokość nakładki − szerokość stopki| ≤ 1;
    - w kotwicy (rodzic nakładki) `kid-primary-slot` i `kid-secondary-slot` mają `boundingBox() === null`;
    - pole lub tekst ± 1.
  - Rozszerz test „powiększenie gestem po wzroście” z Task 3: szerokość nakładki = szerokość stopki (± 1), sloty bez prostokąta.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: CSS** (komentarz: spec §3.2):
  ```css
  :global(.kid-page[data-zoomed="true"]) .dockAnchor > :not(.dockOverlay),
  :global(.kid-page[data-viewport-very-short="true"]) .dockAnchor > :not(.dockOverlay) { display: none; }
  :global(.kid-page[data-zoomed="true"]) .dockOverlay,
  :global(.kid-page[data-viewport-very-short="true"]) .dockOverlay { grid-column: 1 / -1; }
  ```
- [ ] **Step 4: PASS:** `--grep "takes the place of the actions|keeps its layout while the keyboard|no empty band|pinch"`, a także w całości `kid-feedback-dock.spec.ts`, `lesson-sentence-audio.spec.ts` i `kid-answer-contrast.spec.ts`.
- [ ] **Step 5: Test odstępu.** Ciało testu „the top offset gives way before the material” zastąp konstrukcją ze spec §3.4:
  - oba punkty: `free + 45` oraz `free + 90 + 30`;
  - jeden element `<style>` aktualizowany w miejscu;
  - pomiar względem ramy, `free` = (dolna krawędź ramy − dolna krawędź stopki) / zoom.

  Usuń `OFFSET_TAKING_PROMPT` i jego komentarz. Uruchom `--grep "gives way"`: oczekiwany PASS, bo to test strażniczy.
- [ ] **Step 6: Przebieg obciążeniowy** jak w Task 3 Step 8, z dodanym `takes the place of the actions|gives way`.
- [ ] **Step 7: Commit:** `Kid UI: panel zastępuje akcje w trybie przewijanej strony; deterministyczny test odstępu`.

### Task 5: Dokumentacja i pełna weryfikacja

**Files:**
- Modify: `AGENTS.md`:
  - punkt o dużym oknie w sekcji Kid UI: jedno lub dwa zdania wg spec §6, bez nowego punktu;
  - Running and verifying: liczby testów.
- Modify: `docs/superpowers/specs/2026-10-31-kid-ui-large-screens-followups-design.md` (§7, adnotacja: zakładka 1–8 px rozwiązana w spec 2026-10-31-kid-ui-dock-followups §3.3).
- `docs/folder-structure.md`: bez zmian. Plik wymienia `exercises/` jako katalog, a pojedyncze moduły pomocnicze, np. `feedback-dock-reveal.ts`, nie mają wierszy.

- [ ] **Step 1:** `AGENTS.md` i adnotacja.
- [ ] **Step 2:** `corepack pnpm typecheck`: exit 0.
- [ ] **Step 3:** `corepack pnpm test:unit`: wszystkie przechodzą.
- [ ] **Step 4:** `corepack pnpm test:e2e:shards`: 0 porażek. Liczby i czas trafiają do `AGENTS.md`. Porażka w `real` (`speech-recording-ux`, `kid-flow`) wraca do Task 3.
- [ ] **Step 5: Commit:** `Docs: panel wyniku po #205 (AGENTS.md, adnotacja spec)`.

### Task 6: Review gałęzi i PR

- [ ] **Step 1:** Trzech niezależnych krytyków całej gałęzi (`origin/main...HEAD`), soczewki: mechanizm, UX na urządzeniach, testy. Poprawki w jednej fali, ponowne `typecheck`, `test:unit` i dotknięte specy (a pełne shardy, gdy zmienił się kod produkcyjny).
- [ ] **Step 2:** Push `fix/kid-ui-dock-followups` (`git push -u origin fix/kid-ui-dock-followups`). PR do `main` po polsku:
  - zmiany w zachowaniu, z liczbami przed i po;
  - wpływ API → MCP → skill: brak;
  - wykonane sprawdzenia;
  - lista „do sprawdzenia na urządzeniach”;
  - kandydaci ze spec §2 i lista „Niezweryfikowane” ze spec §5.

  PR-a nie scalamy.
