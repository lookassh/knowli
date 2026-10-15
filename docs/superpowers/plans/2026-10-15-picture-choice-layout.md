# Czytelne odpowiedzi obrazkowe na małym ekranie — plan implementacji

> REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Cel:** Dziecko widzi jednocześnie wszystkie trzy odpowiedzi obrazkowe na małym ekranie, a liczby rozpoznaje po wyraźnych, policzalnych jabłkach.

**Projekt:** Zaakceptowany przez właściciela w czacie 2026-10-15: trzy zwarte kafelki w pionie (ilustracja po lewej, polski podpis obok), przycisk odsłuchu dopasowany do wysokości ekranu, duże wyśrodkowane elementy zamiast drobnych kropek oraz sprawdzenie odpowiedzi i ponownej próby. To zmiana bounded istniejącego widoku; nie wymaga osobnej specyfikacji architectural.

**Architektura:** Zmienić układ wyłącznie `picture_listening`, wykorzystując `data-prompt-kind` istniejącego `ExerciseFrame`. Wspólny komponent SVG liczb obsłuży obie istniejące ścieżki renderowania, bez zmiany DTO ani generowania mediów. Zachować mechanizm `KidPage`/`visualViewport` oraz stabilne miejsca feedbacku i akcji.

**Stack:** React, TypeScript strict, CSS, Vitest w środowisku Node, Playwright z istniejącym fixture Kid UI.

**Źródła wymagań:** zaakceptowany projekt powyżej; `docs/SPEC.md` §34; `docs/architecture.md` §20; `AGENTS.md` (mobile, dostępność, TDD i review). `packages/contracts/src/kid.ts` definiuje 2–3 opcje i liczby 1–50.

## Ograniczenia i kryteria odbioru

- Dla 360×640, 360×800, 390×844, 768×1024 i 727×953 CSS px przy zwykłej skali: wszystkie trzy kafelki są w całości widoczne bez przewijania dokumentu i strefy materiału. Ostatni rozmiar przybliża załączony zrzut; nie jest rozpoznanym modelem urządzenia.
- Ilustracja i etykieta mają osobne kolumny; obraz nie spycha podpisu do dolnego rogu. Obrazy zachowują proporcje (`object-fit: contain`), tekst może się zawijać. Pole dotykowe każdej opcji i odsłuchu ma minimum 48×48 CSS px.
- W kompaktowym wariancie ilustracja mieści się w obszarze około 80×64 px; odsłuch ma 64×64 px. Na większych ekranach można zwiększyć ilustrację do 96×80 px i odsłuch do 80×80 px. Ostateczne odstępy podlegają powyższym pomiarom i kontroli wizualnej.
- Nie chować przepełnienia w celu pozornego spełnienia testu. Przy powiększeniu, wyjątkowo długiej etykiecie lub wysokości ≤420 px zachować dostęp do całej treści i możliwość przewijania zamiast obcinać odpowiedzi.
- Jedno jabłko jest duże i wyśrodkowane. Kolejne liczby pokazują dokładnie tyle samo rozpoznawalnych jabłek; zachować pełny zakres 1–50 i polskie etykiety dostępności. Nie zastępować ilości samą cyfrą ani emoji zależnym od platformy.
- Stan przed odpowiedzią, oczekiwanie, feedback i ponowienie zachowują czytelne opcje, zaznaczenia wyniku oraz dostępne akcje. Zwykłe ćwiczenia tekstowe zachowują swój układ.
- Brak zmian API, kontraktów, zapisu prób, ekspozycji, schedulerów, mediów serwera i mikrofonu. API → MCP → skill bez wpływu: to wyłącznie prezentacja istniejących danych; zapisać uzasadnienie w dzienniku i PR.
- Testy przeglądarkowe nie stanowią odbioru na fizycznym Galaxy S25. Ten brak dowodu należy wskazać w raporcie.
- Test powiększenia emuluje `visualViewport.scale` i sprawdza ścieżkę fallback `KidPage`; nie stanowi pomiaru prawdziwego zmniejszenia widocznego viewportu przy powiększeniu przeglądarki.

## Mapa plików

