# Kid UI: panel wyniku — poprawki po PR #205

**Status:** zakres uzgodniony w rozmowie 2026-10-31 po scaleniu PR #205: trzy poprawki z listy „kandydaci na kolejne zadania” oraz próg korekty przewinięcia obniżony z 8 do 1 px (decyzja właściciela, spec #205 §7). Wersja 2 — po review trzech krytyków specu (mechanizm, UX na urządzeniach, testy) i poprawkach z review trzech krytyków planu (obserwacja ramy, odczyt odstępu, próg bramki, testy przejść). Uzupełnia `2026-10-31-kid-ui-large-screens-followups-design.md` („spec #205”) i `2026-10-30-kid-ui-large-screens-design.md` („spec #200”). Tam, gdzie się różnią, obowiązuje ten dokument.

## 1. Problem i kryteria

Pomiary z Playwright (Chromium, reduced motion, mysz, chyba że zaznaczono inaczej), zadanie pisemne:

1. **Długa podpowiedź pisowni jest ucinana mimo wolnego miejsca.**
   - Karta wyniku w panelu ma stały limit `min(36vh, 300px)` (`ExerciseFeedbackDock.module.css`).
   - Testowa podpowiedź (`longSpellingHintFeedback`) potrzebuje ok. 600 px wewnętrznych. Widać 292 px, a wiersz „Poprawnie” (drugi, ten, którego dziecko potrzebuje) znika pod przewijaniem wewnątrz karty.
   - W zwartej ramie z krótkim poleceniem („kot”) pod panelem zostaje wolne miejsce: 3440×1440 i 1920×1080 ok. 106 px wewnętrznych. Dotykowy tablet 1024×1366 ma ok. 400 px.
   - W zwykłej ramie na wysokim oknie w pionie (np. 820×1180) treść stoi na środku materiału, a pod nią też jest wolne miejsce.
2. **Telefon w poziomie i powiększenie gestem: panel wyniku w pierwszej kolumnie, pod pustym pasem.**
   - W trybie przewijanej strony (`data-viewport-very-short` albo `data-zoomed`) nakładka panelu ma `position: static` (`styles.css`), więc staje się zwykłym elementem kotwicy.
   - Przy `data-action-layout="inline"` kotwica jest siatką dwóch kolumn. Panel trafia do drugiego wiersza pierwszej kolumny (844×390: 299 z 528 px), a nad nim stoi wiersz pustych slotów akcji.
   - Przy układzie `stacked` puste sloty (54 + 48 px i odstępy) też stoją nad panelem.
