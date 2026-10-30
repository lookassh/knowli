# Źródła i lekcja „Angielski — rozdział” — projekt

Data: 2026-10-30 (wersja 2 po przeglądzie trzech krytyków — dziennik w sekcji 12). Podstawa: zestawienie typów zadań z zeszytu ćwiczeń 2. klasy (Starter, Unit 1–2) z typami ćwiczeń Umiem! oraz decyzje właściciela podjęte w rozmowie (wariant A zadań, wariant A lektora, przedmiot jako osobny `SubjectModule`, „źródło” jako osobny byt). Status: projekt zaakceptowany przez właściciela 2026-10-30; następny krok to plan wdrożenia Etapu 1.

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
| `usesV3Payload` | `false` — bez pól v3 i oceny dwuwymiarowej |
| `poolDeduplication` | `exercise` |
| `poolMinimums` | `{ guided: 3, productive: 3, independent: 2 }` |
| `ttsForAnswers` / `ttsForPrompts` | `false` / `false` |
| `spokenAnswers` | brak |

Nowe, opcjonalne i generyczne opcje `SubjectModule` (domyślne wartości zachowują dzisiejsze zachowanie `school` i `english_grammar`):

| Opcja | Znaczenie | `school` | `english_chapter` |
|---|---|---|---|
| `sourceQuotes` | czy ćwiczenia wymagają cytatów `sourceRefs`; steruje `groundingRequired` w generacji i wymaganiem `sourceRefs` w gałęziach schematu match/group/cloze (dziś wymagane zawsze, a dla przedmiotu bez v3 każde takie ćwiczenie byłoby odrzucone) | `true` | `false` |
| `refineGeneratedPool(drafts, { material })` | walidacja i czyszczenie **tylko świeżo wygenerowanych** ćwiczeń (odrzuca ćwiczenie albo usuwa pojedyncze warianty); nie działa przy edycji rodzica ani publikacji, w odróżnieniu od `validatePoolExtra` | brak | walidacja słownikowa (4.4) |
| `instructionIsStimulus` | polecenie niesie bodziec znaczenia: tożsamość ćwiczeń `lesson_choice`, `lesson_gap`, `lesson_order` (`exercise-identity.ts`) uwzględnia znormalizowane `instructionPl` | `false` | `true` |
| `exposureText(draft)` | tekst, z którego liczony jest `targetKey` ćwiczenia (dziś zawsze `answer`) | brak | 4.5 |
| `openAnswerPromptLocale` | język pytania `lesson_open_answer` wysyłany w Kid DTO | brak (reguła jak dziś) | `pl-PL` |
| `ttsForFeedback` | nagranie poprawnego zdania w omówieniu (sekcja 5) | `false` | `true` |
| `prompts.objectivesRules` | reguły etapu zagadnień (`LessonObjectivesInput` dostaje pole, adapter je dokleja) | brak | 4.2 |
| `prompts.typeRules` | opisy typów match/group/cloze dla promptu puli — przeniesione z adaptera (`llm.ts`) do profilu przedmiotu | dzisiejszy tekst z adaptera bez zmian | 4.3 |

Kategorie błędów przedmiotu (z polskimi szablonami podpowiedzi): `wrong_word` „Pomylone słowo”, `spelling` „Pisownia”, `word_order` „Szyk zdania”, `missing_word` „Brakujące słowo”, plus kategorie bazowe.

`validateExercise` przedmiotu:

- `lesson_choice` i `lesson_gap`: `stem` z dokładnie jedną luką (`/_{2,}/`);
- `lesson_choice`, `lesson_gap`, `lesson_order`: `instructionPl` niesie polskie zdanie-bodziec — różne od stałych poleceń typów w `messages.kid` i dłuższe niż samo polecenie;
- pole `hint` niedozwolone (bodziec jest w poleceniu, bo kartkówka usuwa `hint` z luki — `lesson-materialize.ts:294`);
- `lesson_order`: żadne dwa klocki nie mają tego samego tekstu po normalizacji (ocena porównuje identyfikatory klocków, więc zamiana dwóch „a” dałaby fałszywy błąd);
- odpowiedź i warianty ≤120 znaków (limit przedmiotów bez v3).

### 4.2. Zagadnienia

Model dzieli materiał na **3–5** zagadnień (`objectivesRules`), żeby przy dwóch nowych zagadnieniach na sesję wszystkie pojawiły się w 2–3 sesjach. `DynamicObjectiveData` dostaje opcjonalne `kind: "words" | "frame"` (przedmiot szkolny go nie ustawia):

