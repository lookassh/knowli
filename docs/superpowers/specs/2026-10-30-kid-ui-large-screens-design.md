# Kid UI na dużych ekranach: szersza kolumna, zwarty układ zadania i proporcjonalne powiększenie

**Status:** projekt uzgodniony w rozmowie 2026-10-30. Po review trzech niezależnych krytyków (mechanizm, UX, testy) właściciel zdecydował: skala tylko na urządzeniach z myszą lub touchpadem, brakujące litery łamią się tylko między słowami (także na telefonie), całość w jednym PR. Zmienia decyzję z `2026-10-29-kid-ui-zatoka-stage1-design.md` (kolumna `KidScreen` zawsze maks. 560 px).

## 1. Problem, odbiorca, kryteria

Na monitorze 34" 3440×1440 sesja dziecka zajmuje wąski pas na środku: kolumna ma maks. 560 px (`.kid-learning` w `styles.css`, `.root` w `KidScreen.module.css`), kafelki obrazków maks. 260 px (`--visual-choice-size` w `answer-controls.module.css`), a typografia ma stałe rozmiary telefonu. Wszystkie media queries Kid UI tylko zmniejszają elementy. Na wysokim oknie materiał zadania stoi u góry, a stopka z wynikiem u dołu ramy — między nimi powstaje pusty pas (ok. 450–650 px na ekranie 34", w wyborze obrazków i tekstu oraz w odpowiedzi pisemnej). Na laptopie FullHD pole z brakującymi literami łamie się do nowej linii, a łamanie wypada w środku słowa, bo każda litera jest osobnym elementem wiersza.

Dzieci uczą się na telefonach, laptopie FullHD (skalowanie Windows 125% lub 150%) i komputerze z monitorem 34". Reguła ma działać na każdym dużym ekranie z myszą lub touchpadem (także 24–27", 4K).

Kryteria sukcesu:

- 34" (okno zmaksymalizowane ok. 3440×1300 i pełny ekran 3440×1440): tekst w polu odpowiedzi ok. 34–39 px na ekranie, kolumna ok. 1040–1150 px, odstęp między odpowiedziami (obrazki, opcje tekstowe, pole pisemne) a panelem wyniku lub akcją ≤ 15% wysokości okna.
- Laptop FullHD (okno ok. 1536×730 przy 125%, ok. 1280×600 przy 150%): kolumna 720 px; fraza z brakującymi literami do ok. 20 znaków mieści się w jednym wierszu; dłuższa łamie się wyłącznie między słowami.
- Telefon i tablet: skala zawsze 1. Telefon w pionie i w poziomie (wysokość < 480) oraz tablet w pionie (< 840) mają kolumnę jak dziś. Jedyna zmiana na telefonie: łamanie liter tylko między słowami (słowo dłuższe niż szerokość wiersza nadal może się złamać).
- Brak poziomego przepełnienia, cele dotykowe ≥ 48 px, główna akcja ≥ 54 px — także przy skali > 1. Odpowiedzi (kafelki, opcje) nie zmieniają rozmiaru ani położenia w chwili werdyktu na nowych rozmiarach okna.

## 2. Zakres

Wyłącznie `packages/kid-ui` (plus testy i dokumentacja). Bez zmian Kid API, DTO, kontraktów, bazy, serwera, panelu rodzica, manifestu PWA, MCP i `SKILL.md` (brak zmian API — uzasadnienie w opisie PR). Jeden PR.

Poza zakresem: osobne układy desktopowe (np. 4 obrazki w rzędzie), więcej kolumn na ekranach profili i zestawów, osobne układy dla tabletów, przełącznik rozmiaru w UI, Safari. Istniejące kurczenie kafelków obrazków na laptopie w chwili pojawienia się panelu wyniku (np. 258 → 220 px przy 125%) to zachowanie sprzed tej zmiany — osobne zadanie.

## 3. Zachowanie

### 3.1 Szersza kolumna od szerokości expanded

