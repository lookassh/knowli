---
title: 'Obsługa klawiatury i zarządzanie fokusem w trybie nauki i kartkówki'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '3397c406d95a7e01fce3bd1dfa4e4bbc70ac4502'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Po wyborze profilu dziecka i wejściu do zestawu do nauki lub kartkówki interfejs wymaga ciągłego sięgania po mysz/dotyk. Pola tekstowe nie zyskują automatycznego fokusu, opcje wyboru nie mają wygodnej obsługi klawiaturą, a ekrany informacji zwrotnej (feedback) oraz prezentacji słówek nie reagują intuicyjnie na klawisz Enter, co uniemożliwia płynne przejście całej sesji przy użyciu samej klawiatury.

**Approach:** Wprowadzenie automatycznego pozycjonowania fokusu na polach tekstowych i głównych przyciskach akcji na wszystkich etapach (wybór zestawu, ekran startowy kartkówki, ćwiczenia pisemne, luki, wybór wielokrotny, feedback i podsumowanie) oraz dedykowanej obsługi klawiatury:
- Automatyczny fokus (`useEffect` z `preventScroll: true` przy zmianie `task.taskId`) na polach tekstowych i głównych przyciskach akcji.
- W zadaniach wyboru (`ReadingView`, `ListeningView`, `PictureListeningView`, `LessonChoiceView`, `LessonShortAnswerView`): wybór klawiszami cyfr `1`–`4`, nawigacja strzałkami góra/dół + Enter, a w zadaniach ze słuchu klawisz Spacji ponawiający odsłuch audio.
- W uzupełnianiu liter (`LetterCompletionView`): fokus na pierwszej luce, przechodzenie do przodu przy wpisaniu litery, cofanie fokusu klawiszem Backspace w pustej luce oraz nawigacja strzałkami lewo/prawo.
- W ekranach feedbacku i ujawnienia: fokus na głównym przycisku akcji ("Dalej" / "Spróbuj jeszcze raz" / "Rozumiem"), ignorowanie `event.repeat` oraz 300 ms ochrony (cooldown) przed przypadkowym natychmiastowym pominięciem feedbacku przy wielokrotnym naciśnięciu Enter.
- Bezpieczny dostęp do „Nie pamiętam” i „Pomiń” przez natywny klawisz `Tab` (gdy pole jest puste, zablokowany przycisk „Sprawdź” jest omijany, więc pierwsze naciśnięcie `Tab` trafia prosto w „Nie pamiętam”).

## Boundaries & Constraints

**Always:**
- Zachować pełną zgodność z istniejącymi zachowaniami na urządzeniach dotykowych i mobilnych (w tym chowanie klawiatury ekranowej po zatwierdzeniu bez niepożądanego przewijania strony – zawsze używać `preventScroll: true` przy `.focus()`).
- Zapewnić widoczny, kontrastowy wskaźnik skupienia (`:focus-visible` / outline) na polach tekstowych i przyciskach.
- Zmiany ograniczyć do pakietu interfejsu dziecka `@learning/kid-ui` (kontrakty DTO i logika serwerowa pozostają nienaruszone).
- Utrzymać poprawność semantyki i atrybutów dostępności dla czytników ekranu (aria-label, aria-live itp.).
- Filtrować listenery klawiatury: ignorować skróty z klawiszami modyfikatorów (`ctrlKey`, `altKey`, `metaKey`) oraz ignorować skróty numeryczne/spacji, gdy kursor znajduje się w aktywnym polu tekstowym (`HTMLInputElement`, `HTMLTextAreaElement`).
- Ignorować `event.repeat` dla klawisza Enter w ekranach feedbacku i stosować 300 ms cooldown od pojawienia się wyniku.