- **words** — grupa słów, np. „Ubrania”, „Pogoda”: 4–12 słów i zwrotów z materiału;
- **frame** — rama zdaniowa, np. „I'm wearing (a) …”, „What's the weather like? It's …”; sprawdzaną częścią jest konstrukcja, a słowa z zagadnień `words` są tylko wypełnieniem.

Każde słowo należy głównie do jednego zagadnienia. `buildDynamicTopic` przypisuje typy ćwiczeń według rodzaju:

| Rodzaj | Typy |
|---|---|
| words | card, match, group, choice, cloze, gap, open_answer |
| frame | card, match (pytanie ↔ odpowiedź), order, choice, cloze, gap, open_answer |

Karty (2–4): lista „słowo — polskie znaczenie” albo wzór ramy z 1–3 przykładami po angielsku. Identyfikatory zagadnień mają prefiks identyfikatora przedmiotu (`english_chapter.d<deckId>.<slug>`); dziś prefiks `school.d` jest wpisany na stałe (`lesson-drafts.ts:448`), a dla przedmiotu szkolnego pozostaje bez zmian.

### 4.3. Typy zadań i etapy

Mapowanie etapów w `STAGE_BY_TYPE` bez zmian.

| Etap | Typ | Treść | Bodziec znaczenia |
|---|---|---|---|
| guided | `lesson_match` | lewa strona po angielsku (słowo, zwrot albo pytanie z rozdziału), prawa: polskie znaczenie albo angielska odpowiedź; 3–5 par + 0–2 dystraktory | strona polska / para pytanie–odpowiedź |
| guided | `lesson_group` | tylko gdy słowa zagadnienia dzielą się naturalnie na 2–3 kategorie; polskie etykiety, 4–8 angielskich elementów | etykiety grup |
| guided | `lesson_cloze` | 2–4 krótkie zdania z ram rozdziału, 2–4 luki na słowa z rozdziału, 1–2 słowa-pułapki z materiału | kontekst zdań |
| guided | `lesson_choice` | angielskie zdanie z luką w `stem`, 2–3 opcje | polskie zdanie w `instructionPl` („Dziś pada śnieg. Wybierz słowo.”) |
| guided | `lesson_order` | klocki-słowa zdania z ramy; zdania bez przestawnych części (jedna poprawna kolejność) | polskie zdanie w `instructionPl` („Ułóż zdanie: Mam na sobie różowy płaszcz.”) |
| productive | `lesson_gap` | angielskie zdanie z jedną luką | polskie zdanie w `instructionPl` („Mam na sobie zielony płaszcz. Wpisz brakujące słowo.”) |
| independent | `lesson_open_answer` | tłumaczenie krótkiego zdania; `prompt` = polskie zdanie, odpowiedź ≤120 znaków | polskie zdanie |

`prompts.typeRules` i `fieldRules` przedmiotu opisują powyższe wprost (prawa strona par po polsku albo angielska odpowiedź, luki cloze na słowa z rozdziału, bodziec w `instructionPl`, brak `hint`). Test sprawdza złożony tekst promptu dla obu przedmiotów.

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

**Raport dla rodzica.** Powody odrzuceń są zliczane (np. „słowo spoza materiału: raining ×3”) w `lesson_context.rejectedReasons` obok dzisiejszego `rejectedCount` i pokazywane w edytorze lekcji, żeby rodzic wiedział, czy dogenerować. To zliczenia bez danych dziecka.

**Znane ograniczenia:**

- słowa z poleceń podręcznika („listen”, „tick”) wklejone w materiał liczą się jako słownictwo;
- przykłady na kartach i zdania-bodźce nie są sprawdzane (tylko reguła w prompcie i przegląd rodzica).

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

Tekst ekspozycji jest normalizowany przed `computeTargetKey`: wielokrotne spacje → jedna, bez końcowej interpunkcji. Dzięki temu „It's snowing.” i „It's snowing” to ta sama ekspozycja.

Skutki tej decyzji:

- zadanie samodzielne = zdanie, którego rozwiązania dziecko jeszcze nie widziało;
- słowo widoczne na karcie, w parach, grupach lub banku słów nie jest ekspozycją (jak dziś w lekcjach);
- ekspozycje zdań z lekcji nie blokują słówek, a ekspozycje słówek nie blokują luk w lekcji (różne klucze);
- znane ograniczenie: słowo pokazane w lekcji nie chroni samodzielnego przypominania tego słowa w zestawie słówek.

**Opanowanie:** jak dziś w lekcjach — trzy ostatnie kwalifikujące sukcesy na różnych ćwiczeniach, w tym jeden w późniejszej sesji innego dnia po ≥12 h.

