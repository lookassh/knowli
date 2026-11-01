# „Posłuchaj i uzupełnij” — wybór brakującej formy ze słuchu (`lesson_listen_choice`) — design

Data: 2026-11-01. Status: do recenzji właściciela.
Issue: lookassh/knowli#198. Powiązane: `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md`
(#194, nagranie `feedback_audio`), `.kiro/specs/grammar-module/requirements.md` (wym. 2.13, 4.1, 4.6, 5.2, 7.2),
`docs/superpowers/specs/2026-10-30-english-chapter-design.md`, `docs/SPEC.md` §22.

## 1. Cel

Dziecko **słyszy** pełne zdanie po angielsku (lektor en-GB), widzi to samo zdanie z luką
i **wybiera** brakującą formę z 2–4 opcji. Ćwiczy słyszenie końcówek i skrótów
(`-s`, `doesn't`, `'re`), czego samo czytanie nie daje.

Ustalenia z właścicielem (2026-11-01):

- odpowiedź **wyborem z opcji** (bez wpisywania) — rozróżnianie form ze słuchu bez bariery
  pisowni skrótów;
- **osobny typ ćwiczenia** `lesson_listen_choice`, generowany, walidowany i edytowany jak
  własne ćwiczenie (podejście A; odrzucone: wariant w czasie sesji z `lesson_choice`
  i flaga w payloadzie `lesson_choice`);
- przedmioty: **`english_grammar` i `english_chapter`**; przedmioty szkolne bez zmian.

## 2. Zakres

W zakresie: kontrakty, domena (etap, walidacja, tożsamość, ekspozycja, selektor), generator
(prompty i fake provider), media (to samo nagranie co #194), sesja (wydanie, autoryzacja
odsłuchu, kwalifikacja, feedback), edytor rodzica, widok Kid UI, dokumentacja.

Poza zakresem:

- wariant z wpisywaniem formy (możliwy później jako osobny typ);
- ukrywanie tekstu zdania (czyste dyktando);
- odsłuch nagrania w podglądzie lekcji rodzica i status nagrania per ćwiczenie w panelu;
- wolniejsze odtwarzanie;
- automatyczne dogenerowanie ćwiczeń słuchowych do już opublikowanych lekcji (rodzic
  dogenerowuje regułę i publikuje nową wersję, jak przy #174/#194).

## 3. Model zadania i kwalifikacja (decyzja wobec wym. 4.6)

- **Nagranie jest bodźcem, ale nadal jest audio zdania przed odpowiedzią.** Zdanie zawiera
  rozwiązanie, więc stosujemy wym. 4.6 bez zmian: serwer zapisuje i pieczętuje ekspozycję
  (`audio_issued`, ekspozycja `target_key` ćwiczenia) **przed** wydaniem nagrania, a próba
  jest wspomagana (`model_audio`).
- **Typ jest zawsze wspomagany** także bez odsłuchu: to typ zamknięty z opcjami
  (`assistance: options`, jak `lesson_choice`). Nigdy nie jest samodzielnym sprawdzeniem
  (`independentCheck = false`) i nie liczy się do opanowania reguły (wym. 7.2–7.3).
- **Etap: `guided`** (`STAGE_BY_TYPE`). Dwie kolejne poprawne odpowiedzi etapu nadal
  awansują etap (wym. 5.3), tak jak `lesson_choice`.
- **Ekspozycja przy wydaniu:** jak `lesson_choice` — zadanie zapisuje `exposures: [targetKey]`
  przy wydaniu (opcje zawierają rozwiązanie). Ochrona należnych samodzielnych sprawdzeń
  w selektorze działa tak samo jak dla wyboru.
- **Kartkówka:** typ jest wykluczony z planu kartkówki (`mock-test-plan.ts`) — audio przed
  odpowiedzią zdradzałoby rozwiązanie.
- Brzmienie wym. 4.6 bez zmian. Nowe brzmienie 2.13 (§10) dopuszcza nagranie zdania przed
  odpowiedzią wyłącznie w tym typie, jako bodziec przez autoryzację odsłuchu.

## 4. Payload i walidacja

Payload rewizji (`item_revisions.payload`, `LessonExerciseInputSchema`) jak `lesson_choice`
bez piktogramu:

| Pole | Reguła |
| --- | --- |
| `stem` | zdanie w języku odpowiedzi z dokładnie jedną luką (2+ podkreśleń) |
| `options` | 2–4 opcje `{id, text}`, niepuste |
| `correctOption` | id jednej z opcji |
| `answer` | tekst poprawnej opcji (jak w `lesson_choice`) |
| `acceptedAnswers`, `focus` | jak w `lesson_choice` |
| `instructionPl` | **niedozwolone** — polecenie dla dziecka jest stałe z katalogu komunikatów („Posłuchaj i uzupełnij zdanie.”); bodźcem znaczenia jest nagranie, nie polskie zdanie |
| `visualSubject`, `hint` | niedozwolone |

Walidacja puli (`pool-validation.ts`, wspólna dla generacji, edycji i publikacji):

- dokładnie jedna luka w `stem`; zdanie z wstawioną poprawną opcją (`feedbackSentenceText`)
  musi istnieć i mieć ≤ 200 znaków — inaczej nagranie nigdy nie powstanie;
- opcje parami różne **po normalizatorze przedmiotu** (np. `doesn't` i `does not` to ta sama
  opcja — brzmią różnie, ale obie są poprawne, więc zadanie byłoby dwuznaczne);
- typ musi być na liście przedmiotu i celu; przedmiot z tym typem musi mieć
  `ttsForFeedbackSentence = true` (`catalog-validation.ts` — bez nagrania typ nie ma sensu).

Walidatory przedmiotów: gramatyka stosuje do zdania z wstawioną opcją te same kontrole
formy co dla `lesson_choice`; rozdział — kontrolę jednej luki i elementu sprawdzanego jak
dla `lesson_choice`, bez wymogu bodźca w poleceniu (`STIMULUS_IN_INSTRUCTION` nie obejmuje
typu).

**Tożsamość** (`exercise-identity.ts`): `[objectiveId, "lesson_listen_choice", stem]` — jawny
`case`, typ nie należy do `INSTRUCTION_STIMULUS_TYPES`. Ten sam stem jako `lesson_choice`
i `lesson_listen_choice` to dwa różne ćwiczenia.

**Ekspozycja** (`target_key`): gramatyka — `answer` (jak dziś dla wyboru); rozdział —
`chapterExposureText` wypełnia stem poprawną opcją jak dla `lesson_choice`.

**Minima publikacji:** ćwiczenia słuchowe **nie liczą się** do minimów etapów
(`poolMinimums`/`DEFAULT_LESSON_POLICY`, `poolStageCounts`): mogą być niewydawalne bez
nagrania, więc nie mogą zastępować zwykłych ćwiczeń prowadzonych. Lekcja bez nich publikuje
się jak dziś.

## 5. Generacja

- Generator (`providers/openai/llm.ts`): typ **nie** wchodzi do menu podziału etapów
  (`guided/productive/independent`). Osobne zdanie promptu: „dodatkowo do 2
  `lesson_listen_choice` na cel, gdy typ jest dozwolony dla celu; nie liczą się do podziału”.
  Schemat puli (`lesson-pool-schema.ts`) dostaje typ w zwykłej gałęzi.
- Reguły typu w profilach promptów (`english-grammar/prompts.ts`, `english-chapter/prompts.ts`):
  krótkie naturalne zdanie (≤ 12 słów), jedna luka `___` na elemencie sprawdzanym reguły,
  2–3 opcje różniące się **słyszalnie** w elemencie sprawdzanym (np. `play`/`plays`,
  `don't`/`doesn't`, `is`/`are`/`'re`), bez opcji równoważnych (pełna forma i skrót tej samej
  formy), bez `instructionPl`.
- Katalog: typ dochodzi do `ALL_EXERCISE_TYPES` gramatyki i do `exerciseTypes` celów, w których
  forma jest słyszalna: Present Simple — forma podstawowa, `-s` w 3. os., przeczenie
  `don't/doesn't`, pytanie `Do/Does`; „to be” — formy i skróty `am/is/are`, przeczenie.
  Cele z samą pisownią (`-es/-ies`) i krótkimi odpowiedziami — bez typu (decyzja przy
  implementacji, opisana w katalogu). Wersja tematów **nie** rośnie: lista typów nie zmienia
  znaczenia reguł (wym. 1.6); stare lekcje mają typ w katalogu, ale bez ćwiczeń.
- Rozdział: typ w `CHAPTER_EXERCISE_TYPES` i w obu rodzajach zagadnień (`words`, `frame`).
- Fake provider (`providers/fake.ts`) generuje ćwiczenie słuchowe dla testów i trybu dev.

## 6. Media

- **Bez nowej roli i migracji.** `feedbackSentenceText` dostaje `case "lesson_listen_choice"`
  identyczny jak `lesson_choice` (stem z wstawioną poprawną opcją). Uzgadnianie mediów planuje
  więc to samo nagranie `feedback_audio` (en-GB, bez stylu), które #194 tworzy dla zdań. To
  jedno nagranie jest bodźcem przed odpowiedzią i odczytem po niej.
- Zasoby TTS są współdzielone po fingerprincie: jeśli identyczne zdanie ma już nagranie (np.
  z `lesson_choice`), zostaje użyte ponownie.
- Publikacja **nie czeka** na nagranie (jak #194). Brak gotowego nagrania = zadanie słuchowe
  nie jest wydawane (§7). Nagranie nieudane ponawia się przy kolejnym uzgadnianiu (edycja,
  nowa wersja), bez `keepFailed` — bez zmian względem #194.
- Rola `feedback_audio` pozostaje ukryta w DTO zasobów szkicu rodzica.

## 7. Sesja (serwer)

Właściciel reguł: `learning/lessons` (selektor, materializacja, próby), `learning/events.ts`
(autoryzacja odsłuchu). Media: `materials`. Granice transakcji: bez zmian — wydanie zadania,
autoryzacja odsłuchu i finalizacja próby mają własne istniejące transakcje.

- **Selektor (rdzeń funkcyjny):** `LessonExerciseCandidate` dostaje `stimulusAudioReady?: boolean`.
  Czysta reguła w `scheduler.ts`: kandydat `lesson_listen_choice` bez gotowego nagrania jest
  pomijany przy wyborze ćwiczenia (jak gdyby nie istniał w puli). Etap guided bierze wtedy
  inne ćwiczenie. Powłoka (`lesson-sessions.ts`) ustawia flagę z rozwiązanego
  `feedbackAudioAssetId` (gotowy zasób TTS o oczekiwanym fingerprincie) i flagi przedmiotu.
- **Materializacja** (`lesson-materialize.ts`): prompt dziecka
  `{ kind: "lesson_listen_choice", instructionPl, stemWithGap, options, contentLocale }` —
  `instructionPl` z katalogu komunikatów; opcje tasowane jak w wyborze; **bez** identyfikatora
  nagrania. Klucz prywatny: jak `lesson_choice` plus `feedbackAudioAssetId` (wymagany: zadanie
  bez nagrania nie jest materializowane — błąd programisty, bo selektor je odfiltrował).
- **Autoryzacja odsłuchu** (`authorizeDisclosure`, `kind: "audio"`): nowa gałąź dla
  `lesson_listen_choice` — dozwolona w treningu (kartkówka i tak nie wydaje typu; dla pewności
  odmowa w `mock_test`), gdy zadanie jest `issued`, przedmiot ma `ttsForFeedbackSentence`, a klucz
  ma `feedbackAudioAssetId` gotowego zasobu. Zapis `audio_issued` z ekspozycją `targetKey`
  przed odpowiedzią (istniejący `writeSealedEvent`), odpowiedź z `audioAssetId` (pole
  `DisclosureDto` już istnieje dla `picture_recall`). Ten typ nie wymaga `ttsForAnswers`.
  Każde odtworzenie (także powtórka) to nowa autoryzacja i nowe zdarzenie — jak dziś.
  Podpowiedź (`kind: "hint"`) dla typu — bez zmian (lekcje jej nie używają).
- **Próba:** modalność `choice`, ocena po id opcji (`evaluateChoice`), `assistanceFor` dodaje
  `options` (lista typów zamkniętych) i `model_audio` (zdarzenie przed `receivedAt`).
  `correctTextFor` jak dla wyboru. Feedback po odpowiedzi czyta to samo zdanie (#194:
  `withFeedbackSentenceAudio` + `sealPostAnswerAudio`, bez zmian reguł).
- **Ocena aktywności sesji** (`session-activity.ts`): typ jak wybór (polecenie, zdanie z luką,
  opcje, wybrana opcja). Do modelu nie trafia nagranie.

## 8. Kid UI

- Nowy widok `LessonListenChoiceView` (dispatcher `ExerciseView`, `exercise-presentation.ts`),
  zbudowany ze wspólnych komponentów: `ExerciseFrame`, duży przycisk „Posłuchaj zdania”
  (`ListenButton`, cel ≥ 54 px — główna akcja bodźca), zdanie z luką (`lang` = `contentLocale`),
  opcje w `AnswerGrid` (wybór wysyła odpowiedź natychmiast). Bez surowych `<button>`.
- **Kontroler sesji:** po wyświetleniu zadania automatycznie autoryzuje i odtwarza nagranie
  raz (`authorizeDisclosure` → `mediaUrl` → istniejący kanał odtwarzania). Przycisk powtarza
  odsłuch (nowa autoryzacja). Nowe zadanie, odpowiedź i inne odtwarzanie przerywają nagranie.
- **Ścieżka bez dźwięku:** zablokowane autoodtwarzanie albo błąd pliku/sieci nie pokazują
  komunikatu — zostaje przycisk. Opcje są aktywne od początku (nie blokujemy odpowiedzi do
  odsłuchu): gdy dźwięk nie działa, zadanie da się rozwiązać czytaniem, a próba i tak jest
  wspomagana. Serwer nie wydaje typu bez gotowego nagrania (§7). Nie ma lokalnego „sukcesu”
  bez odpowiedzi serwera.
- Po odpowiedzi: dok feedbacku jak dla wyboru i automatyczny odczyt zdania z #194. Żeby
  dziecko nie widziało dwóch identycznych głośników i żeby układ nie skakał, dla tego typu
  dok **nie** dodaje własnego „Posłuchaj zdania”; przycisk w treści zostaje na miejscu i po
  odpowiedzi odtwarza nagranie z feedbacku (`correctAudioAssetId`, bez nowej autoryzacji —
  zadanie nie jest już `issued`). Gdy feedback nie niesie nagrania (np. „Pomiń”), przycisk
  jest nieaktywny.
- Teksty w katalogu komunikatów: polecenie, etykieta przycisku, etykiety typu
  (`stepType`, `lessons.exerciseTypes`: „Posłuchaj i uzupełnij”).
- **Responsywność:** przycisk, zdanie i opcje mieszczą się w compact/medium/expanded, niskiej
  wysokości (landscape telefonu), tablecie i desktopie ze skalą; testy geometrii Playwright.

## 9. Panel rodzica

- Edytor: typ w `STAGE_BY_TYPE` (web), `STEM_TYPES`, `OPTION_TYPES`, etykieta-odznaka, pola jak
  w `lesson_choice` bez piktogramu i polecenia. Krótka informacja pod ćwiczeniem: „Lektor
  przeczyta zdanie. Zadanie pojawi się dziecku, gdy nagranie będzie gotowe.”
- Podgląd, akceptacja, usuwanie i dogenerowanie reguły — bez nowych mechanizmów.
- Panel postępu: typ pokazuje się w nadzorze jak inne kroki (`stepType`).

## 10. Dokumentacja i integracje

- `.kiro/specs/grammar-module/requirements.md`: 4.1 (lista typów), 5.2 (etap prowadzony:
  „wybór, wybór ze słuchu, klocki, krótka odpowiedź”), 2.13 — nowe brzmienie:

  > THE lesson-generation flow SHALL NOT generate or require answer-audio (`target_audio`) for
  > grammar exercises. THE flow SHALL prepare a feedback-sentence recording (`feedback_audio`)
  > for exercise types with a full sentence; it never blocks publication. Child lesson tasks
  > SHALL NOT expose a sentence recording before the answer, except in the listen-and-choose
  > type (`lesson_listen_choice`), where the recording is the stimulus: it is disclosed only
  > through the server's disclosure authorization (requirement 4.6 — sealed exposure, assisted
  > attempt), and the type is never issued without a ready recording.

- `docs/SPEC.md` §22 (dopowiedzenie o wyborze ze słuchu) i lista typów lekcji;
  `docs/architecture.md` sekcja 19 (typ, etap, nagranie jako bodziec, filtr selektora);
  spec rozdziału (typ w rodzajach zagadnień); spec #194 §11 (punkt 2 zrealizowany tym
  projektem).
- **API → MCP → `SKILL.md`: brak zmian.** Nowa wartość `exerciseType` i nowy prompt zadania są
  w Kid API, a autoryzacja odsłuchu rozszerza istniejący endpoint bez zmiany schematu. MCP
  i raport Hermesa (`learning-overview`) nie obejmują lekcji ani typów ćwiczeń; implementacja
  potwierdza to wyszukaniem użyć i opisuje w PR.

## 11. Prywatność

Do TTS trafia wyłącznie zdanie z zatwierdzonego materiału. Nagranie jest wspólnym materiałem;
usunięcie profilu usuwa zdarzenia dziecka, nie nagrania. Kid DTO nie zawiera klucza ani
identyfikatora nagrania przed autoryzacją.

## 12. Testy

- **Domena (unit):** etap i `isAssessed`; walidacja puli (luka, opcje równoważne po
  normalizatorze, limit zdania, zakazane pola, typ przedmiotu/celu, wymóg flagi w katalogu);
  tożsamość; `feedbackSentenceText`; ekspozycja rozdziału; selektor pomija typ bez nagrania
  i bierze inne ćwiczenie guided; minima publikacji nie liczą typu; plan kartkówki go wyklucza.
- **Generator (unit):** prompt i schemat puli zawierają typ poza podziałem etapów; fake provider.
- **Media (unit):** typ planuje `feedback_audio` z pełnym zdaniem; zmiana opcji poprawnej
  zmienia fingerprint.
- **Integracja (PostgreSQL):**
  - zadanie słuchowe wydawane tylko z gotowym nagraniem; bez nagrania selektor bierze inne
    ćwiczenie;
  - autoryzacja odsłuchu zapisuje zapieczętowane `audio_issued` z ekspozycją przed
    odpowiedzią i zwraca `audioAssetId`; próba jest wspomagana (`options`, `model_audio`);
  - odmowa autoryzacji dla zadania nie-`issued`, w kartkówce i bez nagrania;
  - feedback niesie `correctAudioAssetId` (odczyt po odpowiedzi);
  - kartkówka nie wydaje typu; publikacja nie czeka na nagranie;
  - edycja rodzica i publikacja nowej wersji z ćwiczeniem słuchowym.
- **Kid UI (unit):** widok, kontroler (autoodtwarzanie, powtórka, przerwanie, błąd).
- **E2E:** `mocked` — autoodtwarzanie po wyświetleniu, przycisk powtórki, zablokowane
  autoodtwarzanie zostawia przycisk, wybór opcji wysyła odpowiedź, odczyt po odpowiedzi;
  geometria widoku (portrait, landscape, tablet, desktop, skala) w specyfikacjach layoutu;
  edytor rodzica (layout). `real` — przepływ lekcji z ćwiczeniem słuchowym (gotowe nagranie
  z fake TTS).
- **Niezweryfikowane symulacją:** autoodtwarzanie na fizycznym iPhonie/iPadzie (Safari) i
  słyszalność różnic form w głosie lektora — raport jako brak dowodu.