**Never:**
- Nie dodawać skrótów klawiaturowych kolidujących z wpisywaniem tekstu w aktywnych polach edycyjnych.
- Nie stosować łatwo dostępnych pojedynczych klawiszy (jak np. `Esc`) dla przycisku „Nie pamiętam”, aby uniknąć przypadkowego zaniżania ocen w algorytmie SRS przez dziecko.
- Nie wprowadzać zewnętrznych bibliotek zarządzania fokusem.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zadanie pisemne (`WrittenView`) | Montowanie lub zmiana `task.taskId` | Kursor automatycznie w polu tekstowym; Enter wysyła wpisany tekst | Puste pole nie wysyła odpowiedzi (przycisk zablokowany); Tab z pustego pola przenosi fokus bezpośrednio do "Nie pamiętam" |
| Uzupełnianie liter (`LetterCompletionView`) | Montowanie zadania z lukami | Pierwsza pusta luka ma fokus; wpisanie litery przechodzi do kolejnej; Backspace w pustej luce cofa do poprzedniej; strzałki lewo/prawo nawigują po lukach | Znaki niedozwolone lub >1 znak są ignorowane; Enter zatwierdza dopiero po wypełnieniu wszystkich luk |
| Zadanie z luką lekcji (`LessonGapView`) / zdanie (`LessonSentenceView`) | Montowanie lub zmiana zadania | Pole edycyjne zyskuje fokus automatycznie; Enter zatwierdza | Puste pole nie wysyła odpowiedzi |
| Wybór opcji tekstu (`ReadingView`, `LessonChoiceView`, `LessonShortAnswerView`) | Wyświetlenie listy opcji | Cyfry `1`–`4` wybierają odpowiadającą opcję; strzałki góra/dół nawigują po opcjach; Enter zatwierdza | Klawisze cyfr spoza zakresu opcji są ignorowane; podczas busy opcje są zablokowane |
| Wybór opcji ze słuchu (`ListeningView`, `PictureListeningView`) | Wyświetlenie zadania audio | Początkowy fokus na przycisku odsłuchu (`kid-play`); Spacja ponawia odsłuch; cyfry `1`–`4` wybierają opcję; strzałki góra/dół nawigują, a Enter zatwierdza | Spacja nie aktywuje przypadkowo zaznaczonej opcji odpowiedzi |
| Prezentacja słowa / reguły (`ExposureView`, `PictureExposureView`, `LessonCardView`) | Wyświetlenie widoku ekspozycji | Przycisk "Rozumiem" / "Dalej" ma fokus; Enter/Spacja kończy prezentację; w widokach audio Spacja/przycisk ponawia odtworzenie | W trakcie ładowania akcja zablokowana |
| Ekran informacji zwrotnej (`AnswerFeedback`, `SpeechFeedbackCard`, `kid-reveal`) | Wyświetlenie wyniku odpowiedzi lub ujawnienia | Główny przycisk akcji ("Dalej" / "Spróbuj jeszcze raz" / "Rozumiem") ma fokus; naciśnięcie Enter przechodzi dalej lub ponawia; wielokrotne/przytrzymane wciśnięcie Enter jest ignorowane (brak natychmiastowego zamknięcia) | Cooldown 300 ms i blokada przy `event.repeat` |
| Ekran wyboru zestawu (`DeckScreen`) i start kartkówki (`MockTestReadyScreen`) | Wejście na ekran zestawów po wyborze profilu | Pierwszy przycisk akcji ("Rozpocznij" / "Wznów" / "Rozpocznij kartkówkę") zyskuje fokus | Brak zestawów nie wywołuje błędu fokusu |
| Podsumowanie sesji (`SummaryScreen`, `MockTestSummaryScreen`, `LessonMockTestSummaryScreen`) | Wyświetlenie ekranu końcowego | Przycisk "Ucz się dalej" / "Ćwicz dalej" ma fokus; Enter uruchamia kolejną sesję | Błędy sieciowe obsługiwane istniejącym stanem błędu |

</frozen-after-approval>

## Code Map