| Plik | Odpowiedzialność |
| --- | --- |
| `packages/kid-ui/src/exercises/PictureListeningView.tsx` | Jawna struktura ilustracji i podpisu w kafelku; zachowanie handlerów i wyników |
| `packages/kid-ui/src/styles.css` | Selektywne rozmiary i układ dla `picture_listening`, zachowanie awaryjnego przewijania |
| `packages/kid-ui/src/visuals/NumberVisual.tsx` (nowy) | Wspólny deterministyczny SVG jabłek |
| `packages/kid-ui/src/visuals/NumberVisual.test.ts` (nowy) | Ilość, geometria, centrowanie i etykiety |
| `packages/kid-ui/src/visuals/MeaningVisualView.tsx` | Użycie nowego SVG w wizualizacjach obrazkowych |
| `packages/kid-ui/src/visuals/Visual.tsx` | Użycie tego samego SVG w dotychczasowych wizualizacjach; zachowanie walidacji |
| `packages/kid-ui/src/visuals/Visual.test.ts` | Aktualizacja testu liczby do nowej reprezentacji, zachowanie testów błędnych danych |
| `tests/e2e/helpers/picture-fixtures.ts` | Osobny fixture trzech mieszanych opcji; nie zmieniać bazowego fixture dwóch opcji |
| `tests/e2e/picture-choice-layout.spec.ts` (nowy) | Regresje geometrii, trzeciej odpowiedzi, stanów i dostępności |
| `.superpowers/sdd/2026-10-15-picture-choice-layout/progress.md` (ignorowany dziennik workflow) | Checklista, RED/GREEN, wyniki, review i odstępstwa |

Nie zmieniać wspólnego `ExerciseFrame` ani `LearnScreen`, jeśli wystarczą selektory konkretnego promptu. Ewentualną konieczność zmiany uzasadnić w dzienniku i objąć regresjami pozostałych ćwiczeń.

## Review Focus

1. Mieszane proporcje: obraz, kolor i liczba w jednej liście nie mogą powodować różnej, nadmiernej wysokości wierszy (testy zadania 1).
2. Ostatnia opcja może być w DOM, ale poza wewnętrzną strefą widoczną: mierzyć granice, przepełnienie i skuteczny wybór trzeciej opcji (zadanie 1).
3. Liczby graniczne 1, 10, 11 i 50: bez zgubionych, nakładających się lub obciętych jabłek; jedno wycentrowane (zadanie 2).
4. Powiększenie, długi podpis i orientacja pozioma: zachować osiągalność każdej opcji zamiast wyłączać scroll globalnie (zadanie 3).
5. Feedback i oczekiwanie: dodatkowy tekst/akcje nie zasłaniają odpowiedzi; kolory wyniku, klawiatura i tekstowe ćwiczenia nadal działają (zadanie 3).

## Przygotowanie wykonania

- [ ] Uruchomić `executing-plans` i `using-git-worktrees`; potwierdzić istniejący worktree, Git, aktualny bazowy ref oraz ewentualne niezwiązane zmiany. Przy sporządzaniu planu HEAD to `167579d`, worktree bez zmian, HEAD odłączony. Ustalić gałąź `feature/picture-choice-layout` zgodnie z możliwościami środowiska przed commitami; nie tworzyć kolejnego worktree bez potrzeby.
- [ ] Założyć dziennik postępu; użyć workspace/task-start/task-done/review-package z zainstalowanej wersji skilla lub udokumentować odpowiedniki PowerShell i zachować te same artefakty.
- [ ] Sprawdzić ponownie `node_modules` i `.env` (przy planowaniu obu brak). Jeżeli zależności nadal nie istnieją, wykonać wyłącznie `corepack pnpm install --prefer-offline --frozen-lockfile`. Brak `.env` uzupełnić `node scripts/setup-worktree.cjs`; nie wypisywać sekretów.
- [ ] Baseline: `corepack pnpm test:unit packages/kid-ui/src/visuals/Visual.test.ts`. Na etapie setupu nie uruchamiać pełnego monorepo ani E2E.
- [ ] Przed zmianami zachowania przeczytać `test-driven-development`. W każdym zadaniu zapisać rzeczywisty RED przed kodem i GREEN po poprawce. Błąd uruchomienia narzędzia nie jest dowodem RED.

## Zadanie 1: Trzy zwarte kafelki odpowiedzi

**Pliki:** `PictureListeningView.tsx`, `styles.css`, `picture-fixtures.ts`, nowy `picture-choice-layout.spec.ts`.

**Interfejsy:** Istniejące `ExerciseProps` i `PictureChoiceOption` pozostają bez zmian. Fixture `pictureChoiceLayoutFixture(): KidUiFixture` tworzy zadanie z trzema opcjami: żółty kolor, liczba 1 i obraz; zachowuje poprawne UUID oraz odpowiedzi fixture wskazujące właściwe zadanie.

