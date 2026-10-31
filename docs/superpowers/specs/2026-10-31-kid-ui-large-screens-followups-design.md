# Kid UI na dużych ekranach — poprawki po PR #200

**Status:** projekt uzgodniony w rozmowie 2026-10-31. Właściciel wybrał stały odstęp od góry dla zwartego układu na wysokim oknie (zamiast wyśrodkowania), zaakceptował projekt i poprosił o PR po review trzech niezależnych krytyków (spec, plan, gałąź). Uzupełnia `2026-10-30-kid-ui-large-screens-design.md` (dalej: „spec #200”); tam, gdzie się różnią, obowiązuje ten dokument.

## 1. Problem i kryteria

Po PR #200 zostały znane ograniczenia (spec #200 §2, §7 i raport PR):

1. **Kafelki obrazków kurczą się w chwili werdyktu**, gdy ich rozmiar ogranicza wysokość materiału — np. laptop 1536×730 (Windows 125%): ok. 258 → 220 px. Przyczyna: w ramie `flow` zadań z obrazkami stopka przed werdyktem jest pusta (`.actions:empty { display: none }`), a panel wyniku zajmuje ją dopiero po werdykcie; materiał traci jego wysokość, a kafelki liczą rozmiar z `100cqh`. To samo dzieje się na 3440×1440, gdy widać komunikat „audio niedostępne” (pasek statusu zabiera ok. 87 px wewnętrznych i limit 300 px przestaje wystarczać).
2. **Panel wyniku może przez klatkę zasłonić treść.** Rezerwa pod panelem w trybie `overlay` (`dockPad` w `ExerciseFrame`) jest liczona w `useEffect`, czyli po pierwszym malowaniu; werdykt przychodzi z sieci, więc React nie wykonuje efektu przed malowaniem. Dotyczy zwartego układu na 34" i każdego ekranu z trybem `overlay`.
3. **Rezerwa nie wydłuża przewijania, gdy materiał już się przewija.** `.materialContent` ma `flex: 1` (podstawa 0) i jawne `min-height`, więc nie rośnie razem z dziećmi wystającymi poza nią; padding rezerwy zostaje wewnątrz pudełka, a zakres przewijania kończy się na dzieciach — panel zasłania koniec treści (poza zwartym układem). Zmiana na `flex: 1 0 auto` na stałe psuła `kid-responsive.spec.ts` (karta słowa na telefonie), dlatego wtedy ją cofnięto.
4. **Na 34" odpowiedź pisemna, litery i mowa zajmują górną połowę ekranu** — zwarty układ (spec #200 §3.2) stawia instrukcję, materiał i stopkę u góry, a 40–60% wysokości pod nimi jest puste.
5. **Tablet z Androidem w poziomie traci zwarty układ przy otwartej klawiaturze.** `interactiveWidget: "resizes-content"` zmniejsza okno poniżej 781 px, warunek zwartego układu przestaje pasować i pole odpowiedzi przeskakuje w trakcie pisania.
6. **Tekst z lukami nie ma limitu długości wiersza** (karty lekcji mają `60ch`, spec #200 §3.1).

Kryteria sukcesu:

- Kafelki obrazków i obrazek-pytanie „Co to jest?” mają ten sam rozmiar i położenie (± 1 px) przed werdyktem i po nim — dla werdyktu poprawnego i błędnego, na oknach 1536×730, 1280×600, 390×750, 360×640 i 3440×1440 (także z widocznym komunikatem audio).
- Panel wyniku nie zachodzi na treść materiału w żadnej malowanej klatce (sprawdzane w pierwszym callbacku `MutationObserver` po wstawieniu panelu — przed malowaniem).
- Gdy materiał przewija się już przed werdyktem, po werdykcie koniec treści da się przewinąć ponad górną krawędź panelu (także poza zwartym układem).
- W zwartym układzie (poza wyborem obrazków) nad instrukcją jest stały odstęp 90 px wewnętrznych (na 34" pełny ekran: 144 px ekranu); odpowiedzi nadal nie przesuwają się w chwili werdyktu.
- Dotykowy tablet w poziomie (≥ 960 px szerokości) zachowuje zwarty układ po otwarciu klawiatury, dopóki wysokość okna ≥ 480 px.
- Tekst z lukami ma wiersz nie szerszy niż `60ch` swojej czcionki.
- Bez regresji: wszystkie testy jednostkowe i pełne `pnpm test:e2e:shards`.

## 2. Zakres

Wyłącznie `packages/kid-ui`, testy i dokumentacja. Bez zmian Kid API, DTO, kontraktów, bazy, serwera, panelu rodzica, MCP i `SKILL.md`. Jeden PR.

Do tego długi w testach z raportu PR #200 (§5.2). Poza zakresem: pozostałe drobne uwagi krytyków #200 (m.in. `:not()` w regule zwartej nakładki, warunek „≥ 2 wiersze” na telefonie, testy klawiatury zależne od głębokości JSX, długość punktu w `AGENTS.md`), pierwsze malowanie w skali 1 przy pełnym załadowaniu strony (spec #200 §4.1) oraz zmiana zachowania, gdy sam komunikat audio pojawia się w trakcie zadania — robi wtedy miejsce kosztem materiału, zgodnie z decyzją z PR #145 (komunikat z przyciskiem nie może zasłaniać odpowiedzi).

## 3. Zachowanie i mechanizm

### 3.1 Stała rezerwa stopki w zadaniach z obrazkami

- Nowy token w bloku tokenów `styles.css`: `--kid-picture-dock-space` — wysokość stopki ramy (`.actions`, `box-sizing: border-box`, z paddingiem 8 + 4 px) z panelem wyniku `compact` z jednowierszowym komunikatem. Dwie wartości: domyślna (okno < 600 px — panel w dwóch wierszach: treść nad szeroką akcją) i od `(min-width: 600px)` (panel w jednym wierszu: treść obok akcji). Wartości wynikają z pomiaru prawdziwego panelu dla werdyktu poprawnego i błędnego (zaokrąglone w górę do pełnego piksela); komentarz przy tokenie podaje skład (np. akcja 54 + padding panelu 2 × 10 + padding stopki 12).
- W ramie `flow` z `data-prompt-kind` `picture_listening` lub `picture_recognition` stopka ma `min-height: var(--kid-picture-dock-space)` i nie jest ukrywana, gdy jest pusta. Panel wyniku pojawia się w zarezerwowanym miejscu (u góry stopki), więc wiersz materiału ma tę samą wysokość przed werdyktem i po nim, a kafelki (`100cqh`) oraz obrazek-pytanie (`38cqh`) nie zmieniają rozmiaru. Panel wyższy niż rezerwa (dłuższy komunikat) zmniejsza je tylko o nadwyżkę.
- Wyjątek: przy powiększeniu gestem (`data-zoomed="true"`) i w bardzo niskim oknie (`data-viewport-very-short="true"`) strona przewija się w całości, materiał nie ma określonej wysokości (`container-type: inline-size`), więc rezerwy nie ma — pusta stopka jest ukryta jak dziś.
- Skutek: przed werdyktem kafelki ograniczone wysokością mają od razu rozmiar „po werdykcie” (laptop 1536×730: ok. 220 px przez całe zadanie), a pod nimi stoi puste miejsce na panel. Kafelki ograniczone szerokością (telefon w pionie, tablet, 34" z limitem 300 px) nie zmieniają się. Kryterium spec #200 (odstęp kafelki → panel ≤ 15% wysokości okna na 3440×1300 i 3440×1440) obowiązuje dalej.

### 3.2 Rezerwa liczona przed malowaniem

- Pomiar rezerwy (`measure` w `ExerciseFrame`) i ponowny pomiar po zmianie `dockPad` działają w izomorficznym efekcie layoutu (ten sam helper co w `layout/viewport.ts`, wydzielony do współdzielonego modułu w `layout/`). `setDockPad` w efekcie layoutu powoduje synchroniczny ponowny render przed malowaniem, a ponowny pomiar po zmianie `dockPad` (też efekt layoutu, wywołanie synchroniczne) wykonuje korektę przewinięcia, gdy zakres przewijania już istnieje. Ponowny pomiar w `requestAnimationFrame` i `ResizeObserver` zostają jako zabezpieczenie (np. dla czcionek i obrazków dociąganych później).
- Efekt odsłonięcia panelu (`scheduleFeedbackDockReveal`) zostaje w `useEffect` — przewija stronę dopiero po ułożeniu.
- Pomiar prostokątów pozostaje w jednostkach z spec #200 §4.4 (`toLayoutPx`).

### 3.3 Rezerwa wydłuża przewijanie przewijanego materiału

- Gdy rezerwa jest aktywna (`dockPad > 0`), `.materialContent` dostaje atrybut `data-dock-reserve` i regułę `flex: 1 0 auto` — pudełko rośnie razem z dziećmi, a padding rezerwy leży pod ostatnim z nich. Bez rezerwy zostaje `flex: 1` (zachowanie, na którym opiera się karta słowa na telefonie).
- Zwarty układ już dziś ma `flex: none` (spec #200 §3.2) — bez zmian.

### 3.4 Odstęp od góry w zwartym układzie

- Nowy token `--kid-compact-frame-offset: 90px` (10% wysokości projektowej 900 px wewnętrznych). W regule zwartego układu (§3.5) rama zadania poza wyborem obrazków dostaje `padding-top: var(--kid-compact-frame-offset)`.
- Stałe piksele wewnętrzne, nie jednostki okna: otwarta klawiatura tabletu (§3.5) nie przesuwa wtedy treści, a pod `zoom` odstęp rośnie ze skalą jak reszta interfejsu (3440×1440: 144 px ekranu; 1920×1080: 108; tablet 1366×1024: 90).
- Przy treści dłuższej niż okno odstęp zostaje, a materiał przewija się o 90 px wcześniej (przyjęte).

### 3.5 Warunek zwartego układu

`@media (min-width: 840px) and (min-height: 781px), (min-width: 960px) and (min-height: 480px) and (pointer: coarse)` — w `ExerciseFrame.module.css` i `ExerciseFeedbackDock.module.css` (zaokrąglony panel). Druga gałąź działa jak gałąź „≥ 960” kolumny 720 px (spec #200 §3.1): dotykowy tablet w poziomie (≥ 1024 px szerokości) zachowuje zwarty układ, gdy klawiatura obniża okno. Telefony w poziomie (≤ 932 px) gałęzi nie spełniają. Próg 480 trzyma zwarty układ z dala od trybu bardzo niskiego okna (`≤ 479`, przewijana strona).

Skutek uboczny (przyjęty): dotykowy tablet o szerokości ≥ 960 i wysokości 480–780 px dostaje zwarty układ także bez klawiatury (dotąd zwykły). Reguły niskiego okna (`max-height: 780px` / `560px`) zmniejszają wtedy tylko wysokości opcji i odstępy, co nie koliduje z siatką zwartego układu.

### 3.6 Tekst z lukami

`.kid-lesson-cloze__text` dostaje `max-inline-size: 60ch` (wyrównanie bez zmian). Przy czcionce `--kid-type-title-size` limit może być bliski szerokości materiału kolumny 720 px — implementacja mierzy szerokość wiersza przed i po; jeśli reguła nic nie zmienia, test i tak pilnuje limitu, a raport PR podaje to wprost.

## 4. Pliki

- `packages/kid-ui/src/styles.css` — tokeny `--kid-picture-dock-space`, `--kid-compact-frame-offset`; `max-inline-size` tekstu z lukami.
- `packages/kid-ui/src/exercises/ExerciseFrame.module.css` — rezerwa stopki zadań z obrazkami, `[data-dock-reserve]`, odstęp i nowy warunek zwartego układu.
- `packages/kid-ui/src/exercises/ExerciseFrame.tsx` — efekty layoutu, atrybut `data-dock-reserve`, komentarze.
- `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css` — nowy warunek zwartego układu.
- `packages/kid-ui/src/layout/` — współdzielony izomorficzny efekt layoutu (używany przez `viewport.ts` i `ExerciseFrame`).

## 5. Testy

### 5.1 Nowe zachowanie (E2E najpierw na czerwono, potem zielono)

W `tests/e2e/kid-large-screen.spec.ts` (projekt `mocked`) lub w specu geometrii, którego dotyczy:

- kafelki obrazków (4 opcje) i „Co to jest?”: prostokąty kafelków (oraz obrazka-pytania) przed werdyktem i po nim równe ± 1 px, dla werdyktu poprawnego i błędnego, na 1536×730, 1280×600, 390×750, 360×640; na 3440×1440 z widocznym komunikatem „audio niedostępne” (nagranie zaślepione błędem). Kontrolnie 844×390 (bardzo niskie okno): pusta stopka ukryta, brak poziomego przepełnienia;
- rezerwa przed malowaniem: `MutationObserver` zainstalowany przed wysłaniem odpowiedzi; w pierwszym callbacku, w którym istnieje panel, maksimum dolnych krawędzi dzieci `.kid-material-content` ≤ górna krawędź panelu + 1 (prostokąty w px ekranu, reduced motion). Przypadki: 3440×1440 (zwarty) i 1536×730 (zwykły) z długą podpowiedzią pisowni (`longSpellingHintFixture`);
- przewijany materiał: 1536×730 i 390×750, zadanie pisemne z treścią przewijaną już przed werdyktem (`scrollHeight > clientHeight`) i długim panelem — po ustaleniu rezerwy koniec treści nad panelem, a po przewinięciu materiału do końca też;
- odstęp od góry: 3440×1440, 3440×1300, 1920×1080 i dotykowy 1366×1024 — górna krawędź instrukcji − górna krawędź ramy zadania = 90 × skala (± 2) dla odpowiedzi pisemnej, wyboru tekstu i liter; wybór obrazków bez odstępu;
- tablet z klawiaturą: kontekst dotykowy (`isMobile`, `hasTouch`) 1366×1024, fokus w polu odpowiedzi, okno zmniejszone do 1366×600 — instrukcja, pole i akcja na tej samej wysokości (± 1) co przed zmniejszeniem; 1280×720 dotykowo — zwarty układ; 844×390 dotykowo — zwykły;
- tekst z lukami przy kolumnie 720: szerokość `.kid-lesson-cloze__text` ≤ 60 × szerokość znaku `0` tej czcionki + 1.

Istniejące testy geometrii (m.in. `kid-responsive`, `picture-choice-layout`, `kid-feedback-dock`, `kid-feedback-layout`, specy `lesson-*-layout`) muszą przejść; zmiana oczekiwanych wartości wymaga uzasadnienia w raporcie zadania.

### 5.2 Długi w testach

- **Zrzuty ekranu** (10 testów `screenshot:` w `kid-large-screen.spec.ts`) uruchamiają się tylko z `UMIEM_E2E_SCREENSHOTS=1` (`test.skip` z komunikatem); `AGENTS.md` (sekcja Running and verifying) opisuje, jak je uruchomić.
- **Reguła jednostek okna** (`tests/kid-design-tokens.test.ts`): wyrażenie z flagą `i` (wielkie litery jednostek), skanowanie stylów inline w plikach `.ts` i `.tsx` (bez testów); nowa reguła: tokeny jednostek okna nie są rejestrowane przez `@property`.
- **Powrót do skali 1:** E2E „rescales on resize” kończy krokiem 1280×800 → `waitForKidScale(page, 1)`, brak inline `zoom` i `--kid-zoom`, rama sesji = okno; unit `KidPage.test.tsx`: zmiana wskaźnika z myszy na dotyk usuwa `--kid-zoom` i przywraca `data-kid-scale="1"`.
- **Panel mikrofonu przy powiększeniu:** unit w `MicrophoneSettingsButton.test.tsx` z `currentCSSZoom` = 1,6 (podstawionym przez `Object.defineProperty`) i wąskim oknem — odstęp pod przyciskiem 8 × zoom, margines 16 × zoom przy dociśnięciu do krawędzi, zapisane `left`/`top` podzielone przez zoom.
- **Długa karta lekcji:** jedna definicja treści (tytuł, treść 1200 znaków, przykłady) w `tests/e2e/helpers/kid-fixtures.ts`, używana przez `kid-large-screen.spec.ts` i `lesson-card-audio-layout.spec.ts`.
- **Strażnik `openDeckScreen`** (`tests/e2e/spec-projects.test.ts`): sygnał zaślepki tylko przy imporcie `openDeckScreen` z `./helpers/kid-fixtures`.
- Przy okazji testu rezerwy: `settledDockReserve` i test „overlay dock reserve is exact” mierzą maksimum dolnych krawędzi dzieci treści (jak kod produkcyjny), nie `lastElementChild`; komentarz o „znanym ograniczeniu” (§1 pkt 3) znika.

**Przed PR:** `pnpm typecheck`, `pnpm test:unit`, pełne `pnpm test:e2e:shards` na buildzie produkcyjnym.

**Niezweryfikowane — raportowane jawnie:** fizyczny monitor 34", laptop i tablet z prawdziwą klawiaturą; animacje Motion (E2E emuluje reduced motion — test przed malowaniem sprawdza geometrię układu, nie przebieg animacji wejścia panelu).

## 6. Dokumentacja

- Ten dokument.
- Spec #200: §2 (kurczenie kafelków — rozwiązane tutaj), §3.2 (nowy warunek i odstęp) — krótkie adnotacje z odsyłaczem.
- `AGENTS.md`, sekcja Kid UI: warunek zwartego układu z gałęzią dotykową, odstęp od góry, rezerwa stopki zadań z obrazkami; sekcja Running and verifying: `UMIEM_E2E_SCREENSHOTS=1`.
- `docs/architecture.md` i `docs/folder-structure.md` tylko jeśli opisują zmieniane miejsca.

## 7. Ryzyka i przyjęte kompromisy

- **Rezerwa stopki to stała wartość**, nie pomiar panelu, który jeszcze nie istnieje. Panel dłuższy niż jeden wiersz komunikatu zmniejsza kafelki o nadwyżkę. Za duża wartość tylko zmniejsza kafelki przed werdyktem — dlatego wartości wynikają z pomiaru, a test porównuje rozmiar przed i po.
- **Mniejsze kafelki przed werdyktem** na oknach ograniczonych wysokością (laptop) — świadomy wybór: rozmiar stały zamiast skoku.
- **Odstęp od góry przy długiej treści** zabiera 90 px wewnętrznych materiałowi.
- **Tablet dotykowy 960+ × 480–780** dostaje zwarty układ bez klawiatury (§3.5).
- **Efekt layoutu** wymusza synchroniczny układ przy pojawieniu się panelu (raz na werdykt i przy zmianach rozmiaru) — koszt pomijalny.
