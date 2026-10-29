# Redesign Kid UI „Zatoka” — etap 2: ramka sesji, ćwiczenia i feedback

Status: projekt zatwierdzony w rozmowie 2026-10-29, do przeglądu właściciela. Kontynuacja `2026-10-29-kid-ui-zatoka-stage1-design.md` (etap 1 scalony w #163).

## 1. Cel, odbiorca, kryteria

Dziecko (ok. 8 lat) w trakcie sesji ma widzieć jeden spokojny ekran, na którym najjaśniejszy jest bodziec, odpowiedzi wyglądają jak karty do wyboru, a wynik próby jest od razu czytelny. Etap 2 przenosi język wizualny Zatoki z ekranów wokół sesji na samą sesję w kierunku **B · Ekran skupienia**: bez pasma z falą, gładkie tło `surface`, minimum ozdób.

Kryteria sukcesu:

- Tekst wpisywany w pole odpowiedzi i bodziec są czytelne na telefonie (zgłoszenie właściciela 2026-10-29: w polu `1rem` zwykłej grubości, bodziec w kolorze `--kid-muted`).
- Ramka, ćwiczenia słówek, ćwiczenia lekcji i feedback korzystają z tych samych tokenów i komponentów co etap 1.
- Brak regresji zachowania: API, ocenianie, kolejność ujawnień, budżet zadań, ekspozycje, obsługa braku sieci i nagrywania pozostają bez zmian.

## 2. Zakres

W zakresie (jeden spec, jeden PR):

- ramka sesji: górny pasek, postęp, „Jeszcze N i koniec!”, miejsce odsłuchu instrukcji (`LearnScreen`, `SessionProgress`, `ExerciseInstruction`, `ExerciseFrame`),
- bodziec i odpowiedzi we wszystkich widokach `packages/kid-ui/src/exercises/` oraz `exercises/lesson/`,
- feedback: `ExerciseFeedbackDock`, `AnswerFeedback`, `SpeechFeedbackCard`, porównanie pisowni, świętowanie poprawnej odpowiedzi,
- teksty w `packages/contracts/src/messages.ts` tylko tam, gdzie wymaga tego układ (np. etykieta dostępności ✕).

Poza zakresem: potwierdzenie „Zakończ sesję”, ekrany wokół sesji (etap 1), zmiany kontraktów, API, MCP i skilla (zmiana jest wyłącznie prezentacyjna — brak wpływu na API → MCP → skill), jasny motyw, nowe ilustracje.

Obowiązują ustalenia etapu 1: tylko ciemny motyw, paleta z `scripts/kid-palette.mjs`, Fredoka (display) i Nunito (body), literały wyłącznie w bloku tokenów, Motion tylko na `transform` i `opacity`, `KidPage` jedynym miernikiem viewportu, cele dotykowe ≥48 px, główna akcja ≥54 px.

## 3. Ramka sesji

- **Tło** gładkie `surface`, bez `HeaderWave` i pasma — fala zostaje na ekranach wokół sesji.
- **Górny pasek** w jednym rzędzie, 56 px (48 px przy wysokości <480 px):
  - lewo: `IconActionButton` z ikoną `close` (48 px) zamiast obrysowanego przycisku tekstowego „Koniec”; `aria-label` i podpowiedź = `messages.kid.end`; zachowanie (`controller.endNow()`, `data-testid="kid-end"`, blokada przy `busy`) bez zmian,
  - środek: kamyki postępu,
  - prawo: status mikrofonu jak dziś.
- **Odsłuch instrukcji** wychodzi z paska. Dla zadania (`taskGuidanceKey`) przycisk stoi w wierszu instrukcji obok jej tekstu (48 px, tonalny) — `ExerciseInstruction` ma już do tego `audio`. Dla wyniku (`feedbackGuidanceKey`) przycisk stoi w panelu wyniku obok tytułu. `data-testid="kid-guidance-play"` i obsługa błędu odsłuchu zostają.
- **Kamyki** (`SessionProgress`): jeden kamyk = jedno oceniane zadanie, liczba = `progress.total` z `session-progress-state.ts` (te same dane co dzisiejszy pasek, bez nowych informacji o budżecie).
  - zrobione: wypełnione `primary`; bieżące: obrys `primary` i powiększenie przez `transform: scale`; przyszłe: `outline-variant`,
  - kamyk ma wysokość 8 px i elastyczną szerokość 5–16 px (odstęp 3 px), więc rząd wypełnia środek paska; kamyki pokazujemy dla `total` ≤ 20 (`PEBBLE_LIMIT`, równy domyślnemu budżetowi sesji `DEFAULT_TASK_BUDGET`), powyżej wskaźnik przechodzi w ciągły pasek (dzisiejszy `scaleX`); 20 kamyków mieści się przy szerokości 320 px (zob. §8),
  - kamyki są dekoracją (`aria-hidden`); dostępny tekst to etykieta „Jeszcze N”, jak dziś,
  - seria poprawnych: podskok i gwiazdka wychodząca z ostatniego wypełnionego kamyka (dzisiejsze `kidStreakJump`, `kid-streak-star`).
- **„Jeszcze N i koniec!”** to mała pigułka w tonie `warm` pod kamykami (obok nich przy wysokości <480 px). Reguła pokazywania bez zmian: `remainingFor` (od 3 zadań do końca, w kartkówce zawsze).

## 4. Instrukcja, bodziec, odpowiedzi

- **Instrukcja**: ikona i tekst jak dziś, plus przycisk odsłuchu z sekcji 3.
- **Bodziec** jest najjaśniejszy na ekranie:
  - słowo lub zdanie (`.kid-source`, słowo czytania, cel ekspozycji) w Fredoce, waga 700, kolor `on-surface`, rozmiar `clamp` w granicach tokenów `headline`–`display`; żaden bodziec nie używa `--kid-muted`,
  - obrazek z zaokrągleniem `--kid-shape-xl` (20 px), bez karty i ramki,
  - przycisk nagrania zadania: okrągły, tonalny, 64 px, bezpośrednio pod bodźcem (dziś samotnie w lewym dolnym rogu).
- **Pole wpisywania** (`AnswerField`, także pola lekcji i liter):
  - jedno źródło stylu w module komponentu; martwą regułę `.kid-written input` i jej `::placeholder` w `styles.css` usuwamy (dziś przegrywa specyficznością z `.kid-ui .input`, co daje `1rem`),
  - tekst: Fredoka, waga 600, `--kid-type-headline-sm-size`, `on-surface`, wyśrodkowany w polach jednowierszowych; długie odpowiedzi (`textarea`) wyrównane do początku, rozmiar `title-lg`,
  - tło `surface-container-highest`, obramowanie 2 px `outline`, fokus: pierścień 3 px `primary`; placeholder `on-surface-variant`,
  - wysokość ≥60 px dla pola jednowierszowego.
- **Odpowiedzi wyboru** (`AnswerGrid`, `WordChoiceButton`, przyciski lekcji):
  - wypełnione karty `surface-container-high` z obramowaniem 1 px `outline`, wysokość ≥56 px, tekst Fredoka 600 `title-md`,
  - siatka 2×2 na szerokości compact, gdy opcji jest 4 i każda ma ≤10 znaków (punktów kodowych), a etykiety nie łamią się w środku słowa; w przeciwnym razie kolumna (zob. §8); medium/expanded jak dziś,
  - stany oczekiwania, poprawnej i błędnej pozostają wyłącznie w `AnswerGrid`; poprawna i błędna dostają ikonę ✓/✕ obok koloru.
- **Akcje** bez zmian w hierarchii: „Sprawdź” wypełniony, „Nie pamiętam” tonalny, „Dalej”/„Pomiń” tekstowe.
- **Lekcje**: luki, kolejność bloków (`LessonBlockButton`), słowa kluczowe, skracanie, krótka odpowiedź i karta lekcji korzystają z tych samych kart, pola i typografii; dyktando (`useDictation`) bez zmian zachowania.

## 5. Feedback po odpowiedzi

- Panel wyniku (`ExerciseFeedbackDock`) wysuwa się w stopce jak dziś; zmienia się wygląd: górne rogi `--kid-shape-xxl` (24 px), tło w tonie wyniku, bez szarej ramki `--kid-line`.
- Tony (mapowanie `answerDockTone` bez zmian), każdy z ikoną w kółku 40 px:

  | Ton | Tło | Ikona |
  | --- | --- | --- |
  | `correct` | `--kid-color-success-container` | `check` |
  | `partial` | `--kid-color-warm-container` | `almost` (nowa ikona: falka „~”) |
  | `incorrect` | `error-container` | `close` |
  | `technical`, `neutral` | `surface-container-high` | `info` (nowa ikona: „i” w kółku) |

  Nowe ikony `almost` i `info` dopisujemy do `KidIconName` w `KidIcon.tsx` w tym samym stylu obrysu 24×24.

- Tytuł w Fredoce `headline-sm`; poprawna odpowiedź jako duże, pogrubione słowo `on-surface`; porównanie pisowni z literami w Fredoce, błędne miejsca podkreślone i w kolorze tonu (nie tylko kolorem).
- `SpeechFeedbackCard` dostaje ten sam układ i tony.
- Świętowanie bez nowych efektów: wybuch gwiazdek (`BurstParticles`) przy poprawnej odpowiedzi, ✓ na wybranej karcie, gwiazdka serii w kamykach.
- Jedna akcja główna („Dalej” / „Spróbuj jeszcze raz”, wypełniona) i opcjonalna tekstowa; tryb `compact` przy niskiej wysokości zostaje.

## 6. Weryfikacja

- Jednostkowe: `SessionProgress` (kamyki dla `total` ≤20, przejście w pasek, bieżący kamyk, etykieta „Jeszcze N”), `ExerciseFeedbackDock` (ikona i ton), `AnswerField` (klasa stylu); `tests/kid-design-tokens.test.ts` i `tests/kid-tokens.test.ts` bez wyjątków.
- Kontrast WCAG: tekst pola wpisywania na `surface-container-highest`, tytuł i odpowiedź na każdym tle tonu panelu, kamyk zrobiony vs tło (≥3:1) — test tokenów oraz rozszerzenie `kid-answer-contrast.spec.ts` o kolor i rozmiar tekstu w polu (≥24 px obliczonego `font-size`).
- Geometria Playwright w 360×800, 320×640, 844×390, 768×1024, 1280×800 (`tests/e2e/helpers/kid-layout.ts`): pasek w jednym rzędzie, kamyki w kolumnie `KidScreen`, brak przepełnienia poziomego, cele ≥48 px, siatka 2×2 bez wyjścia poza kolumnę, panel wyniku nie zasłania akcji; aktualizacja istniejących speców (`kid-responsive`, `kid-feedback-dock`, `kid-feedback-layout`, `kid-ui-layout`, `lesson-*-layout`) zamiast nowych duplikatów.
- Przed PR: `pnpm typecheck`, `pnpm test:unit`, `pnpm build`, `pnpm test:e2e:shards`; zrzuty ekranów sesji (wybór, pisanie, mowa, lekcja, każdy ton panelu) w 360×800 i 844×390.
- Brak odbioru na fizycznym urządzeniu raportujemy jawnie.

## 7. Ryzyka

- Przeniesienie odsłuchu z paska zmienia selektory w testach E2E (`kid-guidance-play`) — test ID zostaje, zmienia się tylko położenie.
- Siatka 2×2 przy długich słowach polskich: próg 10 znaków i powrót do kolumny; geometria sprawdza najdłuższe opcje fixture.
- Kamyki przy dużym `total` (kartkówki) — przejście w pasek; `total` może urosnąć w trakcie sesji (największe widziane `remainingAssessed`), kamyki wtedy przeliczają się bez animacji wymiarów.
- Duża liczba widoków lekcji — wspólne style kart i pola w komponentach, nie w każdym widoku osobno.

## 8. Ustalenia z implementacji (2026-10-29)

Rozstrzygnięcia podjęte podczas wykonania planu; zastępują odpowiednie fragmenty §3–§6.

- Górny pasek ma stałe 56 px (48 px przy bardzo niskim oknie) także wtedy, gdy widać „Jeszcze N i koniec!”: pigułka jest kompaktowa i mieści się w środkowej kolumnie pod kamykami. Nagłówek nie rośnie przy końcu sesji, a viewport testu stabilności układu pozostaje 360×500 — podniesienie go ukryłoby regresję, a nie ją naprawiło.
- `PEBBLE_LIMIT` wynosi 20 (domyślny budżet sesji), bez gęstego trybu 4 px; powyżej 20 wskaźnik przechodzi w ciągły pasek. Poprawia to §3: 24 kamyki przy 320 px nie mieszczą się (189 px wobec 168 px dostępnych przy minimalnej szerokości 5 px), więc budżety 21–24 pokazują pasek zamiast kamyków.
- Próg siatki 2×2 dla krótkich opcji to 10 punktów kodowych, nie 14 (poprawia §4), a etykiety w siatce nigdy nie łamią się w środku słowa (`overflow-wrap: normal`). 14 znaków Fredoki 600 `title-md` nie mieści się w ok. 120 px kolumny przy szerokości 320 px; opcje 11–14-znakowe używają kolumny.
- W siatce 2×2 znacznik wyniku (✓/✕) stoi w zarezerwowanym paśmie górnego dopełnienia karty (ok. 26 px u góry, 6 px u dołu przy karcie 56 px), więc nie nachodzi na etykietę, a wysokość karty nie zmienia się po ocenie. Skutek uboczny: etykieta w kartach siatki leży odrobinę niżej.
- Karty opcji mają 48 px (nie 56 px) przy wysokości okna poniżej 560 px: wymóg „treść i akcje osiągalne” z AGENTS.md wygrywa na niskich oknach, a 48 px to nadal minimum celu dotykowego.
- Obrazek bodźca nie ma ramki (3 px obramowanie usunięte); zachowuje zaokrąglenie `--kid-shape-xl` i tło-podkładkę (backdrop). Wiąże §4 „bez karty i ramki”; testy geometrii przechodzą bez luzowania.
- Tekst na tłach tonów panelu wyniku używa ról `on-*-container` (`on-success-container`, `on-warm-container`, `on-error-container`, a dla tonu neutralnego `on-surface` na `surface-container-high`), nie `on-surface`; kontrast tytułu i odpowiedzi na każdym tle ≥4,5:1 sprawdza `kid-feedback-dock.spec.ts`.
- Test ponawiania w `kid-ui-layout.spec.ts` zakładał niebieski panel sprzed etapu 2. Przepisano go na zatwierdzony projekt: ton `incorrect` to `error-container` z ikoną `close`, kontrast tytułu i odpowiedzi ≥4,5:1; asercje wyników opcji bez zmian. To była luka pokrycia po Zadaniu 5, wykryta przy Zadaniu 6.
- Źródło w ćwiczeniu lekcji (`.kid-source`) schodzi o jeden rozmiar typografii przy wysokości poniżej 480 px, żeby bodziec i pole mieściły się obok siebie w landscape telefonu.
- Przy niskim oknie górne dopełnienie ekranu zmniejszono z 12 do 4 px, żeby oddać wysokość treści i akcjom bez przycinania.
- Karta odsłonięcia odpowiedzi („Nie pamiętam”) zachowuje przycisk odsłuchu w wierszu instrukcji, nie w panelu wyniku: odsłonięcie nie jest feedbackiem po próbie, więc §3 (odsłuch przy tytule panelu) dotyczy tylko `feedbackGuidanceKey`.
- Test kontrastu przycisku audio sprawdza wariant tonalny zamiast wypełnionego, bo odsłuch w wierszu instrukcji jest tonalnym `IconActionButton`; asercje kolorów bez zmian.
- Zmiana jest wyłącznie prezentacyjna: bez wpływu na API, MCP i skill.
- Brak odbioru na fizycznym urządzeniu. Wszystkie sprawdzenia to symulacja w Chromium (Playwright, widoki 360×800, 320×640, 844×390, 768×1024, 1280×800) i nie zastępują testu na telefonie i tablecie.
