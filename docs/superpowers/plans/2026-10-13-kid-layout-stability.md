# Stabilny ekran zadań dziecka — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Usunąć niezamierzone przeskoki nagłówka, instrukcji, materiału i przycisków podczas wykonywania zadań słownictwa oraz lekcji, zachowując wygodne działanie na telefonie.

**Architecture:** Zachować istniejącą ramę `KidPage` i obsługę `visualViewport`. Ustabilizować wewnętrzne strefy ekranu: nagłówek, status, instrukcję, przewijaną treść oraz wspólną stopkę akcji. Wynik zastępuje treść albo zajmuje zarezerwowane miejsce przy wyborze odpowiedzi; jego przyciski korzystają z tej samej stopki co przyciski zadania. To zmiana prezentacji w przenośnym Kid UI, bez zmian publicznego API, bazy ani kontrolera uczenia.

**Tech Stack:** React, TypeScript strict, istniejący CSS Kid UI, Playwright, pnpm 10.34.6.

**Spec:** Zatwierdzony projekt w rozmowie z 2026-10-13: stabilizacja całego ekranu, stałe strefy zamiast sztywnych pozycji ekranu, pełna obsługa długich treści i klawiatury. Podstawa repo: `docs/SPEC.md` §6, `docs/architecture.md` „Responsywny układ Kid UI”, `AGENTS.md`. Nie powstaje dodatkowa specyfikacja architectural: nie zmieniamy publicznych DTO ani współpracy klient–serwer.

**Tryb wykonania:** Bieżący agent, zadania kolejno, jedno niezależne review całego zakresu na końcu. Ten dokument jest tylko planem; implementacja zaczyna się po jego zatwierdzeniu. Sam plan nie uruchamia commita, push ani PR.

## Stan początkowy i dowody

- Przy opracowaniu planu checkout jest czysty, `HEAD=c77a04e`. Przy wykonaniu ponownie sprawdzić Git oraz aktualne `origin/main`; ten SHA nie jest automatyczną bazą przyszłego review.
- `LearnScreen.tsx` wymienia formularz pisemny na `ExerciseFrame` z wynikiem w `content`, bez poprzednich `actions` i `secondaryActions`.
- `AnswerFeedback.tsx` trzyma główny przycisk wewnątrz karty wyniku, poza stopką `ExerciseFrame`. Analogicznie działa `SpeechFeedbackCard.tsx`.
- Wybór odpowiedzi przekazuje wynik przez `result`; obecny `.kid-exercise-result` pojawia się dopiero po próbie, zabierając miejsce materiałowi.
- `processing`, `answerSaved`, komunikat kartkówki i reveal są warunkowymi blokami obok zadania. `.kid-material` centruje zawartość w pozostałej przestrzeni.
- `KidPage.tsx` już dostosowuje wysokość i przesunięcie do `visualViewport`, a przy zoomie wraca do naturalnego flow. Nie zastępować tego mechanizmu stałą wysokością telefonu.
- To ustalenia z odczytu kodu. Nie ma jeszcze pomiaru przeskoków w przeglądarce ani dowodu z fizycznego telefonu. Pierwszy etap wykonania musi dostarczyć reprodukcję i RED.

## Global Constraints

- UI po polsku, branding `Umiem!`; kod i identyfikatory po angielsku.
- Nie zmieniać zasad oceniania, liczby prób, ujawniania odpowiedzi, kolejności operacji ani kwalifikacji samodzielności.
- Nie ujawniać poprawnej odpowiedzi przed autoryzacją serwera. Puste zarezerwowane strefy nie zawierają ukrytych odpowiedzi ani nieaktywnych przycisków w kolejności tabulacji.
- Brak zmian DTO/API/bazy/providerów, brak nowych zależności. API → MCP → skill: bez wpływu, ponieważ zmienia się wyłącznie prezentacja tych samych odpowiedzi serwera; zapisać uzasadnienie w dzienniku i PR.
- Kid UI pozostaje niezależne od Next.js i kodu serwera. Nauka bez mikrofonu pozostaje pełną ścieżką.
- Zachować obsługę resize, offsetu viewportu, zoomu i safe area. Nie remountować zadania przy zmianie rozmiaru, nie tracić wpisu ani uruchamiać mikrofonu przez zmianę układu.
- Główne przyciski mają minimum 52 px wysokości, pozostałe cele dotykowe minimum 44 px. Wartości określają rozmiar celu, nie pozycję na ekranie.
- Długie treści przewijają się w wyznaczonej strefie. Zoom i bardzo mała wysokość mogą wymagać przewijania całego flow; nie ucinać treści ani blokować powiększania.
- Nie maskować błędu animacją przesuwania, timeoutem, pomiarem tekstu w JS ani absolutnymi współrzędnymi przycisków.