- [x] Dodać fixture i test `trzy odpowiedzi obrazkowe mieszczą się bez przewijania` dla pięciu rozmiarów z kryteriów odbioru. Oprócz `assertKidLayout` sprawdzić: dokładnie 3 opcje; każda w całości wewnątrz viewportu i `.kid-material-content`; każda ≥48 px wysokości; `scrollHeight <= clientHeight + 1` i analogicznie dla szerokości w strefie materiału oraz elemencie przewijającym dokument. Bez przewijania i bez kliknięcia przed pomiarem.
- [x] Uruchomić `corepack pnpm test:e2e tests/e2e/picture-choice-layout.spec.ts -g "trzy odpowiedzi"`; potwierdzić RED z powodu geometrii, zapisać pomiary i screenshot. Istniejący global setup wymaga działającego Dockera/PostgreSQL i uruchamia serwer oraz worker z fake providerami; brak tego środowiska zgłosić jako ograniczenie, nie pomijać testu po cichu.
- [x] Nadać kafelkom osobną klasę i opakowanie ilustracji; zastosować układ dwóch kolumn z podpisem po prawej i `min-width: 0`. Ograniczyć rozmiary `img`, SVG koloru i liczby wewnątrz tej klasy; modyfikacje `.kid-options` i `.kid-play-big` ograniczyć do `[data-prompt-kind="picture_listening"]`. Rozdzielić dostępne miejsce między trzy kafelki, odsłuch i istniejące rezerwy akcji/feedbacku.
- [x] Ponownie uruchomić ten sam test i uzyskać GREEN dla wszystkich rozmiarów; obejrzeć screenshoty 360×640 oraz 727×953. Sprawdzić, że poprawę uzyskano dopasowaniem treści, bez jej obcięcia.
- [x] Zapisać dowody i selektywnie commitować pliki zadania: `fix(kid-ui): fit picture answer choices on small screens`.

## Zadanie 2: Wyraźne ilustracje liczb

**Pliki:** nowy `NumberVisual.tsx` i `NumberVisual.test.ts`; `MeaningVisualView.tsx`, `Visual.tsx`, `Visual.test.ts`.

**Interfejs:** `NumberVisual({ count, label }: { count: number; label: string }): ReactElement` zwraca SVG z klasami `kid-visual kid-visual-number`, `role="img"` i przekazaną etykietą. Wywołujący zapewniają już zwalidowaną liczbę 1–50. `MeaningVisualView` nadal używa `formatVisualCountLabel`; `Visual` nadal waliduje dane i używa obecnej etykiety `text`.

- [x] Dodać testy `.test.ts` zgodne z konfiguracją Vitest (nie `.test.tsx`): dla 1, 2, 3, 10, 11 i 50 dokładna liczba instancji jabłka, zachowanie etykiety; jedno jabłko wycentrowane i zajmujące co najmniej połowę wysokości SVG. Każdy element musi mieścić się w `viewBox`, a obwiednie sąsiednich elementów nie zachodzą na siebie. Sprawdzać rzeczywistą geometrię, nie samą obecność klas.
- [x] Uruchomić `corepack pnpm test:unit packages/kid-ui/src/visuals/NumberVisual.test.ts`; zapisać RED. Dla zmiany reprezentacji istniejącej ścieżki uzupełnić test `Visual.test.ts` i potwierdzić jego RED przed podłączeniem nowego komponentu.
- [x] Zaimplementować SVG jabłka jako powtarzalny kształt wektorowy, bez sieci i emoji. Układ dobiera siatkę do liczby, centruje całą grupę i powiększa małe ilości; maksymalnie 10 kolumn i 5 wierszy dla 50. Obrys i wypełnienie mają być czytelne na jasnym i ciemnym tle. Nie kodować cyfry ani dodatkowych ozdobników wyglądających jak kolejne owoce.
- [x] Podłączyć wspólny komponent w obu rendererach liczb, zachowując pozostałe wizualizacje i walidację błędnych wartości. Dostosować dotychczasowy test kółek do nowego, znaczącego kontraktu ilości.
- [x] Uruchomić `corepack pnpm test:unit packages/kid-ui/src/visuals` i testy zadania 1; uzyskać GREEN. W przeglądarce obejrzeć liczby 1, 3, 11 i 50 w kafelku oraz dużej prezentacji, a także istniejącą okładkę liczbową. Dla 50 nie obiecywać rozpoznawania ilości jednym spojrzeniem; wymagać zgodności ilości i braku obcięcia.
- [x] Zapisać dowody i selektywnie commitować: `fix(kid-ui): render clear centered number illustrations`.