- `packages/kid-ui/src/exercises/WrittenView.tsx` -- automatyczny fokus na polu tekstowym po zamontowaniu i przy zmianie `task.taskId`
- `packages/kid-ui/src/exercises/LetterCompletionView.tsx` -- automatyczny fokus na pierwszej luce, cofanie fokusu Backspace w pustej luce oraz nawigacja strzałkami
- `packages/kid-ui/src/exercises/lesson/LessonGapView.tsx` -- automatyczny fokus na polu luki
- `packages/kid-ui/src/exercises/lesson/LessonSentenceView.tsx` -- automatyczny fokus na polu tekstowym zdania
- `packages/kid-ui/src/exercises/ExposureView.tsx` -- automatyczny fokus na przycisku "Rozumiem"
- `packages/kid-ui/src/exercises/PictureExposureView.tsx` -- automatyczny fokus na przycisku "Rozumiem"
- `packages/kid-ui/src/exercises/lesson/LessonCardView.tsx` -- automatyczny fokus na przycisku "Dalej"
- `packages/kid-ui/src/exercises/ReadingView.tsx` -- obsługa klawiszy cyfr 1..4 oraz nawigacji opcji
- `packages/kid-ui/src/exercises/ListeningView.tsx` -- fokus na przycisku audio, klawisz Spacji dla odsłuchu oraz cyfry 1..4 do wyboru opcji
- `packages/kid-ui/src/exercises/PictureListeningView.tsx` -- analogiczna obsługa klawiszy cyfr 1..4, Spacji dla odsłuchu i nawigacji
- `packages/kid-ui/src/exercises/lesson/LessonChoiceView.tsx` -- obsługa klawiszy cyfr 1..4 oraz nawigacji opcji
- `packages/kid-ui/src/exercises/lesson/LessonShortAnswerView.tsx` -- obsługa klawiszy cyfr 1..4 oraz nawigacji opcji
- `packages/kid-ui/src/screens/AnswerFeedback.tsx` -- usunięcie kolidującego fokusu z nagłówka i ustawienie fokusu na przycisku akcji "Dalej" / "Spróbuj jeszcze raz" z cooldownem i ochroną przed repeat
- `packages/kid-ui/src/screens/SpeechFeedbackCard.tsx` -- usunięcie kolidującego fokusu z nagłówka i ustawienie fokusu na przycisku akcji "Dalej" / "Nagraj jeszcze raz"
- `packages/kid-ui/src/screens/LearnScreen.tsx` -- obsługa Enter przy ujawnieniu słowa (`kid-reveal`)
- `packages/kid-ui/src/screens/DeckScreen.tsx` -- początkowy fokus na pierwszym przycisku rozpoczęcia nauki
- `packages/kid-ui/src/screens/MockTestSummaryScreen.tsx` -- początkowy fokus na przycisku startu kartkówki (`MockTestReadyScreen`) i podsumowania (`MockTestSummaryScreen`)
- `packages/kid-ui/src/screens/LessonMockTestSummaryScreen.tsx` -- początkowy fokus na przycisku ponownego ćwiczenia
- `packages/kid-ui/src/screens/SummaryScreen.tsx` -- początkowy fokus na przycisku "Ucz się dalej"
- `packages/kid-ui/src/styles.css` -- wyraźny wskaźnik fokusu `:focus-visible` na polach formularzy i opcjach
- `packages/kid-ui/src/screens/keyboard-navigation.test.tsx` -- kompleksowe testy jednostkowe weryfikujące przepływy klawiaturowe

## Tasks & Acceptance

**Execution:**
- [x] `packages/kid-ui/src/exercises/WrittenView.tsx` -- `useEffect` z `preventScroll: true` dla pola tekstowego przy montowaniu i zmianie `task.taskId`
- [x] `packages/kid-ui/src/exercises/LetterCompletionView.tsx` -- fokus na pierwszej luce, cofanie Backspace i nawigacja ArrowLeft/ArrowRight
- [x] `packages/kid-ui/src/exercises/lesson/LessonGapView.tsx` & `packages/kid-ui/src/exercises/lesson/LessonSentenceView.tsx` -- automatyczny fokus na polach wejściowych w lekcjach
- [x] `packages/kid-ui/src/exercises/ExposureView.tsx`, `packages/kid-ui/src/exercises/PictureExposureView.tsx`, `packages/kid-ui/src/exercises/lesson/LessonCardView.tsx` -- fokus na przycisku "Rozumiem" / "Dalej"
- [x] `packages/kid-ui/src/exercises/ReadingView.tsx`, `packages/kid-ui/src/exercises/ListeningView.tsx`, `packages/kid-ui/src/exercises/PictureListeningView.tsx`, `packages/kid-ui/src/exercises/lesson/LessonChoiceView.tsx`, `packages/kid-ui/src/exercises/lesson/LessonShortAnswerView.tsx` -- obsługa cyfr 1..4, strzałek i dedykowana obsługa Spacji dla ponownego odsłuchu audio w zadaniach słuchowych
- [x] `packages/kid-ui/src/screens/AnswerFeedback.tsx`, `packages/kid-ui/src/screens/SpeechFeedbackCard.tsx`, `packages/kid-ui/src/screens/LearnScreen.tsx` -- fokus na przycisku akcji w feedbacku z ochroną cooldown (300 ms) i `!event.repeat`
- [x] `packages/kid-ui/src/screens/DeckScreen.tsx`, `packages/kid-ui/src/screens/MockTestSummaryScreen.tsx`, `packages/kid-ui/src/screens/LessonMockTestSummaryScreen.tsx`, `packages/kid-ui/src/screens/SummaryScreen.tsx` -- początkowy fokus na głównych przyciskach akcji
- [x] `packages/kid-ui/src/styles.css` -- dopracowanie stylów `:focus-visible` dla pól wejściowych (`.kid-written input`, `.kid-letter-input`, `.kid-lesson-gap__input`, `.kid-lesson-input`)
- [x] `packages/kid-ui/src/screens/keyboard-navigation.test.tsx` -- zestaw testów weryfikujących nawigację klawiaturą we wszystkich typach ćwiczeń