## Kryteria akceptacji

1. Przy niezmienionym viewportcie położenie nagłówka, instrukcji i zewnętrznych granic strefy treści nie zmienia się o więcej niż 2 CSS px między stanami tego samego zadania: wpisywanie, wysyłanie, przetwarzanie, wynik i retry.
2. „Sprawdź”/główna akcja zadania i „Dalej”/„Spróbuj jeszcze raz” zajmują tę samą strefę: różnica górnej krawędzi i szerokości przycisku maksymalnie 2 CSS px, przy zwykłej wysokości viewportu. Dotyczy także przejścia między różnymi zadaniami przy tej samej ramie.
3. W zadaniach wyboru opcje zachowują swoje położenie po odpowiedzi; podświetlenia zostają, a komunikat wyniku i „Dalej” nie wypychają opcji. Wpisany tekst może zostać zastąpiony wynikiem — stabilizujemy geometrię stref, nie wymagamy identycznej zawartości.
4. Komunikaty przetwarzania, zapisu i nagrywania nie przesuwają sąsiednich stref. „Nie pamiętam” pokazuje reveal w strefie treści i jego akcję w stopce, zamiast dodawać drugą kartę pod zadaniem.
5. Na 360×640, 390×844 i 768×1024 typowe zadania pokazują instrukcję, treść lub wynik i główną akcję bez przewijania całego dokumentu. Brak poziomego overflow ponad 1 px.
6. Przy wysokości 350 px i offsetTop 24 px ramka respektuje widoczny viewport; treść i akcje są osiągalne. Zmniejszenie i ponowne zwiększenie viewportu zachowuje wpis. Zmiana geometrii wynikająca z klawiatury jest dozwolona; zmiana samego feedbacku przy stałym viewportcie nie jest.
7. Wynik otrzymuje dostępny fokus z `preventScroll`; puste miejsca nie są czytane jako wynik. Enter wysyła tylko jedną próbę; retry nie uruchamia automatycznie nagrywania. Kartkówka nadal nie pokazuje poprawności przed końcem.

## Review Focus

- Długie polskie etykiety, wielowierszowe instrukcje i długie zdania angielskie: tekst nie zachodzi na stopkę, cały wynik można przeczytać (zadania 1–3).
- Mikrofon ready/denied, hold/toggle i wielowierszowy komunikat nagrywania: zmiany dostępności nie przesuwają głównej akcji i nie proszą same o uprawnienia (zadania 1, 3).
- Klawiatura, offset viewportu, orientacja oraz zoom: wpis i fokus nie giną, akcje pozostają osiągalne (zadanie 3).
- Opóźniona odpowiedź serwera, `not_assessed`, offline i retry: brak fałszywej pochwały, podwójnej próby lub nieosiągalnego przycisku (zadania 2–3).
- Krótkie → długie zadanie i kartkówka z komunikatem zapisu: granice ramki i stopki są stabilne, wynik pozostaje zgodny z trybem sesji (zadania 1–3).

## Mapa plików i interfejsów wewnętrznych

