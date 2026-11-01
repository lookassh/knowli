# Historyjka na koniec sesji lekcji gramatyki — design

Data: 2026-11-01. Status: do recenzji właściciela.
Issue: lookassh/knowli#195.
Powiązane: `.kiro/specs/grammar-module/requirements.md` (2.13, 5.4, 9, 10),
`docs/SPEC.md` §22, `docs/architecture.md` §19,
`docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md` (#194 — nagranie
zdania po odpowiedzi, wzorzec dla nagrania en-GB),
`docs/superpowers/specs/2026-10-30-tts-voice-style-design.md`.

## 1. Cel

Na koniec każdej sesji treningowej lekcji gramatyki angielskiej dziecko dostaje
krótką historyjkę: 4–6 zdań po angielsku (en-GB) w ćwiczonym czasie, z odczytem
lektora. Potem odpowiada na 1–2 pytania sprawdzające zrozumienie. Celem jest
osłuchanie się z formą w spójnym kontekście, a nie sprawdzenie reguły.

Ustalenia z właścicielem (2026-11-01):

- historyjka zamyka **każdą** sesję treningową lekcji (nie kartkówkę). To ta sama
  historyjka wersji lekcji przy każdej sesji, bo ponowny odsłuch to cel;
- pytania i odpowiedzi są **po polsku** (3 opcje), bo sprawdzają zrozumienie
  angielskiego tekstu, a nie czytanie pytań;
- pytania są **oceniane** jak zadania zamknięte: od razu jest wynik i poprawna
  odpowiedź, a próba zostaje zapisana. Są jednak **poza budżetem** ocenianych zadań,
  **poza postępem reguł** i bez cyklu wsparcia;
- opublikowane lekcje bez historyjki dostają przycisk **„Wygeneruj historyjkę”**
  w edytorze szkicu, także w nowej wersji opublikowanej lekcji.

## 2. Zakres

W zakresie:

- dane historyjki w wersji lekcji;
- generowanie: krok w runie lekcji i osobny run samej historyjki;
- walidacja, edycja i zatwierdzenie przez rodzica;
- nagranie TTS w workerze;
- dwa nowe rodzaje zadań sesji (`lesson_story`, `lesson_story_question`) z widokami
  Kid UI;
- dokumentacja i testy.

Poza zakresem:

- historyjka w kartkówce i w omówieniu kartkówki;
- wiele historyjek na lekcję lub rotacja;
- historyjka w innych przedmiotach. Mechanizm jest generyczny i sterowany flagą,
  ale dziś flagę ma tylko `english_grammar`;
- ton lektora historyjki. Styl wypowiedzi nie działa dla en-GB, więc nagranie
  dostaje instrukcję wymowy języka jak `feedback_audio`;
- raport rodzica z wynikami pytań do historyjki. Próby są zapisane, ale osobnego
  widoku nie ma;
- wolniejsze odtwarzanie i podświetlanie zdań w czasie odczytu.

## 3. Rozważone podejścia

**A. Historyjka w `lesson_context` wersji; zadania sesji kotwiczone jak karty —
wybrane.**
- Historyjka jest danymi wersji, tak jak `examples` kart: jest zatwierdzana i
  niezmienna razem z wersją, kopiowana do nowego szkicu i edytowana tą samą
  operacją `edit`.
- Nagranie ma własną tabelę wzorem `lesson_card_assets`.
- Zadania sesji kotwiczą `item_revision_id` w ćwiczeniu lekcji, tak jak karty.
  Konsumenci odróżniają je po `exercise_type`.
- Plusy: pula ćwiczeń, pokrycie, selektor, deduplikacja i edytor ćwiczeń nie
  widzą historyjki.
- Minusy: próby pytań wiszą na rewizji kotwicy, więc czytelnicy prób muszą filtrować
  typ zadania (§7.5).

**B. Historyjka jako element puli (`learning_item` z własną rewizją).**
- Plusy: próby mają czystą rewizję, a media idą przez `revision_assets` (nowa rola).
- Minusy: historyjka nie ma celu (reguły), a pula zakłada „jedno ćwiczenie = jeden
  cel”. Wyjątki musiałyby trafić do walidacji puli, pokrycia publikacji, selektora,
  tożsamości ćwiczeń, edytora grupującego po regułach i kartkówki.