- Token `--kid-column-max-width`: 560 px; przy `@media (min-width: 840px) and (min-height: 480px)` 720 px. Warunek wysokości zostawia telefony w poziomie (np. 844×390, 915×412) bez zmian.
- Używają go `.kid-learning` (sesja), `.root` w `KidScreen.module.css` (ekrany profili, zestawów, podsumowań — wspólna szerokość, bez skoku przy wejściu w sesję) i arkusz `EndSessionConfirm` (dziś `min(560px, 100%)`).
- Token `--kid-visual-choice-max-size`: 260 px; przy tym samym warunku 300 px (zamiast literału `260px` w `--visual-choice-size`). Przy 320 px kafelki kurczyłyby się w chwili pojawienia się panelu wyniku (np. 512 → 488 px na 3440×1440); przy 300 px rozmiar jest stały.
- Tekst kart lekcji (`.kid-lesson-card__body` i pokrewne bloki ciągłego tekstu) dostaje `max-inline-size: 60ch`, żeby wiersz przy 720 px nie przekraczał ok. 60 znaków.
- Ekrany pozostają jednokolumnowe. Przyjęte skutki szerszej kolumny: siatki `auto-fit` dostają kolumnę więcej (np. `.kid-lesson-group__bins` 2 → 3, `.kid-summary-stats`); tablet w poziomie (≥ 840 × ≥ 480) dostaje kolumnę 720 px.

### 3.2 Zwarty układ zadania na wysokim oknie

Przy `@media (min-width: 840px) and (min-height: 781px)` rama zadania (`ExerciseFrame`) poza wyborem obrazków nie rozciąga materiału na całą wysokość: wiersze `auto minmax(0, max-content) auto` i `align-content: start`. Instrukcja, odpowiedzi i stopka (akcja lub panel wyniku) stoją razem u góry, wolne miejsce zostaje pod nimi. Panel wyniku pojawia się pod odpowiedziami, więc odpowiedzi się nie przesuwają. Długa treść nadal przewija się w materiale (ścieżka minimalna 0).

- Dotyczy ramy w trybie `flow` (wybór tekstowy) i `overlay` (odpowiedź pisemna, mowa, karta słowa, lekcje). W trybie `overlay` rezerwa pod panelem wyniku (`dockPad`) powiększa wiersz materiału zamiast nachodzić na treść — weryfikowane testem E2E z realnym nachodzeniem. Jeśli w implementacji pętla rezerwy okaże się niestabilna, reguła zostaje ograniczona do trybu `flow`, a raport PR podaje to wprost.
- Wybór obrazków bez zmian: kafelki i tak wypełniają wysokość materiału (`cqh`).
- Próg wysokości 781 px wyłącza regułę na laptopach (730/600 px), gdzie dziś obowiązują reguły niskiego okna. Regułę dostaje też tablet w poziomie o wysokości ≥ 781 (np. 1366×1024).

### 3.3 Brakujące litery: łamanie tylko między słowami

`LetterCompletionView` grupuje znaki fragmentu w słowa (ciągi bez spacji) — każde słowo to element `.kid-letter-word` (`display: inline-flex`, bez łamania, `max-width: 100%`, łamanie wewnątrz dopiero gdy samo słowo nie mieści się w wierszu). Wiersz `.kid-letter-fragment` łamie się między słowami; spacje zostają widoczne. Pola, ich kolejność, fokus, nawigacja klawiaturą, nazwy dostępne, `data-testid` i wysyłana odpowiedź bez zmian.

### 3.4 Proporcjonalne powiększenie dużego okna

- Skala = `min(innerWidth / 840, innerHeight / 900)`, ograniczona do [1; 1,6], zaokrąglona w dół do 0,01 (`Math.floor(s * 100 + 1e-9) / 100`). Wartości nieskończone, ujemne lub `NaN` dają 1.
- Skala > 1 wyłącznie gdy pasuje `(hover: hover) and (pointer: fine)` (laptop, PC). Telefony i tablety mają zawsze 1 — m.in. dlatego, że klawiatura ekranowa (`interactiveWidget: "resizes-content"` w layoutach Kid UI) zmienia wysokość okna i skala skakałaby przy każdym wpisywaniu.
- Skala > 1 powiększa cały Kid UI (tekst, przyciski, obrazki, kolumnę, odstępy) jak powiększenie przeglądarki.
- Własność: przy skali > 1 wewnętrzne okno układu (`innerWidth/skala` × `innerHeight/skala`) ma co najmniej 840 × 900 px, a prawdziwe okno jest nie mniejsze niż wewnętrzne. Gdy ogranicza wysokość, wewnętrzne okno ma ok. 900 px wysokości (do limitu 1,6); gdy ogranicza szerokość (proporcje węższe niż ok. 0,93:1, np. monitor w pionie), może być wyższe — wtedy zwarty układ z §3.2 zapobiega pustemu pasowi.