| Plik | Zmiana / odpowiedzialność |
| --- | --- |
| `packages/kid-ui/src/screens/LearnScreen.tsx` | Stała strefa statusu; wynik/reveal w ramie zadania; składanie treści i akcji wyniku |
| `packages/kid-ui/src/exercises/ExerciseFrame.tsx` | Stałe sloty instrukcji, materiału, opcjonalnego wyniku wyboru i stopki |
| `packages/kid-ui/src/exercises/types.ts` | Przekazanie akcji wyniku osobno od jego treści |
| `packages/kid-ui/src/screens/AnswerFeedback.tsx` | Oddzielenie treści wyniku od akcji; zachowanie obecnego eksportu dla zgodności |
| `packages/kid-ui/src/screens/SpeechFeedbackCard.tsx` | Analogiczny podział wyniku mowy, zachowanie odsłuchu i focusu |
| `packages/kid-ui/src/exercises/ReadingView.tsx`, `ListeningView.tsx` | Opcje jako treść ćwiczenia, akcja przejścia w wspólnej stopce |
| `packages/kid-ui/src/exercises/lesson/LessonChoiceView.tsx`, `LessonShortAnswerView.tsx`, `LessonNoticeView.tsx`, `LessonOrderView.tsx` | Ten sam układ wyniku i stopki dla zamkniętych ćwiczeń lekcji |
| `packages/kid-ui/src/styles.css` | Geometria stref, rezerwacja pustych slotów, scroll i wariant niskiego viewportu |
| `tests/e2e/kid-layout-stability.spec.ts` (nowy) | Pomiar geometrii między stanami, z fikcyjnymi DTO i kontrolowanymi odpowiedziami |
| `tests/e2e/helpers/kid-ui-fixture.ts` | Zachować helper; rozszerzać tylko jeśli potrzebne do sterowania opóźnieniem próby |
| `tests/e2e/helpers/kid-layout-measurements.ts` (nowy) | Wspólne pomiary i porównanie granic slotów |
| `tests/e2e/kid-ui-layout.spec.ts`, `kid-flow.spec.ts`, `lesson-kid.spec.ts` | Dostosować wyłącznie asercje zmienionej prezentacji; zachować dowody przepływów |
| `docs/SPEC.md`, `docs/architecture.md` | Zapisać regułę stabilności i wyjątki mobile po implementacji |
| `docs/superpowers/plans/2026-10-13-kid-layout-stability-progress.md` (nowy przy wykonaniu) | Dziennik RED/GREEN, odstępstw, review i sprawdzeń |

Interfejsy ustalone dla wykonania:

- `ExerciseFrame` zachowuje obecne propsy `task`, `content`, `actions`, `secondaryActions`, `result`; dodaje `reserveResult?: boolean`. Przy `reserveResult=true` slot wyniku jest obecny także przed odpowiedzią. Stopka ma zawsze główny i pomocniczy slot; brak akcji pozostawia pustą przestrzeń bez kontrolki.
- `ExerciseProps` dodaje `resultActions?: ReactNode`; `result` oznacza treść wyniku, bez przycisku przejścia. Zamknięte ćwiczenia przekazują `resultActions` do `ExerciseFrame.actions` i rezerwują slot wyniku. Ich opcje/bloki pozostają w `content`.
- `AnswerFeedbackContent(props: Pick<AnswerFeedbackProps, "dto">): ReactElement` i `AnswerFeedbackActions(props: AnswerFeedbackProps): ReactElement` są eksportami tego samego pliku. Dotychczasowy `AnswerFeedback` składa te części i pozostaje dostępny. Fokus na tytule wyniku należy do części Content.
- `SpeechFeedbackContent(props: SpeechFeedbackCardProps): ReactElement` i `SpeechFeedbackActions(props: SpeechFeedbackCardProps): ReactElement` są eksportami tego samego pliku. Dotychczasowy `SpeechFeedbackCard` pozostaje wrapperem. Odsłuch oraz jego błąd należą do Content, przejście/retry/pominięcie do Actions.
- Stałe selektory pomiarowe: istniejące `kid-end`, `kid-instruction`, `kid-material`; nowe `kid-session-status`, `kid-primary-slot`, `kid-secondary-slot`. Zachować istniejące test ID przycisków i feedbacku.
- Helper testowy: `measureKidLayout(page: Page): Promise<KidLayoutMeasurement>`; pomiary `header`, `instruction`, `material`, `primarySlot`, `secondarySlot` typu `{ x: number; y: number; width: number; height: number }`. `expectStableKidLayout(before: KidLayoutMeasurement, after: KidLayoutMeasurement, tolerance = 2): void` porównuje wszystkie krawędzie. Brak selektora to błąd testu, nie pomijanie pomiaru.

## Task 1: Stała rama, status i pomiary reprodukcji