**Acceptance Criteria:**
- Given użytkownik otwiera zadanie pisemne, when widok się wyświetla, then pole tekstowe ma aktywny kursor i można od razu pisać bez używania myszy.
- Given użytkownik wpisał słowo i nacisnął Enter, when pojawia się feedback ("Świetnie!" / "Prawie!"), then naciśnięcie Enter przechodzi natychmiast do następnego zadania lub ponawia próbę; powtórzony/przytrzymany Enter (key repeat) nie zamyka feedbacku przed upływem 300 ms.
- Given użytkownik widzi zadanie z opcjami wyboru, when naciska klawisz `1`–`4`, then odpowiadająca opcja zostaje wybrana bez sięgania po mysz.
- Given użytkownik widzi zadanie ze słuchu, when naciska klawisz Spacji, then zadanie odtwarza ponownie nagranie wzorcowe audio i nie wysyła przedwcześnie żadnej opcji.
- Given użytkownik uzupełnia luki w słowie, when naciska Backspace w pustej luce, then fokus wraca do poprzedniej luki, a po wypełnieniu wszystkich luk Enter zatwierdza słowo.
- Given użytkownik przechodzi na ekran wyboru zestawu lub startu kartkówki, when widok się ładuje, then pierwszy przycisk rozpoczęcia ma aktywny fokus i naciśnięcie Enter rozpoczyna sesję.

## Implementation Notes

- Utworzono dedykowane hooki `@learning/kid-ui`:
  - `useChoiceKeyboard.ts` z funkcją pomocniczą `shouldIgnoreKeyboardShortcut` do obsługi klawiszy 1-4, strzałek w górę/w dół oraz odsłuchu audio Spacją bez kolizji z polami edycyjnymi i klawiszami modyfikatorów.
  - `useFeedbackCooldown.ts` zarządzający początkowym fokusem na przycisku akcji w feedbacku oraz blokujący zdarzenia `repeat` i przedwczesne zamknięcie przez pierwsze 300 ms.
  - `useAutoFocus.ts` zapewniający bezpieczne ustawianie fokusu na przyciskach startowych/podsumowania z `preventScroll: true`.
- Zaimplementowano automatyczne pozycjonowanie fokusu oraz obsługę klawiatury w:
  - Polach tekstowych i lukach: `WrittenView`, `LetterCompletionView` (w tym cofanie Backspace i strzałki lewo/prawo), `LessonGapView`, `LessonSentenceView`.
  - Wyborze opcji: `ReadingView`, `ListeningView`, `PictureListeningView`, `LessonChoiceView`, `LessonShortAnswerView`.
  - Prezentacjach i regułach: `ExposureView`, `PictureExposureView`, `LessonCardView`.
  - Informacji zwrotnej i odsłonięciach: `AnswerFeedback`, `SpeechFeedbackCard`, `LearnScreen` (reveal).
  - Ekranach wejściowych i podsumowaniach: `DeckScreen`, `MockTestSummaryScreen`, `LessonMockTestSummaryScreen`, `SummaryScreen`.