3. **Pierwsza zakładka 1–8 px bez korekty** (spec #205 §7). Przewinięcie korygujące w `ExerciseFrame` działa od zakładki > 8 px wewnętrznych.
4. **Test „the top offset gives way before the material”** (`kid-large-screen.spec.ts`) zależy od łamania 70 słów polecenia. Przy innym łamaniu może przestać sprawdzać „odstęp ustępuje pierwszy”.

Kryteria sukcesu:

- **Karta wyniku zajmuje wolne miejsce pod odpowiedzią.** Dotyczy trybu `overlay`, poza trybem przewijanej strony.
  - Karta rośnie ponad dotychczasowy limit najwyżej do granicy, przy której:
    - panel kończy się co najmniej 12 px wewnętrznych nad dolną krawędzią ramy zadania;
    - panel nie zasłania treści materiału.
  - Dotychczasowy limit zostaje dolną granicą. Tam, gdzie wolnego miejsca jest mniej, zachowanie się nie zmienia.
  - Podpowiedź średniej długości (karta ok. 330–380 px wewnętrznych, nowa fixture) mieści się cała, z wierszem „Poprawnie”, bez przewijania w karcie na 3440×1440 i 3440×1300.
  - Długa podpowiedź mieści się cała na dotykowym tablecie 1024×1366, także gdy przed werdyktem była otwarta klawiatura (okno niższe), a po werdykcie się zamknęła.
  - W zwartej ramie odpowiedzi, instrukcja i odstęp od góry nie przesuwają się w chwili werdyktu (± 1 px), a materiał nie zaczyna się przewijać.
  - Akcja panelu („Dalej”) zostaje w ramie zadania.
- **W trybie przewijanej strony panel zastępuje akcje.**
  - Panel stoi tam, gdzie stały akcje (górna krawędź = górna krawędź slotu akcji przed werdyktem, ± 1 px).
  - Ma szerokość stopki.
  - Puste sloty nie zajmują miejsca.
  - Pole odpowiedzi się nie przesuwa.
  - Dotyczy układu `inline` i `stacked`, telefonu w poziomie i powiększenia gestem.
- **Zakładka ≥ 1 px ekranu jest korygowana przewinięciem.** Po ustaleniu zakładka ≤ 1 px ekranu. W każdej malowanej klatce zakładka ≤ 2 px ekranu (dotąd 8 × skala + 1).
- **Test odstępu jest deterministyczny.** Nie zależy od łamania tekstu.
- Bez regresji: `pnpm typecheck`, `pnpm test:unit`, pełne `pnpm test:e2e:shards` (w tym projekt `real`).

## 2. Zakres

Wyłącznie `packages/kid-ui`, testy i dokumentacja. Bez zmian Kid API, DTO, kontraktów, serwera, MCP i `SKILL.md`. Jeden PR.

Poza zakresem, raportowane w PR jako kandydaci:

- Mniejsza czcionka wierszy podpowiedzi pisowni dla zdań (dziś `--kid-type-display-sm-size` jak dla pojedynczego słowa). Skróciłaby długą podpowiedź o ok. 1/3, także na telefonie, ale to decyzja wizualna właściciela.
- Wskazówka, że karta przewija się dalej (np. gradient u dołu). Długa podpowiedź na telefonie i 34" nadal się przewija.
- Brak limitu karty w trybie przewijanej strony. Dziś karta ma tam 36vh (ok. 140 px przy 844×390). Bez limitu „Dalej” wypadałby poza ekran przy długiej podpowiedzi.
- Cofanie przewinięcia korygującego, gdy po zamknięciu klawiatury treść znów się mieści.
- Przeliczenie `REAL_BUCKETS` (osobny PR).

## 3. Zachowanie i mechanizm

### 3.1 Karta wyniku rośnie w wolne miejsce

**Właściciele:**

- czysta funkcja `feedbackCardMax` w nowym `packages/kid-ui/src/exercises/feedback-card-space.ts`;
- pomiar i zmienna CSS w `ExerciseFrame`;
- użycie zmiennej w `ExerciseFeedbackDock.module.css`.

**Geometria niezależna od samego panelu.** Wszystkie wartości są w px wewnętrznych, względem górnej krawędzi `.kid-exercise-frame`, prostokąty przeliczone przez `toLayoutPx(…, material)`.

- `contentBottom0 = contentBottom + material.scrollTop + offsetGiven`, gdzie:
  - `contentBottom` to maksimum dolnych krawędzi dzieci `.kid-material-content`, jak w obecnym pomiarze;
  - `offsetGiven = max(0, fullOffset − currentOffset)`;
  - `fullOffset` to podstawa elementu-odstępu: `parseFloat(getComputedStyle(frame, "::before").flexBasis) || 0`. Element ma ją tylko w zwartej ramie poza wyborem obrazków; gdzie indziej jest `auto`, czyli 0;
  - `currentOffset` to górna krawędź pierwszego dziecka ramy (`.kid-exercise-instruction`) − górna krawędź ramy.
- Dlaczego to nie zależy od panelu:
  - Rezerwa nie przesuwa treści. W zwykłej ramie obszar zawartości `.materialContent` przy rezerwie to nadal `100% − 8`. W zwartej ramie treść ma wysokość własną.
  - Przewinięcie korygujące znosi `scrollTop`.
  - Ustąpienie odstępu od góry znosi `offsetGiven`.
  - Ponowny pomiar nie powiększa więc karty w pętli.
- `available = frameHeight − contentBottom0 − 24`. 24 to:
  - padding treści 4;
  - odstęp ramy 8;
  - górny padding stopki 8;
  - dolny padding stopki 4.

  W zwartej ramie panel zaczyna się wtedy 20 px pod treścią, a w zwykłej ramie 20 px to wybrany odstęp. Założenia: rama nie ma dolnego paddingu ani obramowania, a ostatnie dziecko treści nie ma dolnego marginesu.
- `overhead = overlayHeight − card.offsetHeight`:
  - `overlayHeight` to wysokość prostokąta nakładki / zoom (ułamkowa). Nakładka nie ma transformacji; animacja wejścia działa na wewnętrznym `m.div`.
  - `card` to `.kid-answer-feedback` albo `.kid-speech-feedback` w nakładce. Jego `offsetHeight` nie zależy od transformacji animacji.
  - Gdy karta jest niższa od wiersza z odznaką, `overhead` jest górnym ograniczeniem, co jest nieszkodliwe: limit działa tylko na kartę, która jest najwyższym elementem wiersza.
- `cardMax = floor(available − 8 − overhead)`. 8 to zapas na zaokrąglenia, a panel nie styka się z dolną krawędzią ramy.
- Funkcja zwraca `null`, gdy `cardMax ≤ 0`.

**Kiedy liczyć.** Raz na klucz `(węzeł nakładki, frame.offsetWidth × frame.offsetHeight, round(contentBottom0), overlay.offsetHeight − card.offsetHeight)`, a w trybie przewijanej strony — stały klucz bez zmiennej. Zatrzask to `useRef` obok `gatedDockRef`. `contentBottom0` (z `fullOffset`) nie zależy od panelu, więc jest w kluczu bezpiecznie: zmiana treści po werdykcie (poprawka z review gałęzi) przelicza limit, a wzrost samej karty nie.

- Przy zmianie klucza wartość jest liczona od nowa z bieżącej geometrii, w tym samym pomiarze, przed odczytem `excess` i zakładki. Klucz zmienia się przy pierwszym pomiarze panelu, przy zmianie okna, klawiatury, obrotu, komunikatu zmieniającego wysokość ramy, przy przejściu między ramą zwartą a zwykłą oraz przy zmianie struktury panelu.
- `ResizeObserver` pomiaru obserwuje także samą ramę (`.kid-exercise-frame`). W zwartej ramie zmiana jej wysokości nie zmienia materiału, treści ani stopki: zmienia się tylko odstęp od góry albo wolne miejsce pod stopką. Bez obserwacji ramy klucz nie byłby sprawdzany, a ustępujący odstęp przesunąłby odpowiedzi.
- `overhead` jest stały, gdy karta rośnie (karta jest wtedy najwyższym elementem wiersza), więc nie powoduje przeliczeń w pętli.
- W trybie przewijanej strony zmiennej nie ma. Tryb pomiar czyta z `overlay.closest(".kid-page")`.
- Zatrzask resetuje się tam, gdzie `gatedDockRef` (gałąź `!hasDock || flowFeedback`). Zmienna nie jest wtedy usuwana: wychodzący panel zachowuje rozmiar do końca animacji.
- `AnimatePresence` może ożywić ten sam węzeł nakładki przy nowym werdykcie w trakcie wyjścia poprzedniego. Zresetowany zatrzask liczy wtedy wartość od nowa i ją nadpisuje.
- Gdy rama się przepełnia (`frame.scrollHeight > frame.clientHeight + 1`, tryb komunikatu z przewijaną ramą), zmiennej nie ma.

**Zapis.**

- `overlay.style.setProperty("--kid-feedback-card-max", "<cardMax>px")`, albo `removeProperty`, gdy `null`.
- Zapis następuje przed malowaniem: w efekcie layoutu albo w callbacku `ResizeObserver` lub `requestAnimationFrame`. Pierwsza malowana klatka ma już kartę docelowej wysokości.

**CSS.** `max-height: max(min(calc(36 * var(--kid-vh)), 300px), var(--kid-feedback-card-max, 0px))` dla `.kid-answer-feedback` i `.kid-speech-feedback` w panelu (obie reguły).

**Skutek:**

- **Zwarta rama.** Gdy panel jest wyższy od kotwicy o więcej niż 20 px, włącza się bramka rezerwy. Rezerwa przesuwa stopkę w dół o nadwyżkę panelu. Panel kończy się co najmniej 12 px nad dolną krawędzią ramy, więc odstęp od góry nie ustępuje.
- **Zwykła rama.** Górna krawędź panelu zostaje co najmniej 28 px pod treścią. Zakładki nie ma i rezerwa się nie włącza.
- **Brak wolnego miejsca.** Gdy go nie ma (laptop, telefon, długie polecenie), działa dotychczasowy limit i dotychczasowa ścieżka rezerwy i korekty.

### 3.2 Panel w trybie przewijanej strony zastępuje akcje

W `ExerciseFrame.module.css`, przy `.kid-page[data-zoomed="true"]` i `.kid-page[data-viewport-very-short="true"]`:

- Puste sloty kotwicy (`.dockAnchor > :not(.dockOverlay)`) mają `display: none`.
- Nakładka ma `grid-column: 1 / -1`.

Pomiar rezerwy daje tu 0 jak dotąd, bo nakładka jest w przepływie. Odsłonięcie panelu (`scheduleFeedbackDockReveal`, `scrollIntoView({ block: "end" })`) zostaje bez zmian.

Zmiana widoczna przy ponownej próbie w tym trybie: wychodzący panel przez czas animacji leży nad powracającymi akcjami, a nie pod nimi. Kliknięć nie przechwytuje (`pointer-events: none`, spec #205).

### 3.3 Próg korekty: 1 px ekranu

W `ExerciseFrame`:

- Górna krawędź panelu jest ułamkowa: `toLayoutPx(overlay.getBoundingClientRect().top, material)`. Nakładka nie ma transformacji, więc to ta sama wartość co dotychczasowe `anchor.bottom − offsetHeight`, ale bez zaokrąglenia `offsetHeight`.
- Korekta następuje, gdy `overlap × zoom ≥ 1`, czyli gdy zakładka ma co najmniej 1 px ekranu. Dotąd było `overlap > 8` w px wewnętrznych.
- Ten sam próg włącza bramkę rezerwy (dotąd `overlap > 0`). Zakładka poniżej 1 px ekranu nie dokłada zakresu przewijania, którego nic by nie wykorzystało.
- Przewinięcie zostaje `overlap + 8`. Po korekcie treść kończy się 8 px nad panelem, a przy końcu zakresu przewijania 20 px. Kolejne pomiary nie dokładają przewinięcia, bo zakładka jest ujemna, a klucz korekty pomija ponowny pomiar przy tym samym rozmiarze.

Skutek: w zwykłej ramie przy pierwszej zakładce 1–8 px pole odpowiedzi przesuwa się w górę o 9–16 px. Zależy to od urządzenia, rodzaju zadania i wyniku, bo panel błędu jest zwykle wyższy niż panel sukcesu. To świadoma decyzja właściciela.

### 3.4 Deterministyczny test odstępu

Test „the top offset gives way before the material”, 3440×1440, mysz, krótkie polecenie, po `document.fonts.ready` i `nextFrames`:

1. Warunek wstępny: pełny odstęp, `frameTopOffset` = 90 × skala (± 2).
2. `free = (frameRect.bottom − actionsRect.bottom) / zoom` (px wewnętrzne). Warunek wstępny: `free > 50`.
3. Styl testowy: `.kid-material-content { padding-block-end: calc(4px + <free + 45>px) !important }`.
4. Oczekiwane: `|offsetAfter − (offsetBefore − 45 × skala)| ≤ 2 × skala` i `material.scrollHeight === material.clientHeight`.
5. Drugi punkt: `free + 90 + 30` → odstęp ≤ 1 px i `scrollHeight − clientHeight = 30 ± 1`. Dowodzi kolejności: najpierw odstęp, potem materiał.

`OFFSET_TAKING_PROMPT` i komentarz o 12 wierszach znikają.

## 4. Pliki

- `packages/kid-ui/src/exercises/feedback-card-space.ts` (nowy) i `feedback-card-space.test.ts`: czysta funkcja i test jednostkowy.
- `packages/kid-ui/src/exercises/ExerciseFrame.tsx`:
  - pomiar geometrii, zatrzask, zmienna na nakładce;
  - ułamkowa górna krawędź panelu;
  - próg 1 px ekranu;
  - komentarze.
- `packages/kid-ui/src/exercises/ExerciseFrame.module.css`: panel zastępujący akcje w trybie przewijanej strony.
- `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css`: `max(...)` z `--kid-feedback-card-max` w obu regułach.
- `tests/e2e/helpers/kid-fixtures.ts`: podpowiedź średniej długości.
- `tests/e2e/helpers/kid-frame.ts`: opcja sondy klatek zapisująca wysokość karty w pierwszej próbce. Granice sondy są w `expectPanelNeverCovers` (`kid-large-screen.spec.ts`).
- `tests/e2e/kid-large-screen.spec.ts`: nowe testy (tabele), deterministyczny test odstępu, komentarze progu.
- `docs/folder-structure.md`, jeśli wymienia pliki `exercises/`.

## 5. Testy

E2E najpierw na czerwono, potem na zielono. Nowe testy należą do projektu `mocked` (`kid-large-screen.spec.ts`), jako tabele przypadków z jednym ciałem testu (bramka duplikacji SonarCloud). „Dotykowo” = `isMobile: true, hasTouch: true` (skala 1, bez odstępu); „mysz” = kontekst domyślny.

**Jednostkowe (`feedback-card-space.test.ts`):**

- wzór z §3.1;
- `null` przy `cardMax ≤ 0`;
- `offsetGiven` i `scrollTop` znoszą przesunięcie treści, czyli ta sama wartość przed i po korekcie lub ustąpieniu odstępu;
- zaokrąglenie w dół.

**Karta w wolnym miejscu (§3.1).** Zadanie pisemne z krótkim poleceniem („kot”) we wszystkich wierszach, także w strażnikach i przejściach. „Długa podpowiedź” = `longSpellingHintFeedback` z krótkim poleceniem, nie `longSpellingHintFixture()` (ta ma długie polecenie). Komunikat statusu sesji pusty (warunek wstępny). „Średnia podpowiedź” to nowa fixture: każdy wiersz (twój zapis, poprawnie) składa się z trzech segmentów po ok. 18–20 znaków. Każdy segment mieści się w jednym wierszu, a dwa nie mieszczą się obok siebie, więc wiersz ma dokładnie 3 linie. Warunki wstępne: naturalna wysokość karty > 300 i < (`cardMax` policzony w teście z geometrii przed werdyktem) − 10.

| Okno | Fixture | Warunki wstępne | Oczekiwane |
| --- | --- | --- | --- |
| 3440×1440 mysz | średnia podpowiedź | naturalna wysokość treści karty > 300 px | Cała karta bez przewijania; pole odpowiedzi i instrukcja ± 1; odstęp bez zmian; materiał bez przewijania; „Dalej” w ramie. Sonda pierwszej klatki: wysokość karty w pierwszej próbce = po ustaleniu ± 1 i > 300 |
| 3440×1300 mysz (1,44) | średnia podpowiedź | jw. | jw. |
| 3440×1440 mysz | długa podpowiedź | po werdykcie treść karty nadal się przewija (karta ograniczona miejscem) | Dolna krawędź panelu = dolna krawędź ramy − 12 px wewnętrznych (± 2); pole odpowiedzi ± 1; odstęp bez zmian |
| 1024×1366 dotykowo | długa podpowiedź | treść karty > 300 px | Cała karta bez przewijania; pole odpowiedzi ± 1; materiał bez przewijania |
| 1024×1366 dotykowo, przed werdyktem 1024×700 („klawiatura”), po werdykcie z powrotem 1024×1366 | długa podpowiedź | rama zmieniła wysokość | Po powrocie cała karta bez przewijania; sonda klatek przez cały przebieg: treść nigdy pod panelem |
| 820×1180 mysz (zwykła rama) | długa podpowiedź | karta ograniczona miejscem | Karta > 320 px; górna krawędź panelu − treść ∈ [26, 32] px wewnętrznych; rezerwa 0 |
| 1024×1366 dotykowo | tekst z lukami z podpowiedzią lekcji (`clozeHintFixture`) | treść karty > 300 px | Karta urosła (> 300) i jest w ramie; treść nigdy pod panelem |

Strażnicy:

- **1536×730.** Zmienna ustawiona (> 0), karta = dotychczasowy limit (36vh, ± 1). Pokrywa gałąź `max()`.
- **3440×1440 z `LONG_RECALL_PROMPT`.** Istniejący test „overlay dock reserve is exact” przechodzi bez zmian.

Przejścia przy widocznym panelu:

- **Małe zmniejszenie 840×1000 → 840×960** (mysz, skala 1, zwarta rama; zmiana mniejsza niż odstęp od góry). Bez obserwacji ramy nic by nie przeliczyło karty, a odstęp by ustąpił. Warunek wstępny: zmienna > 300 w obu oknach. Oczekiwane: zmienna niższa o ok. 40 px, odstęp od góry nadal 90 (± 2), pole odpowiedzi względem ramy ± 1.
- **Dalej → 840×800.** Zmienna przeliczona (niższa), sonda klatek: treść nigdy pod panelem, panel w ramie.
- **Deterministyczny wzrost 1024×900 → 1024×1366 dotykowo.** Limit CSS jest w obu oknach 300 px, więc karta może urosnąć tylko przez przeliczenie po zmianie ramy. Oczekiwane: przy 900 karta ograniczona miejscem (> 300); po zmianie cała karta bez przewijania.
- Wiersz „klawiatura” sprawdza dodatkowo, że wartość zmiennej się zmieniła.
- **Powiększenie gestem przy powiększonej karcie** (3440×1440, długa podpowiedź). Oczekiwane:
  - zmiennej nie ma;
  - karta = limit (± 1);
  - panel na szerokość stopki;
  - sloty bez prostokąta;
  - odsłonięcie wykonane raz.

**Panel w trybie przewijanej strony (§3.2).**

| Okno | Fixture | Oczekiwane |
| --- | --- | --- |
| 844×390 i 667×375 | zadanie pisemne (`inline`), błędny werdykt | Górna krawędź panelu = górna krawędź `kid-primary-slot` przed werdyktem (± 1); szerokość panelu = szerokość treści `.kid-exercise-actions` (± 1); `kid-primary-slot` i `kid-secondary-slot` w kotwicy bez prostokąta (`boundingBox() === null`); pole odpowiedzi ± 1 |
| 812×375 | tekst z lukami (`stacked`, „Sprawdź”) | jw. |

Wszystkie są czerwone przed zmianą (szerokość albo położenie panelu). Położenia są mierzone względem górnej krawędzi ramy zadania (`[data-testid='kid-exercise']`): odsłonięcie panelu (`scrollIntoView`) przewija stronę, więc prostokąty względem okna przesuwają się o wielkość przewinięcia.

**Próg 1 px (§3.3).** Zwykła rama 1280×600, krótkie polecenie, werdykt `great`:

1. Przed werdyktem: `contentBottom` i `footerTop` (górna krawędź `.kid-exercise-actions`). Warunek wstępny: wiersz akcji ma 54 px.
2. `X = footerTop + 8 − contentBottom + 5`. Styl testowy `.kid-feedback-overlay { height: calc(100% + Xpx) }`, zakładka 5 px.
3. Sonda, wysłanie, `settledDockReserve`.
4. Oczekiwane: rezerwa > 0, `scrollTop = 13 ± 1`, treść nigdy pod panelem. Przed zmianą `scrollTop = 0`, więc test jest czerwony.

**Granice sondy** (`expectPanelNeverCovers` w `kid-large-screen.spec.ts`): każda próbka ≤ 2 px ekranu, po ustaleniu ≤ 1 px ekranu. Przebieg obciążeniowy testów z sondą na buildzie produkcyjnym (`--repeat-each=15`, projekt `mocked`) po zmianach w `ExerciseFrame`. Po zmianie progu cały projekt `mocked` od razu, bo próg zmienia zachowanie zwykłej ramy także poza tym plikiem.

**Odstęp (§3.4)** jak wyżej.

Istniejące testy z ryzykiem (sprawdzone pełnym przebiegiem, projekt `real` łapią tylko shardy):

- `speech-recording-ux.spec.ts` (karta mowy ma się przewijać przy 1280×720);
- `kid-flow.spec.ts` (długi transkrypt przy 360×640);
- `lesson-sentence-audio.spec.ts` (768×1024 i 812×375 / 740×420);
- `kid-feedback-dock.spec.ts` (844×390, 640×360, ręczne `data-zoomed`);
- `kid-large-screen.spec.ts` (rogi panelu przy 844×390 i 1366×470).

Komentarze o progu 8 px w testach i kodzie są aktualizowane.

**Przed PR:** `pnpm typecheck`, `pnpm test:unit`, pełne `pnpm test:e2e:shards` na buildzie produkcyjnym.

**Niezweryfikowane, raportowane jawnie:**

- fizyczne urządzenia: 34", tablet z prawdziwą klawiaturą, telefon w poziomie;
- animacje Motion;
- karta mowy z długą treścią: ta sama reguła CSS i ten sam selektor, ale bez testu E2E z długim wynikiem mowy.

## 6. Dokumentacja

- Ten dokument.
- Spec #205 §7: adnotacja, że pierwsza zakładka 1–8 px jest rozwiązana tutaj.
- `AGENTS.md`, sekcja Kid UI, punkt o dużym oknie:
  - karta wyniku rośnie w wolne miejsce (`--kid-feedback-card-max`, ustawia `ExerciseFrame`, czysta funkcja `feedbackCardMax`), z dotychczasowym limitem jako dolną granicą, poza trybem przewijanej strony;
  - w trybie przewijanej strony panel zastępuje akcje;
  - korekta przewinięcia od 1 px ekranu.
- `AGENTS.md`, sekcja Running and verifying: liczby testów po pełnym przebiegu.

## 7. Ryzyka i przyjęte kompromisy

- **Stała `24` w kodzie powtarza paddingi z CSS.** Zmiana paddingów stopki albo odstępu ramy bez zmiany stałej przesunie granicę panelu o kilka px. Wykryją to testy „pole odpowiedzi ± 1” i „panel 12 px nad ramą”.
- **Zmiana treści albo struktury panelu po pojawieniu się** przelicza wartość: w kluczu są też dolna krawędź treści bez wpływu panelu i reszta panelu poza kartą (poprawka z review gałęzi). Treść absolutnie pozycjonowana tego nie zmienia (niżej).
- **Karta rośnie po zamknięciu klawiatury** (nowy klucz). Zmiana wysokości następuje razem z dużą zmianą układu po zamknięciu klawiatury.
- **Duży panel na wysokim tablecie** zakrywa puste miejsce materiału, nigdy treść. Położenie „Dalej” różni się między zadaniami bardziej niż dziś.
- **Elementy absolutnie pozycjonowane w treści** (np. dymki) nie liczą się do `contentBottom`, jak dotąd.
- **Próg 1 px:** w zwykłej ramie błędne odpowiedzi mogą przesuwać pole o 9–16 px, poprawne nie (§3.3).