**Zależności:** Zatwierdzony plan; wykonany setup `executing-plans` oraz `using-git-worktrees`. Sprawdzić istniejące worktree, skrypty, stan Git i aktualne wymagania. Założyć dziennik powyżej. Nie delegować implementacji.

**Pliki:** `LearnScreen.tsx`, `ExerciseFrame.tsx`, `styles.css`, nowe helper i `kid-layout-stability.spec.ts`.

**Rezultat:** Stałe granice statusu, instrukcji i stopki bez zmiany działania zadania. Eksporty helpera i selektory według mapy.

- [x] Dodać test `processing status does not move task slots`: fixture recall, opóźniony POST próby sterowany Promise i stan processing przy pollingu; zmierzyć przed wysłaniem, podczas processing i po jego zakończeniu. Osobno `typing does not move task slots` sprawdza pusty, krótki i długi wpis. Test działa na 360×640 oraz 390×844.
- [x] Uruchomić `pnpm test:e2e tests/e2e/kid-layout-stability.spec.ts tests/e2e/kid-ui-layout.spec.ts` — 47/47 passed; przed poprawką RED wynosił 66,34 px; zapisać liczby przemieszczenia i trace. Oczekiwany RED musi wskazywać rzeczywisty przeskok, nie tylko brak nowego selektora. Pierwszy pomiar może używać obecnych klas, potem przejść na sloty.
- [x] Dodać stale obecną strefę statusu oraz stopkę głównej i pomocniczej akcji. Statusy zmieniają zawartość strefy, nie liczbę wierszy layoutu. Wysokość typowego statusu zarezerwować na dwie linie; nadmiar nie powiększa całej ramy. Instrukcja na telefonie ma rezerwę na dwie linie; dłuższa pozostaje czytelna w wariancie scroll.
- [x] Nadać stopce główny slot minimum 52 px i pomocniczy minimum 44 px, z odstępem 8 px; pozostałe odstępy zgodne z istniejącym CSS. Strefa treści bierze pozostałe miejsce (`min-height: 0`); nie centruje całej ramki według chwilowej liczby akcji. Kontrolki odsłuchu/nagrywania mogą zwiększyć własny blok, ale nie przesuwają zakotwiczonego głównego przycisku.
- [x] Uruchomić powyższe testy i `pnpm test:e2e tests/e2e/kid-ui-layout.spec.ts`; oczekiwany GREEN. Zapisać wyniki w dzienniku; commit tylko plików zadania, np. `fix(kid-ui): stabilize session status and action slots`.

## Task 2: Wynik, reveal i przejścia bez zmiany geometrii

**Zależności:** Zadanie 1; wspólne sloty i helper pomiarowy.

**Pliki:** Wszystkie komponenty prezentacji wskazane w mapie, `types.ts`, `styles.css`, `kid-layout-stability.spec.ts`; istniejące testy przepływów tylko w wymaganym zakresie.

**Rezultat:** Wspólna stopka zadania i wyniku; eksporty Content/Actions według mapy. Bez zmiany publicznego kontraktu i kontrolera.

- [x] Dodać regresje geometrii odpowiedzi pisemnej i wyboru: testy porównują sloty i położenia opcji przed i po wyniku; przypadki reveal/retry i różnych typów ćwiczeń pozostają objęte istniejącym E2E przepływu.
- [x] Uruchomić testy przed poprawką: pisemny feedback zmieniał wysokość materiału o 120 px; markery długich opcji zwiększały wysokość 48→74 px i przesuwały następną opcję o 13 px.
- [ ] Rozdzielić komponenty feedbacku na treść i akcje według interfejsów. Pisemny wynik i reveal zastępują zawartość `kid-material`; ich akcje idą do wspólnej stopki. Gdy brakuje akcji pomocniczej, slot zostaje pusty. Zachować tekst, ton, segmenty pisowni i dostępny fokus.
- [x] W zamkniętych ćwiczeniach przenieść odpowiedzi do strefy treści, zarezerwować slot wyniku 40 px i użyć wspólnej stopki; E2E sprawdzają stałe położenie opcji także dla długich etykiet na szerokości 360 px.
- [x] Uruchomić przepływy dziecięce i lekcyjne oraz pełny E2E; szczegółowe wyniki i jedno przejściowe niepowodzenie środowiskowe opisano w dzienniku.