Szacunki (okno w px CSS po skalowaniu systemu; kolumna — wewnętrzna; ostatnia kolumna — na ekranie):

| Urządzenie | Okno | Wskaźnik | Kolumna | Skala | Kolumna na ekranie |
| --- | --- | --- | --- | --- | --- |
| Telefon pionowo | ~390×750 | dotyk | cała szerokość | 1 | bez zmian |
| Telefon poziomo | 844×390 | dotyk | 560 | 1 | bez zmian |
| Tablet pionowo | 768×1024 | dotyk | 560 | 1 | bez zmian |
| Tablet poziomo | 1366×1024 | dotyk | 720 | 1 | 720 |
| Laptop FullHD, 125% | ~1536×730 | mysz | 720 | 1 | 720 |
| Laptop FullHD, 150% | ~1280×600 | mysz | 720 | 1 | 720 |
| Monitor FullHD, 100% | ~1920×950 | mysz | 720 | 1,05 | ~756 |
| 27" 2560×1440, 100% | ~2560×1300 | mysz | 720 | 1,44 | ~1037 |
| 34", okno zmaksymalizowane | ~3440×1300 | mysz | 720 | 1,44 | ~1037 |
| 34", pełny ekran | 3440×1440 | mysz | 720 | 1,6 | 1152 |
| 34", pół ekranu / 1/3 ekranu | ~1720×1300 / ~1146×1300 | mysz | 720 | 1,44 / 1,36 | ~1037 / ~979 |
| 4K, 100% | ~3840×2050 | mysz | 720 | 1,6 | 1152 |

## 4. Mechanizm

### 4.1 Skala w `KidPage`

- `layout/viewport.ts`: czysta funkcja `computeKidLayoutScale({ width, height, finePointer }): number` ze stałymi `KID_SCALE_REFERENCE_WIDTH = 840`, `KID_SCALE_REFERENCE_HEIGHT = 900`, `KID_SCALE_MAX = 1.6`. `KidViewport` dostaje pole `scale` (serwer i stan początkowy: 1). `finePointer` pochodzi z `matchMedia("(hover: hover) and (pointer: fine)")`; zmiana tego zapytania przelicza widok jak `resize`.
- Pomiar okna przechodzi z `useEffect` na efekt layoutu po stronie klienta (izomorficzny `useLayoutEffect`), żeby pierwsze malowanie nie skakało o skalę.
- `KidPage` pozostaje jedynym właścicielem pomiaru okna i jedynym źródłem skali. Gdy `scale > 1`, na `.kid-page` ustawia inline `zoom: scale`, zmienną `--kid-zoom: scale` i `data-kid-scale`; przy skali 1 nie ustawia `zoom` ani `--kid-zoom` (zachowanie jak dziś), `data-kid-scale="1"`.
- Ramka sesji: inline `height = viewport.height / scale`, `top = viewport.offsetTop / scale` (pod `zoom` długości inline są mnożone przez skalę).
- Progi `data-viewport-short` (≤ 700) i `data-viewport-very-short` (≤ 479) liczone jak dziś z prawdziwej wysokości; przy skali > 1 prawdziwa i wewnętrzna wysokość przekraczają 900, więc oba są wyłączone.
- Powiększenie gestem (`zoomed`) działa jak dziś; skala liczy się z `innerWidth/innerHeight` (layout viewport).
- Reguły: poza `KidPage` nic w `packages/kid-ui` nie ustawia `zoom`; tokeny z §4.2 nie są rejestrowane przez `@property` (rozwiązanie jednostek na elemencie użycia jest warunkiem poprawności).

### 4.2 Jednostki okna

