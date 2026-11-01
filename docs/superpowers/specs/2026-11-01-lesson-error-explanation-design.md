# Wyjaśnienie błędu dla dziecka w lekcjach — design

Data: 2026-11-01. Status: do recenzji właściciela.
Issue: #196. Powiązane: `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md`
(odczyt zdania, #194), `docs/superpowers/specs/2026-10-30-tts-voice-style-design.md` (styl TTS),
`.kiro/specs/grammar-module/requirements.md`, `docs/architecture.md` §19, `docs/SPEC.md` §22.

## 1. Cel

Po błędnej odpowiedzi w lekcji angielskiego dziecko widzi **jedno krótkie polskie zdanie**
wyjaśniające regułę, np. „Przy *he* dodajemy *-s*: he plays.”, i może je odsłuchać.
Dziś po błędnym wyborze, złej kolejności albo „Nie pamiętam” widzi tylko „Poprawna odpowiedź: …”,
a podpowiedź kategorii błędu dostaje wyłącznie po werdykcie modelu oceniającego.

Ustalenia z właścicielem (2026-11-01):

- **jedno wyjaśnienie na ćwiczenie** (`explanationPl`), generowane razem z materiałem,
  widoczne i edytowalne przez rodzica — zatwierdzane jak reszta materiału;
- pokazywane **po błędnej odpowiedzi i po „Nie pamiętam”**; nie po „prawie”, „Pomiń”,
  nieocenionej odpowiedzi ani w kartkówce;
- przedmioty **`english_grammar` i `english_chapter`** (flaga przedmiotu); szkoła bez zmian;
- **nagranie pl-PL w tym PR**: przycisk „Posłuchaj wyjaśnienia”, odtwarzanie ręczne
  (bez autoodtwarzania), nie blokuje publikacji; rodzic może odsłuchać i nagrać ponownie;
- podejście **A′**: rodzaj feedbacku się nie zmienia — `incorrect` dostaje opcjonalne `hintPl`,
  a `lesson_hint` (werdykt modelu) bierze wyjaśnienie ćwiczenia zamiast szablonu kategorii.
- już opublikowane lekcje: bez wstecznego generowania; rodzic dopisuje wyjaśnienia
  w nowej wersji albo regeneruje cel.

Wyjaśnienie wybiera **deterministyczna reguła serwera** — w sesji nie działa żaden model.

## 2. Zakres

W zakresie: pole materiału, generator, walidacja, edytor rodzica, klucz zadania, reguła
feedbacku, kontrakt Kid DTO, nowa rola nagrania `explanation_audio`, Kid UI, testy, dokumentacja.

Poza zakresem:

- przedmioty szkolne — `commonErrors` szkoły to prywatne kryteria oceny (lista błędnych
  twierdzeń dla modelu oceniającego), nie tekst dla dziecka; ich treści nie używamy, przejmujemy
  tylko wzorzec „treść błędu powstaje z materiałem i zatwierdza ją rodzic”;
- komentarze modelu oceniającego (`lesson_verdicts.comment`) — nadal wyłącznie dla rodzica;
- wiele wyjaśnień na ćwiczenie (per dystraktor / per kategoria błędu);
- omówienie kartkówki, autoodtwarzanie wyjaśnienia, słówka (zadania spoza lekcji).

## 3. Model danych i generowanie

### 3.1 Pole

- `explanationPl?: string` w `LessonExerciseInputSchema` (`packages/contracts/src/lessons.ts`),
  w drafcie domeny (`LessonExerciseDraft`), w payloadzie rewizji i DTO szkicu.
- Jedno zdanie po polsku: po przycięciu niepuste, bez znaku nowej linii, **≤ 120 znaków**
  (wspólny limit pól tekstowych w `pool-validation.ts`). Może cytować angielskie formy
  (`he plays`, `-s`).
- Niedozwolone dla `lesson_card` (karta nie ma odpowiedzi) i gdy przedmiot ma wyłączoną flagę —
  walidacja puli odrzuca, jak `voiceTone`; zapis szkicu zdejmuje pole po cichu
  (`withoutExplanationUnlessAllowed`, wzorem `withoutVoiceToneUnlessAllowed`).
- **Nie wpływa na tożsamość** ćwiczenia (`exercise-identity.ts`), `target_key` ani kryteria celu:
  edycja wyjaśnienia tworzy nową rewizję treści (jak edycja `hint`), ale nie nową wersję
  umiejętności (`objectiveImpacted` go pomija). Nie jest polem v3.

### 3.2 Flaga przedmiotu

`SubjectModule.exerciseExplanations: boolean` — `english_grammar: true`, `english_chapter: true`,
`school: false`, testowy przedmiot w testach architektury: `false`.

### 3.3 Generator

- `LessonPoolInput.exerciseExplanations` (wzorem `voiceTones`) włącza regułę promptu i pole
  w schemacie structured output (`lesson-pool-schema.ts`, opakowanie `withExplanation`, także
  w gałęziach dedykowanych typów).
- Reguła promptu (`llm.ts`): dla każdego ćwiczenia z odpowiedzią jedno zdanie po polsku do
  dziecka w wieku ok. 8 lat, wyjaśniające **regułę stojącą za poprawną odpowiedzią** w kontekście
  najczęstszego błędu; bez pochwał i oceniania dziecka, bez imion, zgodne z odpowiedzią
  kanoniczną, ≤ 120 znaków.
- Pole jest opcjonalne w walidacji: brak wyjaśnienia nie odrzuca puli (zachowanie jak dziś).
- Fake provider generuje przewidywalne wyjaśnienia dla testów.
- Regeneracja celu (`regenerateObjective`) używa tego samego wejścia.

### 3.4 Panel rodzica

- Pole tekstowe „Wyjaśnienie dla dziecka (po błędzie)” w karcie ćwiczenia edytora
  (`LessonExerciseCard`), poza blokiem pól v3, z limitem 120 znaków; puste pole = brak wyjaśnienia.
- Pod polem kontrolki nagrania (§5.3).
- Stan edytora (`lesson-editor-state.ts`) śledzi pole; zmiana oznacza ćwiczenie jako zmienione.

## 4. Reguła feedbacku (sesja)

Właściciel reguł: `learning/lessons` (materializacja i próby); media: `materials`.
Granica transakcji: istniejąca transakcja finalizacji próby.

### 4.1 Klucz zadania

Materializacja w **treningu** (nie kartkówka), gdy przedmiot ma flagę i payload niesie
wyjaśnienie, zapisuje w prywatnym kluczu zadania (`LessonTaskAnswerKey`):

- `explanationPl` — tekst;
- `explanationAudioAssetId` — gotowe nagranie o oczekiwanym fingerprincie, jeśli było gotowe
  w chwili wydania (rozwiązywane jak `feedback_audio` w `loadExercises`).

Prompt zadania i Kid DTO zadania ich nie niosą. Klucz jest niezmienny: zadanie wydane przed
edycją albo przed gotowym nagraniem zostaje przy swoim stanie.

### 4.2 Kiedy feedback dostaje wyjaśnienie

Czysta funkcja `withExerciseExplanation(feedback, key, outcome, taskEnds)` w
`lesson-attempts.ts` (obok `withFeedbackSentenceAudio`), wołana w obu ścieżkach finalizacji —
ocena deterministyczna i po werdykcie modelu — **przed** dołączeniem nagrania zdania.
Wyjaśnienie trafia do feedbacku, gdy jednocześnie:

1. feedback nie jest `null` (nie kartkówka, nie „Pomiń”);
2. ocena próby to `incorrect` (błędny wybór/kolejność/zaznaczenie/przypisanie, „Nie pamiętam”,
   werdykt `model_incorrect`);
3. rodzaj feedbacku to `incorrect` albo `lesson_hint`;
4. `revealsAnswer(feedback)` — feedback ujawnia rozwiązanie (wyklucza `not_assessed`
   i podpowiedź bez `correctText`);
5. odpowiedź **kończy zadanie** (następny stan nie jest `issued`) — `model_other`, które zostawia
   zadanie otwarte do ponowienia, nie dostaje wyjaśnienia, aby nie podpowiadać przed drugim
   podejściem;
6. klucz ma `explanationPl`.

Skutek:

| Sytuacja | Feedback |
| --- | --- |
| błędny wybór / kolejność / zaznaczenie / przypisanie, „Nie pamiętam” | `incorrect` + `correctText` + **`hintPl` = wyjaśnienie** |
| `model_incorrect` | `lesson_hint`; `hintPl` = wyjaśnienie ćwiczenia, a bez niego — jak dziś szablon kategorii |
| „prawie” (`minor_typo`, `model_almost`), `model_other`, `not_assessed`, „Pomiń”, trener precyzji, kartkówka | bez zmian |
| ćwiczenie bez wyjaśnienia (stare lekcje, szkoła) | bez zmian |

Wyjaśnienie ćwiczenia ma pierwszeństwo przed szablonem kategorii, bo zatwierdził je rodzic
dla konkretnego zdania. `answerSegments` i `correctText` się nie zmieniają.

### 4.3 Nagranie w feedbacku

Gdy feedback dostał wyjaśnienie ćwiczenia (nie szablon kategorii) i klucz ma
`explanationAudioAssetId`, feedback niesie `explanationAudioAssetId`.

### 4.4 Ekspozycja i samodzielność

- Wyjaśnienie jest częścią feedbacku, który już ujawnia rozwiązanie (warunek 4), więc obejmuje
  je ta sama ekspozycja `targetKey` zapisywana w `discloseLessonFeedback` przed odpowiedzią HTTP.
- **Pieczęć nagrania:** `audio_issued` jest zapisywane **raz** na próbę, gdy feedback niesie
  którekolwiek nagranie po odpowiedzi (`correctAudioAssetId` albo `explanationAudioAssetId`),
  z tym samym `occurredAt = max(now, receivedAt + 1 ms)` co dziś. Uogólnia to warunek
  `sealFeedbackSentenceAudio`; dwa nagrania nie dają dwóch zdarzeń.
- Kwalifikacja próby się nie zmienia: zdarzenia po `receivedAt` nie liczą się do wsparcia,
  a zadanie lekcji kończy się na tej odpowiedzi (warunek 5).
- Feedback zapisuje się w `attempts.feedback`, więc ponowny odczyt próby zwraca to samo.

### 4.5 Kontrakt Kid DTO

`FeedbackDtoSchema` (`packages/contracts/src/kid.ts`):

- `hintPl` dozwolone także przy `incorrect` (opcjonalne); przy `lesson_hint`
  i `lesson_precision_hint` nadal wymagane, przy pozostałych rodzajach nadal zabronione;
- nowe `explanationAudioAssetId?: string` — dozwolone tylko razem z `hintPl` i tylko przy
  `incorrect` albo `lesson_hint`; reguła „`not_assessed` nie niesie audio” obejmuje też to pole.

Zmiana jest addytywna: stary klient Kid UI ignoruje nowe pole i nie pokazuje `hintPl` przy
`incorrect` (dziecko widzi feedback jak dziś). DTO nie niesie kryteriów, kategorii błędu ani komentarza modelu.

## 5. Nagranie wyjaśnienia

### 5.1 Rola i uzgadnianie

- Nowa rola zasobu rewizji **`explanation_audio`**: migracja `0032_explanation_audio_role.sql`
  rozszerza `revision_assets_role_allowed` (wzorem `0029`), schemat Drizzle, typ `AssetRole`
  i `docs/schema.sql` (który przy okazji uzupełnia brakujące `prompt_audio` i `feedback_audio`).
- `requiredAssetsForLessonExercise` przy fladze `exerciseExplanations` i niepustym
  `explanationPl` dodaje `ttsAsset("explanation_audio", explanationPl, "pl-PL", settings,
  "lesson_explanation")`.
- Nowy styl roli **`lesson_explanation`** (`TtsRoleStyle`, zdanie w `STYLE_SENTENCES_PL`):
  „Wyjaśnij spokojnie i życzliwie, jak cierpliwy nauczyciel, wyraźnie.” Ton lektora ćwiczenia
  (`voiceTone`) nie dotyczy wyjaśnienia — po błędzie zawsze spokojnie.
- Fingerprint obejmuje tekst i styl: edycja wyjaśnienia daje nowe nagranie, niezmienione
  zachowują swoje.
- Publikacja **nie czeka** na nagranie (jak `prompt_audio` i `feedback_audio`); nieudane
  nagranie nie jest utrzymywane przy `keepFailed`.
- Worker: oczekujące `explanation_audio` przedmiotu z wyłączoną flagą kończy się jako zastąpione
  (`supersedeDisabledLessonTts`).
- Lista zasobów szkicu w DTO rodzica pomija rolę (jak `prompt_audio`); stan nagrania rodzic
  dostaje osobno (§5.3).

### 5.2 Wydanie zadania

`loadExercises` (`lesson-sessions.ts`) rozwiązuje `explanation_audio` jak `feedback_audio`:
dowolny gotowy zasób TTS o oczekiwanym fingerprincie, najnowsza generacja. Kartkówka go nie
ładuje.

### 5.3 Rodzic: odsłuch i ponowne nagranie

- DTO ćwiczenia szkicu dostaje `explanationAudio` (ten sam kształt co `promptAudio`: stan
  i identyfikator gotowego nagrania).
- `regenerateLessonPromptAudio` uogólnia się na rolę (`prompt_audio` | `explanation_audio`) —
  jeden przypadek użycia, nowe pole wejścia `role` z wartością domyślną `prompt_audio`
  (zgodność dotychczasowych wywołań). Procedura oRPC rodzica i kontrolki
  (`PromptAudioControls`) obsługują obie role.
- Odsłuch w panelu rodzica używa istniejącego endpointu mediów.

## 6. Kid UI

- **Tekst:** dla `incorrect` z `hintPl` pod wierszem „Poprawna odpowiedź: …” pojawia się
  wyjaśnienie (blok `AnswerFeedback`, kolor i waga tekstu pomocniczego z tokenów M3, bez kursywy).
  `lesson_hint` pokazuje `hintPl` jak dziś.
- **Odsłuch:** gdy feedback niesie `explanationAudioAssetId`, dok feedbacku pokazuje
  `ListenButton` „Posłuchaj wyjaśnienia” (cel ≥ 48 px, tekst w katalogu komunikatów).
  Odtwarzanie tylko po kliknięciu: kontroler `playExplanationAudio()` przez `#beginPlayback`
  i `mediaUrl`; przerywa odczyt zdania i odwrotnie; „Dalej” przerywa. Błąd pliku jest cichy.
- **Odczyt zdania** (#194) zostaje automatyczny; wyjaśnienie go nie zastępuje.
- **„Nie pamiętam”:** gdy feedback niesie wyjaśnienie (`hintPl`), ekran zostaje na wyniku do
  „Dalej” — rozszerzenie istniejącego wyjątku dla nagrania zdania w `#showResult`.
- **Bez zmian:** rodzaj feedbacku, ton doku (`incorrect` → „incorrect”), oznaczenie opcji
  (`option-outcome.ts`), postęp sesji.
- **Responsywność:** dok z dwoma przyciskami odsłuchu i najdłuższym wyjaśnieniem (120 znaków)
  mieści się w portrait, landscape telefonu, tablecie i desktopie; tekst zawija się, a akcje
  pozostają osiągalne (testy geometrii).

## 7. Prywatność

Do TTS trafia wyłącznie zatwierdzony tekst materiału. Wyjaśnienie nie zależy od odpowiedzi
dziecka, nie jest generowane w sesji i nie zawiera danych dziecka. Nagranie jest wspólnym
materiałem; usunięcie profilu go nie usuwa. Komentarz modelu oceniającego pozostaje tylko
dla rodzica.

## 8. Testy

- **Domena / unit:**
  - `withExerciseExplanation` — każdy wiersz tabeli §4.2 (w tym `model_other` z otwartym zadaniem,
    `lesson_almost`, `not_assessed`, trener precyzji, brak wyjaśnienia, pierwszeństwo przed
    szablonem kategorii, nagranie tylko przy wyjaśnieniu ćwiczenia);
  - kontrakt: `hintPl` przy `incorrect`, odrzucenie `explanationAudioAssetId` bez `hintPl`,
    przy `not_assessed` i innych rodzajach;
  - walidacja puli: limit 120, nowa linia, `lesson_card`, wyłączona flaga; tożsamość ćwiczenia
    nie zależy od wyjaśnienia;
  - schemat i prompt generatora przy fladze i bez niej; fake provider;
  - uzgadnianie mediów: rola, locale, styl, fingerprint zależny od tekstu, szkoła bez nagrania,
    publikacja nie czeka;
  - `objectiveImpacted` ignoruje wyjaśnienie; stan edytora rodzica; kontrolki nagrania;
  - kontroler Kid UI: odsłuch ręczny, przerywanie, „Nie pamiętam” zostaje na wyniku;
    `ExerciseFeedbackDock` z dwoma przyciskami.
- **Integracja (PostgreSQL):**
  - wyjaśnienie i nagranie w feedbacku błędnego wyboru, „Nie pamiętam” i `model_incorrect`;
  - brak dla dobrej odpowiedzi, „prawie”, `model_other`, `not_assessed`, „Pomiń”, kartkówki;
  - jedna pieczęć `audio_issued` przy dwóch nagraniach; próba samodzielna; ponowny odczyt próby;
  - edycja wyjaśnienia: nowa rewizja bez nowej wersji umiejętności, nowe nagranie przy publikacji;
  - ponowne nagranie przez rodzica; migracja `0032` przyjmuje rolę; szkoła bez wyjaśnień.
- **E2E (Playwright):** `mocked` — wyjaśnienie po błędnym wyborze i po „Nie pamiętam”,
  „Posłuchaj wyjaśnienia” odtwarza tylko po kliknięciu, brak przycisku bez nagrania, geometria
  doku (telefon portrait/landscape, tablet, desktop); edytor rodzica — pole i kontrolki nagrania.
  Nowe specy trafiają do partycji w `tests/e2e/spec-projects.ts`, nowe pliki integracyjne do
  najlżejszego kosza `tests/integration-buckets.ts`.
- **Niezweryfikowane symulacją:** jakość polskiej wymowy z wtrąceniami angielskimi na
  prawdziwym providerze TTS i odbiór na fizycznym urządzeniu — do raportu jako brak dowodu.

## 9. Dokumentacja i integracje

- `docs/architecture.md` §19 (feedback lekcji, rola `explanation_audio`) i §22 (media);
  `docs/SPEC.md` §22/§37 (feedback po błędzie w lekcji); `.kiro/specs/grammar-module/requirements.md`
  (nowe wymaganie o wyjaśnieniu); `docs/schema.sql`; krótka nota w specu odczytu zdania (§11,
  punkt 5 zrealizowany) i w specu stylu TTS (nowa rola stylu).
- **API → MCP → `SKILL.md`:** brak zmian. MCP nie udostępnia feedbacku zadań dziecka ani
  materiału lekcji, a raport `learning-overview` świadomie nie obejmuje lekcji. Implementacja
  potwierdza to wyszukaniem użyć `FeedbackDto` i `LessonExerciseInput` w `apps/web/src/integrations`
  oraz `integrations/umiem-mcp`, a PR opisuje uzasadnienie.