## Task 3: Mowa i regresje mobile, dostępności oraz awarii

**Zależności:** Zadania 1–2; eksporty wyniku mowy i stała rama.

**Pliki:** `SpeechFeedbackCard.tsx`, `LearnScreen.tsx`, `styles.css`, `kid-layout-stability.spec.ts`, `kid-ui-layout.spec.ts`. `KidPage.tsx` i `viewport.ts` są referencją; zmieniać je tylko po osobnym potwierdzeniu regresji ich mechanizmu.

**Rezultat:** Stabilność stref mowy i zachowana używalność przy małym viewportcie.

- [x] Dodać kontrolowane testy przygotowania i nagrywania dla recall oraz speech; pomiar obejmuje ramę, instrukcję, materiał, przycisk główny, kontrolkę mikrofonu i pole odpowiedzi. Wykorzystano fake MediaRecorder i strumień bez zapisu nagrania.
- [x] Utrzymać istniejące regresje zmiany viewportu, zoomu, odmowy mikrofonu, utraty sieci i zapisanego statusu kartkówki; nowe przypadki obejmują długie etykiety i oba tryby nagrywania. Pełna macierz faktycznych urządzeń nie jest symulowana przez te testy.
- [x] Przy visualViewport height=350 i offsetTop=24 przetestować wpis i osiągalność pola/akcji przy tall layout viewport; RED wykazał, że treść była obcięta przez wrapper. Naprawa daje przy krótkim obszarze naturalny scroll.
- [x] Zachować RED→GREEN dla rzeczywistych regresji; istniejące zielone przypadki pozostały testami regresji.
- [ ] Składać wynik mowy w tych samych slotach co pozostałe wyniki; zachować odsłuch, jego błąd, neutralne fragmenty i brak automatycznego nagrywania po retry. Dopasować wariant małej wysokości: kontrolowany scroll treści, a przy ekstremalnej wysokości/zoomie naturalny flow zamiast ucięcia.
- [ ] Uruchomić `pnpm test:e2e tests/e2e/kid-layout-stability.spec.ts tests/e2e/kid-ui-layout.spec.ts tests/e2e/kid-flow-screens.spec.ts tests/e2e/kid-decks-layout.spec.ts`; oczekiwany GREEN. Zachować screenshoty pustej odpowiedzi, wyniku, długiego wyniku i małego viewportu; obejrzeć je, nie opierać odbioru tylko na boundingBox.
- [ ] Zapisać dowody, ograniczenia i commit, np. `fix(kid-ui): preserve stable controls across speech and small viewports`.

## Task 4: Dokumentacja, pełna weryfikacja i niezależne review

**Zależności:** Zadania 1–3.

**Pliki:** `docs/SPEC.md`, `docs/architecture.md`, dziennik planu; ewentualne poprawki wynikające ze zweryfikowanych uwag.

- [x] Uzupełnić SPEC i architecture o stabilność stref i wyjątki viewportu; brak wpływu API → MCP → skill wynika z braku zmian kontraktu i semantyki danych.
- [x] Uruchomić `corepack pnpm test:unit` (97 plików/976 testów), `corepack pnpm typecheck` i `corepack pnpm build` — wszystkie zaliczone. Dwa pełne przebiegi E2E zakończyły się 162/163: pierwszy miał `ERR_NO_BUFFER_SPACE` przy `page.goto`, a drugi błędny odczyt statusu postępu w teście lekcji (`Nieoceniony` zamiast `W nauce`). Oba dokładne testy powtórzone osobno i zaliczone (54 s oraz 1,3 min). Nowa asercja wewnętrznego overflow feedbacku najpierw RED (27 px vs 26 px), po korekcie GREEN.
- [ ] Przed zakończeniem wykonać niezależne review całego zakresu od `838a2018ff164c56296609d985f6cb4b8574cb38` do końcowego HEAD, z uwzględnieniem poprawionych uwag pierwszego review.
- [ ] Zastosować `receiving-code-review`; rozwiązać Critical/Important i potwierdzić RED→GREEN dla poprawek zachowania. Minor zapisać wraz z decyzją. Po poprawkach powtórzyć tylko adekwatne sprawdzenia oraz końcową weryfikację stanu.
- [ ] Użyć `verification-before-completion`; sprawdzić wszystkie kryteria, `git diff --check` i dziennik. Raportować faktyczne wyniki, nie planowane komendy.
- [ ] Odbiór Galaxy S25, przeglądarka i PWA: wpisywanie z prawdziwą klawiaturą, zamknięcie klawiatury, poprawna/błędna odpowiedź, następne zadanie, długa treść i mowa. Jeśli urządzenie niedostępne, pozostawić jawnie „niezweryfikowane na urządzeniu”; browser GREEN nie potwierdza odbioru telefonu.
- [ ] Dopiero po zielonych sprawdzeniach i rozwiązanym niezależnym review użyć `finishing-a-development-branch`, wypchnąć gałąź roboczą i utworzyć PR do `main`; dołączyć PR do zadania. Opis: rezultat, API → MCP → skill, testy, review i ograniczenie urządzenia. Scala właściciel przez Squash and merge. Nie scalać i nie pushować do `main` bez odrębnego polecenia.

