# Źródła i lekcja „Angielski — rozdział” — projekt

Data: 2026-10-30. Podstawa: zestawienie typów zadań z zeszytu ćwiczeń 2. klasy (Starter, Unit 1–2) z typami ćwiczeń Umiem! oraz decyzje właściciela podjęte w rozmowie (wariant A zadań, wariant A lektora, przedmiot jako osobny `SubjectModule`, „źródło” jako osobny byt). Status: zapisany projekt do przeglądu; zapis nie oznacza rozpoczęcia implementacji.

## 1. Cel

Dziecko ćwiczy słownictwo i ramy zdaniowe z bieżącego rozdziału podręcznika angielskiego w zadaniach podobnych do zeszytu ćwiczeń: połącz, pogrupuj, uzupełnij tekst z bankiem słów, wybierz słowo w zdaniu, ułóż zdanie, wpisz słowo, przetłumacz krótkie zdanie. Zestawy słówek nadal ćwiczą pojedyncze słowa z powtórkami; lekcja rozdziału dokłada poziom zdania.

Rodzic wkleja tekst rozdziału raz — jako **źródło** — i tworzy z niego osobno lekcję rozdziału, zestaw słówek albo lekcję szkolną. Każde utworzenie jest dzisiejszą, niezależną operacją z własnym szkicem, przeglądem i publikacją; nie ma wspólnej transakcji ani automatycznego łańcucha.

