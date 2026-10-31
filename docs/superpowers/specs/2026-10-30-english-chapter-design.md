# Źródła i lekcja „Angielski — rozdział” — projekt

Data: 2026-10-30 (wersja 2 po przeglądzie trzech krytyków — dziennik w sekcji 12). Podstawa: zestawienie typów zadań z zeszytu ćwiczeń 2. klasy (Starter, Unit 1–2) z typami ćwiczeń Umiem! oraz decyzje właściciela podjęte w rozmowie (wariant A zadań, wariant A lektora, przedmiot jako osobny `SubjectModule`, „źródło” jako osobny byt). Status: projekt zaakceptowany przez właściciela 2026-10-30; Etap 1 (przedmiot z wklejonym materiałem) zaimplementowany — stan i wynik próby w sekcji 10; następne etapy czekają na osobne plany.

## 1. Cel

Dziecko ćwiczy słownictwo i ramy zdaniowe z bieżącego rozdziału podręcznika angielskiego w zadaniach podobnych do zeszytu ćwiczeń: połącz, pogrupuj, uzupełnij tekst z bankiem słów, wybierz słowo w zdaniu, ułóż zdanie, wpisz słowo, przetłumacz krótkie zdanie. Zestawy słówek nadal ćwiczą pojedyncze słowa z powtórkami; lekcja rozdziału dokłada poziom zdania.

Rodzic wkleja tekst rozdziału raz — jako **źródło** — i tworzy z niego osobno lekcję rozdziału, zestaw słówek albo lekcję szkolną. Każde utworzenie jest dzisiejszą, niezależną operacją z własnym szkicem, przeglądem i publikacją; nie ma wspólnej transakcji ani automatycznego łańcucha.