Pod `zoom` jednostki okna są mnożone przez skalę (`100dvh` daje 1,6 wysokości ekranu). W bloku tokenów `:root:has(.kid-ui), .kid-theme, .kid-ui` powstają tokeny zachowujące rodzaj jednostki:

- `--kid-vh: calc(1vh / var(--kid-zoom, 1))`
- `--kid-dvh: calc(1dvh / var(--kid-zoom, 1))`
- `--kid-svh: calc(1svh / var(--kid-zoom, 1))`
- `--kid-vw: calc(1vw / var(--kid-zoom, 1))`

Zmienne niezarejestrowane: `var(--kid-zoom)` podstawia się na elemencie deklaracji (`.kid-page` ma klasę `kid-ui` i inline `--kid-zoom`), a jednostka rozwiązuje się na elemencie użycia, przy jego zoomie — poprawne, bo całe drzewo `.kid-page` ma ten sam zoom. Elementy poza `.kid-page` dostają fallback 1. Wszystkie 22 użycia jednostek okna w CSS `packages/kid-ui` (w tym `36svh` w `styles.css` i `100dvh` w `theme/kid-theme.module.css`) przechodzą na odpowiadające tokeny (`calc(N * var(--kid-…))`). `tests/kid-design-tokens.test.ts` dostaje regułę: brak surowych jednostek okna (`vh`, `vw`, `vi`, `vb`, `vmin`, `vmax` z przedrostkami `s`/`l`/`d`) poza blokiem tokenów, w CSS i w stylach inline TSX pakietu.

### 4.3 Media i container queries

- Media queries porównują prawdziwe okno. Z własności §3.4 (przy skali > 1 prawdziwe ≥ wewnętrzne ≥ 840 × 900) żaden próg szerokości (359/420/599/600/840) ani wysokości (420/479/480/560/700/780/781) nie przełącza się inaczej niż dla okna wewnętrznego. Jedyne `matchMedia` w pakiecie (zapytanie o hover w `DeckScreen`) nie zależy od rozmiaru.
- Container queries i jednostki `cq*` liczą się w pikselach wewnętrznych — spójnie z układem.

### 4.4 Pomiary w JS

Pod `zoom` `getBoundingClientRect()` i pozycje `position: fixed` są w pikselach ekranu (× skala), a `offsetHeight`, `clientHeight`, `scrollHeight`, `scrollTop`, `offsetTop` i `ResizeObserver` w pikselach wewnętrznych; `innerWidth/innerHeight` i `visualViewport` nie zależą od zoomu elementu. Helper w `layout/` przelicza długość z pikseli ekranu na wewnętrzne przez `element.currentCSSZoom` (brak, 0 lub wartość nieskończona → 1). Dwa miejsca dziś mieszają jednostki:

- `ExerciseFrame` (tryb overlay): `contentBottom` i dolna krawędź kotwicy z prostokątów przeliczone na piksele wewnętrzne przed porównaniem z `offsetHeight` i dodaniem do `scrollTop`.
- `MicrophoneSettingsButton`: obliczenie pozycji zostaje w pikselach ekranu (prostokąty, `viewport.width/height/offsetTop`, odstępy bezpieczne 16 px), a dopiero wynikowe `left` i `top` dzielone są przez zoom przed zapisem jako `position: fixed`.

Pozostałe użycia są bezpieczne pod zoomem (sprawdzone w review): `scrollIntoView` w `feedback-dock-reveal`, `AnimatePresence mode="popLayout"` (mierzy i zapisuje w pikselach wewnętrznych); brak portali, `IntersectionObserver`, `canvas`, `srcset`.

### 4.5 Dowody z prób (Chromium 153, Playwright 1.63)

Element z `zoom: 1.5` w oknie 1200×800: `200px` → 300 px na ekranie; `100dvh` → 1200; `10vw` → 180; `100cqw` kontenera 400 px → 600; `@container (min-width: 500px)` dla kontenera 400 px nie pasuje (progi w px wewnętrznych); `@media (min-width: 1000px)` pasuje (prawdziwe okno); `offsetHeight`/`clientHeight`/`ResizeObserver` = 200 dla elementu 300 px na ekranie; `position: fixed; left: 100px` → 150; `currentCSSZoom` = 1,5. Review potwierdził na 12 rozmiarach okna: tokeny `calc(N * var(--kid-vh))` dają dokładnie N% wysokości ekranu, ramka sesji `height = H/skala` i strona flow nie przewijają dokumentu ani o 1 px, scrim `inset: 0` pokrywa okno.