## Zadanie 3: Cały przepływ i odbiór poprawki

**Pliki:** `picture-choice-layout.spec.ts` oraz dziennik; ewentualne poprawki ograniczone do plików poprzednich zadań.

- [x] Dodać test wyboru trzeciej opcji bez automatycznego przewijania: najpierw asercja pełnej widoczności i pomiar `scrollTop`, następnie kliknięcie oraz weryfikacja `optionId` w wysłanej próbie.
- [x] Dodać scenariusze oczekiwania na odpowiedź, feedbacku sukcesu i błędu oraz ponowienia ze wsparciem. Test sprawdza blokadę podwójnej odpowiedzi, oznaczenia wyniku i geometrię; trasę odpowiedzi ustawiono na rzeczywiste `/api/v1/kid/tasks/{taskId}/attempts`.
- [x] Dodać regresje dwóch opcji (istniejący test), długiej etykiety, 640×360 i powiększenia. W wyjątkowych warunkach cała treść pozostaje osiągalna. Sprawdzono wybór klawiaturą i widoczność fokusu.
- [x] Uruchomić pełny zestaw E2E z listy; 72 testy przeszły. Obejrzano widoki krótkiego telefonu, tabletu, jasnego i ciemnego motywu. Inspekcja wykryła znaczniki wyniku nachodzące na ilustrację; test najpierw potwierdził nakładanie, następnie po rezerwie miejsca znaczniki są czytelne. Test jednostkowy potwierdził też większą, dominującą wysokość pojedynczego jabłka.
- [x] Uruchomić `corepack pnpm test:unit` (117 plików / 1136 testów), `corepack pnpm typecheck`, `corepack pnpm build` oraz `git diff --check` — PASS. Nie ma zmian serwera ani API; osobne testy integracyjne nie dotyczą tego zakresu.
- [x] Testy zadania 3 i dziennik zapisano w commicie `test(kid-ui): cover picture choice layout and feedback`.

## Końcowe review i integracja

- [x] Uruchomić `requesting-code-review`: dedykowany reviewer sprawdził cały zakres `167579d..1af436f`, zaakceptowany projekt, Review Focus, testy i stan Git. Brak uwag implementacyjnych.
- [x] Dedykowany recenzent `gpt-6.1-sol` (poza rodziną GPT Astra) sprawdził poprawkę review `39beb81`. Jedna Minor dotycząca ścieżki dziennika została rozwiązana; nie pozostały uwagi blokujące.
- [x] Użyć `verification-before-completion`: ponownie sprawdzono czysty stan Git i `git diff --check`; unit, E2E, typecheck i build przeszły po ostatnich zmianach kodu. Fizyczny Galaxy S25 pozostaje niezweryfikowany.
- [ ] Użyć `finishing-a-development-branch`; po ukończeniu całego zakresu i review wypchnąć gałąź roboczą i utworzyć PR do `main`, zgodnie z autoryzacją `AGENTS.md`. W opisie: efekt, dowody RED/GREEN, wyniki, niezależne review, ograniczenie fizycznego urządzenia i brak wpływu API → MCP → skill. Dołączyć PR do czatu. Nie scalać; właściciel wykonuje Squash and merge.

## Samokontrola planu i przekazanie

- [x] Pokryto zaakceptowany układ trzech kafelków, rozmiar odsłuchu, ilustrację liczby oraz stany po odpowiedzi i przy ponowieniu.
- [x] Sprawdzono rzeczywiste ścieżki, kontrakt 2–3 opcji i 1–50, konfigurację `.test.ts`, istniejące fixture i ograniczenie `assertKidLayout`.
- [x] Każdy punkt Review Focus ma przypisane sprawdzenie; testy geometrii mierzą także wewnętrzną strefę, a nie tylko obrys ekranu.
- [x] Brak zmian kodu aplikacji, instalacji, testów wykonawczych, commita, push i PR podczas planowania. Sam plan sprawdzić przez odczyt, kontrolę ścieżek i `git diff --check`.
- [ ] Właściciel przegląda plan. Domyślnie wykonuje go bieżący agent przez `executing-plans`; delegacja implementacji wymaga odrębnej wyraźnej zgody. Rozpoczęcie implementacji następuje po poleceniu wykonania planu.