- W `styles.css` dodano wyraźny obrys `:focus-visible` dla `.kid-written input`, `.kid-letter-input`, `.kid-lesson-gap__input` oraz `.kid-lesson-input`.
- Utworzono plik testowy `keyboard-navigation.test.tsx` (26 testów jednostkowych) pokrywający wszystkie scenariusze z macierzy I/O.

## Design Notes

Fokus po wejściu na widok ustawiany jest za pomocą referencji w `useEffect` (z `preventScroll: true`), aby nie powodować skoków widoku na małych ekranach. W zadaniach wielokrotnego wyboru listener klawiatury dla klawiszy `1`–`4` ignoruje zdarzenia z aktywnych pól edycyjnych i klawiszy modyfikatorów. W zadaniach ze słuchu Spacja ponawia odsłuch audio. W ekranach informacji zwrotnej przycisk akcji posiada fokus początkowy, a nagłówek komunikatu jest dostępny dla czytników ekranowych dzięki atrybutowi `aria-live="polite"`.

## Verification

**Commands:**
- `corepack pnpm test:unit packages/kid-ui/src/screens/keyboard-navigation.test.tsx` -- expected: wszystkie testy nawigacji klawiaturowej przechodzą
- `corepack pnpm typecheck` -- expected: brak błędów typowania TypeScript we wszystkich pakietach

## Review Triage Log