- Odrzucone: więcej punktów styku i ryzyko przecieku do selektora.

**C. Historyjka i pytania tylko w podsumowaniu sesji, sprawdzane po stronie
klienta.**
- Odrzucone: klucz odpowiedzi trafiłby do Kid DTO, a to łamie zasadę „Kid DTO nie
  zawiera klucza odpowiedzi”. Do tego nie ma zapisu prób ani ekspozycji.

## 4. Model danych historyjki (domena)

Nowy plik `packages/server/src/domain/lessons/story.ts`. Zawiera czyste funkcje
bez bazy, SDK ani zegara.

```ts
interface LessonStory {
  readonly sentences: readonly string[];            // 4–6 zdań, answerLocale przedmiotu
  readonly questions: readonly LessonStoryQuestion[]; // 1–2 pytania
}
interface LessonStoryQuestion {
  readonly id: string;                               // "q1", "q2" — stabilne w wersji
  readonly question: string;                         // promptLocale (pl-PL)
  readonly options: readonly { readonly id: string; readonly text: string }[]; // dokładnie 3
  readonly correctOption: string;                    // id jednej z opcji
}
```

**`validateLessonStory(story, ctx)`** zwraca listę błędów (pusta oznacza, że
historyjka jest poprawna).

Reguły kształtu i treści:
- 4–6 zdań. Każde po przycięciu i scaleniu białych znaków jest niepuste i ma ≤ 160
  znaków. Całość ≤ 700 znaków.
- 1–2 pytania o unikalnych `id`. Treść pytania jest niepusta i ma ≤ 160 znaków.
- Dokładnie 3 opcje o unikalnych `id` i różnej treści po normalizacji
  (`trim` + `toLocaleLowerCase("pl-PL")`). Każda opcja jest niepusta i ma ≤ 80
  znaków. `correctOption` wskazuje jedną z opcji.

**Bariera ekspozycji:**
- Żadne zdanie historyjki nie może mieć klucza `lessonTextTargetKey(subject,
  sentence)` równego `target_key` któregokolwiek ćwiczenia wersji. `ctx` niesie
  zbiór kluczy ćwiczeń.
- Uzasadnienie: zdanie historyjki identyczne z odpowiedzią ćwiczenia ujawniłoby
  rozwiązanie. Ćwiczenie straciłoby wtedy status „niewidziane” w samodzielnych
  sprawdzeniach (wymaganie 5.7).
- Zbieżność z przykładami kart jest dopuszczalna, bo przykłady są i tak jawną
  ekspozycją.

**`storyReadText(story)`** zwraca tekst nagrania: zdania złączone spacją. Pytań
nie czyta.

**`storyFingerprintText(story)`** to wejście fingerprintu nagrania, równe
`storyReadText`. Zmiana pytań nie zmienia nagrania.

## 5. Przedmiot (`SubjectModule`)

Silnik nie zna gramatyki. Zachowanie włącza się nowymi opcjami interfejsu.

- `readonly lessonStory?: boolean`. Brak oznacza `false`. Przedmiot przygotowuje
  i pokazuje historyjkę na koniec sesji treningowej.
  - `english_grammar: true`
  - `english_chapter`, `school` i przedmiot testowy: brak pola
- `SubjectPromptProfile.storyRules?: string` to reguły treści historyjki doklejane
  do promptu generacji (§6.1). Dla gramatyki:
  - ćwiczony czas tematu, prosty język dla początkującego 8-latka, słownictwo
    z materiału rodzica tam, gdzie to możliwe;
  - 4–6 krótkich zdań o jednej postaci lub sytuacji;
  - formy z kilku reguł tematu (np. twierdzenie, przeczenie, pytanie);
  - pytania o treść (kto, co, kiedy), a nie o gramatykę;
  - błędne opcje wiarygodne, ale jednoznacznie sprzeczne z tekstem;
  - żadnego zdania z puli ćwiczeń.