- Należne sprawdzenia samodzielne wybierają najpierw tłumaczenie, a lukę na niewidzianym zdaniu dopiero jako zapas (`scheduler.ts:350-375`).
- Bez modelu tłumaczenie zalicza tylko dokładne trafienie w wariant (inaczej „nieocenione” bez kary).
- Luka na niewidzianym zdaniu działa bez modelu.

**Kartkówka:** jak w lekcjach. Bodziec zostaje, bo jest w `instructionPl`. Pary, grupy i luki z bankiem są w niej nauką wspomaganą. Raport per zagadnienie.

### 4.6. Tworzenie lekcji

- `createSchoolLesson` staje się cienką komendą nad wspólnym `createMaterialLesson(services, subjectId, …)` dla przedmiotów z `buildDynamicTopic`.
- `SubjectCatalogDto` dostaje jawne `creation: "catalog" | "material"`. Formularz rodzica wybiera ścieżkę po tym polu, a nie po pustej liście tematów — dziś `isSchoolSubject` uznałby `english_chapter` za szkołę (`NewLessonForm.tsx:68-71`).
- Nowa komenda `ChapterLessonCommand`:
  - `clientRequestId`,
  - `topicTitlePl` (np. „Unit 1”, 1–120),
  - `material` albo `sourceMaterialId` (3.3),
  - opcjonalnie `instruction` (≤500), `poolSize`, `deckId`.

  Tytuł zestawu: „Angielski: <topicTitlePl>”.
- Fałszywy provider dostaje gałąź `english_chapter` (bez `sourceRefs`, z polskim bodźcem w poleceniu, z `kind` zagadnień).

### 4.7. Języki w Kid DTO i panel rodzica

- Prompty `lesson_match`, `lesson_group`, `lesson_cloze`, `lesson_choice`, `lesson_order` i `lesson_gap` dostają opcjonalne `contentLocale`. Silnik ustawia je zawsze na `answerLocale` przedmiotu: dla każdego przedmiotu treść tych typów jest w języku odpowiedzi (szkoła `pl-PL`, gramatyka i rozdział `en-GB`), więc nie ma gałęzi po identyfikatorze przedmiotu.
- `lesson_open_answer` dostaje opcjonalne `answerLocale` (język pola odpowiedzi), a `promptLocale` bierze z `openAnswerPromptLocale`, gdy przedmiot je ma (inaczej reguła jak dziś). Kid UI ustawia `lang` pola odpowiedzi z `answerLocale`, a nie z `promptLocale` jak dziś (`LessonSentenceView.tsx:58-71`). Starszy klient bez nowych pól działa jak dotąd.
- Kid UI oznacza `lang` treść o pewnym języku: lewą kolumnę par, elementy grup, tekst cloze i bank słów, `stem` i opcje wyboru, klocki, zdanie z luką. Prawa kolumna par i etykiety grup nie dostają `lang` treści. Bez nowych widoków i wzorców interakcji.
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
  - `ChapterLessonCommandSchema`;
  - `sourceMaterialId` w `SchoolLessonCommandSchema` i `GenerationCommandSchema` (z regułą „dokładnie jedno źródło tekstu”) oraz `instruction` w `GenerationCommandSchema`;
  - `rejectedCount` w `GenerationDto`;
  - `creation` w `SubjectCatalogDto`;
  - `sourceMaterialId` i `sourceMaterialRevision` w DTO zestawu dla rodzica;
  - `rejectedReasons` w DTO szkicu lekcji;
  - opcjonalne `contentLocale` i `answerLocale` w promptach lekcji Kid DTO.
- Serwerowe schematy `.strict()` dostają nowe pola. Kid UI nie parsuje odpowiedzi schematem, więc nowe pola są zgodne wstecz.
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

1. **Przedmiot „Angielski — rozdział”** z wklejonym materiałem (sekcja 4, bez `sourceMaterialId`) + próba z prawdziwym modelem na Unit 1–2. Z próby raportujemy liczbę zagadnień, odrzuceń według powodów i spełnienie minimów; materiał próby nie trafia do repozytorium. Ten PR zawiera też niniejszą specyfikację.
2. **Źródła** + lekcja rozdziału i lekcja szkolna ze źródła (sekcja 3).
3. **Lektor po odpowiedzi** (sekcja 5).
4. **Słówka ze źródła** (sekcja 6).

Dokumentacja w PR etapów: nowa sekcja `docs/SPEC.md` (§37), uzupełnienie `docs/architecture.md` §19 (nowe opcje `SubjectModule`, `ttsForFeedback`, źródła) i §22 (temat dynamiczny poza przedmiotem szkolnym), `docs/schema.sql`.

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