Sukces: dziecko ćwiczy w aplikacji te same rodzaje zadań co na sprawdzianie z rozdziału, wyłącznie na słowach z rozdziału, a rodzic widzi, które zagadnienia (np. „Pogoda”, „Rama: I'm wearing…”) sprawiają trudność.

## 2. Ograniczenia globalne

- Interfejs po polsku; polecenia zadań po polsku, treść i odpowiedzi lekcji rozdziału po angielsku (`en-GB`).
- Opublikowana treść, wydany prompt, klucz odpowiedzi i zakończona ocena pozostają niezmienne. Zestaw utworzony ze źródła przechowuje własną kopię tekstu.
- Silnik lekcji nie zna przedmiotu: nowy przedmiot to nowy katalog `subjects/english-chapter/` i jeden wpis w rejestrze (test architektoniczny bez zmian).
- Kid DTO bez klucza odpowiedzi; nagranie poprawnego zdania ujawniane wyłącznie w omówieniu, po zapisaniu oceny.
- Zadania zamknięte oceniane deterministycznie, bez modelu. Model oceniający tylko dla tłumaczenia niedopasowanego do wariantów, gdy jest skonfigurowany; awaria lub brak modelu = „nieocenione” bez kary.
- Cała ścieżka działa bez mikrofonu. Nie dodajemy odpowiedzi mówionych w lekcji rozdziału.
- Bez nowych widoków ćwiczeń w Kid UI (wariant A). Bez uploadu plików i OCR — źródło to wklejony tekst.
- Źródło to treść podręcznika od rodzica, bez danych dziecka. Do modeli trafia jak dzisiejszy materiał lekcji.

## 3. Etap 1 — Źródła

### 3.1. Model danych

Nowa tabela `source_materials` w obszarze `materials/`:

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | 1–120 znaków po trim |
| `body` | text | 1–16 000 znaków po trim (limit `MAX_SCHOOL_MATERIAL_LENGTH`) |
| `revision` | integer | zaczyna od 1; rośnie przy każdej edycji (kontrola współbieżności) |
| `created_at`, `updated_at` | timestamptz | |

Nowa kolumna `decks.source_material_id uuid null references source_materials(id) on delete set null`. Odnośnik jest informacją o pochodzeniu; treść zestawu nigdy nie jest czytana ze źródła po utworzeniu.

Migracja Drizzle z przeglądanym SQL; `docs/schema.sql` uzupełniony o tabelę i kolumnę.

### 3.2. Operacje (rodzic, Parent Mode)

- `createSourceMaterial({ clientRequestId, title, body })` — idempotentne po `clientRequestId` (ponowienie zwraca ten sam rekord).
- `updateSourceMaterial({ id, expectedRevision, title?, body? })` — rozbieżna `expectedRevision` → `conflict` (dwie przeglądarki nie nadpisują się po cichu).
- `deleteSourceMaterial({ id })` — usuwa źródło; zestawy zostają, odnośnik staje się `null`.
- `listSourceMaterials()` — tytuł, daty, liczba zestawów z `source_material_id` (bez zarchiwizowanych).
- `getSourceMaterial({ id })` — pełny tekst i lista zestawów utworzonych z tego źródła (tytuł, rodzaj, stan).

Każda operacja wymaga sesji rodzica i serwerowej autoryzacji, jak operacje na zestawach. Źródła nie są widoczne w Kid API.

### 3.3. Tworzenie zestawu ze źródła

Komendy tworzenia przyjmują `sourceMaterialId` jako alternatywę dla wklejonego tekstu (dokładnie jedno z dwóch; oba albo żadne → `validation`). Serwer w transakcji tworzenia:

1. czyta `body` źródła (brak → `not_found`),
2. kopiuje tekst w to samo miejsce, w którym zestaw przechowuje dziś materiał (`lesson_context.material` dla lekcji, zapisany input generacji dla słówek),
3. zapisuje `decks.source_material_id`.

Dogenerowanie, ponowne generowanie i edycja szkicu korzystają z kopii w zestawie. Edycja źródła nie zmienia istniejących zestawów.

W Etapie 1 obsługuje to lekcja szkolna (`SchoolLessonCommand`). Lekcja gramatyki ze źródła jest poza zakresem (limit 8000 znaków i tematy z katalogu).

### 3.4. Panel rodzica

- Nowa zakładka **„Źródła”** w nawigacji panelu (w UI słowo „materiał” oznacza już zestaw albo lekcję — stąd inna nazwa).
- Lista źródeł: tytuł, data zmiany, liczba zestawów; przycisk „Nowe źródło” (tytuł + pole tekstowe z licznikiem znaków).
- Strona źródła: podgląd i edycja tekstu, usunięcie z potwierdzeniem podającym liczbę zestawów, lista zestawów z tego źródła (link do edytora) oraz przyciski tworzenia: „Utwórz lekcję szkolną” (Etap 1), „Utwórz lekcję rozdziału” (Etap 2), „Utwórz zestaw słówek” (Etap 4). Przycisk otwiera dzisiejszy formularz z tekstem źródła zablokowanym do podglądu.
- Edytor zestawu utworzonego ze źródła pokazuje „Ze źródła: <tytuł>” z linkiem (gdy odnośnik istnieje).
- Komunikaty w `messages.ts`; Mantine wyłącznie w `apps/web/src/parent`.

## 4. Etap 2 — przedmiot `english_chapter`

### 4.1. Moduł

`subjects/english-chapter/module.ts`:

| Pole | Wartość |
|---|---|
| `id` | `english_chapter` |
| `titlePl` | „Angielski — rozdział” |
| `answerLocale` / `promptLocale` | `en-GB` / `pl-PL` |
| `exerciseTypes` | `lesson_card`, `lesson_match`, `lesson_group`, `lesson_cloze`, `lesson_choice`, `lesson_order`, `lesson_gap`, `lesson_open_answer` |
| `normalizer` | normalizator angielski (rozwijanie skrótów) przeniesiony z `english-grammar/` do wspólnego miejsca w `subjects/`, z którego korzystają oba przedmioty angielskie |
| `topics` | `[]` — temat dynamiczny z materiału (`buildDynamicTopic`, jak `school`) |
| `usesV3Payload` | brak (`false`) — bez pól v3, cytatów i oceny dwuwymiarowej |
| `poolDeduplication` | `exercise` (to samo słowo bywa odpowiedzią w kilku zdaniach) |
| `poolMinimums` | domyślne `DEFAULT_LESSON_POLICY` (3 / 4 / 2) |
| `ttsForAnswers` / `ttsForPrompts` | `false` / `false` |
| `ttsForFeedback` | `true` od Etapu 3 (sekcja 5) |
| `spokenAnswers` | brak |
| `validatePoolExtra` | walidacja słownikowa względem materiału (4.4) |

Kategorie błędów przedmiotu (z polskimi szablonami podpowiedzi): `wrong_word` „Pomylone słowo”, `spelling` „Pisownia”, `word_order` „Szyk zdania”, `missing_word` „Brakujące słowo”, plus kategorie bazowe silnika.

### 4.2. Zagadnienia

Model dzieli materiał na 2–8 zagadnień dwóch rodzajów:

- **grupa słów** — np. „Ubrania”, „Pogoda”, „Pory roku”, „Dni tygodnia”: 4–12 słów i zwrotów z materiału;
- **rama zdaniowa** — np. „I'm wearing (a) …”, „What's the weather like? It's …”: konstrukcja z rozdziału ze słowami, które do niej pasują.

Karty zagadnienia (2–4): lista „słowo — polskie znaczenie” albo wzór ramy z 1–3 przykładami po angielsku zbudowanymi wyłącznie ze słów materiału. `SubjectPromptProfile` dostaje opcjonalne pole `objectivesRules` doklejane do promptu etapu zagadnień; przedmiot szkolny go nie ustawia, więc jego prompt się nie zmienia.

### 4.3. Typy zadań i etapy

Mapowanie etapów pozostaje w `STAGE_BY_TYPE` bez zmian.

| Etap | Typ | Treść | Bodziec znaczenia |
|---|---|---|---|
| guided | `lesson_match` | lewa strona po angielsku (słowo, zwrot albo pytanie z rozdziału), prawa: polskie znaczenie albo angielska odpowiedź; 3–5 par + 0–2 dystraktory | strona polska / para pytanie–odpowiedź |
| guided | `lesson_group` | 2–3 grupy z polskimi etykietami (np. „Pogoda”, „Ubrania”), 4–8 angielskich elementów | etykiety grup |
| guided | `lesson_cloze` | 2–4 krótkie zdania z ram rozdziału, 2–4 luki, 1–2 słowa-pułapki z materiału | kontekst zdań |
| guided | `lesson_choice` | angielskie zdanie z luką w `stem` (`It's ___ today.`), 2–3 opcje | polskie zdanie w `instructionPl` („Dziś pada śnieg. Wybierz słowo.”) |
| guided | `lesson_order` | klocki-słowa zdania z ramy | polskie zdanie w `instructionPl` („Ułóż zdanie: Mam na sobie różowy płaszcz.”) |
| productive | `lesson_gap` | angielskie zdanie z jedną luką | `hint` = polskie znaczenie brakującego słowa |
| independent | `lesson_open_answer` | tłumaczenie krótkiego zdania z polskiego (≤200 znaków odpowiedzi) | polskie zdanie |

Polecenia (`instructionPl`) są krótkie, po polsku; dla typów, które je mają, obowiązują stałe polecenia z `messages.kid`.

### 4.4. Zgodność z materiałem (walidacja słownikowa)

Słownik materiału: tokeny materiału po normalizacji (NFC, małe litery, `’`→`'`, bez interpunkcji). `FUNCTION_WORDS`: stała, testowana lista ok. 60 angielskich słów funkcyjnych w module (zaimki, przedimki, formy `be`, `do`, `can`, skróty typu `i'm`, `it's`, spójniki, podstawowe przyimki, `yes`/`no`, `today`).

Element **sprawdzany** — każdy jego token należy do słownika materiału albo `FUNCTION_WORDS`, a co najmniej jeden token należy do słownika materiału i nie jest słowem funkcyjnym. Elementy sprawdzane:

- `lesson_match`: każde `left`;
- `lesson_group`: każdy element;
- `lesson_cloze`: każde `gapAnswers` i `extraWords`;
- `lesson_choice`: każda opcja;
- `lesson_order`: zdanie odpowiedzi;
- `lesson_gap`: `answer` i każdy `acceptedAnswers`;
- `lesson_open_answer`: `answer` i każdy `acceptedAnswers`.

Ćwiczenie z niespełnionym warunkiem jest odrzucane pojedynczo (jak dziś niepoprawne ćwiczenia), z komunikatem wskazującym słowo spoza materiału. Zdania-bodźce (stem, tekst cloze poza lukami, polskie zdania) mają tylko regułę w prompcie; resztę wyłapuje rodzic przy przeglądzie.

### 4.5. Ocena, opanowanie, kartkówka

Bez zmian w silniku:

- porównanie z zatwierdzonymi wariantami po normalizacji (`I'm` = `I am`); literówka w sprawdzanym słowie nie zalicza zadania, dziecko widzi poprawną odpowiedź;
- tłumaczenie niedopasowane do wariantów: cache werdyktów, potem model oceniający (standardowa ścieżka lekcji, nie szkolna), gdy skonfigurowany i limit sesji niewyczerpany; `gradingRole` przedmiotu: czy zdanie oddaje znaczenie polskiego zdania słowami z rozdziału, drobny błąd pisowni = `almost`;
- opanowanie zagadnienia: trzy ostatnie kwalifikujące sukcesy na różnych ćwiczeniach, w tym jeden w późniejszej sesji innego dnia po ≥12 h; bez modelu osiągalne przez `lesson_gap` na ćwiczeniach niewidzianych (SPEC §29a.7);
- próbna kartkówka i termin sprawdzianu jak w lekcjach, raport per zagadnienie; pary, grupy i luki z bankiem są w niej nauką wspomaganą, jak w przedmiocie szkolnym.

### 4.6. Tworzenie lekcji

- `createSchoolLesson` staje się cienką komendą nad wspólnym `createMaterialLesson(services, subjectId, …)` dla przedmiotów z tematem dynamicznym (wymaga `buildDynamicTopic`; inaczej `internal`).
- Nowa komenda `ChapterLessonCommand`: `clientRequestId`, `topicTitlePl` (np. „Unit 1”, 1–120), `material` albo `sourceMaterialId` (3.3), opcjonalnie `instruction` (≤500), `poolSize`, `deckId`. Tytuł zestawu: „Angielski: <topicTitlePl>”.
- Generacja zagadnień i puli idzie dzisiejszym runem `lesson` (temat dynamiczny jest już generyczny względem przedmiotu); fałszywy provider dostaje gałąź `english_chapter`.

### 4.7. Panel rodzica i Kid UI

- Formularz nowej lekcji: przedmiot „Angielski — rozdział” z polem tytułu i materiałem (wklejonym albo ze źródła); informacja, że zagadnienia powstaną automatycznie i rodzic sprawdzi je przed publikacją. Edytor ćwiczeń bez nowych pól — wszystkie typy mają edytory z gramatyki lub przedmiotu szkolnego.
- Kid DTO: prompty `lesson_match`, `lesson_group`, `lesson_cloze`, `lesson_choice`, `lesson_order` i `lesson_gap` dostają opcjonalne `contentLocale: "pl-PL" | "en-GB"` (brak = dzisiejsze zachowanie, starsze klienty parsują dalej). Serwer ustawia je z `answerLocale` przedmiotu dla `english_chapter`; `lesson_open_answer` zachowuje `promptLocale` (tu `pl-PL`, bo pytaniem jest polskie zdanie).
- Kid UI: przy `contentLocale` widoki oznaczają atrybutem `lang` treść o pewnym języku: lewą kolumnę par, elementy grup, tekst cloze i bank słów, `stem` i opcje wyboru, klocki, zdanie z luką. Prawa kolumna par (polskie znaczenie albo angielska odpowiedź) i polskie etykiety grup nie dostają `lang` treści. Bez nowych widoków i wzorców interakcji.

## 5. Etap 3 — lektor po odpowiedzi

### 5.1. Zachowanie

W omówieniu zadania treningowego (po dobrej i złej odpowiedzi) przy poprawnym zdaniu jest głośnik; dotknięcie odtwarza zdanie po angielsku głosem `en-GB`. Nagranie nie odtwarza się samo, nie zmienia oceny ani samodzielności. W próbnej kartkówce lektora nie ma (brak omówienia po zadaniu).

### 5.2. Tekst nagrania

Czysta funkcja domenowa `feedbackReadText(payload)` (obok `questionReadText`), wyłącznie z zatwierdzonego payloadu:

| Typ | Tekst |
|---|---|
| `lesson_choice` | `stem` z luką zastąpioną tekstem poprawnej opcji |
| `lesson_gap` | `stem` z luką zastąpioną `answer` |
| `lesson_cloze` | `clozeText` z lukami zastąpionymi `gapAnswers` w kolejności |
| `lesson_order` | `answer` |
| `lesson_open_answer` | `answer` |
| `lesson_match`, `lesson_group`, `lesson_card` | `null` (brak nagrania) |

### 5.3. Media

- `SubjectModule.ttsForFeedback: boolean` (wymagane; `false` dla `english_grammar` i `school`).
- Nowa rola `revision_assets.role = 'feedback_audio'` (migracja ograniczenia `revision_assets_role_allowed`); TTS w `answerLocale` przedmiotu, głos z konfiguracji mediów dla `en-GB`.
- Uzgadnianie mediów (`media-reconciliation`) zleca nagranie, gdy przedmiot ma `ttsForFeedback` i `feedbackReadText` nie jest `null`. Fingerprint z tekstu i głosu, więc identyczne zdania dzielą nagranie; edycja zleca nowe nagranie tylko po zmianie tekstu.
- Publikacja nie czeka na nagranie; liczy się dowolny gotowy zasób o oczekiwanym fingerprincie, jak przy `prompt_audio`. Brak gotowego nagrania = brak głośnika.

### 5.4. Ujawnienie i autoryzacja

- Wydanie zadania nie niesie nagrania ani jego identyfikatora (także w snapshotach zadań i odpowiedziach wznowienia sesji przed oceną).
- Odpowiedź na próbę lekcji (zadanie treningowe, gotowe nagranie) niesie istniejące pole `FeedbackDto.correctAudioAssetId`. W tej samej transakcji, przed odpowiedzią HTTP, serwer pieczętuje zdarzenie `audio_issued` dla zadania — ten sam wzorzec co dziś dla `picture_recognition` (`attempts.ts`).
- Plik pobierany jest istniejącym `GET /api/v1/media/:id` po nieprzejrzystym identyfikatorze, bez dodatkowej autoryzacji — tak jak dziś audio poprawnej opcji obrazkowej. Gwarancją „nie przed odpowiedzią” jest więc wyłącznie nieujawnianie identyfikatora przed oceną; test integracyjny sprawdza, że żaden DTO wydanego, nieocenionego zadania go nie zawiera.
- Kid UI używa istniejącego przycisku odsłuchu w omówieniu (`feedbackAudio` w `LearnScreen`, `playCorrectOptionAudio` w kontrolerze sesji), rozszerzonego na feedback lekcji; bez nowego wzorca interakcji.

## 6. Etap 4 — słówka ze źródła

### 6.1. Dwie ścieżki

| Ścieżka | Skąd słowa | Zmiana |
|---|---|---|
| Z opisu (np. „przedmioty codziennego użytku, dni tygodnia”) | model dobiera słowa do tematu | bez zmian |
| Ze źródła | wyłącznie słowa z tekstu źródła | nowa |

### 6.2. Tryb „ze źródła”

- Formularz generowania otwarty ze strony źródła: format (`standard`/`picture`), maksymalna liczba słów (≤ `MAX_DECK_ITEMS`), opcjonalne polecenie zawężające (≤500 znaków, np. „tylko pogoda”). Polecenie nie może dodać słów spoza materiału.
- `GenerationCommand` dostaje `sourceMaterialId` (wzajemnie wykluczające z dotychczasowym `prompt`; zwykłe polecenie zostaje przy 4000 znaków). Tekst źródła trafia do zapisanego inputu generacji i do `LlmGenerateDeckInput` osobnym polem `material`.
- Prompt trybu materiału: model wypisuje słowa i krótkie stałe zwroty, których uczy materiał, nie dodaje własnych; proponuje polskie znaczenie i przykładowe zdanie. Ramy zdaniowe z lukami („I'm wearing (a) …”) nie są elementami słówek.
- Walidacja deterministyczna: `target` każdego elementu po normalizacji (małe litery, interpunkcja, apostrofy) występuje w materiale jako fraza na granicach słów. Element spoza materiału jest odrzucany, reszta zostaje; zero poprawnych elementów = błąd generowania.
- Bez zmian: ilustracje i wizualizacje deterministyczne, TTS słów, przegląd, publikacja, scheduler, umiejętności.

## 7. Kontrakty, API, MCP

- `packages/contracts`: schematy źródeł (`SourceMaterialInput`, `SourceMaterialPatch`, `SourceMaterialDto`, `SourceMaterialSummaryDto`), `ChapterLessonCommandSchema`, `sourceMaterialId` w `SchoolLessonCommandSchema` i `GenerationCommandSchema` (z regułą „dokładnie jedno źródło tekstu”), `sourceMaterialId` w DTO zestawu dla rodzica, `LessonExerciseType`/limity bez zmian.
- `contentLocale` w promptach lekcji Kid DTO (4.7) — pole opcjonalne, zgodne wstecz.
- Procedury oRPC rodzica dla źródeł i lekcji rozdziału; Kid API bez nowych endpointów (zmienia się tylko zawartość feedbacku i opcjonalne `contentLocale`).
- MCP i `SKILL.md`: bez zmian. Raport Hermesa (`learning-overview`) nie obejmuje lekcji ani źródeł; filtr lekcji pozostaje. Uzasadnienie w opisie każdego PR.

## 8. Testy

- **Jednostkowe (domena):** rejestracja `english_chapter` (walidacja rejestru); walidacja słownikowa (element w materiale, słowa funkcyjne, odrzucenie słowa spoza materiału, odpowiedź złożona z samych słów funkcyjnych); `feedbackReadText` dla każdego typu; przeniesiony normalizator (dotychczasowe testy gramatyki przechodzą); walidacja `target` słówek względem materiału; testy architektoniczne (granice obszarów, silnik nie importuje przedmiotów).
- **Kontrakty:** schematy źródeł, wzajemne wykluczanie `material`/`sourceMaterialId`/`prompt`, limity.
- **Integracyjne (PostgreSQL):** źródło — idempotentne tworzenie, konflikt `revision`, kopia tekstu w zestawie, edycja źródła nie zmienia zestawu, usunięcie zostawia zestaw z `null`; lekcja rozdziału z fałszywym generatorem (zagadnienia, pula, odrzucenie zadania spoza materiału, publikacja); nagranie w omówieniu — brak identyfikatora w wydanym i wznowionym zadaniu przed oceną, `audio_issued` zapieczętowane przed odpowiedzią, brak nagrania w kartkówce; słówka ze źródła — odrzucenie pozycji spoza materiału.
- **Kid UI:** test komponentu omówienia lekcji z głośnikiem; `lang="en-GB"` w parach, grupach i lukach; specyfikacja geometrii Playwright omówienia z głośnikiem (portrait, landscape, tablet, desktop, cele ≥48 px).
- **E2E:** rodzic — źródło → lekcja rozdziału → publikacja (`real`); dziecko — sesja lekcji rozdziału z odsłuchem w omówieniu (`mocked`). Nowe pliki w `tests/e2e/spec-projects.ts` i `tests/integration-buckets.ts`.

## 9. Niezweryfikowane po wdrożeniu

- Jakość zagadnień i zadań z prawdziwego modelu na prawdziwym rozdziale (ryzyko: zbyt wiele odrzuceń słownikowych → niespełnione minima puli; wtedy stroimy prompt albo listę słów funkcyjnych).
- Wymowa lektora `en-GB` na fizycznym urządzeniu.
- Pilotaż z dzieckiem.

## 10. Etapy i PR

Każdy etap kończy się osobnym PR do scalenia przez właściciela:

1. **Źródła** + lekcja szkolna ze źródła (sekcja 3); ten PR zawiera też niniejszą specyfikację.
2. **Przedmiot „Angielski — rozdział”** (sekcja 4).
3. **Lektor po odpowiedzi** (sekcja 5).
4. **Słówka ze źródła** (sekcja 6).

Dokumentacja w PR etapów: nowa sekcja `docs/SPEC.md` (§37), uzupełnienie `docs/architecture.md` §19 (przedmiot z tematem dynamicznym poza `school`, `ttsForFeedback`, źródła), `docs/schema.sql`.

## 11. Poza zakresem

- Rozsypane litery i brakujący element ciągu — [lookassh/knowli#185](https://github.com/lookassh/knowli/issues/185).
- Zadania z obrazkami — [lookassh/knowli#186](https://github.com/lookassh/knowli/issues/186).
- „Posłuchaj pytania” przed odpowiedzią w lekcji rozdziału, odpowiedzi mówione, lekcja gramatyki ze źródła, wersjonowanie źródła, upload i OCR.