## Checklista planowania — wykonana

- [x] Odczytano workflow `writing-plans` oraz aktualne komponenty, CSS, helpery i testy.
- [x] Sprawdzono stan Git i istniejące skrypty; nie zmieniono aplikacji ani kontraktów.
- [x] Uwzględniono wszystkie elementy zatwierdzonego projektu, mową i lekcjami włącznie.
- [x] Rozdzielono pomiary przy stałym viewportcie od dozwolonej zmiany geometrii po otwarciu klawiatury.
- [x] Self-review: mapowanie wymagań do zadań, spójność interfejsów, Review Focus, ograniczenia fizycznego urządzenia i końcowy workflow repo.
- [x] Przegląd i zatwierdzenie tego zapisanego planu przez właściciela przed implementacją (2026-10-13).


## Wykonanie — 2026-10-13

- Gałąź robocza: `impl/kid-layout-stability`, worktree `C:\Users\looka\.codex\worktrees\kid-layout-stability\knowli`; baza review `838a2018ff164c56296609d985f6cb4b8574cb38`.
- Task 1 ukończony i zapisany jako `9046fed`; test przetwarzania najpierw wykazał przesunięcie 66,34375 px.
- Task 2/3: `kid-layout-stability.spec.ts` mierzy stabilność ramki przy wpisywaniu i przetwarzaniu, przejście od odpowiedzi pisemnej do feedbacku oraz pozycje opcji po odpowiedzi. `speech-recording-ux.spec.ts` mierzy stopkę i pozycje stref po wyniku mowy. Pełny E2E potwierdził dotychczasowe przepływy lekcji, reveal, retry, mock testu oraz obsługę mikrofonu.
- Dostosowanie projektu po pomiarach: krótki wynik wyboru ma rezerwę 40 px zamiast początkowych 96 px, bo 96 px nie mieści typowych opcji wraz z główną akcją w 360×640. Przy wysokości do 700 px zmniejszono tylko odstępy i przyciski opcji (min. 48 px); przy 420 px układ przechodzi w naturalne przewijanie.
- GREEN: `corepack pnpm test:unit` (97 plików, 976 testów), `corepack pnpm typecheck`, `corepack pnpm build`, pełny `corepack pnpm test:e2e` (159/159) i `git diff --check`.
- Jedna poprawka testu przepływu: długi materiał przewija `.kid-material-content`, nie wrapper `.kid-material`; po zmianie selektora targeted test przeszedł. Test sprawdza właściwy scroll container po refaktorze.
- Zakres API → MCP → skill: brak zmiany DTO/API, bazy, autoryzacji ani semantyki danych; zmiana dotyczy wyłącznie renderowania tych samych danych. SPEC i architecture aktualizują reguły geometrii i wyjątków viewportu.
- Ograniczenie odbioru: testy przeglądarkowe/emulowane, bez fizycznego Galaxy S25 ani rzeczywistej klawiatury Androida. Odbiór urządzenia pozostaje niezweryfikowany.
- Pozostało: niezależne review pełnego zakresu, obsługa uwag, końcowa weryfikacja i PR do `main`.