## 5. Testy

**Unit (Vitest, jsdom):**

- tabela `computeKidLayoutScale`: telefon, tablet (wskaźnik dotykowy → 1 także dla 1366×1024), laptop 125%/150%, FullHD 100%, 27", 34" okno/pełny ekran/pół/⅓, 4K, limit, przypadek graniczny zaokrąglenia (np. szerokość 949,2 → 1,13), wartości nieprawidłowe;
- helper przeliczania pikseli ekranu (fallback 1 przy braku `currentCSSZoom` — jsdom go nie ma);
- `KidPage` z podstawionymi `innerWidth/innerHeight`, `visualViewport` i `matchMedia` (jak w `MicrophoneSettingsButton.test.tsx`): `--kid-zoom`, `data-kid-scale`, wysokość ramki / skala; brak `--kid-zoom` przy skali 1. Samego `zoom` jsdom nie obsługuje — sprawdza go E2E;
- `LetterCompletionView`: grupowanie w słowa, kolejność pól i wysyłana odpowiedź bez zmian;
- reguła jednostek okna w `kid-design-tokens.test.ts`.

**E2E (Playwright), nowy spec `kid-large-screen.spec.ts` w projekcie `mocked`** (fixture zaślepia całe Kid API; spec dopisany do `MOCKED_SPECS`; potrzebne buildery fixture — np. zakończone zadanie z panelem wyniku, ekran zestawów, zadanie `letter_completion` — przeniesione do wspólnych helperów zamiast kopiowania). Okna z oczekiwaną skalą wpisaną na sztywno: 1536×730 (1), 1280×600 (1), 1920×1080 (1,2), 3440×1300 (1,44), 3440×1440 (1,6), 1146×1300 (1,36); kontrolnie 390×750, 844×390 i 768×1024 (kolumna jak dziś) oraz 1366×1024 z emulacją urządzenia dotykowego (`isMobile`, skala 1, kolumna 720). Pomiar dopiero po ustaleniu `data-kid-scale` i `currentCSSZoom` na oczekiwanej wartości. Tolerancje ± 1 px.

- kolumna sesji i ekranów flow: szerokość na ekranie = 720 × skala, wyśrodkowana; brak poziomego przepełnienia; krótki ekran flow (jeden profil, podsumowanie) przy skali 1,6: `scrollHeight ≤ innerHeight` (sprawdza migrację jednostek okna);
- wybór obrazków z 4 opcjami: kafelki i panel wyniku w oknie; odstęp siatka → panel ≤ 15% wysokości okna przy 3440×1300 i 3440×1440; rozmiar i położenie kafelków bez zmian po werdykcie (1920×1080, 3440×1440);
- wybór tekstowy i odpowiedź pisemna: odstęp odpowiedzi → akcja/panel ≤ 15% wysokości okna od 1920×1080; opcje bez przesunięcia po werdykcie;
- brakujące litery: fraza ≥ 17 znaków w jednym wierszu przy kolumnie 720 (wiersze liczone po środkach pionowych pól i liter); kontrolnie ta sama fraza w ≥ 2 wierszach przy kolumnie 560 (768×1024); na 390×750 litery jednego słowa (≤ 9 znaków) w jednym wierszu, łamanie tylko między słowami;
- tekst pola odpowiedzi: `rect.height / offsetHeight` ≈ skala (± 0,01);
- poprawki JS, najpierw na czerwono (przed przeliczeniem prostokątów w JS): przy skali 1,6 zadanie z odpowiedzią pisemną i długim feedbackiem, gdzie panel wyniku realnie nachodzi na treść — koniec treści widoczny nad panelem po rezerwie; panel mikrofonu: górna krawędź w `button.bottom + [0; 8 × skala + 2]`, lewa krawędź przy przycisku (± 2 px).