- Walidacja katalogu (`validateSubject`): przy `lessonStory: true` wymagane jest
  niepuste `prompts.storyRules`.
- Test architektury (`architecture.test.ts`) pilnuje dalej, że kod silnika,
  `materials/lessons` i `learning/lessons` nie zawiera identyfikatora przedmiotu.

## 6. Generowanie (materials)

Właściciel: `materials/lessons`. Port LLM: nowa metoda
`generateLessonStory(input): Promise<unknown>` w `ports/ai.ts`. Adapter OpenAI
używa strict `json_schema` `lesson_story`. Fake provider zwraca deterministyczną,
poprawną historyjkę.

### 6.1. Wejście promptu (bez danych dziecka)

- tytuł tematu;
- `descriptionEn` wybranych celów;
- materiał rodzica (ten sam blok co przy puli);
- opcjonalna instrukcja rodzica;
- `storyRules` przedmiotu;
- odpowiedzi kanoniczne ćwiczeń wersji jako lista „nie używaj tych zdań”
  (≤ 120 pozycji, przycięte jak `existingAnswers`).

Nie trafiają tam imię, wiek ani identyfikatory dziecka.

### 6.2. Krok w runie lekcji

- Po zapisaniu ćwiczeń, w tym samym runie, worker woła `generateLessonStory`, gdy
  `subject.lessonStory` jest `true`. Wynik parsuje Zod, potem waliduje
  `validateLessonStory` względem kluczy zapisanej puli.
- Wynik poprawny trafia do `lesson_context.story` w transakcji finalizacji runu,
  pod blokadą wersji i z kontrolą numeru edycji, razem z `examples`.
- Błąd providera, odmowa, zły format albo odrzucenie walidacją **nie** kończą runu
  błędem. Lekcja przechodzi do `review` bez historyjki, a
  `lesson_context.storyError = "generation_failed" | "invalid"` pozwala panelowi
  pokazać „Historyjka nie powstała”. Lekcja bez historyjki jest poprawna.
- Przejściowy błąd providera nie dostaje osobnych retry. Ponowienie to przycisk
  z §6.3.
- Dogenerowanie ćwiczeń jednej reguły (`regenerateObjective`) nie zmienia
  historyjki.

### 6.3. Run samej historyjki („Wygeneruj historyjkę”)

- Nowa operacja `regenerateLessonStory({ deckId, expectedEditNumber,
  clientRequestId })` wzorem `regenerateObjective`:
  - run `kind = 'lesson'`, `runInput.story = { only: true }`;
  - ta sama deduplikacja `lesson:<clientRequestId>`;
  - te same warunki: szkic nie opublikowany, zgodny numer edycji, brak aktywnego
    runu lekcji;
  - przedmiot z flagą `lessonStory`.
- Worker w trybie `story.only`:
  - pomija batch ćwiczeń i woła tylko `generateLessonStory`;
  - przy sukcesie zastępuje `lesson_context.story` i czyści `storyError`;
  - przy błędzie zapisuje `storyError` i **zachowuje** poprzednią historyjkę;
  - stan wersji wraca do tego sprzed runu, tak jak przy dogenerowaniu.
- Procedura parent oRPC: `lessonDrafts.regenerateStory`.

### 6.4. Edycja i publikacja

- Patch `lessonDrafts.edit` dostaje pole `story: LessonStory | null`:
  - `null` usuwa historyjkę;
  - brak pola oznacza bez zmian;
  - wartość zastępuje historyjkę w całości, jak `examples`.
- Edycja waliduje `validateLessonStory` i zwraca `validation` z listą błędów.
  Kontrola nakładania się na ćwiczenia działa na kluczach puli **po** zmianach
  z tego samego patcha.
- Publikacja (`publishLessonDraft`): gdy wersja ma historyjkę, walidacja (z
  kluczami finalnej puli) jest warunkiem publikacji. Chroni to przed edycją
  ćwiczenia, której odpowiedź zrównała się ze zdaniem historyjki. Błąd ma kod
  `validation` z `details.story`. **Publikacja nie czeka na nagranie** i nie
  wymaga historyjki.