Sukces: dziecko ćwiczy w aplikacji te same rodzaje zadań co na sprawdzianie z rozdziału, wyłącznie na słowach z rozdziału, a rodzic widzi, które zagadnienia (np. „Pogoda”, „Rama: I'm wearing…”) sprawiają trudność.

## 2. Ograniczenia globalne

- Interfejs po polsku; polecenia zadań po polsku, treść i odpowiedzi lekcji rozdziału po angielsku (`en-GB`).
- Opublikowana treść, wydany prompt, klucz odpowiedzi i zakończona ocena pozostają niezmienne. Zestaw utworzony ze źródła przechowuje własną kopię tekstu.
- Nowy przedmiot to katalog `subjects/english-chapter/` i wpis w rejestrze. Silnik lekcji dostaje kilka **generycznych** opcji `SubjectModule` (sekcja 4.1), z których korzysta ten przedmiot; żadna gałąź silnika nie sprawdza identyfikatora przedmiotu (test architektoniczny bez zmian).
- Kid DTO bez klucza odpowiedzi; nagranie poprawnego zdania ujawniane wyłącznie w omówieniu, po zapisaniu oceny.
- Zadania zamknięte (stukane) oceniane deterministycznie, bez modelu. Wpisane odpowiedzi (luka, tłumaczenie) niedopasowane do wariantów idą do cache werdyktów i modelu oceniającego, gdy jest skonfigurowany; awaria lub brak modelu = „nieocenione” bez kary.
- Cała ścieżka działa bez mikrofonu. Nie dodajemy odpowiedzi mówionych w lekcji rozdziału.
- Bez nowych widoków ćwiczeń w Kid UI (wariant A). Bez uploadu plików i OCR — źródło to wklejony tekst.
- Źródło to treść podręcznika od rodzica, bez danych dziecka. Do modeli trafia jak dzisiejszy materiał lekcji. Materiał z prawdziwego podręcznika używany do próby (sekcja 10) nie trafia do repozytorium.

## 3. Źródła

### 3.1. Model danych

Nowa tabela `source_materials` w obszarze `materials/`:

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | uuid PK | |
| `client_request_id` | uuid unique | idempotencja tworzenia |
| `request_hash` | text | skrót znormalizowanego tytułu i treści z pierwszego żądania |
| `title` | text | 1–120 znaków po trim |
| `body` | text | 1–16 000 znaków po trim (limit `MAX_SCHOOL_MATERIAL_LENGTH`) |
| `revision` | integer | od 1; rośnie przy każdej edycji (kontrola współbieżności) |
| `created_at`, `updated_at` | timestamptz | |

Nowe kolumny w `decks`:

- `source_material_id uuid null references source_materials(id) on delete set null`,
- `source_material_revision integer null` — rewizja źródła skopiowana przy tworzeniu.

Odnośnik jest informacją o pochodzeniu; treść zestawu nigdy nie jest czytana ze źródła po utworzeniu. Migracja Drizzle z przeglądanym SQL; `docs/schema.sql` uzupełniony.

### 3.2. Operacje (rodzic, Parent Mode)

- `createSourceMaterial({ clientRequestId, title, body })` — ponowienie z tym samym `clientRequestId` i tą samą treścią zwraca istniejący rekord; z inną treścią → `conflict`. Ponowienie po usunięciu źródła tworzy je od nowa (świadomie akceptowany przypadek brzegowy; bez nagrobków).
- `updateSourceMaterial({ id, expectedRevision, title?, body? })` — rozbieżna `expectedRevision` → `conflict`.
- `deleteSourceMaterial({ id })` — usuwa źródło; zestawy zostają, odnośnik staje się `null`.
- `listSourceMaterials()` — tytuł, daty, liczba niezarchiwizowanych zestawów z tym źródłem.
- `getSourceMaterial({ id })` — pełny tekst i lista zestawów utworzonych z tego źródła (tytuł, rodzaj, stan, czy skopiowana rewizja jest starsza od bieżącej).

Każda operacja wymaga sesji rodzica i serwerowej autoryzacji, jak operacje na zestawach. Źródła nie są widoczne w Kid API.

### 3.3. Tworzenie zestawu ze źródła

Komendy tworzenia przyjmują `sourceMaterialId` jako alternatywę dla wklejonego tekstu (dokładnie jedno z dwóch; oba albo żadne → `validation`). Serwer w transakcji tworzenia:

1. czyta `body` i `revision` źródła z blokadą `FOR KEY SHARE` (równoległe usunięcie czeka; brak źródła → `not_found`, nie błąd 500 z naruszenia klucza obcego),
2. kopiuje tekst w to samo miejsce, w którym zestaw przechowuje dziś materiał,
3. zapisuje `decks.source_material_id` i `decks.source_material_revision`.

Co dzieje się z kopią później:

- **Lekcje:** kopia jest w `lesson_context.material`; dogenerowanie, regeneracja zagadnienia, edycja i nowa wersja korzystają z niej.
- **Słówka:** kopia jest tylko w zapisanym inpucie pierwszego runu generacji. Słówka nie mają dogenerowania z materiału, a nowa wersja nie generuje ponownie — odnośnik jest wyłącznie informacją o pochodzeniu.

Edycja źródła nie zmienia istniejących zestawów.

### 3.4. Panel rodzica

- Nowa zakładka **„Źródła”** (w UI słowo „materiał” oznacza już zestaw albo lekcję — stąd inna nazwa).
- Lista źródeł: tytuł, data zmiany, liczba zestawów; przycisk „Nowe źródło” (tytuł + pole tekstowe z licznikiem znaków).
- Strona źródła: podgląd i edycja tekstu, usunięcie z potwierdzeniem podającym liczbę zestawów, lista zestawów z tego źródła oraz przyciski „Utwórz lekcję rozdziału”, „Utwórz lekcję szkolną” i (po wdrożeniu sekcji 6) „Utwórz zestaw słówek”. Przycisk otwiera dzisiejszy formularz z tekstem źródła zablokowanym do podglądu.
- Edytor zestawu ze źródła pokazuje „Ze źródła: <tytuł>” z linkiem, a gdy źródło zmieniono po utworzeniu zestawu — „Źródło zmieniono od utworzenia tego zestawu”.
- Komunikaty w `messages.ts`; Mantine wyłącznie w `apps/web/src/parent`.

## 4. Przedmiot `english_chapter`

### 4.1. Moduł i nowe opcje silnika

`subjects/english-chapter/module.ts`:

| Pole | Wartość |
|---|---|
| `id` | `english_chapter` |
| `titlePl` | „Angielski — rozdział” |
| `answerLocale` / `promptLocale` | `en-GB` / `pl-PL` |
| `exerciseTypes` | `lesson_card`, `lesson_match`, `lesson_group`, `lesson_cloze`, `lesson_choice`, `lesson_order`, `lesson_gap`, `lesson_open_answer` |
| `normalizer` | normalizator angielski przeniesiony z `english-grammar/` do `subjects/english/` (bez zmiany zachowania, więc klucze cache werdyktów gramatyki zostają; każda przyszła zmiana dotknie obu przedmiotów) |
| `topics` | `[]` — temat dynamiczny z materiału (`buildDynamicTopic`) |
| `usesV3Payload` | nie ustawione (domyślnie `false`) — bez pól v3 i oceny dwuwymiarowej |
| `poolDeduplication` | `exercise` |
| `poolMinimums` | `{ guided: 3, productive: 3, independent: 2 }` |
| `ttsForAnswers` / `ttsForPrompts` | `false` / `false` |
| `spokenAnswers` | brak |

Nowe, opcjonalne i generyczne opcje `SubjectModule` (domyślne wartości zachowują dzisiejsze zachowanie `school` i `english_grammar`):

| Opcja | Znaczenie | `school` | `english_chapter` |
|---|---|---|---|
| `sourceQuotes` | czy ćwiczenia wymagają cytatów `sourceRefs`; steruje `groundingRequired` w generacji i wymaganiem `sourceRefs` w gałęziach schematu match/group/cloze (dziś wymagane zawsze, a dla przedmiotu bez v3 każde takie ćwiczenie byłoby odrzucone) | `true` | `false` |
| `refineGeneratedPool(drafts, { material })` | walidacja i czyszczenie **tylko świeżo wygenerowanych** ćwiczeń (odrzuca ćwiczenie albo usuwa pojedyncze warianty lub niezamówione pola); nie działa przy edycji rodzica ani publikacji, w odróżnieniu od `validatePoolExtra` | brak | walidacja słownikowa i usuwanie niezamówionych pól v3 (4.4) |
| `materialSubjectTitle` | skąd tytuł przedmiotu zestawu z materiału: `"parent"` — nazwę podaje rodzic, `"fixed"` — stały `titlePl`; brak = przedmiot katalogowy. Wspólny predykat z katalogiem przedmiotów i poleceniami tworzenia (4.6). Opcja dodana podczas wdrożenia; `validateSubject` wymaga jej razem z `buildDynamicTopic` | `"parent"` | `"fixed"` |
| `instructionIsStimulus` | polecenie niesie bodziec znaczenia: tożsamość ćwiczeń `lesson_choice`, `lesson_gap`, `lesson_order` (`exercise-identity.ts`) uwzględnia znormalizowane `instructionPl` | `false` | `true` |
| `exposureText(draft)` | tekst, z którego liczony jest `targetKey` ćwiczenia (dziś zawsze `answer`) | brak | 4.5 |
| `normalizeExposureText(text)` | normalizacja tekstu przed `computeTargetKey` dla każdej ekspozycji lekcji przedmiotu — ćwiczeń i przykładów kart (`lessonTextTargetKey`); dodana po końcowym przeglądzie Etapu 1 | brak | 4.5 |
| `openAnswerPromptLocale` | język pytania `lesson_open_answer` wysyłany w Kid DTO | brak (reguła jak dziś) | `pl-PL` |
| `ttsForFeedback` | nagranie poprawnego zdania w omówieniu (sekcja 5); dopiero w Etapie 3 | `false` | `true` |
| `prompts.objectivesRules` | reguły etapu zagadnień (`LessonObjectivesInput` dostaje pole, adapter je dokleja) | brak | 4.2 |
| `prompts.typeRules` | opisy typów match/group/cloze dla promptu puli — przeniesione z adaptera (`llm.ts`) do profilu przedmiotu | dzisiejszy tekst z adaptera bez zmian | 4.3 |

Kategorie błędów (z polskimi szablonami podpowiedzi): przedmiotowe `wrong_word` „Pomylone słowo” i `spelling` „Pisownia” oraz bazowe `incomplete` „Niepełna odpowiedź” i `wrong_order` „Zła kolejność”, które każde zagadnienie dostaje z przedmiotem. Rozstrzygnięcie podczas wdrożenia: pierwsza wersja projektu zakładała własne `word_order` i `missing_word`, ale kategorie bazowe znaczą to samo, a zdublowane kody rozpraszałyby raport rodzica (koszt błędnej decyzji: dopisanie dwóch kodów później).

`validateExercise` przedmiotu:

- `lesson_choice` i `lesson_gap`: `stem` z dokładnie jedną luką (`/_{2,}/`);
- `lesson_choice`, `lesson_gap`, `lesson_order`, `lesson_cloze`: `instructionPl` niesie polskie zdanie-bodziec — różne od stałych poleceń typów w `messages.kid`, dłuższe niż samo polecenie i z granicą zdania, po której jest dalszy tekst (`/[.!?:]\s+\S/`, np. „Dziś pada deszcz. Wybierz słowo.”; samo „Wybierz właściwe słowo.” nie przechodzi) — uzupełnianie tekstu dołączono po końcowym przeglądzie;
- `lesson_open_answer`: niepuste `instructionPl` (stałe „Przetłumacz na angielski.”) — bez niego dziecko widziało tylko tytuł zagadnienia;
- pole `hint` niedozwolone (bodziec jest w poleceniu, bo kartkówka usuwa `hint` z luki — `lesson-materialize.ts:294`);
- `lesson_order`: żadne dwa klocki nie mają tego samego tekstu po normalizacji (ocena porównuje identyfikatory klocków, więc zamiana dwóch „a” dałaby fałszywy błąd);
- odpowiedź i warianty ≤120 znaków (limit przedmiotów bez v3).

W kodzie `validateExercise` przedmiotu obejmuje pierwsze pięć reguł; jedną lukę `lesson_gap` i limit 120 znaków egzekwuje już walidacja ogólna silnika (`pool-validation.ts`), więc przedmiot ich nie powiela (jeden komunikat dla rodzica).

### 4.2. Zagadnienia

Model dzieli materiał na **3–5** zagadnień (`objectivesRules`), żeby przy dwóch nowych zagadnieniach na sesję wszystkie pojawiły się w 2–3 sesjach. `DynamicObjectiveData` dostaje opcjonalne `kind: "words" | "frame"` (przedmiot szkolny go nie ustawia):

- **words** — grupa słów, np. „Ubrania”, „Pogoda”: 4–12 słów i zwrotów z materiału;
- **frame** — rama zdaniowa, np. „I'm wearing (a) …”, „What's the weather like? It's …”; sprawdzaną częścią jest konstrukcja, a słowa z zagadnień `words` są tylko wypełnieniem.

Każde słowo należy głównie do jednego zagadnienia. `buildDynamicTopic` przypisuje typy ćwiczeń według rodzaju:

| Rodzaj | Typy |
|---|---|
| words | card, match, group, choice, cloze, gap, open_answer |
| frame | card, match (pytanie ↔ odpowiedź), order, choice, cloze, gap, open_answer |

Karty (2–4): lista „słowo — polskie znaczenie” albo wzór ramy z 1–3 przykładami po angielsku **bez polskich tłumaczeń**; żadna karta nie niesie pary zdań polskie → angielskie (karta słów może wypisywać pojedyncze słowa z polskim znaczeniem). Treść karty nie jest ekspozycją, więc para zdań na karcie ujawniałaby rozwiązanie tłumaczenia bez zapisu (4.5). Identyfikatory zagadnień mają prefiks identyfikatora przedmiotu (`english_chapter.d<deckId>.<slug>`); dziś prefiks `school.d` jest wpisany na stałe (`lesson-drafts.ts:448`), a dla przedmiotu szkolnego pozostaje bez zmian.

### 4.3. Typy zadań i etapy

Mapowanie etapów w `STAGE_BY_TYPE` bez zmian.

| Etap | Typ | Treść | Bodziec znaczenia |
|---|---|---|---|
| guided | `lesson_match` | lewa strona po angielsku (słowo, zwrot albo pytanie z rozdziału), prawa: polskie znaczenie albo angielska odpowiedź; 3–5 par + 0–2 dystraktory | strona polska / para pytanie–odpowiedź |
| guided | `lesson_group` | tylko gdy słowa zagadnienia dzielą się naturalnie na 2–3 kategorie; polskie etykiety, 4–8 angielskich elementów | etykiety grup |
| guided | `lesson_cloze` | 2–3 krótkie zdania z ram rozdziału (całe `instructionPl` — polskie znaczenie i komenda — najwyżej 120 znaków), 2–4 luki na słowa z rozdziału, 1–2 słowa-pułapki z materiału; każda luka jednoznaczna, luki niezamienialne, pułapka nie pasuje do znaczenia żadnej luki (ocena całościowa) | polskie znaczenie całego tekstu w `instructionPl` („W poniedziałek pada deszcz. W środę wieje wiatr. Uzupełnij tekst.”) |
| guided | `lesson_choice` | angielskie zdanie z luką w `stem`, 2–3 opcje | polskie zdanie w `instructionPl` („Dziś pada śnieg. Wybierz słowo.”) |
| guided | `lesson_order` | klocki-słowa zdania z ramy; zdania bez przestawnych części (jedna poprawna kolejność) | polskie zdanie w `instructionPl` („Ułóż zdanie: Mam na sobie różowy płaszcz.”) |
| productive | `lesson_gap` | angielskie zdanie z jedną luką | polskie zdanie w `instructionPl` („Mam na sobie zielony płaszcz. Wpisz brakujące słowo.”) |
| independent | `lesson_open_answer` | tłumaczenie krótkiego zdania; `prompt` = polskie zdanie, odpowiedź ≤120 znaków; `instructionPl` zawsze „Przetłumacz na angielski.” | polskie zdanie |

`prompts.typeRules` i `fieldRules` przedmiotu opisują powyższe wprost (prawa strona par po polsku albo angielska odpowiedź, luki cloze na słowa z rozdziału, bodziec w `instructionPl`, brak `hint`). W parach dodatkowa pozycja po prawej nigdy nie jest poprawnym partnerem żadnej pozycji z lewej, a w parach pytanie ↔ odpowiedź nie jest poprawną odpowiedzią na żadne pytanie z listy (próba: „inna odpowiedź na to samo pytanie” dawała dwie poprawne odpowiedzi). Test sprawdza złożony tekst promptu dla obu przedmiotów.

### 4.4. Zgodność z materiałem (walidacja słownikowa, tylko generacja)

Działa w `refineGeneratedPool`, więc nie ogranicza rodzica: przy edycji i publikacji rodzic może dopisać słowo albo wariant spoza materiału.

**Słownik materiału.** Tokeny po normalizacji:

- NFC, małe litery, `’`→`'`;
- apostrof wewnątrz słowa zostaje (`i'm`, `it's`), reszta interpunkcji znika;
- wyraz z łącznikiem daje token całości i tokeny części (`t-shirt`, `t`, `shirt`);
- skróty rozwijane normalizatorem angielskim po obu stronach porównania;
- prosta odmiana: token pasuje, gdy po odcięciu końcówki `-s`, `-es`, `-ies`→`-y`, `-ing` lub `-ed` (z podwojoną spółgłoską) zgadza się z tokenem materiału albo odwrotnie (`boots`/`boot`, `raining`/`rain`).

`FUNCTION_WORDS` to stała, testowana lista około 60 słów funkcyjnych w module.

**Element sprawdzany** spełnia dwa warunki: każdy jego token jest w słowniku materiału albo w `FUNCTION_WORDS`, a co najmniej jeden token jest w słowniku i nie jest słowem funkcyjnym. Wiodące `a`/`an`/`the`/`to` są pomijane.

| Typ | Co jest sprawdzane | Skutek niepowodzenia |
|---|---|---|
| `lesson_match` | każde `left` | odrzucenie ćwiczenia |
| `lesson_group` | każdy element | odrzucenie ćwiczenia |
| `lesson_cloze` | każde `gapAnswers` i `extraWords` | odrzucenie ćwiczenia |
| `lesson_choice` | każda opcja | odrzucenie ćwiczenia |
| `lesson_order` | zdanie odpowiedzi | odrzucenie ćwiczenia |
| `lesson_gap`, `lesson_open_answer` | `answer` | odrzucenie ćwiczenia |
| `lesson_gap`, `lesson_open_answer` | `acceptedAnswers` spoza materiału | usunięcie samego wariantu, ćwiczenie zostaje |

**Niezamówione pola v3 (dodane podczas strojenia po próbie).** `refineGeneratedPool` usuwa ze świeżego ćwiczenia pola v3, których przedmiot nie żąda (`questionType`, `requiredElements`, `supplementaryElements`, `commonErrors`, `expectedForm`, `familyId`, `sourceRefs`), zamiast je odrzucać. Prawdziwy model potrafił wypełnić je dla całej partii mimo polecenia „null” (w próbie cytaty `sourceRefs` w jednej z czterech partii), a walidacja ogólna odrzuca takie ćwiczenie jako „pole v3 niedozwolone”, więc tracona była cała partia zagadnienia. To niepożądany dodatek modelu, nie dane rodzica; lista pól pochodzi z walidacji ogólnej (`V3_EXERCISE_FIELDS`) bez `calculation` — specyfikacja rachunku to inny typ ćwiczenia, który ma zostać odrzucony przez walidację, a nie po cichu naprawiony. Dane rodzica (edycja, publikacja) tej naprawie nie podlegają.

**Brakujące polecenie tłumaczenia (dodane po końcowym przeglądzie).** Prawdziwy model zwracał `instructionPl: null` w 20–50% tłumaczeń, a materializacja pokazywała wtedy tytuł zagadnienia zamiast polecenia. Prompt każe dawać dokładnie „Przetłumacz na angielski.”, `refineGeneratedPool` uzupełnia brakujące lub puste polecenie tłumaczenia tym tekstem (jak usuwanie niezamówionych pól: naprawa świeżego wyjścia modelu), a `validateExercise` wymaga niepustego polecenia.

**Raport dla rodzica.** Powody odrzuceń są zliczane (np. „słowo spoza materiału: raining ×3”, „tylko słowa pomocnicze: the ×1” — element złożony wyłącznie ze słów funkcyjnych) w `lesson_context.rejectedReasons` obok dzisiejszego `rejectedCount` i pokazywane w edytorze lekcji, żeby rodzic wiedział, czy dogenerować. To zliczenia bez danych dziecka. Powody dotyczą tylko sprawdzania słów z materiału, a `rejectedCount` liczy wszystkie odrzucenia generacji, więc edytor podpisuje listę „Powody odrzuceń przy sprawdzaniu słów z materiału” i dopisuje „inne powody: N”, gdy `rejectedCount` przekracza sumę wypisanych powodów.

**Znane ograniczenia:**

- słowa z poleceń podręcznika („listen”, „tick”) wklejone w materiał liczą się jako słownictwo;
- przykłady na kartach i zdania-bodźce nie są sprawdzane (tylko reguła w prompcie i przegląd rodzica);
- rozdziału, którego kluczowym materiałem są słowa funkcyjne (przyimki in/on/under, can/can't, this/these, is/are, do/does, he/she), nie da się ćwiczyć na tych słowach jako opcjach, lukach ani słowach banku: reguła słownikowa wymaga w elemencie co najmniej jednego słowa treści, więc takie ćwiczenia odpadają z powodem „tylko słowa pomocnicze”. Przed użyciem z takim rozdziałem warto wykonać próbę (`pnpm probe:chapter`) na rozdziale o przyimkach albo o can/can't.

### 4.5. Ocena, samodzielność, opanowanie, kartkówka

**Ocena:**

- Porównanie z zatwierdzonymi wariantami po normalizacji (`I'm` = `I am`).
- Wpisana odpowiedź niedopasowana do wariantów (luka i tłumaczenie) idzie do cache werdyktów, a potem do modelu oceniającego (standardowa ścieżka lekcji). Model dostaje polecenie z polskim bodźcem (`buildGraderInput` przekazuje `instructionPl`).
- `almostDefinition` zgodne z semantyką silnika (`evaluate.ts:577-600`): drobna literówka poza sprawdzanym słowem to `almost` bez kategorii (zaliczone); błąd w sprawdzanym słowie to `incorrect` z kategorią `spelling` albo `wrong_word`.
- `gradingRole`: zdanie ma oddawać znaczenie polskiego zdania; poprawny synonim spoza rozdziału jest co najwyżej `almost`, nie błędem.

**Samodzielność — decyzja dla tego przedmiotu.** Lekcja rozdziału sprawdza użycie słowa w zdaniu, więc ekspozycją jest **rozwiązane zdanie**, a nie pojedyncze słowo. `exposureText`:

| Typ | Tekst ekspozycji |
|---|---|
| `lesson_choice`, `lesson_gap` | zdanie ze wstawioną odpowiedzią |
| `lesson_cloze` | cały uzupełniony tekst |
| `lesson_order`, `lesson_open_answer` | `answer` |
| `lesson_match`, `lesson_group` | jak dziś (złączona odpowiedź) |

Tekst ekspozycji jest normalizowany przed `computeTargetKey` (`normalizeChapterExposureText`, opcja `normalizeExposureText`): typograficzne apostrofy i cudzysłowy → proste, wielokrotne spacje → jedna, bez końcowej interpunkcji `.!?…`. Dzięki temu „It's snowing.” i „It’s snowing” to ta sama ekspozycja. Ta sama normalizacja obejmuje przykłady kart (`lessonTextTargetKey` w `materializeCard`), więc przykład „I’m wearing a pink coat.” i luka rozwiązana do „I'm wearing a pink coat” mają jeden klucz (przed końcowym przeglądem klucz przykładu zachowywał kropkę i luka po karcie liczyła się jako samodzielna). `exposureText` i `normalizeExposureText` są utrwalonym kontraktem: edycja rodzica przelicza klucze rewizji, a skopiowane szkice i opublikowane wersje zachowują zapisane, więc ich zmiana wymaga decyzji o migracji lub uzupełnieniu kluczy.

Skutki tej decyzji:

- zadanie samodzielne = zdanie, którego rozwiązania dziecko jeszcze nie widziało;
- treść karty i słowo widoczne w parach, grupach lub banku słów nie są ekspozycją (jak dziś w lekcjach); ekspozycją karty są wyłącznie jej przykłady (`lesson_context.examples`), dlatego karty nie niosą par zdań polskie → angielskie (4.2);
- klucze lekcji i słówek pokrywają się dokładnie wtedy, gdy tekst po normalizacji i język są równe — dla pojedynczych słów i wielowyrazowych zwrotów (np. tłumaczenie „poniedziałek” → „Monday” i słówko „Monday” albo „Pada deszcz.” → „It's raining.” i słówko „It's raining”); ekspozycje są wspólne dla dziecka. Zwykle klucz zdania nie pokrywa się z celem słówka, więc zdania lekcji i słówka się nie blokują. Przy pokryciu blokada jest w praktyce asymetryczna: słówka liczą samodzielność w oknie 300 s od ujawnienia, lekcje — od jakiegokolwiek wcześniejszego ujawnienia, więc ekspozycja słówka trwale odbiera samodzielność tłumaczeniu rozdziału o identycznym tekście, a ekspozycja z lekcji blokuje słówko tylko na 300 s (do uwzględnienia w Etapie 4, słówkach ze źródła);
- znane ograniczenie: słowo pokazane w lekcji tylko jako część treści karty, par, grupy, banku albo zdania nie chroni samodzielnego przypominania tego słowa w zestawie słówek;
- znane ograniczenie (ziarnistość uzupełniania tekstu): kluczem tekstu z lukami jest cały uzupełniony tekst, więc zdanie rozwiązane wewnątrz uzupełniania nie blokuje luki ani tłumaczenia tego samego zdania.

**Opanowanie:** jak dziś w lekcjach — trzy ostatnie kwalifikujące sukcesy na różnych ćwiczeniach, w tym jeden w późniejszej sesji innego dnia po ≥12 h.

- Należne sprawdzenia samodzielne wybierają najpierw tłumaczenie, a lukę na niewidzianym zdaniu dopiero jako zapas (`scheduler.ts:350-375`).
- Bez modelu tłumaczenie zalicza tylko dokładne trafienie w wariant (inaczej „nieocenione” bez kary).
- Luka na niewidzianym zdaniu działa bez modelu.

**Kartkówka:** jak w lekcjach. Bodziec zostaje, bo jest w `instructionPl`. Pary, grupy i luki z bankiem są w niej nauką wspomaganą. Raport per zagadnienie.

### 4.6. Tworzenie lekcji

- `createSchoolLesson` jest cienką komendą nad wspólnym `createMaterialLesson(services, { subjectId, subjectTitlePl?, … })` dla przedmiotów z `buildDynamicTopic` (zaimplementowane w Etapie 1).
- `SubjectCatalogDto` dostaje jawne `creation: "catalog" | "material"` oraz `subjectTitleRequired`. Formularz rodzica wybiera ścieżkę po tych polach, a nie po pustej liście tematów — dziś `isSchoolSubject` uznałby `english_chapter` za szkołę (`NewLessonForm.tsx:68-71`). Pola wyprowadza ten sam predykat co polecenia tworzenia (`domain/lessons/material-creation.ts`, opcja `materialSubjectTitle`), żeby formularz nie obiecywał ścieżki, którą serwer odrzuci.
- Nowa komenda `MaterialLessonCommand` (zamiast pierwotnie planowanej `ChapterLessonCommand`: jest ogólna dla przedmiotów o stałym tytule, nie tylko dla rozdziału) z procedurą oRPC `lessons.createFromMaterial` (POST `/lessons/material`, 202 `{ runId, deckId }`):
  - `clientRequestId`,
  - `subjectId` (przedmiot o `materialSubjectTitle: "fixed"`; przedmiot katalogowy i szkolny → `validation`),
  - `topicTitlePl` (np. „Unit 1”, 1–120),
  - `material` (1–16 000 znaków); `sourceMaterialId` jako alternatywa (3.3) dojdzie w Etapie 2,
  - opcjonalnie `instruction` (≤500), `poolSize`, `deckId`.

  Tytuł zestawu: „Angielski — rozdział: <topicTitlePl>” (tytuł przedmiotu z modułu, dwukropek, tytuł tematu; przycięty do 120 znaków), a nie pierwotne „Angielski: <topicTitlePl>”.
- Fałszywy provider dostaje gałąź `english_chapter` (bez `sourceRefs`, z polskim bodźcem w poleceniu, z `kind` zagadnień).

### 4.7. Języki w Kid DTO i panel rodzica

- Prompty `lesson_match`, `lesson_group`, `lesson_cloze`, `lesson_choice`, `lesson_order` i `lesson_gap` dostają opcjonalne `contentLocale`. Silnik ustawia je zawsze na `answerLocale` przedmiotu: dla każdego przedmiotu treść tych typów jest w języku odpowiedzi (szkoła `pl-PL`, gramatyka i rozdział `en-GB`), więc nie ma gałęzi po identyfikatorze przedmiotu.
- `lesson_open_answer` dostaje opcjonalne `answerLocale` (język pola odpowiedzi), a `promptLocale` bierze z `openAnswerPromptLocale`, gdy przedmiot je ma (inaczej reguła jak dziś). Kid UI ustawia `lang` pola odpowiedzi z `answerLocale`, a nie z `promptLocale` jak dziś (`LessonSentenceView.tsx:58-71`). Nowy klient ze starszym serwerem (bez nowych pól) działa jak dotąd; w odwrotnym kierunku obowiązuje uwaga o wdrożeniu w sekcji 7.
- Kid UI oznacza `lang` treść o pewnym języku: lewą kolumnę par, elementy grup, tekst cloze i bank słów, `stem` i opcje wyboru, klocki, zdanie z luką i samo pole luki (język odpowiedzi, jak pole tłumaczenia). Prawa kolumna par i etykiety grup nie dostają `lang` treści. Bez nowych widoków i wzorców interakcji. `lang` działa pewnie dla tekstu nieinteraktywnego; przycisk z polską etykietą `aria-label` wewnątrz elementu `lang="en-GB"` czytnik ekranu może przeczytać angielskim głosem (do poprawy w Kid UI, poza Etapem 1).
- Panel rodzica: przedmiot „Angielski — rozdział” w formularzu nowej lekcji (tytuł + materiał wklejony albo ze źródła); edytor bez nowych edytorów typów, z podsumowaniem powodów odrzuceń (4.4) i — gdy jest — rodzajem zagadnienia.

## 5. Lektor po odpowiedzi

### 5.1. Zachowanie

W omówieniu zadania treningowego (po dobrej i złej odpowiedzi) przy poprawnym zdaniu jest głośnik; dotknięcie odtwarza zdanie po angielsku głosem `en-GB`. Nagranie nie odtwarza się samo, nie zmienia oceny ani samodzielności. W próbnej kartkówce lektora nie ma (próby kartkówki zapisują `feedback = null`).

### 5.2. Tekst nagrania

Czysta funkcja domenowa `feedbackReadText(payload)` obok `questionReadText`, wyłącznie z zatwierdzonego payloadu:

| Typ | Tekst |
|---|---|
| `lesson_choice` | `stem` z luką zastąpioną tekstem poprawnej opcji; bez luki → `null` |
| `lesson_gap` | `stem` z luką zastąpioną `answer`; bez luki → `null` |
| `lesson_cloze` | `clozeText` z lukami zastąpionymi `gapAnswers` w kolejności |
| `lesson_order` | `answer` |
| `lesson_open_answer` | `answer` |
| `lesson_match`, `lesson_group`, `lesson_card` | `null` |

Dla `lesson_open_answer` nagranie trafia do omówienia tylko wtedy, gdy pokazany tekst poprawnej odpowiedzi (najbliższy zatwierdzony wariant) jest po normalizacji równy `answer`. Inaczej dziecko słyszałoby inne zdanie niż widzi.

Po normalizacji (4.5) tekst nagrania jest równy `exposureText` ćwiczenia, więc nagranie nie ujawnia niczego ponad to, co omówienie już zapisuje jako ekspozycję.

### 5.3. Media

- Nowa rola `revision_assets.role = 'feedback_audio'`. Zmiany: migracja ograniczenia `revision_assets_role_allowed` (wzór: migracja 0027), unia `AssetRole` (`media-reconciliation.ts:20`) i typ kolumny w `schema.ts`.
- Uzgadnianie mediów zleca nagranie, gdy przedmiot ma `ttsForFeedback` i `feedbackReadText` nie jest `null`. TTS w `answerLocale` przedmiotu, głos z konfiguracji mediów dla `en-GB`. Fingerprint z tekstu i głosu: identyczne zdania dzielą nagranie, a edycja zleca nowe nagranie tylko po zmianie tekstu.
- `supersedeDisabledLessonTts` (`media-generation.ts:80-87`) rozstrzyga `feedback_audio` według `ttsForFeedback`. Dziś każdą rolę poza `prompt_audio` wiąże z `ttsForAnswers` i oznaczyłby te zadania jako nieudane.
- Ponowienie po porażce: `feedback_audio`, jak `prompt_audio`, wraca do kolejki przy uzgadnianiu (`keepFailed`, `media-reconciliation.ts:329`). Inaczej nieudane nagranie opublikowanej rewizji zostałoby nieudane na zawsze.
- Publikacja nie czeka na nagranie; liczy się dowolny gotowy zasób o oczekiwanym fingerprincie, jak przy `prompt_audio` (`lesson-sessions.ts:287-309`). Brak gotowego nagrania = brak głośnika.

### 5.4. Ujawnienie

- Wydanie i wznowienie zadania nie niosą nagrania ani jego identyfikatora. Zasób **nie** trafia do `LoadedExercise` / `materializeExercise`.
- Identyfikator nagrania (`FeedbackDto.correctAudioAssetId`) dołączają wszystkie trzy ścieżki finalizacji próby lekcji: `finalizeLessonAttempt`, `finalizeGradedAttempt` (ocena modelem) i trafienie w cache werdyktów. Każda wyszukuje zasób w tej samej transakcji przez złączenie po `expected_fingerprint`.
- W tej samej transakcji, przed odpowiedzią HTTP, serwer pieczętuje `audio_issued`. Znacznik czasu to `clock.now()`, a nie `receivedAt`; inaczej przegląd aktywności (`supportDisclosedBefore`) i `assistanceFor` uznałyby, że wsparcie ujawniono przed odpowiedzią.
- Ponowienie tej samej próby zwraca ten sam identyfikator i nie pieczętuje zdarzenia drugi raz.
- Plik pobierany jest istniejącym `GET /api/v1/media/:id` po nieprzejrzystym identyfikatorze, bez dodatkowej autoryzacji — tak jak audio poprawnej opcji obrazkowej. Gwarancją „nie przed odpowiedzią” jest nieujawnianie identyfikatora przed oceną (test integracyjny).
- Kid UI: istniejący przycisk odsłuchu w omówieniu (`feedbackAudio` w `LearnScreen`, `playCorrectOptionAudio`) rozszerzony na feedback lekcji; bez nowego wzorca interakcji.

## 6. Słówka ze źródła

### 6.1. Dwie ścieżki

| Ścieżka | Skąd słowa | Zmiana |
|---|---|---|
| Z opisu (np. „przedmioty codziennego użytku, dni tygodnia”) | model dobiera słowa do tematu | bez zmian |
| Ze źródła | wyłącznie słowa z tekstu źródła | nowa |

### 6.2. Tryb „ze źródła”

**Kontrakt i formularz:**

- Formularz otwarty ze strony źródła: format (`standard`/`picture`), maksymalna liczba słów (≤ `MAX_DECK_ITEMS`), opcjonalne polecenie zawężające.
- `GenerationCommand` dostaje `sourceMaterialId` i `instruction` (≤500 znaków, np. „tylko pogoda”). `prompt` staje się wzajemnie wykluczający z `sourceMaterialId`, a zwykłe polecenie zostaje przy 4000 znaków.
- Domyślny tytuł zestawu to tytuł źródła, bo dziś tytuł bierze się z początku `prompt`.
- Tekst źródła trafia do zapisanego inputu generacji i do `LlmGenerateDeckInput` osobnym polem `material`.

**Prompt:** model wypisuje słowa i krótkie stałe zwroty, których uczy materiał, w formie z materiału, bez własnych dodatków. Proponuje polskie znaczenie i przykładowe zdanie. Ramy zdaniowe z lukami („I'm wearing (a) …”) nie są elementami słówek, a polecenie zawężające nie może dodać słów spoza materiału.

**Walidacja per element:** dziś walidacja zestawu działa wszystko-albo-nic (`GeneratedDeckSchema.parse`, `validateVocabularyFormatItems`). Tryb materiału waliduje elementy pojedynczo:

- element niepoprawny albo spoza materiału jest odrzucany, a reszta zostaje;
- zero poprawnych elementów = błąd generowania;
- liczba odrzuceń trafia do runu i do `GenerationDto`, bo wersja słówek nie ma `lesson_context`.

**Dopasowanie do materiału:** `target` pasuje, gdy po normalizacji występuje w materiale jako fraza na granicach słów. Normalizacja:

- małe litery, interpunkcja i apostrofy jak w 4.4;
- pominięte wiodące `a`/`an`/`the`/`to`;
- skróty przez normalizator angielski;
- prosta odmiana jak w 4.4.

**Bez zmian:** ilustracje i wizualizacje deterministyczne, TTS słów, przegląd, publikacja, scheduler, umiejętności.

## 7. Kontrakty, API, MCP

- `packages/contracts`:
  - schematy źródeł (`SourceMaterialInput`, `SourceMaterialPatch`, `SourceMaterialDto`, `SourceMaterialSummaryDto`);
  - `MaterialLessonCommandSchema` (Etap 1; w pierwszej wersji projektu `ChapterLessonCommandSchema`, z `sourceMaterialId` dopiero w Etapie 2);
  - `sourceMaterialId` w `SchoolLessonCommandSchema` i `GenerationCommandSchema` (z regułą „dokładnie jedno źródło tekstu”) oraz `instruction` w `GenerationCommandSchema`; w Etapie 2 reguła obowiązuje w `SchoolLessonCommandSchema` i `MaterialLessonCommandSchema`, a `GenerationCommandSchema` (słówka) dostaje pole w Etapie 4;
  - `rejectedCount` w `GenerationDto`;
  - `creation` i `subjectTitleRequired` w `SubjectCatalogDto`;
  - `sourceMaterialId` i `sourceMaterialRevision` w DTO zestawu dla rodzica — w Etapie 2 wyłącznie dla lekcji, jako opcjonalne `LessonDeckDto.source { id, title, copiedRevision, currentRevision }` (tytuł i bieżąca rewizja pochodzą z żywego źródła, więc pole znika po jego usunięciu); DTO zestawu słówek dostanie odnośnik w Etapie 4;
  - `rejectedReasons` w DTO szkicu lekcji;
  - opcjonalne `contentLocale` i `answerLocale` w promptach lekcji Kid DTO.
- Serwerowe schematy `.strict()` dostają nowe pola. Kid UI także waliduje zadania i sesje ścisłymi schematami z `@learning/contracts` (`parseWith(TaskDtoSchema/SessionDtoSchema)`, błąd daje ogólny `KidApiError("internal")`), a silnik ustawia `contentLocale` i `answerLocale` dla każdego przedmiotu lekcji. Pakiet Kid UI zbudowany przed zmianą odrzuci więc zadania lekcji typów, które niosą nowe pola — wybór, układankę, lukę, pary, grupy, uzupełnianie tekstu (`contentLocale`) i odpowiedź otwartą (`answerLocale`), także w gramatyce i szkole; karty i pozostałe typy lekcji nie są dotknięte — więc web i Kid UI/PWA wdrażamy razem, a po wdrożeniu otwartą kartę lub PWA trzeba odświeżyć — jak przy wcześniejszych dodaniach pól w ścisłych schematach (np. `promptLocale`). Nowy klient ze starszym serwerem działa, bo pola są opcjonalne.
- Porty: `LessonObjectivesInput.objectivesRules`, `LlmGenerateDeckInput.material` i `instruction`; zmiany w adapterze OpenAI, schemacie puli (`sourceRefs` zależne od `sourceQuotes`) i fałszywym providerze.
- Procedury oRPC rodzica dla źródeł i lekcji rozdziału. Kid API bez nowych endpointów.
- MCP i `SKILL.md`: bez zmian. Raport Hermesa (`learning-overview`) filtruje do `kind='vocabulary'`, więc lekcje i źródła są poza nim. Słówka ze źródła to zwykłe zestawy słówek o niezmienionym znaczeniu danych. Uzasadnienie w opisie każdego PR.

## 8. Testy

**Jednostkowe (domena i adaptery):**

- rejestracja `english_chapter`; przedmiot testowy `history-like-subject` dalej przechodzi;
- walidacja słownikowa: element w materiale, odmiana, łącznik, skróty, słowa funkcyjne, odrzucenie słowa spoza materiału, usunięcie wariantu zamiast ćwiczenia, brak działania przy edycji rodzica;
- `validateExercise` przedmiotu: jedna luka, bodziec w poleceniu, brak `hint`, brak powtórzonych klocków, limit 120;
- tożsamość ćwiczeń z `instructionIsStimulus`: to samo zdanie z innym bodźcem to dwa ćwiczenia;
- `exposureText` z normalizacją;
- `feedbackReadText` dla każdego typu i dla `stem` bez luki;
- schemat puli bez `sourceRefs` dla `sourceQuotes: false` i z `sourceRefs` dla szkoły;
- tekst promptów zagadnień i puli dla obu przedmiotów;
- przeniesiony normalizator (dotychczasowe testy gramatyki przechodzą);
- dopasowanie `target` słówek do materiału;
- testy architektoniczne (granice obszarów, silnik nie importuje przedmiotów, brak gałęzi po identyfikatorze przedmiotu).

**Kontrakty:** schematy źródeł, wzajemne wykluczanie `material` / `sourceMaterialId` / `prompt`, limity, nowe pola opcjonalne.

**Integracyjne (PostgreSQL):**

- **Źródło:**
  - idempotentne tworzenie, konflikt przy innej treści, konflikt `revision`;
  - kopia tekstu i rewizji w zestawie;
  - edycja źródła nie zmienia zestawu;
  - usunięcie równoległe z tworzeniem daje `not_found`, a usunięcie zostawia zestaw z `null`.
- **Lekcja rozdziału** z fałszywym generatorem:
  - zagadnienia z `kind`, pula i publikacja;
  - odrzucenie zadania spoza materiału z powodem w `rejectedReasons`;
  - pełne odrzucenie i to, co widzi rodzic;
  - rodzic dopisuje wariant spoza materiału i publikuje.
- **Samodzielność:**
  - luka po wyborze w tym samym zdaniu nie jest samodzielna;
  - luka w innym zdaniu z tym samym słowem jest samodzielna;
  - ekspozycja słówka nie blokuje luki i odwrotnie.
- **Kartkówka:** luka z bodźcem w poleceniu, bez nagrania.
- **Nagranie w omówieniu:**
  - brak identyfikatora w wydanym i wznowionym zadaniu;
  - identyfikator w każdej z trzech ścieżek finalizacji;
  - `audio_issued` raz i z czasem po `receivedAt`;
  - ponowienie próby zwraca ten sam identyfikator;
  - dwa klienty.
- **Media `feedback_audio` (R02/R06):**
  - niezmieniony tekst zachowuje zasób, zmieniony dostaje nowy;
  - spóźniony worker nie zmienia gotowego zasobu;
  - nieudane nagranie wraca do kolejki.
- **Słówka ze źródła:** odrzucenie pozycji spoza materiału przy zachowaniu reszty, `rejectedCount`.

**Kid UI:**

- test komponentu omówienia lekcji z głośnikiem;
- `lang` w parach, grupach i lukach;
- `lang` pola odpowiedzi tłumaczenia;
- specyfikacja geometrii Playwright omówienia z głośnikiem (portrait, landscape, tablet, desktop, cele ≥48 px).

**E2E:**

- rodzic: źródło → lekcja rozdziału → publikacja (`real`);
- dziecko: sesja lekcji rozdziału z odsłuchem w omówieniu (`mocked`).

Nowe pliki trafiają do `tests/e2e/spec-projects.ts` i `tests/integration-buckets.ts`.

## 9. Ryzyka i niezweryfikowane

- **Wykonalność generacji** na prawdziwym rozdziale: ile zadań odrzuca walidacja słownikowa i czy pula spełnia minima. Dlatego pierwszy etap zawiera próbę z prawdziwym modelem (sekcja 10); wynik może zmienić `FUNCTION_WORDS`, reguły odmiany albo minima.
- **Czytanie po angielsku:** bodźce są tekstowe, a dziecko dopiero zaczyna czytać po angielsku. Kryterium pilotażu: czy dziecko odczytuje słowa w parach, grupach i klockach bez pomocy. Odsłuch słów na kartach lub przed odpowiedzią to możliwe rozszerzenie po pilotażu.
- **Wymowa lektora `en-GB`** na fizycznym urządzeniu.
- **Pilotaż z dzieckiem.**

## 10. Etapy i PR

Każdy etap kończy się osobnym PR do scalenia przez właściciela. Kolejność zmieniona po przeglądzie i potwierdzona przez właściciela (2026-10-30). Największe ryzyko (wykonalność generacji) idzie pierwsze, a źródła są dodatkiem do działającej lekcji:

1. **Przedmiot „Angielski — rozdział”** z wklejonym materiałem (sekcja 4, bez `sourceMaterialId`) + próba z prawdziwym modelem na Unit 1–2 (wykonano na odtworzonym Unit 1). Z próby raportujemy liczbę zagadnień, odrzuceń według powodów i spełnienie minimów; materiał próby nie trafia do repozytorium. Ten PR zawiera też niniejszą specyfikację.
2. **Źródła** + lekcja rozdziału i lekcja szkolna ze źródła (sekcja 3) — zaimplementowane, stan w „Stan Etapu 2” niżej.
3. **Lektor po odpowiedzi** (sekcja 5).
4. **Słówka ze źródła** (sekcja 6).

Dokumentacja w PR etapów: nowa sekcja `docs/SPEC.md` (§37), uzupełnienie `docs/architecture.md` §19 (nowe opcje `SubjectModule`, `ttsForFeedback`, źródła) i §22 (temat dynamiczny poza przedmiotem szkolnym), `docs/schema.sql`.

### Stan Etapu 1 (2026-10-30)

**Zaimplementowane** (gałąź `claude/english-chapter-1-lesson`, plan `docs/superpowers/plans/2026-10-30-english-chapter-stage1.md`): przedmiot `english_chapter` w `subjects/english-chapter/` (moduł, słownik materiału, walidatory, tekst ekspozycji, prompty); normalizator angielski w `subjects/english/`; generyczne opcje `SubjectModule` (`sourceQuotes`, `materialSubjectTitle`, `instructionIsStimulus`, `exposureText`, `normalizeExposureText`, `refineGeneratedPool`, `openAnswerPromptLocale`, `prompts.typeRules`, `prompts.objectivesRules`) i `DynamicObjectiveData.kind`; `contentLocale`/`answerLocale` w Kid DTO z atrybutami `lang` w Kid UI; `rejectedReasons` w szkicu i edytorze rodzica; `createMaterialLesson`, `createLessonFromMaterial`, `lessons.createFromMaterial` i `creation`/`subjectTitleRequired` w katalogu; fałszywy provider z gałęzią rozdziału; testy jednostkowe, integracyjne (`tests/integration/lesson-chapter.test.ts`) i narzędzie próby `pnpm probe:chapter`. Opis architektury: `docs/architecture.md` §19.9 i §22, produktu: SPEC §37. Odstępstwa od pierwszej wersji projektu: kategorie błędów (4.1), dodatkowa opcja `materialSubjectTitle`, `MaterialLessonCommand` zamiast `ChapterLessonCommand` i tytuł zestawu (4.6), usuwanie niezamówionych pól v3 (4.4). Po końcowym przeglądzie (2026-10-31): wspólna normalizacja ekspozycji ćwiczeń i przykładów kart (`normalizeExposureText`, 4.5), stałe polecenie tłumaczenia i bodziec w uzupełnianiu tekstu (4.1, 4.4), jednoznaczne luki i pary w promptach (4.3), karty ram bez tłumaczeń (4.2), uczciwy raport odrzuceń w edytorze (4.4), `lang` pola luki (4.7), spójność `buildDynamicTopic`/`materialSubjectTitle` w rejestrze oraz test architektoniczny, że silnik i adaptery nie zawierają literałów identyfikatorów przedmiotów (jedyny nazwany wyjątek: `"school"` w `createSchoolLesson`). Nie ma jeszcze: źródeł (Etap 2, stan niżej), lektora (`ttsForFeedback`), słówek ze źródła ani osobnej specyfikacji E2E całego przebiegu rozdziału (Etap 2 i dalsze); formularz rodzica i edytor (rodzaje zagadnień, powody odrzuceń) pokrywają specyfikacje układu `parent-lessons-layout` i `parent-lesson-editor-layout`, a przebieg dziecka — testy integracyjne.

**Próba na prawdziwym modelu** (`google/gemini-3.8-flash`, odtworzony materiał Unit 1, pula 60; `pnpm probe:chapter` z `UMIEM_PROBE_MATERIAL` wskazującym plik poza repozytorium):

| Przebieg | Zagadnienia | Odrzucone | Publikowalny | Uwagi |
| --- | --- | --- | --- | --- |
| 1 (przed strojeniem) | 4 | 4 z 60 (6,7%) | nie | sprawdzany fragment tłumaczeń (`focus`) nie był ciągły; brak pokrycia samodzielnego w zagadnieniu-ramie |
| 2 (po poprawce `focus`) | 4 | 16 z 60 (26,7%) | nie | model wypełnił `sourceRefs` w całej partii; zagadnienie bez ćwiczeń |
| 3–4 (po strojeniu promptów i usuwaniu pól v3) | 5 | 0 | tak | 3 zagadnienia `words` i 2 `frame`; 4/6/2 ćwiczenia na zagadnienie; odpowiedzi luk w ramie powtarzały „wearing” |
| 5 (po strojeniu różnorodności luk i dystraktorów) | 4 | 2 z 60 (3,3%) | tak | odpowiedzi luk w ramie różne (najwyżej dwie takie same), klocki układanek bez interpunkcji |
| 6 (po końcowym przeglądzie, 2026-10-31) | 4 | 1 z 60 (1,7%; „tylko słowa pomocnicze”) | tak | wszystkie 12 tłumaczeń z poleceniem „Przetłumacz na angielski.” już od modelu; 4 teksty z lukami z polskim znaczeniem całego tekstu w poleceniu, każda luka jednoznaczna; karty ram z angielskimi przykładami bez tłumaczeń; 0 z 60 z niezamówionymi polami v3; 16 z 59 ćwiczeń (m.in. 7 tłumaczeń) rozwiązuje zdanie z przykładu karty |

Po końcowym przeglądzie (przebieg 6) przykład karty i ćwiczenie rozwiązujące to samo zdanie mają jeden klucz (4.5), więc te 16 ćwiczeń po pokazaniu karty nie liczy się już jako samodzielne — wcześniej żadne nie byłoby rozpoznane. Zmniejsza to pulę samodzielnych tłumaczeń; reguła promptu, by przykłady kart nie powtarzały odpowiedzi ćwiczeń, jest kandydatem na kolejne strojenie.

Strojenie obejmowało: ciągły `focus` tłumaczenia, zerowanie pól v3 w prompcie i ich usuwanie ze świeżego wyjścia, regułę banku uzupełniania (słowo banku nie występuje poza luką), różnorodność luk w ramach, dystraktory z tej samej kategorii oraz układanki bez interpunkcji końcowej. Po strojeniu trzy kolejne przebiegi (3, 4 i 5) były publikowalne, z 0%, 0% i 3,3% odrzuconych. Pierwsze dwa przebiegi pokazują, że jedno wadliwe pole w partii potrafi unieważnić całe zagadnienie, co uzasadnia czyszczenie świeżego wyjścia (4.4). Porównanie ze szkołą (po dwa przebiegi na `main` i na gałęzi, geografia): bez regresji; istniejąca, losowa usterka `questionType` na `lesson_choice` szkoły uczyniła niepublikowalnym jeden z dwóch przebiegów szkoły na `main` (próbka dwóch przebiegów, więc częstości nie szacujemy) i jest poza zakresem tego etapu.

**Niezweryfikowane:**

- pilotaż z dzieckiem (czy dziecko odczytuje angielskie słowa w parach, grupach i klockach bez pomocy);
- fizyczne urządzenie i czytniki ekranu z atrybutami `lang` (atrybuty sprawdzono tylko testami komponentów Kid UI; polskie `aria-label` przycisków wewnątrz `lang="en-GB"` mogą być czytane angielskim głosem); specyfikacja geometrii uzupełniania tekstu (`lesson-cloze-layout`) obejmuje wariant rozdziału z `contentLocale` i długim polskim poleceniem, ale pary, grupy i klocki rozdziału nie mają osobnej specyfikacji geometrii;
- prawdziwy materiał właściciela (NotebookLM): próba objęła odtworzony Unit 1, nie tekst od właściciela;
- odrzucanie słownikowe na prawdziwym modelu: ani razu nie odrzuciło ćwiczenia za słowo spoza materiału (jedyne odrzucenia słownikowe to elementy bez słowa treści: luka z samym „It's” w przebiegu 5 i element z samym „What's” w przebiegu 6), więc heurystyka odmiany i `FUNCTION_WORDS` nie były sprawdzone na żywo; rozdział oparty na słowach funkcyjnych (przyimki, can/can't) nie był próbowany (4.4, znane ograniczenia);
- jakość ćwiczeń poza próbkami: mało układanek na pulę (około 3), wybór bywa dwuopcyjny, pojedynczy dystraktor w parach bywa z innej kategorii.

### Stan Etapu 2 (2026-10-31)

**Zaimplementowane** (gałąź `claude/english-chapter-2-sources`, ułożona na gałęzi Etapu 1; plan `docs/superpowers/plans/2026-10-31-english-chapter-stage2-sources.md`):

- dane: tabela `source_materials`, kolumny `decks.source_material_id` (FK `ON DELETE SET NULL`) i `decks.source_material_revision`, indeks częściowy, migracja `0029_source_materials.sql`, `docs/schema.sql`;
- serwer (obszar `materials/`): `source-materials.ts` z `createSourceMaterial` (idempotencja po `clientRequestId` i `request_hash`), `updateSourceMaterial` (`expectedRevision`, `FOR UPDATE`), `deleteSourceMaterial`, `listSourceMaterials`, `getSourceMaterial`, `lockSourceMaterialForCopy` (`FOR KEY SHARE` w transakcji tworzenia lekcji) i `readDeckSource`;
- kontrakty: `source-materials.ts`, `sourceMaterialId` w `SchoolLessonCommandSchema` i `MaterialLessonCommandSchema` (dokładnie jedno z `material` / `sourceMaterialId`), `LessonDeckDto.source`, `messages.sources`;
- Parent API: grupa oRPC `sources` (list, get, create 201/200, update, delete 204), sesja rodzica, kontrola Origin na mutacjach; bez Kid API i MCP;
- panel rodzica: zakładka „Źródła” (lista, nowe źródło, strona źródła z edycją, usuwaniem i listą zestawów), formularz nowej lekcji w trybie źródła (`/parent/lessons/new?source=…&subject=…`), notka „Ze źródła: …” i „Źródło zmieniono od utworzenia tego zestawu.” w edytorze lekcji;
- prompt uzupełniania tekstu rozdziału: 2–3 krótkie zdania, całe `instructionPl` najwyżej 120 znaków (sekcja 4.3).

Opis architektury: `docs/architecture.md` §19.10 (blokady, idempotencja, wdrożenie, znane ograniczenia), produktu: SPEC §37 („Etap 2: źródła”).

**Odstępstwa od pierwszej wersji projektu:**

- DTO zestawu niesie `source { id, title, copiedRevision, currentRevision }` zamiast pól `sourceMaterialId` i `sourceMaterialRevision`, i to tylko dla lekcji (sekcja 7); odnośnik w zestawach słówek dochodzi w Etapie 4;
- każda udana edycja źródła podnosi `revision`, także gdy treść się nie zmieniła; unika tego panel (wysyła tylko zmienione pola, „Zapisz” wyłączone bez zmian), a nie serwer;
- formularz lekcji ze źródła pokazuje tytuł i podgląd tekstu tylko do odczytu oraz „Zmień źródło” zamiast zablokowanego pola (3.4), a oferuje wyłącznie przedmioty tworzone z materiału (`creation: "material"`);
- strona źródła wylicza także zestawy zarchiwizowane (stan `archived`), a liczba zestawów na liście i w nagłówku ich nie liczy; potwierdzenie usunięcia podaje liczbę wszystkich zestawów ze strony;
- przycisk „Utwórz zestaw słówek” nie istnieje (Etap 4).

**Zweryfikowane** (uruchomione podczas implementacji):

- na PostgreSQL (`tests/integration/source-materials.test.ts`, 41 testów, kosz integracyjny 3): idempotencja i konflikt tworzenia, równoległe tworzenie z tym samym `clientRequestId`, edycja z rewizją i dwie równoległe edycje tej samej rewizji, usunięcie bez utraty zestawów (`source_material_id` = `NULL`, kopia tekstu zostaje, triggery `decks` nie przeszkadzają), kopia tekstu i rewizji do lekcji rozdziału i szkolnej, trzy deterministyczne przeploty usunięcie/tworzenie/edycja oraz pętla 12 wyścigów (mutacyjnie: bez `FOR KEY SHARE` cztery testy padają), pełny cykl przez handler Parent API (statusy, 401, 403 dla mutacji z obcego Origin, 400 dla złych ciał);
- jednostkowo: kontrakty, router oRPC (w tym CSRF dla trzech mutacji), trasy panelu, `sources-state`, markup listy, strony i formularza ze źródła, notka w edytorze, prompt uzupełniania tekstu;
- Playwright z zaślepionym API (`parent-sources-layout.spec.ts`; 320×640, 390×844, 768×1024, 1280×800): lista, nowe źródło, ponowienie po niepewnym zapisie (ten sam `clientRequestId`), edycja tylko zmienionych pól, konflikt 409 i „Odśwież” z potwierdzeniem, usunięcie z liczbą zestawów, przyciski „Utwórz lekcję…” i formularz ze źródła (żądanie z `sourceMaterialId` bez `material`), 404 z usuniętego źródła, fokus po „Edytuj”, cele dotykowe ≥ 44 px bez przepełnienia poziomego; `parent-shell-layout.spec.ts` sprawdza pięć zakładek w dolnym pasku na 390, 360 i 320 px oraz w górnym rzędzie na 844×390, 768×1024 i 1280×800;
- Playwright na prawdziwej bazie i workerze z fałszywym LLM (`parent-sources.spec.ts`, kosz `real` 4): nowe źródło → lekcja ze źródła → notka w edytorze → edycja źródła → znacznik zmiany → usunięcie → lekcja zostaje z pełną kopią tekstu; spec 3 razy z rzędu stabilny, a pełny przebieg `pnpm test:e2e:shards` z nim (wtedy w koszu 1) zakończył się zielono (mocked 293, real 34/33/21/33); po przeniesieniu do kosza 4 pełnego przebiegu nie powtarzano.

**Niezweryfikowane:**

- pilotaż z rodzicem (czy zakładka „Źródła”, rozróżnienie źródło/zestaw i komunikaty o zmianie źródła są zrozumiałe);
- fizyczne urządzenia: układ sprawdzono wyłącznie w emulacji okna przeglądarki; górny rząd pięciu zakładek nie był mierzony w szerokościach 600–767 px;
- skutek skróconego polecenia uzupełniania tekstu na prawdziwym modelu: zmieniono sam prompt (limit 120 znaków egzekwuje walidacja silnika), a próby `pnpm probe:chapter` po zmianie nie powtarzano;
- generowanie z prawdziwego modelu ze źródła jako wejścia (próba z Etapu 1 objęła tekst wklejony; ścieżka ze źródła używa tego samego generatora);
- jednoczesne wdrożenie: kolejność migracja `0029` → web wynika z projektu, nie była ćwiczona na środowisku wdrożeniowym.

## 11. Poza zakresem

- Rozsypane litery i brakujący element ciągu — [lookassh/knowli#185](https://github.com/lookassh/knowli/issues/185).
- Zadania z obrazkami — [lookassh/knowli#186](https://github.com/lookassh/knowli/issues/186).
- „Posłuchaj pytania” przed odpowiedzią w lekcji rozdziału, odpowiedzi mówione, lekcja gramatyki ze źródła, wersjonowanie źródła, upload i OCR.
- Istniejący, pokrewny problem: `audio_issued` dla poprawnej opcji obrazkowej (`picture_recognition`) jest pieczętowany z czasem `receivedAt` (`attempts.ts:726`). Dotyczy słówek, poprawka osobno.

## 12. Dziennik przeglądu (wersja 2)

Przegląd trzech niezależnych krytyków (architektura i silnik; dane, ujawnienia i media; produkt i wykonalność), z twierdzeniami potwierdzonymi w kodzie. Zmiany względem wersji 1:

- **Blokada:**
  - Walidacja słownikowa przez `validatePoolExtra` włączała wymóg cytatów `sourceRefs`, a przedmiot bez v3 je odrzuca, więc każde ćwiczenie zostałoby odrzucone. Teraz decyduje o tym jawna opcja `sourceQuotes`, a walidacja słownikowa działa w `refineGeneratedPool` (tylko generacja).
- **Bodziec znaczenia:**
  - Przeniesiony z `hint` do `instructionPl`, bo kartkówka usuwa `hint`, a deduplikacja pomijała polecenie.
  - Doszła opcja `instructionIsStimulus`.
- **Samodzielność:**
  - Jawna decyzja, że ekspozycją jest rozwiązane zdanie (`exposureText`).
  - Wersja 1 liczyła ją po słowie, co blokowało luki po każdym wyborze i po słówkach, a nagranie w omówieniu ujawniało zdanie bez ekspozycji.
- **Lektor:**
  - Wszystkie trzy ścieżki finalizacji.
  - `audio_issued` z czasem `clock.now()`.
  - `supersedeDisabledLessonTts` i ponowienia nieudanych nagrań.
  - Przypadek `stem` bez luki.
  - Zgodność nagrania tłumaczenia z pokazanym wariantem.
- **Pula:**
  - 3–5 zagadnień z rodzajem `words`/`frame` i typami według rodzaju.
  - Minima 3/3/2.
  - Powody odrzuceń widoczne dla rodzica.
  - Warianty spoza materiału usuwane zamiast odrzucania ćwiczenia.
  - Rodzic nie jest ograniczany słownikiem.
- **Prompty:** opisy typów match/group/cloze przeniesione z adaptera do profilu przedmiotu, a `objectivesRules` dochodzi do portu.
- **Formularz i identyfikatory:** jawne `creation` w katalogu przedmiotów, prefiks identyfikatora zagadnienia z identyfikatora przedmiotu.
- **Języki:** `contentLocale` ustawiane generycznie z `answerLocale`, osobny `answerLocale` pola odpowiedzi.
- **Źródła:**
  - `client_request_id` z `request_hash`;
  - `FOR KEY SHARE` przy tworzeniu;
  - rewizja źródła w zestawie;
  - jawne różnice kopii dla lekcji i słówek.
- **Słówka ze źródła:**
  - pole `instruction`, tytuł ze źródła;
  - walidacja per element zamiast wszystko-albo-nic;
  - dopasowanie z rodzajnikami, skrótami i odmianą.
- **Drobne:**
  - limit odpowiedzi 120 zamiast 200;
  - semantyka `almost`;
  - jedna poprawna kolejność klocków bez powtórzeń;
  - normalizator w `subjects/english/`;
  - odwołanie do §22 architektury.
- **Kolejność etapów:** lekcja rozdziału pierwsza (z próbą na prawdziwym modelu), źródła drugie — potwierdzone przez właściciela.

Wersja 2 zaakceptowana przez właściciela 2026-10-30.
