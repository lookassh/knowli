# „Posłuchaj zdania” — dalsze prace, etap 1 (issue #199) — design

Data: 2026-11-01. Status: po przeglądzie trzech krytyków, do recenzji właściciela.
Powiązane:
- issue #199, PR #194;
- `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md` (dalej „design #194”);
- `docs/superpowers/specs/2026-10-30-english-chapter-design.md` §5.

## 1. Cel

Domknąć po #194 to, co poprawia odczyt pełnego zdania bez nowego przepływu nauki:

- dziecko **widzi**, że słyszy zdanie (wskaźnik odtwarzania na „Posłuchaj zdania”);
- może posłuchać **wolniej** tego samego nagrania;
- **nieudany ręczny odsłuch** daje delikatny sygnał zamiast ciszy;
- porządki techniczne i brakujące testy z przeglądów #194, w tym automatyczne sprawdzenie
  ścieżki „stara lekcja → nowa wersja → odczyt w sesji”.

Ustalenia z właścicielem (2026-11-01):

- zakres: etap 1 bez „Powtórz za lektorem”;
- „wolniej” to **osobny przycisk z ikoną żółwia** obok „Posłuchaj zdania”;
- nieudany ręczny odsłuch: **krótkie poruszenie przycisku i tekst** w doku. Nieudany
  autoodczyt zostaje cichy, jak w #194;
- iPhone/iPad nie są teraz wspierane, więc kod nie obchodzi polityki autoplay Safari.

## 2. Zakres i stan punktów issue

| Punkt #199 | Decyzja w tym etapie |
| --- | --- |
| Autoodtwarzanie na fizycznym iPhonie/iPadzie | Poza zakresem: decyzja właściciela, iOS nie jest teraz wspierany. Punkt zostaje otwarty w issue. |
| Stare lekcje: „Nowa wersja → Opublikuj” zleca nagrania i po wygenerowaniu odczyt działa w sesji | **W zakresie jako test**. Istniejący test integracyjny sprawdza tylko zlecenie nagrań. Rozszerzamy go o worker, sesję i odpowiedź (§6.4). Odbiór na produkcji robi właściciel. |
| Wskaźnik odtwarzania na „Posłuchaj zdania” | **W zakresie** (§4.2). |
| Wolniejsze odtwarzanie | **W zakresie** (§4.3, §5). |
| „Powtórz za lektorem” | Poza zakresem: osobne issue i etap. Układ przycisków zdania (§4.3) przyjmie później trzeci przycisk. |
| Odczyt w „Angielski — rozdział” | **Już zrobione** w #204 (`english_chapter.ttsForFeedbackSentence = true`). Do odhaczenia. |
| Odczyt w omówieniu kartkówki, odsłuch w podglądzie rodzica | Poza zakresem: osobne issue. |
| Warunek „odpowiedź kończy zadanie” w `withFeedbackSentenceAudio` | **W zakresie** (§6.1). |
| Pominięcie `feedback_audio` przy kartkówce | **Zachowanie już poprawne** od #194, ale bez testu pilnującego zapytania. Dodajemy test (§6.2). |
| Testy: pusta odpowiedź i puste klocki, fixture `approved`, dokładna liczba runów | **W zakresie** (§6.3). |
| Sygnał nieudanego ręcznego odsłuchu | **W zakresie** (§4.4). |

Szczegóły do punktu o kartkówce: `createLessonMockTestPlan` woła
`loadExercises(..., { feedbackAudio: false })`. Zadania kartkówki wydaje
`issueLessonMockTestTask`, a nie `lesson-sessions.ts`.

PR odwołuje się do #199 (`Refs`) i nie zamyka go. Po scaleniu właściciel odhacza punkty.
Agent nie edytuje issue bez polecenia.

## 3. Moduły i granice

- **Kid UI (`packages/kid-ui`):** kontroler sesji, dok feedbacku, `ListenButton`, nowa ikona,
  token Motion i odtwarzacz przeglądarkowy (adapter `AudioPlayer`). Tu leży większość zmian.
- **Kontrakty (`packages/contracts`):** wyłącznie katalog komunikatów (`messages.kid`). DTO
  i schematy API się nie zmieniają.
- **Serwer (`packages/server`):**
  - `learning/lessons`: refaktoryzacja bez zmiany zachowania (§6.1);
  - `domain/lessons`: zaostrzenie `feedbackSentenceText` dla pustych klocków (§6.3);
  - testy.

  Granica transakcji się nie zmienia; jest nią istniejąca finalizacja próby.
- **Bez zmian:** baza, migracje, worker, MCP, `SKILL.md`.

## 4. Kid UI

### 4.1 Stan odczytu w kontrolerze

Autoodczyt startuje bez kliknięcia, więc stanu odtwarzania nie można trzymać lokalnie w
przycisku, jak w `QuestionAudioButton`. Kontroler sesji przechowuje go w feedbacku ekranu
nauki:

- `sentencePlaying: "normal" | "slow" | null` — tempo, które **faktycznie gra**.
- `sentenceAudioError: { rate: "normal" | "slow"; seq: number } | null` — ostatni **ręczny**
  odsłuch, który się nie udał.
  - `rate` wskazuje przycisk do poruszenia.
  - `seq` rośnie przy każdym błędzie. Jest kluczem animacji, więc drugi taki sam błąd też
    porusza przyciskiem, nawet gdy React scali stany.

Reguły:

1. **Przebieg.** Każdy start odczytu dostaje numer z prywatnego licznika `#sentenceRun`,
   niezależnego od `#playbackGeneration`. Kontroler zapamiętuje też `attemptId` feedbacku.
2. **Start wskaźnika.** `sentencePlaying` ustawia callback `onStarted` odtwarzacza
   (zdarzenie `playing`), a nie kliknięcie. Zablokowany autoodczyt nie miga więc wskaźnikiem.
   Callback ustawia stan tylko wtedy, gdy:
   - jego przebieg jest nadal ostatni i jeszcze się nie zakończył;
   - ekran pokazuje feedback o tym samym `attemptId`.
3. **Gaszenie.**
   - Synchronicznie w `#stopPlayback`: każde inne odtwarzanie (komunikat „?”, odsłuch pytania),
     „Dalej”, nowe zadanie, pauza aktywności i offline gaszą wskaźnik od razu, bez czekania
     na rozstrzygnięcie `play()`.
   - Po zakończeniu przebiegu (koniec, błąd): gaszenie tylko przy warunkach z pkt 2. Spóźnione
     zakończenie nie gasi więc nowego odczytu ani nie dotyka następnego zadania.
4. **Zapis stanu.** Każdy zapis `sentencePlaying` i `sentenceAudioError` robi spread z
   **bieżącego** `this.#learning().feedback` w chwili zapisu. Nie używa obiektu złapanego na
   początku metody, bo między `await` mógł się zmienić.
5. **Błąd.**
   - Ręczny odsłuch (zdanie albo wolniej) przy błędzie `play()` ustawia `sentenceAudioError`.
   - Autoodczyt nigdy nie ustawia błędu.
   - Błąd znika dopiero przy udanym starcie odsłuchu zdania (`onStarted`) albo z feedbackiem
     („Dalej”). Nowa próba go nie ukrywa, żeby dok nie skakał przy każdym dotknięciu.
   - Komunikat „?” nie zmienia błędu.
   - Błąd sieci (`TypeError` z pobierania) traktujemy jak każdy inny błąd odsłuchu: tekst
     w doku, bez przejścia w tryb offline. Utratę połączenia wykrywa kontroler swoimi
     ścieżkami, jak przy `playCorrectOptionAudio`.
6. **API kontrolera.** `playSentenceAudio(rate: "normal" | "slow" = "normal")`. Autoodczyt
   i „Posłuchaj zdania” grają w tempie `"normal"`, a żółw w `"slow"`. Warunki wejścia się nie
   zmieniają: `offline`, `busy`, `recordingPhase`, lekcja z nagraniem.
   `#playCountedAudio(url, assetId, options?)` dostaje opcjonalne `onStarted` i `rate`. Callback
   aktywności i callback wskaźnika wołane są w tym samym `onStarted` odtwarzacza.

### 4.2 Wskaźnik odtwarzania

- Przyciski zdania pokazują `SoundRing` i `data-sound-active`, jak pozostałe odsłuchy.
- Pierścień ma tylko przycisk tempa, które gra.
- Przy `prefers-reduced-motion` `SoundRing` ma już statyczny wariant.

### 4.3 Przycisk „Posłuchaj wolniej” i układ grupy

- **`ListenButton` rozszerzony zamiast nowego przycisku.** Jest jedynym przyciskiem odsłuchu
  w Kid UI.
  - Opcjonalny `icon?: "volume" | "turtle"`, domyślnie `volume`.
  - Opcjonalny `failKey?: number`: zmiana wartości porusza raz **ikoną**, nie przyciskiem.
    Ikona siedzi w `m.span`, bo `ActionButton` sam steruje transformacją przycisku.
  - Test komponentu obejmuje oba propsy.
- **Ikona `turtle`** w `KidIcon`: liniowa, w stylu pozostałych, bez literałów koloru.
  Czytelność sprawdzamy na zrzucie w rozmiarze ikony przycisku 48 px.
- **Przycisk żółwia:**
  - `ListenButton icon="turtle"`, `data-testid="kid-sentence-audio-slow"`;
  - `aria-label` i `title` z katalogu: „Posłuchaj wolniej” (`messages.kid.listenSlower`);
  - pojawia się zawsze razem z „Posłuchaj zdania” i tylko wtedy;
  - wolny odsłuch jest tylko ręczny, autoodczyt gra w normalnym tempie.
- **Wyłączenie.** Oba przyciski zdania są `disabled`, gdy kontroler i tak zignorowałby
  dotknięcie (`busy`, `offline` albo nagrywanie: `recordingPhase !== "idle"`), jak
  `QuestionAudioButton`.
- **Grupa `kid-sentence-audio-group`.** Kontener w górnym wierszu doku, w którym stoją przyciski
  zdania. Układ zależy od **szerokości doku**: container query na doku
  (`container-type: inline-size`), nie media query okna, bo od 600 px dok ma najwyżej 560 px.
  - Dok ≥ 480 px: grupa w wierszu. Kolejność: odznaka, treść, [zdanie][wolniej], „?”.
  - Dok < 480 px: przyciski zdania w kolumnie, zdanie nad żółwiem, z odstępem 8 px. Kolumna ma
    104 px wysokości. Dok rośnie o różnicę między nią a wysokością treści, zwykle o zero, bo
    karta wyniku lekcji jest wyższa. „?” wyrównany do górnego przycisku.
  - Reguły układu nie trafiają pod klasę `.compact`. Ta klasa oznacza dok wyboru obrazków,
    który nie ma przycisków zdania.
- **Wymagania.** Cele dotykowe ≥ 48 px, bez przepełnienia poziomego, `SoundRing` w granicach
  doku. „Dalej” pozostaje osiągalne, a nad panelem zostaje zapas materiału jak w istniejących
  testach.

### 4.4 Sygnał nieudanego ręcznego odsłuchu

Gdy `sentenceAudioError` nie jest `null`:

- **Poruszenie.** Ikona przycisku, który zawiódł (`rate`), porusza się raz (`failKey = seq`).
  - Token `kidListenFailWobble` (`rotate`, tylko transform) w `kid-motion.ts` używa klatek
    istniejącego `kidWrongIconAnimate`: to samo „nie”, bez nowej krzywej.
  - `MotionConfig reducedMotion="user"` wyłącza ruch.
  - `kidOutcomeShake` zostaje dla pigułek pisowni.
  - Przycisk dostaje `data-audio-failed={seq}`, żeby test ruchu mógł go znaleźć.
- **Tekst.** Stały region `aria-live="polite"` (`data-testid="kid-sentence-audio-error"`), na
  całą szerokość i wyśrodkowany. W DOM stoi za górnym wierszem (`.scroll`) i przed akcjami,
  więc czytnik ekranu czyta najpierw wynik, potem komunikat (uzupełnienie 2026-11-01, #199).
  Region jest zawsze w DOM, gdy dok ma przyciski zdania, a przy błędzie dostaje treść.
  - **Położenie wizualne** (CSS `order`) zależy od tego, w którą stronę rośnie dok — tekst nie
    może przesunąć przycisków zdania pod palcem dziecka; drugie dotknięcie w to samo miejsce
    trafia w przycisk, nie w tekst.
  - Dok w nakładce przy dolnej krawędzi ramy rośnie w górę: region stoi nad górnym wierszem
    (`order: -1`), więc przyciski zdania i „Dalej” zostają na miejscu.
  - Zwarta rama dużego okna (stopka tuż pod odpowiedziami, wolne miejsce niżej) i przewijana
    strona (powiększenie gestem, bardzo niskie okno) rosną w dół: region zostaje pod górnym
    wierszem, przyciski zdania stoją, w dół przesuwa się tylko „Dalej”.
  - Zwarta rama z przewijanym materiałem (treść wyższa od okna, np. dotykowy tablet z długim
    tekstem) nie ma wolnego miejsca pod stopką, więc dok rośnie w górę: `ExerciseFrame` oznacza
    nakładkę `data-material-full`, a region wraca nad wiersz (uzupełnienie 2026-11-01, #199).
    Gdy dopiero sam tekst błędu zapełnia ramę, wiersz może przesunąć się o mniej niż wysokość
    tekstu (o wolne miejsce, które było pod stopką).
  - Tekst stoi w elemencie kluczowanym `seq`: każdy błąd montuje go od nowa, więc czytnik
    ogłasza także powtórzony, identyczny komunikat.
  - Treść z katalogu (`messages.kid.sentenceAudioFailed`): „Nagranie się nie włączyło. Dotknij
    jeszcze raz.” Celowo nie „Spróbuj jeszcze raz”, bo w doku złej odpowiedzi to brzmi jak
    polecenie ponownej odpowiedzi.
  - Kolor dziedziczy z panelu (`inherit`, jak lista w `ExerciseFeedbackDock.module.css`), bez
    `.kid-notice`.
  - Pusty region nie zajmuje miejsca.
- **Kiedy znika.** Tekst znika przy udanym starcie odsłuchu zdania albo przy „Dalej”
  (§4.1, pkt 5). Fokus zostaje na przycisku.

### 4.5 Bez zmian

- Logika „Nie pamiętam” w lekcji z nagraniem.
- Ikona „?” komunikatu obok przycisków zdania.
- „Dalej” przerywa odczyt.
- Prefetch następnego zadania.
- Pieczęć `audio_issued` po stronie serwera.

Ponowne i wolne odsłuchy nie tworzą zdarzeń nauki ani ekspozycji, bo nagranie zostało
ujawnione i zapieczętowane razem z oceną. Trafiają tylko do lokalnego raportu aktywności (§8).

## 5. Odtwarzacz (adapter `AudioPlayer`)

- **Port:** `play(url, onStarted?, options?: { rate?: number })`. Brak opcji oznacza tempo 1,
  więc dotychczasowi wywołujący i fake'i z mniejszą liczbą parametrów działają bez zmian.
- **Stała:** `SLOW_PLAYBACK_RATE = 0.75` w module mediów Kid UI, jedno miejsce.
- **`BrowserAudioPlayer`:**
  - **Tempo:** po utworzeniu elementu, a przed `play()`, ustawia `defaultPlaybackRate`
    i `playbackRate`. Konstruktor `Audio(src)` już ładuje plik. `defaultPlaybackRate` chroni
    tempo przy ewentualnym ponownym `load()`.
  - **Wysokość głosu:** ustawia `preservesPitch = true`, a gdy standardowej właściwości nie ma,
    `webkitPreservesPitch`/`mozPreservesPitch`. Przeglądarki mają tę wartość domyślnie
    włączoną, więc ustawienie jest jawną gwarancją (i punktem asercji E2E), a nie słyszalną
    zmianą.
  - **Czas:** `onStarted(durationMs)` raportuje rzeczywisty czas odtwarzania,
    `duration / audio.playbackRate`. To tempo odczytane z elementu w `onplaying`, a nie
    żądane, więc przeglądarka, która go nie przyjęła, nie zawyża limitu.
  - **Jeden start na przebieg:** `playing` przychodzi ponownie po wznowieniu z buforowania;
    `onStarted` jest zgłaszany najwyżej raz na wywołanie `play()`.
  - **Spóźnione zdarzenia:** `onplaying` sprawdza generację (`generation !== this.#generation`
    → nic). `#releaseAudio` zeruje `onplaying`, `onended` i `onerror`. Zdarzenie `playing`
    czekające w kolejce po `stop()` nie wywoła więc `onStarted`.
- **Brak obsługi zmiany tempa:** odtwarzanie w tempie, które element faktycznie przyjął, bez
  błędu.
- **Ponowny odsłuch bez sieci:** `/api/v1/media/:id` odpowiada `cache-control: public,
  max-age=31536000, immutable`, a `fetch` odtwarzacza używa domyślnego trybu cache, więc kolejne
  „Posłuchaj zdania” i żółw biorą plik z pamięci przeglądarki. Własny cache bloba w odtwarzaczu
  nie jest potrzebny (decyzja 2026-11-01, #199).
- **Raport aktywności:** koniec odsłuchu zamyka w raporcie tylko przebieg, który go otworzył
  (`#playCountedAudio` w kontrolerze). Przerwany odsłuch tego samego nagrania — np. zmiana
  tempa — nie skraca nowego, który zdążył już wystartować. Po `teardown` kontroler nie startuje
  już odczytu zdania.

## 6. Serwer i testy techniczne

### 6.1 `withFeedbackSentenceAudio` z warunkiem końca zadania

Dziś oba miejsca wywołania w `lesson-attempts.ts` (finalizacja deterministyczna i po werdykcie
modelu) robią:

```ts
taskState === "issued" ? visibleFeedback : withFeedbackSentenceAudio(...)
```

Zmiany:

- Sygnatura: `withFeedbackSentenceAudio(feedback, key, taskState)`. `taskState` to wyliczony
  następny stan z `nextLessonTaskState`, typ jego wyniku, a nie `finalTaskState: string`.
- Przy `taskState === "issued"` funkcja zwraca feedback bez nagrania.
- Komentarz funkcji traci zdanie „Wywołujący stosuje ją tylko…”, bo warunek jest teraz w środku.
- Istniejące wywołania w `lesson-attempts.test.ts` dostają stan, a dochodzi przypadek `issued`.
- Obie ścieżki wywołania nadal pokrywają testy integracyjne `not_assessed` i `model_other`
  w `lesson-sentence-audio.test.ts`.

Zachowanie i pieczęć `audio_issued` (zależna od pola w feedbacku) się nie zmieniają.

### 6.2 Kartkówka bez zapytania o `feedback_audio` — test

Istniejący test „kartkówka — feedback null i brak audio_issued” sprawdza tylko klucz zadania.
Ten sam wynik daje strażnik `!mockTest` w materializacji, więc test nie pilnuje zapytania.

Nowy test integracyjny w `lesson-sentence-audio.test.ts` podgląda zapytania puli (wzorzec
z `grammar-without-tts.test.ts`) podczas `createLessonMockTestPlan`, wywoływanego przez start
kartkówki. Sprawdza, że żadne zapytanie nie filtruje roli `feedback_audio`. Dla kontroli ten sam
podgląd przy starcie treningu takie zapytanie widzi, więc test nie przechodzi pusto.

### 6.3 Brakujące testy i zaostrzenie domeny

- **`feedbackSentenceText`:**
  - pusta albo biała `answer` dla `lesson_gap`, `lesson_error_fix`, `lesson_transform`
    i `lesson_open_answer` → `null`;
  - `lesson_choice` z pustym tekstem poprawnej opcji → `null`;
  - `lesson_order` z pustą listą klocków → `null`;
  - **zaostrzenie domeny:** `lesson_order`, w którym którykolwiek klocek ma pusty tekst,
    → `null`, jak `lesson_cloze` z pustą odpowiedzią luki. Dziś `["I", "", "go"]` daje
    „I go”, czyli zdanie bez jednego klocka. Zmiana tekstu zmienia fingerprint. Opublikowane
    rewizje z takim payloadem przestają przy kolejnej edycji planować nagranie, a stare zasoby
    zostają.
- **Fixture `attachLessonFeedbackAudio`:**
  - obecny wariant `"ready"` zostaje: wiersz `pending` z gotowym zasobem to najczęstszy stan
    produkcji, bo publikacja nie czeka, a wiersz opublikowanej rewizji jest niezmienny;
  - dochodzi wariant `"ready-approved"` (`revision_assets.state = 'approved'`, jak przy
    ponownym użyciu gotowego zasobu);
  - test odczytu w `lesson-sentence-audio.test.ts`, że feedback niesie `correctAudioAssetId`,
    jest sparametryzowany po obu wariantach.
- **`grammar-without-tts.test.ts`:** zamiast `>= 20` oczekiwana liczba runów TTS to liczba
  **różnych** `asset_id` z `revision_assets` szkicu (role `target_audio` i `feedback_audio`).
  Zasoby są deduplikowane po fingerprincie, a obie role mogą dzielić zasób. Asercja:
  `runs.length === distinctAssets` i wszystkie runy `superseded`.

### 6.4 Stara lekcja: nowa wersja → nagranie → odczyt w sesji

Istniejący test „nowa wersja starej lekcji…” w `lesson-sentence-audio.test.ts` zostaje.
Nowy test (albo przedłużenie istniejącego) po publikacji kopii:

1. uruchamia worker (`runDueGenerationWork` z fałszywym TTS) do wyczerpania pracy;
2. startuje trening dziecka na nowej wersji;
3. odpowiada na zadanie typu ze zdaniem;
4. sprawdza, że feedback ma `correctAudioAssetId` gotowego zasobu i że jest
   `audio_issued` z `occurredAt > receivedAt`.

## 7. Testy (podsumowanie)

- **Unit Kid UI:**
  - **Fake odtwarzacza w `session-controller.test.ts`:** każde `play()` dostaje własną bramkę,
    a `stop()` rozwiązuje bieżącą, jak `BrowserAudioPlayer`. Fake zapisuje też `options`.
    Bez tego testy przerwań zawieszają się albo przechodzą fałszywie.
  - **Kontroler:**
    - wskaźnik trwa od `onStarted` do końca odsłuchu;
    - zablokowany autoodczyt nie zapala wskaźnika;
    - przerwanie przez „?” i przez „Dalej” gasi wskaźnik synchronicznie;
    - spóźnione zakończenie albo `onStarted` poprzedniego przebiegu nie gasi i nie zapala
      nowego;
    - wolny odsłuch przekazuje `rate: 0.75`;
    - ręczny błąd ustawia `sentenceAudioError` z tempem i rosnącym `seq`, a autoodczyt nie;
    - błąd znika przy udanym starcie, a nie przy samej próbie.
  - **`ListenButton`:** `icon="turtle"`, `failKey` porusza ikoną.
  - **Dok:** grupa przycisków, `data-sound-active`, region błędu z treścią.
  - **`BrowserAudioPlayer`:**
    - tempo i `preservesPitch` (także prefiksy `webkit`/`moz`);
    - `durationMs` z rzeczywistego `playbackRate`;
    - brak `onStarted` po `stop()` i jeden `onStarted` przy ponownym `playing`.
  - **Raport aktywności:** limit odsłuchu dla wolnego tempa (`durationMs` wydłużony) nie ucina
    odsłuchu.
  - **Tokeny:** nowa ikona i token Motion przechodzą `kid-design-tokens.test.ts`.
- **Unit serwer:** `withFeedbackSentenceAudio` z `issued`; `feedbackSentenceText` (§6.3).
- **Integracja:**
  - zapytanie w kartkówce (§6.2);
  - fixture w obu wariantach i dokładna liczba runów (§6.3);
  - stara lekcja → odczyt w sesji (§6.4).
- **E2E `mocked`:**
  - **`lesson-sentence-audio.spec.ts`:**
    - `data-sound-active` na „Posłuchaj zdania” w trakcie autoodczytu i jego brak po
      zatrzymaniu;
    - „Posłuchaj wolniej” odtwarza ten sam plik z `playbackRate` 0,75 i `preservesPitch`,
      odczytanymi w podmienionym `play`; zapis `preservesPitch` przez kod rejestruje
      podsłuch settera (sam odczyt w Chromium jest domyślnie `true`);
    - ręczny odsłuch przy zablokowanym `play()` wypełnia region błędu, a autoodczyt nie;
      fokus zostaje na przycisku;
    - tekst błędu nie przesuwa przycisków zdania (375×812, 1280×800 i 812×375: prostokąty
      przed i po błędzie ±1 px; w nakładce przy dolnej krawędzi także „Dalej”);
    - układ grupy z container query: przy treści doku < 480 px (pomiar doku) kolumna —
      żółw pod zdaniem z odstępem 8 px, ta sama lewa krawędź, „?” na wysokości górnego;
      szerszy dok — jeden wiersz;
    - geometria grupy:
      - oba przyciski ≥ 48 px, w doku, bez przepełnienia poziomego, bez nakładania na „?”;
      - `SoundRing` w doku;
      - „Dalej” osiągalne;
      - także w stanie z widocznym tekstem błędu;
      - istniejące rozmiary plus 320×640;
      - test uzupełniania tekstu z bankiem słów (`CLOZE_VIEWPORTS`) z dwoma przyciskami.
  - **`kid-large-screen.spec.ts`:** dok z grupą przy skali > 1 (np. 1920×1080,
    `waitForKidScale`), prostokąty w pikselach ekranu.
  - **`kid-motion.spec.ts`:** bez reduced-motion ikona przycisku z `data-audio-failed` ma
    transformację w trakcie animacji, a przy reduced-motion nie ma.
- **Niezweryfikowane:**
  - fizyczne urządzenia;
  - słyszalna jakość wolnego tempa (test sprawdza ustawienia elementu, nie dźwięk);
  - czytelność ikony żółwia u dziecka.

## 8. Prywatność, dane i raport aktywności

- Nie dochodzą nowe dane, wywołania providerów, nagrania dziecka ani zdarzenia nauki.
- Wolny odsłuch to lokalne ponowne odtworzenie nagrania lektora, które zostało już ujawnione.
- **Raport aktywności — świadoma decyzja.** Każdy odsłuch, także wolny, trafia jak dotąd do
  lokalnego raportu aktywności sesji (`playbacks`). Raport ocenia `SessionActivityReviewer`
  i pokazuje karta pracy rodzica, a odsłuch liczy się do czasu aktywnego. Wolne tempo wydłuża
  zapisany odsłuch do rzeczywistego czasu słuchania (ok. 1,33×). Tak ma być: dziecko naprawdę
  tyle słucha. Limit nadal wynika z długości nagrania, więc odsłuchu nie da się „rozciągnąć”
  dowolnie.

## 9. Dokumentacja i integracje

- **Design #194:** §2 „Poza zakresem” i §11 „Kolejne etapy” dostają notę, że wskaźnik i wolniejsze
  odtwarzanie zrobiono w tym etapie, z odnośnikiem do tego dokumentu.
- **`docs/architecture.md`, akapit „Odczyt zdania po odpowiedzi”:** dochodzą „Posłuchaj
  wolniej” (0,75×, bez zdarzeń), wskaźnik odtwarzania, sygnał błędu i bramka końca zadania
  wewnątrz `withFeedbackSentenceAudio`.
- **`docs/SPEC.md`, Etap 3 rozdziału (opis „Posłuchaj zdania”):** jedno zdanie o „Posłuchaj
  wolniej”. §22 nie opisuje przycisków doku, więc zostaje bez zmian.
- **API → MCP → `SKILL.md`:** bez zmian. Zmieniają się tylko katalog komunikatów Kid UI i port
  odtwarzacza po stronie klienta. DTO, endpointy i znaczenie danych zostają. Feedback dziecka
  i `playbacks` nie są częścią MCP, a `learning-overview` nie obejmuje lekcji. PR potwierdza
  to grepem.

## 10. Wdrożenie

Zmienia się web (Kid UI) i serwer, bez migracji. Kolejność restartu jest dowolna. Otwarta karta
PWA zobaczy żółwia po odświeżeniu, a stary klient działa bez zmian, bo kontrakt jest ten sam.