- Kopia opublikowanej wersji do nowego szkicu (`version-ops`) kopiuje cały
  `lesson_context`, więc historyjkę też.
- DTO rodzica `LessonDraftDto` dostaje:
  - `story: LessonStoryDto | null`;
  - `storyError?`;
  - `storyAudio?: { state: "pending" | "ready" | "failed" | "none"; assetId? }`
    wzorem `cardAudio`.
- Kontrakt `LessonStorySchema` (Zod) trafia do `packages/contracts/src/lessons.ts`.

## 7. Media (materials)

- Nowa tabela `lesson_story_assets` (migracja `0032`):
  - `deck_version_id` (PK, FK `deck_versions` z kaskadą), `asset_id` (FK
    `media_assets`), `expected_fingerprint`;
  - trigger niezmienności wierszy opublikowanej wersji skopiowany z
    `0028_lesson_card_assets.sql`;
  - schemat Drizzle w tym samym PR.
- Uzgadnianie: nowe `reconcileLessonStoryAssetTx` wołane z `reconcileDraftAssetsTx`
  obok kart.
  - Gdy przedmiot ma `lessonStory` i wersja ma historyjkę:
    `ttsAsset(storyReadText, subject.answerLocale, settings)` bez stylu (instrukcja
    wymowy en-GB jak `feedback_audio`) przez `findOrCreateAsset`.
  - Brak historyjki usuwa wiersz.
  - Fingerprint obejmuje tekst, głos i locale, więc zmiana zdań daje nowe
    nagranie, a zmiana pytań nie.
- Worker: oczekujące nagranie historyjki przedmiotu bez flagi `lessonStory` kończy
  się jako zastąpione. To rozszerzenie reguły w `media-generation.ts` dla wierszy
  kart.
- Rodzic: `readLessonAudioStates` dostaje stan nagrania historyjki. Nowa operacja
  `regenerateLessonStoryAudio` działa wzorem `regenerateLessonCardAudio`
  (procedura `lessonDrafts.regenerateStoryAudio`).

## 8. Sesja (learning)

Właściciel: `learning/lessons`. Granice transakcji są te same co dziś: plan
sesji przy `startSession`, wydanie zadania w `nextTask`, finalizacja próby
w transakcji próby.

### 8.1. Plan

- `createLessonTrainingSessionPlan` po pętli ocenianych slotów dokleja sloty
  historyjki, gdy jednocześnie:
  - przedmiot ma `lessonStory`;
  - `lesson_context.story` przechodzi `validateLessonStory`, z kluczami puli wersji
    jako obroną przed starymi danymi;
  - plan ma ≥ 1 oceniany slot.
- Sloty historyjki to:
  1. `lesson_story` — prezentacja;
  2. `lesson_story_question`, po jednym na pytanie, w kolejności historyjki.
- Wszystkie sloty historyjki mają `assessed: false` i nie zmieniają `taskBudget`.
- Kotwica `item_revision_id`: rewizja pierwszego ćwiczenia pierwszego celu, ta sama
  reguła co karty.
- Nagranie jest rozwiązywane przy budowie planu, tak jak karty: gotowy zasób
  o oczekiwanym fingerprincie, najnowsza generacja. Brak gotowego nagrania oznacza
  brak odczytu w tej sesji, bo plan jest zamrożony.
- Ścieżka bez planu (`issueNextLessonTask`, stare sesje) **nie** dostaje historyjki.
- Kartkówka nie dostaje historyjki.

### 8.2. Wydanie

- `nextTask` dziś kończy sesję, gdy `remaining <= 0` albo minął miękki limit
  czasu. Zmiana: zanim zwróci `null` z tych dwóch powodów, wydaje następny
  niewydany slot z `assessed: false` **po** ostatnim ocenianym slocie planu, czyli
  slot historyjki. Dopiero gdy takich slotów nie ma, zwraca `null`.
- Limit czasu nie ucina więc historyjki. Zakończenie oknem wznowienia (30 min)
  i `endSession` ją pomijają.
- Liczniki: `lessonTaskCounts.assessed` i `remainingAssessed` pomijają typy
  historyjki. Baner „Jeszcze 3” się nie zmienia: obietnica dotyczy zadań, a
  historyjka jest zamknięciem.