**Istniejące testy do poprawy** (przy oknach 1392×984, 1440×960 i 1920×1080 skala wynosi teraz 1,09 / 1,06 / 1,2):

- `kid-responsive.spec.ts:153`, `picture-choice-layout.spec.ts:55` i `:98` — wysokość ramki porównywana dokładnym stringiem `toHaveCSS("height", …)`; zastąpione wspólnym helperem „prostokąt ramki ≈ okno (± 1 px)”, użytym też w `helpers/lesson-reach.ts:40` i specach lekcji z tym samym sprawdzeniem;
- `kid-responsive.spec.ts:151, 155, 387, 435, 456`, `kid-feedback-dock.spec.ts:172`, `kid-feedback-layout.spec.ts:58` — przegląd asercji łączących prostokąty z `clientHeight/scrollTop` i stałymi px;
- `kid-end-confirm.spec.ts:138` (dokładne `toMatchObject` scrimu → tolerancja) i `:141` (`≤ 560` → token);
- komentarz `kid-decks-layout.spec.ts:209`.

**Przed PR:** `pnpm typecheck`, `pnpm test:unit`, pełne `pnpm test:e2e:shards`.

**Niezweryfikowane — raportowane jawnie:** wygląd na fizycznym monitorze 34" i laptopie; animacje Motion pod zoomem (fixture E2E emuluje reduced motion, `kid-motion.spec.ts` biegnie przy oknach bez skali); prawdziwe fonty (Nunito, monospace Androida — szerszy, co zwiększa łamanie liter na telefonie).

## 6. Dokumentacja

- Ten dokument.
- `2026-10-29-kid-ui-zatoka-stage1-design.md`: przy notce o kolumnie 560 px adnotacja „zastąpione przez 2026-10-30-kid-ui-large-screens-design.md”.
- `AGENTS.md`, sekcja Kid UI: skala dużego okna (`KidPage`, `zoom`, `--kid-zoom`, tylko `pointer: fine`); tokeny `--kid-vh/--kid-dvh/--kid-svh/--kid-vw` zamiast surowych jednostek okna; przeliczanie prostokątów w JS; brak `zoom` poza `KidPage` i `@property` dla tokenów; kolumna 560/720 i kafelki 260/300; Ctrl +/− na dużym monitorze (§7).
- `docs/architecture.md:97` (limit kafelków 260 px), komentarz w `styles.css` o szerokości materiału na desktopie (ok. l. 2586), `docs/folder-structure.md:85` jeśli opisuje pomiar okna.

## 7. Ryzyka i przyjęte kompromisy

- **Ctrl +/− na dużym monitorze** w zakresie ok. 90–160% prawie nie zmienia rozmiaru: powiększenie przeglądarki zmniejsza okno w px CSS, więc skala maleje i wynik wychodzi podobny (np. 3440×1300: 1,44 przy 90%, 100%, 110% i 125%). Przyjęte — interfejs i tak jest duży; odczytywanie powiększenia przeglądarki (np. z `outerWidth/innerWidth`) jest zawodne. Opisane w `AGENTS.md`.
- **Obramowania** 1–2 px nie rosną ze skalą (Chromium zaokrągla szerokość ramki do pełnych pikseli urządzenia); pierścienie fokusu są względnie cieńsze. Asercje E2E nie mierzą dokładnych rozmiarów z ramkami.
- **Podwójne skalowanie w nowym kodzie JS** (prostokąt ekranu zapisany jako długość w stylu). Mitigacja: helper z §4.4, nota w `AGENTS.md`, testy E2E przy skali 1,6.
- **Zwarty układ w trybie overlay** zależy od pętli rezerwy `dockPad` — test z realnym nachodzeniem; ścieżka awaryjna opisana w §3.2.
- **Grafiki rastrowe** mają do 768 px (`ILLUSTRATION_DISPLAY_MAX_PX`), więcej niż największy kafelek na ekranie (480 px), więc nie są rozciągane ponad rozdzielczość.
- **Zmiana rozmiaru okna** (przeciągnięcie między monitorami, przyciągnięcie okna) przelicza skalę na `resize`, jak dziś pomiar okna.