| Finding ID | Layer | Location | Verdict | Route | Evidence / Notes |
|------------|-------|----------|---------|-------|------------------|
| B1/E7/V5 | Blind / Edge / Gap | `LetterCompletionView.tsx`, `ListeningView.tsx`, `PictureListeningView.tsx`, `ReadingView.tsx`, `LessonChoiceView.tsx`, `LessonShortAnswerView.tsx` | `high` | `patch` | Hooki (`useRef`, `useEffect`, `useChoiceKeyboard`) zostały wywołane po warunkowym `if (task.prompt.kind !== ...) return null;`, co narusza Rules of Hooks i grozi błędem Reacta przy zmianie typu zadania w unmounted/re-rendered instancji. Należy przenieść deklaracje hooków przed instrukcje warunkowego zwrotu. |
| B2/E1/E8 | Blind / Edge | `packages/kid-ui/src/screens/useFeedbackCooldown.ts:36-47` | `high` | `patch` | W oknie `keydown` przycisk Enter jest przechwytywany (`active !== buttonRef.current`), co powoduje, że gdy dziecko przejdzie tabulatorem na "Pomiń" lub inny przycisk wtórny i naciśnie Enter, feedback przechwytuje zdarzenie i wywołuje `onAction()` (dalej/retry) zamiast pominięcia. Należy zaniechać przechwytywania Enter, gdy `activeElement` jest innym przyciskiem (`active?.tagName === 'BUTTON'`). |
| B3/E2 | Blind / Edge | `packages/kid-ui/src/screens/useFeedbackCooldown.ts` | `medium` | `patch` | `handleWindowKeyDown` nie weryfikuje stanu `buttonRef.current?.disabled` przed wywołaniem `onAction()`, co może wywołać akcję w trakcie trwania żądania sieciowego. Należy dodać warunek `if (buttonRef.current?.disabled) return;`. |
| B4/E3 | Blind / Edge | `packages/kid-ui/src/screens/useFeedbackCooldown.ts` | `medium` | `patch` | Klawisz Spacji na sfokusowanym przycisku wyzwala natywny click z pominięciem 300 ms cooldownu. Należy obsłużyć Spację w `onKeyDown` przycisku analogicznie do Enter. |
| B5/V7 | Blind / Gap | `packages/kid-ui/src/screens/AnswerFeedback.tsx:186` | `high` | `patch` | Tablica zależności `useFeedbackCooldown` w `AnswerFeedbackActions` to `[retry]`. Przy dwóch kolejnych błędach lub sukcesach `retry` się nie zmienia, co uniemożliwia ponowne uruchomienie 300 ms cooldownu dla kolejnego pytania. Należy przekazać `[dto, retry]`. |
| B6 | Blind | `ReadingView.tsx`, `LessonChoiceView.tsx`, `LessonShortAnswerView.tsx` | `low` | `patch` | Brak ustawienia początkowego fokusu po wejściu na ekran wyboru opcji tekstu (klawisze 1-4 działają globalnie, ale przy nawigacji strzałkami/tabem fokus jest w ciele strony). Należy ustawić fokus na pierwszej opcji przy montowaniu. |
| B7 | Blind | `packages/kid-ui/src/exercises/ExposureView.tsx:30-36`, `PictureExposureView.tsx:30-36` | `medium` | `patch` | Klawisz Spacji ponawia odsłuch audio nawet gdy fokus znajduje się na przycisku "Rozumiem" (`kid-done`), uniemożliwiając jego aktywację Spacją. Należy nie przechwytywać Spacji, gdy aktywny element to `kid-done`. |
| B8/V6 | Blind / Gap | `packages/kid-ui/src/screens/useAutoFocus.ts:3-7` | `low` | `patch` | Sprawdzanie `__CLIENT_INTERNALS...` narusza czystość kodu Reacta. Należy uprościć lub zabezpieczyć hook bez używania prywatnych właściwości. |
| B9 | Blind | `packages/kid-ui/src/screens/DeckScreen.tsx:49` | `low` | `patch` | Atrybut HTML `autoFocus={isFirst}` w `DeckScreen` powoduje natywne przewijanie ekranu w przeglądarkach. Należy usunąć atrybut i polegać na `useAutoFocus({ preventScroll: true })`. |
| B10 | Blind | `packages/kid-ui/src/exercises/useChoiceKeyboard.ts` | `low` | `patch` | Strzałki w górę/dół blokują domyślne przewijanie strony nawet przy braku fokusu na opcjach. Należy wywoływać `event.preventDefault()` tylko wtedy, gdy fokus jest aktywnie przenoszony. |
| B11 | Blind | `packages/kid-ui/src/exercises/LetterCompletionView.tsx` | `low` | `patch` | Po cofnięciu Backspace do poprzedniej pustej luki litera nie jest zaznaczana (`.select()`), co utrudnia jej natychmiastowe nadpisanie. Należy dodać zaznaczenie tekstu przy cofaniu. |
| B12 | Blind | `packages/kid-ui/src/exercises/useChoiceKeyboard.ts` | `low` | `patch` | Tablica referencji `optionRefs.current` nie jest resetowana przy zmianie opcji. Należy czyścić ją w `useEffect`. |
| B13 | Blind | `packages/kid-ui/src/screens/keyboard-navigation.test.tsx` | `low` | `patch` | Mock dispatcher w `renderWithHooks` domyślnie inicjalizował `ref.current` atrapą elementu. Należy poprawić mock, by inicjalizował `current: null`. |
| B14 | Blind | `packages/kid-ui/src/exercises/ExposureView.tsx` | `false` | `rejected` | Brak skrótu do przykładowego audio nie jest błędem — specyfikacja wymaga jedynie powtórzenia wzorcowej wymowy słówka głównego. |
| E4/E5/E6 | Edge | `useChoiceKeyboard.ts`, `ExposureView.tsx` | `low` | `patch` | Brak blokady `if (event.repeat) return;` dla klawiszy cyfr i spacji przy ich przytrzymaniu. Należy dodać ignorowanie `event.repeat`. |
| V1 | Gap | `packages/kid-ui/src/screens/keyboard-navigation.test.tsx:1287` | `medium` | `patch` | Test `LetterCompletionView` asertował jedynie `data-testid`, a nie wywołanie `focus({ preventScroll: true })`. Należy dodać asercję. |
| V2 | Gap | `packages/kid-ui/src/screens/keyboard-navigation.test.tsx` | `medium` | `patch` | Brak testu wywołania `onKeyDown` bezpośrednio na elemencie przycisku akcji w trakcie trwania 300 ms cooldownu. Należy uzupełnić test. |
| V3 | Gap | `packages/kid-ui/src/screens/keyboard-navigation.test.tsx` | `medium` | `patch` | Komponenty `PictureListeningView`, `LessonChoiceView`, `LessonShortAnswerView`, `PictureExposureView`, `LessonCardView` nie były bezpośrednio renderowane w testach nawigacji. Należy dodać dla nich przypadki testowe. |
| V4 | Gap | `packages/kid-ui/src/screens/LearnScreen.tsx` | `low` | `defer` | Brak testu jednostkowego dla wewnętrznego komponentu `RevealActions`. Zachowanie pokrywane w testach e2e / screen flows. |