- Ekspozycja `lesson_story`: przy wydaniu, w tej samej transakcji i przed
  odpowiedzią, serwer pieczętuje `prompt_issued` z ekspozycjami
  `lessonTextTargetKey` każdego zdania, tak jak przykłady kart. Dzięki barierze
  z §4 te klucze nie należą do żadnego ćwiczenia.
- Ekspozycja `lesson_story_question`: `prompt_issued` bez kluczy ćwiczeń. Pytanie
  i opcje są jawne, a rozwiązanie wychodzi w feedbacku (§8.3).

### 8.3. Odpowiedź na pytanie

- Ocena deterministyczna po `optionId` z prywatnego klucza zadania
  (`answerKey.correctOption`), modalność `choice`. Do modelu oceniającego nic nie
  trafia.
- Wynik `correct` albo `incorrect`. Feedback: „Świetnie!” albo poprawna opcja
  (`correctText` = tekst poprawnej opcji). Jedna próba kończy zadanie, bez retry.
- Ujawnienie feedbacku idzie przez istniejące `discloseLessonFeedback`. Ekspozycja
  ma klucz `computeTargetKey("story:" + questionId + ":" + correctOptionText,
  promptLocale)`, w przestrzeni nazw, która nie koliduje z kluczami ćwiczeń en-GB.
- **Brak** zapisu w `assessments` i brak zmian `child_objective_progress`,
  streaków, cyklu wsparcia i licznika wywołań modelu.
- „Nie pamiętam” nie jest dostępne w pytaniu historyjki. Akcja sesji „Pomiń”
  (jeśli widoczna) daje `skip` bez kary, jak w innych zadaniach.
- Próba ma `context.storyQuestion = true` dla czytelników prób.

### 8.4. Czytelnicy zadań i prób

Typy historyjki są wykluczane albo obsługiwane jawnie (wyczerpujące `switch`):

- selektor: historia sesji, `lastSeenAt` i `exposedTargetKeys` liczą tylko
  ćwiczenia; sloty historyjki są ostatnie i nie wpływają na planowanie;
- `lesson-supervision` (werdykty rodzica): pomija;
- `parent-work-card` i raport aktywności;
- `session-activity` (ocena aktywności sesji): historyjka i pytania trafiają do
  modelu jako zwykłe zadania. To praca dziecka (bodziec, opcje, wysłana odpowiedź),
  bez kluczy i danych dziecka;
- `buildLessonSummaryObjectives`: pomija;
- `lesson-mock-tests`: pomija (nigdy nie wydaje).

### 8.5. Baza

Migracja `0032`:
- `session_tasks_completed_only_exposure` dopuszcza `lesson_story`;
- `lesson_story_question` przechodzi zwykłą ścieżką `answered`.

## 9. Kontrakt Kid API

`TaskPromptSchema` (`packages/contracts/src/kid.ts`) dostaje dwie gałęzie `.strict()`:

```ts
{ kind: "lesson_story",
  story: { sentences: string[] },        // 4–6, lang = answerLocale
  storyAudioAssetId?: Uuid }
{ kind: "lesson_story_question",
  question: string,                      // pl-PL
  options: { id: string; text: string }[], // 3
  story: { sentences: string[] },        // do ponownego przeczytania
  storyAudioAssetId?: Uuid }
```

- Brak `correctOption` i jakiegokolwiek klucza. Test kontraktu sprawdza, że gałęzie
  odrzucają nadmiarowe pola.
- `EXERCISE_TYPES` dostaje oba typy.
- Teksty UI trafiają do katalogu komunikatów (`messages.ts`).

## 10. Kid UI

Ekrany zbudowane wyłącznie ze wspólnych komponentów, bez surowych kontrolek
i literałów stylu poza tokenami.

**`LessonStoryView`** (`packages/kid-ui/src/exercises/lesson/`):
- `ExerciseFrame` z nagłówkiem „Historyjka”;
- zdania jako blok czytania (`lang="en-GB"`, `max-inline-size:
  var(--kid-reading-measure)`);
