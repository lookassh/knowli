# Phase 01 — UI Review (ponowny audyt)

**Audited:** 2026-10-22
**Baseline:** abstract 6-pillar standards (brak UI-SPEC.md) + AGENTS.md (UX pierwszej wersji) + zgłoszenie właściciela: degradacja responsywności w iframe na kiosku Windows 11 (https://start.devforce.pl hostuje https://umiem.devforce.pl)
**Screenshots:** not captured (audyt statyczny — na polecenie właściciela nie uruchamiano dev servera; reguły CSS potwierdzono także na produkcyjnym pliku CSS `/_next/static/css/58d0a5a160f5e6d0.css`)
**Interaction captures:** off (workflow.ui_interaction_capture is false)

Ten przegląd zastępuje wersję z 2026-10-21 (22/24). Zakres rozszerzony o problem właściciela: przelewanie się treści (scrollbar) na ekranie ćwiczenia wyboru obrazka w iframe kiosku.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|---|---:|---|
| 1. Copywriting | 4/4 | Krótkie, polskie komunikaty stanów; brak generycznych etykiet; zgodność z AGENTS.md. |
| 2. Visuals | 3/4 | Stan pending nadal nieodróżnialny wizualnie od naliczonych punktów (dcyzja z poprzedniego audytu niewdrożona). |
| 3. Color | 3/4 | Dobra dyscyplina tokenów i semantyki kolorów, ale ~18 deklaracji z surowymi hex omija tokeny i psuje ciemny motyw. |
| 4. Typography | 3/4 | ~19 różnych rozmiarów czcionki z near-duplikatami (0.85/0.9/0.95, 1.05/1.1/1.15…), brak skali; czytelność dobra. |
| 5. Spacing | 2/4 | **BLOCKER:** siatka obrazków wyboru nie ma budżetu wysokości — przy 3–4 opcjach treść przelewa się w każdym widoku o wysokości ~541–949 px, w tym w iframe kiosku. |
| 6. Experience Design | 2/4 | **BLOCKER:** w kiosku dolny rząd obrazków jest poniżej linii zgięcia — dziecko może odpowiedzieć bez zobaczenia wszystkich opcji; zagnieżdżone kontenery scrolla; brak ErrorBoundary. |

**Overall: 17/24**

---

## Diagnoza problemu kiosku (PRIMARY FOCUS)

### Objaw

Na https://start.devforce.pl (host zewnętrzny, poza repo) `<iframe id="appFrame">` dostaje wysokość `100dvh minus header hosta` (header: `padding 12px` + przyciski ~46 px → ~70 px). Na kiosku 1920×1080 z zmaksymalizowaną przeglądarką iframe ma **~860–880 px** wysokości; w pełnym ekranie ~980–1010 px. W tym kształcie (szeroki + ~870 px wysokości) ekran ćwiczenia `picture_listening` (słowo EN → wybór obrazka) przelewa się i pokazuje scrollbar.

### Mechanika przepełnienia (wszystkie linie: `packages/kid-ui/src/styles.css`)

Ekran sesji to `position: fixed; height: 100dvh` z `overflow-y: auto` (linie 55–66, 73–75) — scrollbar pojawia się tam, gdzie naturalna wysokość treści przekroczy wysokość ramki.

Składniki wysokości ekranu `picture_listening` przy 4 opcjach (2 rzędy):

| Element | Wysokość | Źródło |
|---|---|---|
| padding ekranu 2×16 | 32 | linia 257 |
| odstępy ekranu 3×12 | 36 | linia 262 |
| `kid-header` | 48 | linia 1476 |
| `kid-session-status` | 52 | linie 1482–1484 |
| `kid-exercise-instruction` | 48 | linia 129 |
| `kid-play-big` | 48–60 | linie 994–999 |
| `kid-material-content` gap | 6 | linia 982 |
| `kid-primary-slot` (pusty, zarezerwowany) | 52 | linie 182–187, 36–38 `ExerciseFrame.tsx` |
| `kid-exercise-result` (pusty, zarezerwowany) | 56 | linie 986–992 (`:empty` = `visibility:hidden`, zajmuje miejsce) |
| odstępy ramki ćwiczenia 3×8 | 24 | linia 121 |
| **Suma stała** | **≈ 360 px** | |

Siatka obrazków: `.kid-picture-option { width: min(100%, 25svh); aspect-ratio: 1/1 }` (linia 1028), a w media query `(min-width: 700px) and (orientation: landscape)` szerokość rośnie do `min(100%, 35svh)` (linie 1216–1220). Ramka ćwiczenia jest ograniczona do 560 px szerokości (linia 115), więc kolumna siatki ≈ 274 px i realny rozmiar kwadratu = `min(274, 0.35·H)`.

- Przy **H = 870 px** (kiosk): `0.35·870 = 304 → 274` → siatka = 2×274+12 = **560 px** → całkowita ~**920 px > 870** → ~50–90 px treści pod linią zgięcia (odcięty dolny rząd obrazków).
- Przy **H = 700 px**: `0.35·700 = 245` → siatka 502 px → ~850 px > 700 → ~150 px pod linią zgięcia.
- Ekran mieści się dopiero przy **H ≥ ~950 px** — czyli prawie nigdy w iframe kiosku ani na laptopie.

### Właściwe przyczyny w kodzie (do naprawy w repo)

1. **`styles.css:1216–1220`** — podbicie do `35svh` przy szerokim landscape **bez budżetu wysokości**. Telefony landscape mają ≤540 px wysokości i wpadają w ratunkowy układ dwukolumnowy; kiosk/iframe to jedyny kształt „szeroki ORAZ 541–949 px wysokości” — dla niego nie ma żadnej reguły. To główny winowajca.
2. **`styles.css:973–984`** — `picture_listening` świadomie rezygnuje z elastycznego kontenera (`.kid-material { flex: none; overflow: visible }`, `.kid-material-content { flex: none; min-height: auto; overflow: visible }`), więc siatka przyjmuje wysokość naturalną i **nie może się skurczyć**.
3. **`styles.css:1006–1015` + `1028–1036`** — `grid-auto-rows: max-content` + kwadraty definiowane przez **szerokość** (`width: min(100%, Nsvh)` + `aspect-ratio: 1/1`) czynią wysokość siatki funkcją pełnej wysokości viewportu, nie dostępnego miejsca. Brak jakiegokolwiek `max-height`.
4. **`styles.css:292–313` + `KidPage.tsx:25–26`** — drabina kompakcji ma tylko szczeble „short ≤700” (skraca odstępy, ~14 px zysku) i „very-short ≤420” (każe obrazkom 112 px), a układ ratunkowy dwukolumnowy włącza się wyłącznie przy `max-height: 540` (`styles.css:1222, 1258`). Przedział **541–949 px nie ma żadnego szczebla poza.reduce odstępów** — kiosk ląduje dokładnie tam.
5. **`styles.css:182–187, 986–992`** — zawsze zarezerwowane ~108 px (pusty `kid-primary-slot` 52 + pusty `kid-exercise-result` 56). Rezerwacja anty-shift jest słuszna, ale nie jest wliczona w matematykę `svh`.

### Co NIE jest przyczyną (zweryfikowane)

- Jednostki `dvh/svh/vh` i media queries **w iframe rozstrzygająAgainst viewportu iframe** (Chromium) — działa poprawnie; problemem jest kształt viewportu, nie jednostki.
- `position: fixed` sesji w iframe działa (brak transformowanego przodka w DOM umiem).
- Meta viewport na produkcji jest poprawna (`width=device-width, initial-scale=1, viewport-fit=cover`); `interactiveWidget: resizes-content` (`apps/web/src/app/kids/layout.tsx:7`) nie wpływa na desktop.
- Wdrożony CSS produkcyjny zawiera te same reguły co repo (potwierdzone w `58d0a5a160f5e6d0.css`) — to nie jest zagłuszony deploy.

### Ryzyko dodatkowe do weryfikacji na kiosku: zoom

`packages/kid-ui/src/layout/viewport.ts:18` traktuje `visualViewport.scale > 1.01` jako pinch-zoom (telefon). W Chromium w iframe `visualViewport.scale` bywa raportowane jako **zoom strony hosta**; kioski z Windowsoften działają na zoomie 125–150 %. Wtedy `KidPage.tsx:12–13` spada z trybu sesji do przepływowego (`zoomed=true`), zmieniając semantykę układu i przenosząc scroll na dokument iframe. Zawartość pozostaje osiągalna (WARNING), ale warto to sprawdzić na urządzeniu; ewentualna ochrona: w iframe (`window.self !== window.top`) ignorować `scale`, bo pinch-zoom nie propaguje się do iframe.

### Podział: repo vs strona hosta

**Naprawialne w repo (i to wystarczy):** poz. 1–5 powyżej — patrz Top 3 Priority Fixes.

**Wymagane ze strony hosta (poza repo — tylko uwaga, nie warunek):** żadne, po naprawie budżetu wysokości. Opcjonalnie: utrzymywać zoom przeglądarki 100 % do czasu weryfikacji ryzyka zoom-scale; `allow="microphone; autoplay; fullscreen"` jest już poprawne. Jeśli host chciałby zachować układ jednokolumnowy bez ratunkowego dwukolumnowego, iframe musiałby mieć ≥ ~950 px wysokości.

---

## Top 3 Priority Fixes

1. **Dać siatce obrazków budżet wysokości zamiast pełnego `svh`** (BLOCKER; `packages/kid-ui/src/styles.css:1006–1036, 973–984`) — dolny rząd obrazków dziś wypada poza ekran kiosku, a dziecko może udzielić odpowiedzi bez zobaczenia wszystkich opcji (fałszywy dowód wiedzy). Konkretne: przywrócić dla `picture_listening` `.kid-material { flex: 1; min-height: 0; overflow: hidden }`, ustawić `.kid-picture-options { flex: 1 1 auto; min-height: 0; grid-auto-rows: minmax(112px, 1fr) }` i odwrócić oś wymiarowania kwadratów: `.kid-picture-option { width: auto; height: 100%; max-width: min(100%, 35svh); aspect-ratio: 1/1 }` — rozmiar rośnie z dostępnej wysokości, nie z `svh` całego viewportu, a 112 px to istniejące minimum dotykowe (`styles.css:1134–1140`).
2. **Rozszerzyć układ ratunkowy i drabinę kompakcji na przedział 541–949 px** (BLOCKER; `styles.css:1222–1256`, `KidPage.tsx:25–26`) — ten kształt viewportu istnieje praktycznie tylko w iframe kiosku, więc dotychczasowe progi go nie widziały. Konkretne: podnieść próg dwukolumnowego układu landscape z `max-height: 540px` do ~`900px` (reguła już istnieje i jest przetestowana kształtem — tylko warunek) oraz skasować lub ograniczyć podbicie `35svh` (`styles.css:1216–1220`) warunkiem `min-height`, albo wydłużyć atrybut `data-viewport-short` (np. ≤950 px przy siatce obrazków), by objął też rezerwacje slotów (result 56→48, primary 52→44).
3. **Wdrożyć zaległy wariant wizualny stanu pending + tokens instead of ~18 surowych hex** (WARNING; `packages/kid-ui/src/screens/SessionActivityResultView.tsx:8`, `styles.css:867, 889–893, 926–929, 1580–1584, 1834–1881`) — dziecko nie dostaje żadnego niewerbalnego sygnału, że punkty jeszcze się liczą (tkwi to od audytu 2026-10-21), a surowe hexy (`#eef0fb` dla aktywnej opcji, `#f4f5fd/#c8cdf0` przycisków karty, `#f0c8c8/#fdf3f3` offline/error) nie przełączają się w ciemnym motywie, choć paleta dark istnieje (`styles.css:29–49`). Konkretne: klasa `.kid-summary-counts--pending` z neutralną ikoną/tonem + test w `reward-summary.test.tsx`; zamiana hexów na istniejące tokeny `--kid-soft/--kid-line/--kid-wrong-bg`.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Komunikaty kompletne, po polsku, specyficzne dla stanu: „Punkty z tej nauki są jeszcze liczone.” / „Zdobyto {points} pkt” / „Nauka zapisana. Nie udało się naliczyć punktów.” (`packages/contracts/src/messages.ts:413–415`), „Jeszcze {n} i koniec!” (`messages.ts:468`) — dokładnie fraza z AGENTS.md; liczby mnogie przez `Intl.PluralRules` (`SummaryScreen.tsx:26–29`). Stany puste przyjazne („Na dziś wystarczy. Wróć później!”, `messages.ts:471`; brak talii: `DeckScreen.tsx:75–77`), „Wczytuję…”/„Chwilka…” jako loading. Grep nie znalazł generycznych „OK/Submit/Cancel/Save”. Feedback nie chwali błędnej odpowiedzi.

### Pillar 2: Visuals (3/4)

**WARNING (zaległe):** stan `already_started` renderuje się tą samą klasą `kid-summary-counts` co wynik i pozostałe liczniki (`SessionActivityResultView.tsx:8`; `SummaryScreen.tsx:34–44`) — zalecenie nr 1 poprzedniego audytu nie zostało wdrożone. Poza tym hierarchia jest czytelna (rozmiar/waga/kolor), ikony mają `aria-hidden` z tekstowymi odpowiednikami, przyciski ikonowe mają `aria-label` (`GuidanceButton.tsx:27`, `MockTestSummaryScreen.tsx:57`, `LearnScreen.tsx:141,187`). Fokus widoczny 3 px accentem (`styles.css:425–433`).

### Pillar 3: Color (3/4)

Semantyka kolorów zdyscyplinowana i udokumentowana: niebieski = nawigacja/rekomendacje, zielony zarezerwowany dla poprawnej odpowiedzi (`styles.css:370–373`); ✓/✗ w pseudoelementach dubluje kolor dla ślepoty barwnej (`styles.css:870–901`) — wzorcowo. Tokenów `var(--kid-*)` użyto 177 razy. **WARNING:** ~18 deklaracji z surowymi hex omija tokeny i nie adaptuje się do dark: aktywne opcje `#eef0fb` (`styles.css:867`), przyciski karty `#f4f5fd/#c8cdf0/#c8cdf0` (`styles.css:926–929`), błędna opcja `#c0392b/#fdeeee/#38211f` (`styles.css:889–893`), offline/error `#f0c8c8/#fdf3f3` (`styles.css:1580–1584`), pigułki pisowni `#1d4ed8/#eaf1ff/#1c5c2e/#e3f4e3/#fdf6ec/#8a6116` (`styles.css:1866–1881`), fokus nagrań `#24318a/#303a80/#5157a5` (`styles.css:1402–1418, 1695–1699`). Na jasnym kiosku problem niewidoczny; w ciemnym motywie PWA — jaśniejsze plamy. Stan pending nadal bez własnego tonu.

### Pillar 4: Typography (3/4)

~19 różnych rozmiarów: 0.7, 0.8, 0.85(×2 zapisy), 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.7, 1.75, 2, 2.4, 26 px oraz dwa `clamp()` — ponad progi „>4 rozmiarów” dla audytu bez specyfikacji; wagi: 700 (×20), 600 (×6), 800 (×5) — trzy wagi. Near-duplikaty (0.85/0.9/0.95; 1.05/1.1/1.15; 1.2/1.25; 1.3/1.4) nie tworzą skali. Drobne wyrostki: `font-size: 26px` poza skalą rem (`styles.css:1112`), `1rem !important` (`styles.css:958`). Czytelność dziecka jest jednak dobra (treść ≥1 rem, meta ≥0.85 rem) i `clamp()` dla słowa mówionego jest przemyślane — stąd 3, nie 2.

### Pillar 5: Spacing (2/4)

**BLOCKER — przepełnienie ekranu wyboru obrazka (diagnoza szczegółowa wyżej):** brak budżetu wysokości siatki kwadratów (`styles.css:1006–1036`), rezygnacja z flex-containment dla `picture_listening` (`styles.css:973–984`), podbicie `35svh` bez budżetu (`styles.css:1216–1220`), pusty przedział drabiny kompakcji 541–949 px (`styles.css:1222, 1258`; `KidPage.tsx:25–26`), zawsze zarezerwowane ~108 px slotów (`styles.css:182–187, 986–992`). Odstępy same w sobie są spójne (dominanta 8/10/12 px; 44–64 px pola dotykowe; media 420 px zwęża padding), ale drobne wyrostki: `gap: 6px/14px` i mieszanie `0.5rem/0.25rem` z px w sekcji lekcji (`styles.css:1814–1843`) — brak jednej skali. Ekstremum: `min-height: 360px` ramki przy ≤420 px wysokości (`styles.css:280–290`) celowo akceptuje scroll — to świadoma decyzja, nie defekt.

### Pillar 6: Experience Design (2/4)

**BLOCKER (konsekwencja PILLAR 5):** na kiosku dolny rząd obrazków wyboru jest odcięty — dziecko może odpowiedzieć bez zobaczenia pełnego zestawu opcji, co łamie zasadę „jeden jasny krok” z AGENTS.md i może produkować fałszywe pomyłki. Dodatkowo trzy zagnieżdżone kontenery scrolla (`.kid-page--session` overflow auto, `.kid-learning` overflow auto, `.kid-material-content` overflow auto dla pozostałych typów zadań — `styles.css:63, 74, 166`) utrudniają intuicyjny scroll dotykowy w iframe.

**WARNING — brak ErrorBoundary:** w `apps/web/src` i `packages/kid-ui` nie ma żadnej klasy z `componentDidCatch`/`getDerivedStateFromFromError`; niespodziewany błąd renderu = biały iframe bez komunikatu. Stany kontrolera (offline/error/processing/transitioning, karty retry — `LearnScreen.tsx:149–177`) pokrywają błędy API, nie crash renderu.

**WARNING — zoom w iframe:** patrz sekcja Diagnoza (viewport.ts:18 + KidPage.tsx:12–13); do weryfikacji na urządzeniu.

Pozytywnie (faza 01): pending nie blokuje akcji podsumowania (`reward-summary.test.tsx:91`), zmiana wyniku ogłaszana `role="status"` + `aria-live="polite"` (`SessionActivityResultView.tsx:8`), polling przeżywa nawigację/zmianę profilu/reload i wiąże wynik z właścicielem sesji (`session-controller.ts` — testy 92/92), obsługa klawiatury wyboru (`useChoiceKeyboard`), autofocus „Jeszcze raz” i odsłuchu, `prefers-reduced-motion` (`styles.css:1462–1470`), statusy mikrofonu z podpowiedziami. To trzyma filar na 2, a nie 1.

---

## Registry Safety

Brak `components.json` (shadcn niezainicjowany) — sekcja pominięta zgodnie z procedurą; brak third-party registry do sprawdzenia.

---

## Files Audited

- `packages/kid-ui/src/styles.css` (pełny przegląd 2444 linii)
- `packages/kid-ui/src/layout/KidPage.tsx`, `packages/kid-ui/src/layout/viewport.ts`, `viewport.test.ts`
- `packages/kid-ui/src/exercises/ExerciseFrame.tsx`, `PictureListeningView.tsx`, `PictureRecognitionView.tsx`
- `packages/kid-ui/src/screens/LearnScreen.tsx`, `SummaryScreen.tsx`, `SessionActivityResultView.tsx`, `DeckScreen.tsx`, `MockTestSummaryScreen.tsx`, `ProfileScreen.tsx`
- `packages/kid-ui/src/KidApp.tsx`, `packages/kid-ui/src/components/GuidanceButton.tsx`, `KidIcon.tsx`, `SpeechRecordButton.tsx`
- `apps/web/src/app/layout.tsx`, `apps/web/src/app/kids/layout.tsx`, `apps/web/src/app/kids/[childId]/learn/page.tsx`, `apps/web/src/kid/KidLearningHost.tsx`, `apps/web/src/app/globals.css`
- `packages/contracts/src/kid.ts` (limity opcji `.min(2).max(4)`, linia 114), `packages/contracts/src/messages.ts` (fragmenty)
- Produkcja (curl, materiał dowodowy): `https://umiem.devforce.pl` (meta viewport, CSS `58d0a5a160f5e6d0.css`), `https://start.devforce.pl` (struktura hosta: header ~70 px, iframe `height:100%` w `body{height:100dvh; overflow:hidden}`)
