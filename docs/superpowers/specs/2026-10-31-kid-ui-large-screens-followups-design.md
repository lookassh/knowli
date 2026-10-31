# Kid UI na dużych ekranach — poprawki po PR #200

**Status:** projekt uzgodniony w rozmowie 2026-10-31. Właściciel wybrał stały odstęp od góry dla zwartego układu na wysokim oknie (zamiast wyśrodkowania), zaakceptował projekt i poprosił o PR po review trzech niezależnych krytyków (spec, plan, gałąź). Wersja 2 — po review trzech krytyków specu (mechanizm, UX na urządzeniach, testy). Uzupełnia `2026-10-30-kid-ui-large-screens-design.md` (dalej: „spec #200”); tam, gdzie się różnią, obowiązuje ten dokument.

## 1. Problem i kryteria

Po PR #200 zostały znane ograniczenia (spec #200 §2, §7 i raport PR):

1. **Kafelki obrazków kurczą się w chwili werdyktu**, gdy ich rozmiar ogranicza wysokość materiału — np. laptop 1536×730 (Windows 125%): ok. 258 → 220 px. Przyczyna: w ramie `flow` wyboru obrazków stopka przed werdyktem jest pusta (`.actions:empty { display: none }`), a panel wyniku zajmuje ją dopiero po werdykcie; materiał traci jego wysokość, a kafelki liczą rozmiar ze `100cqh`. To samo dzieje się na 3440×1440, gdy widać komunikat „audio niedostępne” (pasek statusu zabiera ok. 87 px wewnętrznych).
2. **Panel wyniku może zasłonić treść na co najmniej jedną malowaną klatkę.** Rezerwa pod panelem w trybie `overlay` (`dockPad` w `ExerciseFrame`) powstaje z `setDockPad` wywołanego w `useEffect`; ta aktualizacja stanu trafia do zwykłego pasa Reacta i renderuje się dopiero po malowaniu. Do tego w chwili werdyktu wychodzące akcje zadania (`Fragment` w `AnimatePresence mode="popLayout"`) zostają jeszcze w układzie — fragmentu nie da się „wypchnąć” — więc pierwszy pomiar widzi stopkę podwójnej wysokości i zaniża zakładkę (zwarty układ: ok. 118 px; w zwykłym zadaniu pisemnym z krótkim błędnym werdyktem na 3440×1440 bramka rezerwy w ogóle się nie włącza aż do `ResizeObserver`, którego aktualizacja też ląduje po malowaniu).
3. **Rezerwa nie wydłuża przewijania, gdy materiał już się przewija.** `.materialContent` ma `flex: 1` (podstawa 0) i jawne `min-height`, więc nie rośnie razem z dziećmi; padding rezerwy zostaje wewnątrz pudełka, a zakres przewijania kończy się na dzieciach — panel zasłania koniec treści (poza zwartym układem). `flex: 1 0 auto` na stałe psuło `kid-responsive.spec.ts` (karta słowa na telefonie), dlatego w #200 je cofnięto.
4. **Na 34" odpowiedź pisemna, litery i mowa zajmują górną połowę ekranu** — zwarty układ (spec #200 §3.2) stawia instrukcję, materiał i stopkę u góry, a 40–60% wysokości pod nimi jest puste.
5. **Tablet z Androidem w poziomie traci zwarty układ przy otwartej klawiaturze.** `interactiveWidget: "resizes-content"` zmniejsza okno poniżej 781 px, warunek zwartego układu przestaje pasować i pole odpowiedzi przeskakuje w trakcie pisania.
6. **Limit długości wiersza tekstu nie działa.** Spec #200 §3.1 dał kartom lekcji `max-inline-size: 60ch`, ale `ch` to szerokość cyfry `0` (w Nunito 0,6 em), więc 60ch przy 1,15 rem to ok. 660 px — tyle, ile ma materiał kolumny 720 px; reguła prawie nic nie zmienia, a wiersz ma ok. 70–80 znaków. Tekst z lukami (1,3 rem) nie ma limitu wcale (wiersz ok. 79 znaków przy 688 px).

Kryteria sukcesu:

- **Wybór obrazków** (`picture_listening`) od szerokości 600 px: kafelki mają ten sam rozmiar i położenie (± 1 px) przed werdyktem i po nim, dla werdyktu poprawnego i błędnego (panel zawsze ma przycisk podpowiedzi głosowej), na 1536×730, 1280×600 i 3440×1440 z widocznym komunikatem „audio niedostępne”. Na 3440×1440 bez komunikatu kafelki są stałe przy obu werdyktach i mają co najmniej 290 px wewnętrznych (dotąd 300 przy werdykcie poprawnym; stałość ma pierwszeństwo przed limitem 300 — §3.1).
- **Panel wyniku nie zachodzi na treść materiału w żadnej malowanej klatce:** od pierwszego callbacku `MutationObserver` po wstawieniu panelu przez kolejne klatki aż do ustalenia — zakładka ≤ 8 px (próg korekty z `ExerciseFrame`), a po ustaleniu ≤ 1 px.
- Gdy materiał przewija się już przed werdyktem, po werdykcie koniec treści jest nad panelem, także po przewinięciu materiału do końca (także poza zwartym układem).
- **Zwarty układ przy myszy lub touchpadzie** (poza wyborem obrazków): nad instrukcją odstęp do 90 px wewnętrznych (34" pełny ekran: 144 px ekranu), który znika, zanim materiał zacznie się przewijać; odpowiedzi nadal nie przesuwają się w chwili werdyktu na oknach z testów #200.
- **Dotykowy tablet w poziomie** (≥ 960 px szerokości) zachowuje zwarty układ po otwarciu klawiatury, dopóki wysokość okna ≥ 480 px.
- Tekst kart lekcji i tekst z lukami mają wiersz ok. 60 znaków (najdłuższy wiersz testowego tekstu ≤ 65 znaków) w kolumnie 720 px.
- Bez regresji: `pnpm typecheck`, `pnpm test:unit`, pełne `pnpm test:e2e:shards`.

## 2. Zakres

Wyłącznie `packages/kid-ui`, testy i dokumentacja. Bez zmian Kid API, DTO, kontraktów, bazy, serwera, panelu rodzica, MCP i `SKILL.md`. Jeden PR. Do tego długi w testach z raportu PR #200 (§5.2).

Świadomie poza zakresem (raportowane w PR):

- **Telefony (< 600 px szerokości) w wyborze obrazków** — bez rezerwy. Typowy telefon w pionie (≥ ok. 680 px wysokości okna) ma kafelki ograniczone szerokością i nie zmienia ich przy werdykcie; mały telefon (np. 375×548) nadal je zmniejsza w chwili werdyktu (np. 165 → 112 px), bo stała rezerwa dwuwierszowego panelu (ok. 160 px) dałaby 112 px już przed odpowiedzią.
- **Obrazek-pytanie w „Co to jest?”** (`picture_recognition`) nadal maleje w chwili werdyktu (`38cqh`): to bodziec, nie odpowiedź (niezmiennik spec #200 dotyczy odpowiedzi), a rezerwa zmniejszyłaby go przed odpowiedzią nawet o ok. 26% na telefonie.
- Pojawienie się samego komunikatu audio w trakcie zadania nadal robi mu miejsce kosztem materiału (decyzja z PR #145: komunikat z przyciskiem nie zasłania odpowiedzi).
- Pierwsze malowanie w skali 1 przy pełnym załadowaniu strony (spec #200 §4.1) i pozostałe drobne uwagi krytyków #200 (`:not()` w regule zwartej nakładki, warunek „≥ 2 wiersze” na telefonie, testy klawiatury zależne od głębokości JSX, długość punktu w `AGENTS.md`).

## 3. Zachowanie i mechanizm

### 3.1 Stała rezerwa stopki w wyborze obrazków

- Nowy token w bloku tokenów `styles.css`: `--kid-picture-dock-height` — minimalna wysokość panelu wyniku `compact` w jednym wierszu (od 600 px szerokości: treść obok akcji). Zapisany jako skład z tokenów i `rem` (części tekstowe w `rem`, żeby rosły z rozmiarem czcionki systemu), `calc(20px + max(54px, 12px + 8px + var(--kid-type-body-size) * 1.3 + 4px + var(--kid-type-headline-sm-size) * 1.2, 48px))` (93,6 px przy 16 px; 106 px przy czcionce systemu 125%); skład wynika z CSS panelu i `AnswerFeedback` (błędny werdykt pokazuje etykietę i poprawną odpowiedź w dwóch blokach z `margin-top: 4px`, nagłówek h2 ma dolny margines 8 px z `.kid-screen h2`, a w wierszu stoi przycisk podpowiedzi głosowej 48 px) i jest potwierdzony pomiarem prawdziwego panelu: błędny werdykt 93,6 px, poprawny 74 px (podniesiony do tokenu przez `min-height`). Pierwsza wersja tego zapisu pomijała margines nagłówka (85,6 px) i dawała panel błędnego werdyktu wyższy o 8 px od rezerwy.
- Od `(min-width: 600px)`, w ramie `flow` z `data-prompt-kind="picture_listening"` (poza `data-zoomed="true"` i `data-viewport-very-short="true"`):
  - stopka `.actions` ma `min-height: calc(var(--kid-picture-dock-height) + 12px)` (padding stopki 8 + 4) i nie jest ukrywana, gdy jest pusta;
  - panel wyniku w tej ramie ma `min-height: var(--kid-picture-dock-height)`.
  Poprawny i błędny werdykt dają wtedy z konstrukcji tę samą wysokość stopki, a wiersz materiału (i `100cqh` kafelków) nie zmienia się w chwili werdyktu. Panel wyższy niż token (dłuższy komunikat) zmniejsza kafelki tylko o nadwyżkę. Siatka ma odstęp 8 px między ścieżkami niezależnie od tego, czy stopka jest pusta, czy ukryta (sprawdzone w review), więc rezerwa zmienia wiersz materiału dokładnie o wysokość stopki.
- Skutek: kafelki ograniczone wysokością mają od razu rozmiar „po werdykcie” (laptop 1536×730: ok. 210 px przez całe zadanie, dotąd 263 px przed odpowiedzią i 220 px po poprawnej; 1280×600: ok. 149 px, dotąd 202 px; pomiar z panelem błędnego werdyktu 93,6 px, wyższym niż poprawny 74 px), a pod nimi stoi pusta stopka w kolorze tła (wygląda jak dolny margines). Kafelki ograniczone szerokością lub limitem (tablet w pionie, 34") nie zmieniają się. Kryterium spec #200 (odstęp kafelki → panel ≤ 15% wysokości okna na 3440×1300 i 3440×1440) obowiązuje dalej. Limit 300 px na 3440×1440 trzymał się dotąd tylko przy werdykcie poprawnym (niższy panel); panel błędnego werdyktu jest o kilkanaście px wyższy i zapas wysokości (ok. 5 px na kafelek) może nie wystarczyć. Decyzja: stały rozmiar ma pierwszeństwo — kafelki mogą mieć tam kilka px mniej niż 300 (co najmniej 290 px wewnętrznych), ale są takie same przed werdyktem i po obu werdyktach; test #200 „limit === 300” przechodzi na tę regułę.
- Wychodzący (wypchnięty z układu) panel nie przechwytuje kliknięć w trakcie animacji wyjścia: `pointer-events: none` dla elementu wypchniętego przez `AnimatePresence` (`[data-motion-pop-id]`) w stopce — puste sloty kotwicy nie mają dziś tej ochrony.

### 3.2 Rezerwa gotowa przed malowaniem

- **Akcje poza `AnimatePresence`.** W `ExerciseFrame` pod `AnimatePresence mode="popLayout"` zostaje wyłącznie panel wyniku (kotwica `overlay` albo `flowDock`); akcje zadania renderują się obok, warunkowo, bez obecności. W chwili werdyktu znikają w tym samym commicie co pojawia się panel, więc pierwszy pomiar widzi ułożoną stopkę. Wyjście panelu (ponowna próba) działa jak dziś: panel jest wypychany z układu i animuje wyjście, a akcje wracają od razu.
- **Pomiar w efekcie layoutu.** Efekt rezerwy działa w izomorficznym efekcie layoutu (helper z `layout/viewport.ts` wydzielony do współdzielonego modułu w `layout/`) i zależy od obecności panelu (`hasDock`), `task.taskId` i trybu, nie od tożsamości węzła JSX `dock` (LearnScreen tworzy go przy każdym renderze). `setDockPad` w efekcie layoutu daje synchroniczny ponowny render przed malowaniem; efekt po zmianie `dockPad` (też layoutu) mierzy od razu synchronicznie i wykonuje korektę przewinięcia, gdy zakres przewijania już istnieje. Pomiar, który zmienia rezerwę, kończy się bez korekty przewinięcia także w efekcie layoutu (przegląd końcowy gałęzi): liczona na układzie sprzed rezerwy, w materiale, który już się przewija, zatrzymywała się na starym końcu zakresu i przy nadwyżce panelu 16–24 px zostawiała pod nim 1–8 px treści, poniżej progu kolejnej korekty. Pomiar w `requestAnimationFrame` zostaje jako zabezpieczenie.
- **Późniejsze pomiary przed malowaniem.** Pomiar wywołany przez `ResizeObserver` lub `requestAnimationFrame` zatwierdza zmianę `setDockPad` przez `flushSync` i kończy się (bez korekty przewinięcia liczonej na starym układzie) — korektę wykonuje efekt `[dockPad]` na świeżym układzie. Callback `ResizeObserver` działa przed malowaniem; `flushSync` nie jest wołany wewnątrz efektu layoutu (React ostrzega) — efekt `[dockPad]` mierzy w trybie bez `flushSync`. Synchroniczna zmiana rozmiaru w callbacku obserwatora może dać nieszkodliwe zdarzenie „ResizeObserver loop completed with undelivered notifications” (powiadomienie przechodzi do następnej klatki) — opisane w komentarzu.
- `data-dock-reserve` ma ten sam warunek co styl rezerwy: `dock !== undefined && dockPad > 0`.
- Efekt odsłonięcia panelu (`scheduleFeedbackDockReveal`) zostaje w `useEffect`. Pomiar prostokątów zostaje w jednostkach ze spec #200 §4.4 (`toLayoutPx`).

### 3.3 Rezerwa wydłuża przewijanie przewijanego materiału

- Gdy rezerwa jest aktywna (`dockPad > 0`), `.materialContent` dostaje atrybut `data-dock-reserve` i regułę `flex: 1 0 auto` — pudełko rośnie razem z dziećmi, a padding rezerwy leży pod ostatnim z nich. Bez rezerwy zostaje `flex: 1` (karta słowa na telefonie, która nie ma panelu).
- Specyficzność reguły `.materialContent[data-dock-reserve]` (0,2,0) zostaje niższa niż reguły zwartego układu `flex: none` (0,3,0).

### 3.4 Odstęp od góry w zwartym układzie (mysz lub touchpad)

- Nowy token `--kid-compact-frame-offset: 90px` (10% wysokości projektowej 900 px wewnętrznych).
- Odstęp dostaje tylko zwarty układ przy `(hover: hover) and (pointer: fine)` (duży monitor ze skalą), poza powiększeniem gestem (`data-zoomed="true"`) i poza zadaniami z dużą ilustracją lub kartą: `exposure`, `picture_exposure`, `picture_recall`, `picture_speech`, `lesson_card` (oraz wyborem obrazków, który nie ma zwartego układu). Ilustracja lub karta zajmuje tam większość wysokości; częściowy odstęp dawałby instrukcję na pośrednich wysokościach i znikałby przy werdykcie (wyższy panel mowy), przesuwając słowo i przycisk nagrywania. Tablet dotykowy (§3.5) ma odstęp 0 — otwarta klawiatura nie może go zmienić, a na krótszych oknach dotykowych odstęp kosztowałby 16–25% ramy.
- **Odstęp ustępuje pierwszy.** Zwarty układ (§3.5, oba warianty wskaźnika) przechodzi z siatki `auto minmax(0, max-content) auto` na równoważną kolumnę flex: instrukcja i stopka `flex: none`, materiał `flex: 0 1 auto; min-height: 0` (podstawa = wysokość treści, kurczy się do 0 i przewija jak dotąd), wszystko u góry. Odstęp to pseudo-element przed instrukcją `flex: 0 1000000 <odstęp>` (współczynnik musi być tak duży, żeby materiał nie stracił nawet ułamka piksela, zanim odstęp spadnie do 0 — przy 1000 materiał gubi ok. 1 px i pokazuje pasek przewijania) z ujemnym marginesem kompensującym `gap`; przy `pointer: fine` (poza wyjątkami wyżej) odstęp = `var(--kid-compact-frame-offset)`, w pozostałych przypadkach 0. Gdy treść się nie mieści, najpierw kurczy się odstęp, potem materiał. Krótka treść (odpowiedź pisemna, litery, mowa, wybór tekstu, ćwiczenia lekcji) dostaje pełny odstęp; długa (np. długie polecenie) — mniejszy albo zero. Jeśli w chwili werdyktu grupa przestaje się mieścić, odstęp maleje i odpowiedzi przesuwają się w górę o najwyżej tyle (przyjęte: zachowuje widoczność panelu).
- Stałe piksele wewnętrzne, nie jednostki okna: pod `zoom` odstęp rośnie ze skalą (3440×1440: 144 px ekranu; 1920×1080: 108).
- Instrukcja zadania z obrazkami (bez odstępu) stoi wyżej niż w kolejnym zadaniu tekstowym — przyjęte (wybór obrazków nie ma zapasu wysokości przy 900 px wewnętrznych).

### 3.5 Warunek zwartego układu

`@media (min-width: 840px) and (min-height: 781px), (min-width: 960px) and (min-height: 480px) and (pointer: coarse)` — w `ExerciseFrame.module.css` i `ExerciseFeedbackDock.module.css` (zaokrąglony panel). Druga gałąź działa jak gałąź „≥ 960” kolumny 720 px (spec #200 §3.1): dotykowy tablet w poziomie (≥ 1024 px szerokości) zachowuje zwarty układ, gdy klawiatura obniża okno. Telefony w poziomie (≤ 932 px) gałęzi nie spełniają. Próg 480 trzyma zwarty układ z dala od trybu bardzo niskiego okna (≤ 479, przewijana strona).

Skutki uboczne (przyjęte): dotykowy tablet ≥ 960 × 480–780 dostaje zwarty układ także bez klawiatury (bez odstępu z §3.4). Po otwarciu klawiatury reguła `max-height: 700px` (`styles.css`) nadal zmniejsza górny padding sesji o 8 px, więc rama zadania przesuwa się o 8 px w górę — położenie elementów względem ramy się nie zmienia. Treść wymiarowana jednostkami okna (ilustracja `36svh`, pole tekstowe `40dvh`) może się zmniejszyć. Fizyczne zachowanie dotyczy głównie dużych tabletów z Androidem; 10–12" tablety z klawiaturą zwykle schodzą poniżej 480 px (tryb bardzo niskiego okna, jak dziś).

### 3.6 Długość wiersza tekstu

- Nowy token `--kid-reading-measure` (w `ch`, wybrane 44ch), dobrany pomiarem tak, żeby typowy polski tekst lekcji miał ok. 60 znaków w wierszu przy czcionce Nunito niezależnie od jej rozmiaru (`ch` skaluje się z czcionką elementu).
- Używają go `.kid-lesson-card__body`, `.kid-lesson-card__examples` (zamiast `60ch`) i `.kid-lesson-cloze__text`. Na telefonie w pionie kolumna jest węższa niż limit — bez zmian (w poziomie, przy kolumnie 560 px, blok zwęża się nieco).
- Węższy blok tekstu stoi na środku kolumny (`margin-inline: auto`), a wiersze są wyrównane do początku — tak blok jest symetryczny względem tytułu karty, miejsc luk i banku słów pod tekstem.

## 4. Pliki

- `packages/kid-ui/src/styles.css` — tokeny `--kid-picture-dock-height`, `--kid-compact-frame-offset`, `--kid-reading-measure`; użycie tokenu długości wiersza.
- `packages/kid-ui/src/exercises/ExerciseFrame.tsx` — akcje poza `AnimatePresence`, efekty layoutu, `flushSync`, zależności efektu, atrybut `data-dock-reserve`, komentarze.
- `packages/kid-ui/src/exercises/ExerciseFrame.module.css` — rezerwa stopki wyboru obrazków, `[data-dock-reserve]`, nowy warunek zwartego układu, odstęp (kolumna flex) przy `pointer: fine`.
- `packages/kid-ui/src/screens/ExerciseFeedbackDock.module.css` — nowy warunek zwartego układu; `min-height` panelu w wyborze obrazków.
- `packages/kid-ui/src/layout/` — współdzielony izomorficzny efekt layoutu (`viewport.ts` i `ExerciseFrame`).

## 5. Testy

### 5.1 Nowe zachowanie (E2E najpierw na czerwono, potem zielono)

Konsolidacja: jedna strona na okno z przebiegiem werdykt błędny → ponowna próba → werdykt poprawny (jak `picture-choice-layout.spec.ts`), pętle okien z `resizeAndSettle`; razem ok. 12–15 nowych testów w projekcie `mocked`. Wspólne helpery zamiast kopii (bramka duplikacji SonarCloud ≤ 3%): `expectRectsUnchanged`, `boxes`, `nextFrames`, `pictureTiles`, `settledDockReserve` i sonda „zakładka w każdej klatce” w `tests/e2e/helpers/kid-frame.ts`; fixture wyboru obrazków i „Co to jest?” w `tests/e2e/helpers/picture-fixtures.ts`; jedno `openPictureChoice` zamiast kopii w `kid-large-screen` i `picture-choice-layout`.

- **Kafelki (§3.1).** Na 1536×730, 1280×600 i 3440×1440 z widocznym komunikatem audio (nagranie instrukcji odpowiada 404; pomiar „przed” dopiero po pojawieniu się `kid-task-audio-error`): warunek wstępny — kafelki są ograniczone wysokością po werdykcie błędnym (wzór `limit` z `kid-large-screen.spec.ts`); prostokąty kafelków przed werdyktem, po błędnym, po ponownej próbie i po poprawnym równe ± 1 px. Strażnicy (nie czerwone): 3440×1440 bez komunikatu — kafelki stałe przy obu werdyktach i ≥ 290 px wewnętrznych; 390×750 — bez zmian; 844×390 (bardzo niskie okno) — pusta stopka ukryta, brak poziomego przepełnienia; główna czcionka 125% przy 1536×730 — kafelki stałe.
- **Zakładka w każdej klatce (§3.2).** Sonda instalowana przed wysłaniem odpowiedzi (albo uruchamiana od razu — dla kroku zmiany okna przy widocznym panelu): `MutationObserver` wykrywa `.kid-feedback-overlay`, potem próbki (a) we własnym `ResizeObserver` sondy utworzonym po obserwatorze `ExerciseFrame` (obserwatory działają w kolejności utworzenia, więc sonda widzi stan po korekcie, tuż przed malowaniem) i (b) po malowaniu (`setTimeout(0)` z `requestAnimationFrame`) aż do ustalenia (co najmniej 5 klatek). Zakładka = maksimum dolnych krawędzi dzieci `.kid-material-content` − górna krawędź `.kid-feedback-overlay` (element bez transformacji; nie `kid-feedback-dock`, który ma jeszcze `initial` `scale`), w px ekranu. Kryterium: w każdej próbce ≤ 8 × skala + 1 px (próg korekty `ExerciseFrame` jest w px wewnętrznych), po ustaleniu ≤ 1 px. Przypadki z dużą zakładką: 3440×1440 (zwarty) z krótkim błędnym werdyktem pisemnym oraz z długą podpowiedzią pisowni; 1536×730 (zwykły) z długą podpowiedzią — warunki wstępne po ustaleniu: rezerwa > 0, a na 1536×730 także `scrollTop > 0`; zmiana okna 1536×730 → 1280×600 przy widocznym panelu; tekst z lukami z podpowiedzią lekcji (`lesson_hint`) przy 1280×600 i 1536×730 (materiał przewijany).
- **Ponowna próba.** Po błędnym werdykcie z ponowną próbą: zaraz po „Spróbuj jeszcze raz”, w trakcie animacji wyjścia (bez reduced motion), `elementFromPoint` w środku akcji trafia w akcję, nie w wychodzący panel; po zakończeniu rezerwa 0; drugi błędny werdykt po ponownej próbie znów ma rezerwę bez zakładki.
- **Przewijany materiał (§3.3).** 1536×730 i 390×750, zadanie pisemne z nowym, dłuższym poleceniem z `helpers/kid-fixtures.ts` (warunek wstępny przed werdyktem: `scrollHeight > clientHeight`) i długim panelem: po ustaleniu koniec treści nad panelem; po przewinięciu materiału do końca też.
- **Odstęp (§3.4).** Przy myszy 3440×1440, 3440×1300 i 1920×1080: górna krawędź instrukcji − górna krawędź ramy zadania = 90 × skala (± 2) dla odpowiedzi pisemnej, wyboru tekstu, liter i mowy (bez nagrania); wybór obrazków i karta słowa — 0 (istniejący test karty słowa przy 1440×960 w `kid-responsive.spec.ts` przechodzi bez zmian); odpowiedzi bez przesunięcia po werdykcie; powiększenie gestem (podstawione `visualViewport.scale`) — 0. Kontrolnie przy myszy 1536×730 i 1366×600 — zwykły układ (stopka przy dolnej krawędzi ramy), bez odstępu.
- **Tablet (§3.5).** Kontekst dotykowy (`hasTouch`, `isMobile`; sprawdzone `matchMedia("(pointer: coarse)")`): 1366×1024, tekstowe zadanie pisemne, fokus w polu, okno zmniejszone do 1366×600 — położenie instrukcji, pola i akcji względem górnej krawędzi ramy zadania bez zmian (± 1); panel wyniku zaokrąglony (`expectDockCorners("rounded")`) i odpowiedzi bez przesunięcia po werdykcie; odstęp 0. 1280×720 dotykowo — zwarty układ (stopka ≤ 8 + 4 + 1 px pod najniższym dzieckiem treści materiału, nie pod samym materiałem); 844×390 dotykowo — zwykły.
- **Długość wiersza (§3.6).** Przy kolumnie 720 px (1536×730): najdłuższy wiersz tekstu karty lekcji i tekstu z lukami ma 45–65 znaków (wiersze grupowane po pionowym środku prostokątów znaków z `Range`; numery luk nie są liczone); blok tekstu wyśrodkowany w kolumnie (± 2 px); dziś ok. 70–80 znaków — test czerwony przed zmianą.

Istniejące testy, które zmieniają oczekiwania (każda zmiana uzasadniona w raporcie zadania): `kid-responsive.spec.ts` (wysokość stopki po werdykcie w wyborze obrazków przy ≥ 600 px — równa zamiast większej; odstęp instrukcji w zwartym układzie), `kid-large-screen.spec.ts` (kafelki, „no empty band”), `picture-choice-layout.spec.ts`, specy `lesson-*-layout` przy 1280×800 (odstęp) i `kid-flow.spec.ts` (projekt `real`). Pozostałe testy geometrii muszą przejść bez zmian.

### 5.2 Długi w testach

- **Zrzuty ekranu** (10 testów `screenshot:` w `kid-large-screen.spec.ts`) w `test.describe` z `test.skip(!process.env.UMIEM_E2E_SCREENSHOTS, …)`; `AGENTS.md` (Running and verifying) opisuje uruchomienie.
- **Reguła jednostek okna** (`tests/kid-design-tokens.test.ts`): flaga `i`; skanowanie stylów w plikach `.ts` i `.tsx` (bez testów) po usunięciu komentarzy; dopasowanie także jednostek po interpolacji (`${n}vh`). Nowa reguła na surowym CSS (z blokiem tokenów) i TS: tokeny jednostek okna i `--kid-zoom` nie są rejestrowane przez `@property` ani `CSS.registerProperty`.
- **Powrót do skali 1:** E2E „rescales on resize” kończy krokiem 1280×800 → `waitForKidScale(page, 1)`, brak inline `zoom` i `--kid-zoom`, rama sesji = okno; unit `KidPage.test.tsx` — `setFine(false)` po skali > 1 usuwa `--kid-zoom` i daje `data-kid-scale="1"`.
- **Panel mikrofonu przy powiększeniu:** unit w `MicrophoneSettingsButton.test.tsx` — `currentCSSZoom` = 1,6 podstawione na `Element.prototype` (panel powstaje przy otwarciu), `getBoundingClientRect` per element, wąskie okno; odstęp pod przyciskiem 8 × zoom, margines 16 × zoom przy dociśnięciu do krawędzi, zapisane `left`/`top` podzielone przez zoom; podstawienia przywracane po teście.
- **Długa karta lekcji:** jedna definicja treści (tytuł, treść 1200 znaków, przykłady) w `tests/e2e/helpers/kid-fixtures.ts`, używana przez `kid-large-screen.spec.ts` (także zamiast `LONG_LESSON_TEXT`) i `lesson-card-audio-layout.spec.ts`.
- **Strażnik `openDeckScreen`** (`tests/e2e/spec-projects.test.ts`): sygnał zaślepki tylko przy imporcie `openDeckScreen` z `./helpers/kid-fixtures` (także wielowierszowym) i wywołaniu `openDeckScreen(`.
- `settledDockReserve` i test „overlay dock reserve is exact” mierzą maksimum dolnych krawędzi dzieci treści (jak kod produkcyjny), nie `lastElementChild`; komentarz o „znanym ograniczeniu” (§1 pkt 3) znika.

**Przed PR:** `pnpm typecheck`, `pnpm test:unit`, pełne `pnpm test:e2e:shards` na buildzie produkcyjnym.

**Niezweryfikowane — raportowane jawnie:** fizyczny monitor 34", laptop i tablet z prawdziwą klawiaturą; animacje Motion (E2E emuluje reduced motion — sonda klatek sprawdza geometrię układu, nie przebieg animacji wejścia panelu); duże czcionki systemowe Androida (token w `rem` ma je pokryć, bez testu).

## 6. Dokumentacja

- Ten dokument.
- Spec #200: §2 (kurczenie kafelków — rozwiązane tutaj dla ≥ 600 px), §3.1 (`60ch` zastąpione tokenem długości wiersza), §3.2 (nowy warunek i odstęp) — krótkie adnotacje z odsyłaczem.
- `AGENTS.md`, sekcja Kid UI: warunek zwartego układu z gałęzią dotykową, odstęp przy `pointer: fine`, rezerwa stopki wyboru obrazków, token długości wiersza; sekcja Running and verifying: `UMIEM_E2E_SCREENSHOTS=1`.
- `AGENTS.md`: token długości wiersza `--kid-reading-measure` w punkcie o dużym oknie; aktualna liczba i czas testów w opisie `pnpm test:e2e:shards` po pełnym przebiegu.
- `docs/folder-structure.md`: wiersz dla nowego `layout/isomorphic-layout-effect.ts` (plik wymienia wszystkie pliki `layout/`); `docs/architecture.md` tylko jeśli opisuje zmieniane miejsca.

## 7. Ryzyka i przyjęte kompromisy

- **Rezerwa stopki to token, nie pomiar** panelu, który jeszcze nie istnieje. Panel dłuższy niż token zmniejsza kafelki o nadwyżkę; `min-height` panelu wyrównuje werdykt poprawny do błędnego.
- **Mniejsze kafelki przed werdyktem** na oknach ograniczonych wysokością (laptop) — świadomy wybór: rozmiar stały zamiast skoku.
- **Odstęp może ustąpić w chwili werdyktu** w prawie pełnej ramie — odpowiedzi przesuwają się wtedy w górę (najwyżej o 90 px wewnętrznych) zamiast chować koniec materiału.
- **Zwarty układ jako kolumna flex** zastępuje siatkę z #200 (równoważne rozmieszczenie bez odstępu) — pokrywają go istniejące testy zwartego układu (#200: brak pustego pasa, odpowiedzi bez przesunięcia, rezerwa `overlay`, długa karta lekcji) i nowe testy odstępu.
- **Tablet dotykowy 960+ × 480–780** dostaje zwarty układ bez klawiatury (§3.5).
- **Pierwsza zakładka 1–8 px bez korekty** (sprzed tej zmiany): gdy panel w zwykłym układzie od razu zachodzi na treść o 1–8 px, rezerwa się włącza, ale przewinięcie korygujące działa dopiero od progu 8 px — do 8 px treści może zostać pod panelem. Kryterium „≤ 1 px po ustaleniu” z §1 dotyczy przypadków z korektą; zmiana progu wymaga osobnej decyzji.
- **`flushSync` w `ResizeObserver`** wymusza synchroniczny commit przy zmianie rozmiaru z panelem — raz na zmianę, koszt pomijalny.