- przycisk „Posłuchaj historyjki” (`GuidanceButton`/`ListenButton` przez
  `useExerciseGuidance`, cel ≥ 48 px), gdy jest `storyAudioAssetId`;
- akcja „Dalej” wywołuje `completePresentation`.
- Autoodtwarzanie raz po pokazaniu ekranu przez istniejący kanał odtwarzania,
  wzorem odczytu zdania z #194:
  - zablokowane autoodtwarzanie i błąd pliku nie pokazują komunikatu, zostaje
    przycisk;
  - „Dalej” przerywa odczyt.

**`LessonStoryQuestionView`**:
- pytanie po polsku;
- pod nim zwarty blok zdań historyjki (do ponownego przeczytania, bo bez nagrania
  to jedyna droga powrotu);
- przycisk „Posłuchaj historyjki” bez autoodtwarzania;
- opcje w `AnswerGrid`; wybór od razu wysyła odpowiedź;
- wynik w `AnswerFeedback*` z „Dalej”;
- bez „Nie pamiętam”.

Responsywność:
- treść rośnie albo przewija się w ramie;
- akcje pozostają osiągalne w portrait, landscape telefonu (niska wysokość),
  tablecie i desktopie ze skalą > 1.

## 11. Panel rodzica

`LessonEditor` dostaje sekcję „Historyjka na koniec sesji”, widoczną dla
przedmiotu z flagą. O flagę pyta DTO szkicu przez `storyEnabled: boolean`, bo UI
nie zna przedmiotów. Sekcja zawiera:

- pola zdań (4–6, dodaj/usuń) i 1–2 pytania z trzema opcjami oraz wyborem
  poprawnej (`Radio`). Komponenty Mantine;
- komunikaty walidacji z serwera przy zapisie;
- odsłuch i „Nagraj ponownie” wzorem kart, dostępne tylko przy treści niezmienionej
  od zapisu;
- „Wygeneruj historyjkę” (albo „Wygeneruj od nowa”, z potwierdzeniem, gdy
  historyjka istnieje) oraz stan runu;
- informację, gdy historyjka nie powstała (`storyError`);
- „Usuń historyjkę”.

Tekst informacyjny: „Dziecko przeczyta i posłucha historyjki na koniec każdej
sesji, a potem odpowie na pytania. Pytania nie liczą się do postępu.”

## 12. Zmiana uzgodnionych wymagań

**2.13** (nowe brzmienie, dopisane zdanie):

> … THE flow MAY prepare one end-of-session story recording (`lesson_story_assets`)
> in the answer locale. It is presented only after all graded tasks of a training
> session, never before a grammar exercise's answer, and never blocks
> publication. Story sentences SHALL NOT repeat the answer (target key) of any
> exercise of the lesson version.

**Nowe wymaganie 12 — Historyjka na koniec sesji** w
`.kiro/specs/grammar-module/requirements.md`. Zawiera kryteria akceptacji z §1,
§4, §6 i §8:
- liczby zdań i pytań;
- pytania PL;
- poza budżetem i postępem;
- bez kartkówki;
- bariera ekspozycji;
- publikacja nie czeka na nagranie;
- run samej historyjki.

**5.4:** dopowiedzenie, że historyjka i jej pytania nie należą do budżetu 12
ocenianych zadań.

`docs/SPEC.md` §22: zdanie o historyjce. `docs/architecture.md` §19: nowa opcja
`SubjectModule.lessonStory`, tabela `lesson_story_assets`, typy zadań historyjki.

## 13. Prywatność i bezpieczeństwo

- Do LLM trafia materiał rodzica, opisy reguł, reguły przedmiotu i odpowiedzi
  ćwiczeń. Do TTS trafiają wyłącznie zatwierdzone zdania. Bez danych dziecka.
- Kid DTO nie zawiera klucza odpowiedzi pytań. Próba przechowuje tylko id opcji.
- Usunięcie profilu usuwa zadania, próby i zdarzenia dziecka (kaskady jak dziś).
  Nagranie historyjki jest wspólnym materiałem.

## 14. API → MCP → `SKILL.md`

- Zmiany API dotyczą Kid API (nowe gałęzie promptu) i parent oRPC (patch, DTO
  szkicu, dwie procedury).
- MCP udostępnia wyłącznie raport `learning-overview`, który świadomie nie obejmuje
  lekcji (`SKILL.md`: „grammar lessons are not covered”). Zmiana nie wymaga więc
  zmian adaptera MCP, schematu ani skilla.
- Implementacja potwierdza to wyszukaniem użyć nowych typów i DTO w
  `apps/web/src/integrations` i `integrations/umiem-mcp`, a PR to opisuje.

## 15. Testy

**Unit (domena i kontrakty):**
- `validateLessonStory`: granice liczb i długości, duplikaty opcji i id, zły
  `correctOption`, białe znaki, nakładanie na klucz ćwiczenia (także po
  normalizacji ekspozycji przedmiotu);
- `storyReadText`;
- walidacja katalogu (flaga bez `storyRules`);
- `TaskPromptSchema`: gałęzie strict;
- `LessonStorySchema`;
- test architektury bez wyjątków.

**Unit (Kid UI):**
- widoki: rendering, `lang`, brak przycisku bez nagrania;
- wybór wysyła odpowiedź;
- brak „Nie pamiętam”;
- kontroler: autoodtwarzanie raz, „Dalej” przerywa.

**Integracja (PostgreSQL):**
- run lekcji z fake providerem zapisuje historyjkę;
- błąd lub odrzucenie historyjki daje `review` + `storyError`, a lekcja jest
  poprawna;
- run `story.only`: sukces, błąd zachowujący starą historyjkę, konflikt numeru
  edycji, opublikowana wersja → `immutable`, idempotencja `clientRequestId`;
- edycja: walidacja, `null` usuwa, nakładanie na ćwiczenie z tego samego patcha;
- publikacja odrzuca nakładanie i nie czeka na nagranie;
- uzgadnianie: wiersz `lesson_story_assets`, zmiana zdań daje nowe nagranie,
  zmiana pytań nie, usunięcie kasuje wiersz, trigger niezmienności;
- sesja:
  - plan kończy się slotami historyjki;
  - budżet i `remainingAssessed` bez zmian;
  - historyjka wychodzi po wyczerpaniu budżetu i po limicie czasu;
  - brak historyjki w kartkówce i bez flagi;
  - zapieczętowane ekspozycje zdań;
  - pytanie: poprawna, błędna, idempotentny ponowny odczyt, brak `assessments`
    i zmian postępu, „Pomiń”;
  - nowy wiersz w koszu `INTEGRATION_BUCKETS`;
- migracja `0032`.

**E2E (Playwright):**
- `mocked`, `lesson-story.spec.ts`:
  - historyjka po ostatnim zadaniu, autoodtwarzanie i powtórka;
  - pytanie: dobra i zła odpowiedź z poprawną opcją;
  - brak przycisku bez nagrania;
  - geometria w portrait, landscape telefonu, tablecie i desktopie ze skalą > 1:
    brak przepełnienia poziomego, cele ≥ 48 px, akcje osiągalne, blok zdań w ramie
    albo przewijalny;
  - wpis do partycji `mocked` w `spec-projects.ts`;
- `real`, rozszerzenie `lesson-real-flow.spec.ts` albo nowy spec w najlżejszym
  koszu:
  - rodzic edytuje historyjkę;
  - publikacja;
  - dziecko kończy sesję historyjką i odpowiada na pytanie;
- panel rodzica: test komponentu sekcji (walidacja, generowanie, usuwanie) oraz
  przypadek w istniejącym specu edytora.

**Niezweryfikowane symulacją:** autoodtwarzanie na fizycznym iPhonie/iPadzie
(polityka autoplay Safari). Trafia do raportu jako brak dowodu.

## 16. Dokumentacja

- `.kiro/specs/grammar-module/requirements.md`: 2.13, 5.4, nowe wymaganie 12.
- `docs/SPEC.md` §22.
- `docs/architecture.md` §19.
- Krótka nota w specu stylu TTS: nagranie historyjki bez stylu, en-GB.
- `AGENTS.md` bez zmian, chyba że implementacja wprowadzi nową regułę pracy.
