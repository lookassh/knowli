# Redesign Kid UI — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wdrożyć zaakceptowane niebieskie Skupienie dla wszystkich zadań i Karty zestawów, aby typowe sesje na Galaxy S25 mieściły zadanie, wynik i działania bez przewijania strony.

**Architecture:** Zmiana prezentacji w przenośnym `@learning/kid-ui`: wspólna rama viewportu, wiersz instrukcji, ikony, tokeny i strefa działań. Istniejący kontroler sesji, publiczne DTO, autoryzacja ujawnień, reguły nauki i profilowy tryb nagrywania pozostają autorytatywne. Host Next.js dostaje wyłącznie wymagane ustawienie viewportu w trasach dziecka; panel rodzica pozostaje poza przebudową.

**Tech Stack:** TypeScript strict, React 19, istniejący CSS, pnpm 10.34.6, Vitest i Playwright; bez nowych zależności produkcyjnych.

**Spec:** `docs/superpowers/specs/2026-10-11-kid-ui-redesign-design.md`.

## Global Constraints

- Niebieskie Skupienie, jasny/ciemny motyw zgodny z preferencją systemową.
- Pod nagłówkiem/postępem jest osobny wiersz instrukcji: ikona i treść, bez prostokątnego tła, ramki i kolorowego paska.
- Bez zmian publicznego Kid API, schematu bazy, ocen, harmonogramu, ekspozycji, reguł kartkówki, liczby zadań, providerów i panelu rodzica.
- Bez Androida, przełącznika motywu/języka, dodatkowej gamifikacji i nowych zależności produkcyjnych. Nagrania pozostają krótkotrwałe w pamięci.
- Kontrolki mają cele dotykowe minimum 44 × 44 CSS px; główna akcja minimum 52 px wysokości.
- Kontrast normalnego tekstu minimum 4,5:1, dużego tekstu i istotnych elementów graficznych minimum 3:1.
- Obraz i symbol występują wyłącznie w rodzajach wspierających je w obecnym kontrakcie (`exposure`, `speech`).
- Tryb `mock_test` zachowuje „Odpowiedź zapisana” i wyniki dopiero na końcu; nie pokazujemy natychmiastowego podświetlenia poprawnej odpowiedzi.
- Domyślnie wykonanie przez bieżącego agenta przez `superpowers:executing-plans`, dopiero po akceptacji zapisanego planu.

## Review Focus

1. Klawiatura/paski zmieniają viewport, a pinch-zoom `scale > 1.01` ma fallback flow → pole, wpis i główna akcja pozostają osiągalne bez remountu i utraty gestu. Testy Zadania 1/3 i odbiór S25 z powiększeniem/powrotem w Zadaniu 7.
2. Maksymalna długość materiału, opcje wielowierszowe i 200% tekst → czytelna pełna treść, przewijanie szczegółów jako fallback, dostępne wszystkie opcje i działania. Testy Zadania 2/3/4.
3. Niepewne STT/offline pozostają neutralne; pewna poprawna treść zachowuje ocenę przy awarii wymowy, `content_matched` nie dostaje „Świetnie!” ani pochwały wymowy → bez zmiany mapowania domeny/describeSpeechFeedback. Testy Zadania 4/6.
4. Dane zestawów zmieniają się na ostatniej stronie; różne recommended/mockTestAvailable/testDate → prawidłowa strona i deckId, brak zgubionego zestawu lub przesunięcia daty. Testy Zadania 5.
5. Przebudowa nagłówka/focusu oraz aktywna sesja → budżet/remaining ze stanu serwera, poprawny hold/toggle z profilu, działające wznowienie i konflikt dwóch klientów. Regresje Zadania 1/3/6.

## Punkt startowy i sposób wykonania

- Baza planowania: `3efdc168181d1922cadcf8c0042dbdb548d6ba7b` (#40), zgodna z origin/main w chwili przygotowania dokumentu.
- Spec i plan są dokumentami do oceny właściciela. Nie zaczynać implementacji podczas ich przygotowywania.
- Wykonawca używa `using-git-worktrees`, sprawdza dołączone worktree i tworzy nowe tylko w razie potrzeby. Nie przenosi `.codex-remote-attachments/`, `.zcodeignore`, `mock-summary-screenshot.png` ani `work/` z głównego checkoutu.
- Przeczytać wskazane dokumenty bazowe i ten spec; sprawdzić aktualne API/branch po nowych merge'ach. Nie przywracać usuniętego w #40 przełącznika trybu nagrywania w Kid UI.
- Wykonać setup `executing-plans` i jego skrypty workspace/task-start/task-done/review-package lub udokumentowane odpowiedniki dla PowerShell. Dziennik implementacji: `docs/superpowers/progress/2026-10-11-kid-ui-redesign-implementation.md`; dziennik planowania jest odrębny.
- Instalacja, jeśli potrzebna: `npx --yes pnpm@10.34.6 install --frozen-lockfile`. Nie aktualizować lockfile bez powodu.
- Wyizolować testy: ustawić w PowerShell `$env:UMIEM_TEST_RUN_ID = 'kid-ui-redesign'`, `$env:UMIEM_E2E_PORT = '24611'`, `$env:UMIEM_WORKER_HEALTH_PORT = '9461'`; najpierw sprawdzić, że porty są wolne. To istniejące opcje `tests/test-run-config.ts`. Nie używać produkcyjnej bazy ani prawdziwych providerów.
- Zapisać baseline unit/typecheck i odpowiednich istniejących E2E. Rozróżnić błąd środowiska od regresji; nie dopisywać dowodu GREEN na podstawie dawnej sesji.

## Mapa plików

Nowe małe elementy:

- `packages/kid-ui/src/components/KidIcon.tsx`: zamknięty zestaw ikon SVG, bez bibliotek/frameworka ikon.
- `packages/kid-ui/src/layout/viewport.ts` + `viewport.test.ts`: SSR-safe hook viewportu i czysty wybór wymiarów.
- `packages/kid-ui/src/layout/KidPage.tsx`: wspólna powierzchnia/motyw i rama sesji; tryb flow zachowuje dostępność długich ekranów.
- `packages/kid-ui/src/exercises/exercise-presentation.ts` + `.test.ts`: instrukcja/ikona dla ośmiu publicznych rodzajów.
- `packages/kid-ui/src/exercises/ExerciseFrame.tsx`: instrukcja, materiał i istniejące akcje; nie prowadzi sesji.
- `packages/kid-ui/src/screens/AnswerFeedback.tsx`: prezentacja istniejącego wyniku wyboru/pisma; nie ocenia.
- `packages/kid-ui/src/screens/deck-presentation.ts` + `.test.ts`: strony zestawów i formatowanie kalendarzowej daty.
- `tests/e2e/helpers/kid-ui-fixture.ts`: publiczne syntetyczne DTO/HTTP, bez klucza odpowiedzi w Kid API i bez plików audio dziecka.
- `tests/e2e/helpers/assert-kid-layout.ts`: asercje widocznego viewportu i kolizji ważnych obszarów.
- `tests/e2e/kid-ui-layout.spec.ts`, `kid-decks-layout.spec.ts`: macierz widoków i zachowań użytkownika.

Modyfikowane: `styles.css`, `KidApp.tsx`, wszystkie sześć plików `*View.tsx` ćwiczeń (obejmują osiem rodzajów), `SpeechRecordButton.tsx`, `LearnScreen.tsx`, `SpeechFeedbackCard.tsx`, `DeckScreen.tsx`, `ProfileScreen.tsx`, `SummaryScreen.tsx`, `MockTestSummaryScreen.tsx`, `contracts/src/messages.ts`, odpowiednie istniejące E2E i dokumenty. `FeedbackDialog.tsx` usunąć dopiero po zastąpieniu jego jedynego użycia. `session-controller.ts`, `media/browser.ts`, `api/client.ts`, schematy DTO i serwer nie wymagają zmiany zachowania.

Host: utworzyć `apps/web/src/app/kids/layout.tsx` oraz `apps/web/src/app/(kid)/layout.tsx` dla viewportu dziecka, przenieść istniejące `apps/web/src/app/page.tsx` do `(kid)/page.tsx` bez zmiany URL `/`. Zachować wspólny root i panel rodzica. Route group nie jest nowym hostem ani API.

## Zadanie 1: Rama viewportu, motyw i nagłówek

**Pliki:** nowe `KidIcon.tsx`, `layout/viewport.ts`, `.test.ts`, `KidPage.tsx`; modyfikacje `styles.css`, `KidApp.tsx`, `LearnScreen.tsx`; host kids/(kid) layouty; nowe helpers i początek `kid-ui-layout.spec.ts`.

**Interfejsy:**

- `KidIconName = 'volume' | 'microphone' | 'microphone-off' | 'book' | 'ear' | 'pencil' | 'letters' | 'check' | 'close' | 'calendar' | 'chevron-left' | 'chevron-right' | 'arrow-right' | 'lock' | 'sparkles' | 'retry'`; `KidIcon({name, className?}: {name: KidIconName; className?: string}): ReactElement`. SVG dekoracyjne; dostępna nazwa należy do przycisku/instrukcji.
- `computeKidViewport({innerHeight, visualViewport}: {innerHeight: number; visualViewport: {height: number; offsetTop: number; scale?: number} | null}): {height: number; offsetTop: number; zoomed: boolean}`; nieprawidłowe/zerowe visualViewport daje fallback innerHeight i offset 0. Scale brak/niepoprawne = 1; scale > 1.01 daje `{height: innerHeight, offsetTop: 0, zoomed: true}`.
- `useKidViewport(): {height: number | null; offsetTop: number; zoomed: boolean}`; SSR height null/zoomed false, inicjalizacja/resize/scroll visualViewport oraz resize window, cleanup po unmount.
- `KidPage({mode, children}: {mode: 'flow' | 'session'; children: ReactNode}): ReactElement`; session zajmuje zmierzony prostokąt viewportu, flow ma naturalny dostęp do długiej treści. Gdy zoomed, session tymczasowo używa flow bez blokady scroll/panning; powrót nie remountuje dzieci.
- `KidUiFixture = { profiles: KidProfileDto[]; decks: KidDeckDto[]; session: SessionDto; tasks: readonly (TaskDto | null)[]; attempts?: readonly AttemptDto[]; disclosure?: DisclosureDto; presentation?: PresentationCompletionDto; summary?: SessionSummaryDto; mockSummary?: MockTestSummaryDto; feedbackAudio?: FeedbackAudioDto }` (typy z `@learning/contracts`). `installKidUiFixture(page: Page, fixture: KidUiFixture): Promise<void>` i `assertKidLayout(page: Page, options?: {allowDetailsScroll?: boolean}): Promise<void>`; helper obsługuje GET profiles/decks, POST sessions/next/attempts/disclosures/complete-presentation/end, GET attempt do pollingu, GET mock-test-summary oraz POST feedback-audio zgodnie z `api/client.ts`, obserwacje events jako 204. `tasks` to kolejka; null oznacza terminalny next→204, a po wyczerpaniu kolejki test dostaje jawny błąd. `attempts` to kolejka POST/GET odpowiedzi, pozwalająca zasymulować processing→completed bez lokalnej oceny. Brak wymaganej odpowiedzi fixture powoduje jawny błąd testu, nie domyślny sukces. Publiczne DTO walidować odpowiednim schematem Zod podczas setupu; TTS/obrazy testowe można obsłużyć syntetycznym zasobem, nigdy nagraniem dziecka. `allowDetailsScroll` zezwala wyłącznie na opisany w spec fallback, nie na ukryte/nieosiągalne działania.

- [ ] Napisać `viewport.test.ts`: poprawne height/offsetTop, brak visualViewport, wartości 0/NaN, scale > 1.01 i powrót, fallback; oraz E2E `session frame remains inside visible viewport after resize` i `pinch zoom fallback preserves input and reachable actions`, sprawdzające rzeczywiste bounding boxes i możliwość działania. Syntetyczne visualViewport.scale testuje wyłącznie reakcję UI; fizyczny gest należy do Zadania 7.

Przykładowa wiążąca asercja jednostkowa (bez implementacji algorytmu):

```ts
expect(computeKidViewport({ innerHeight: 700, visualViewport: { height: 350, offsetTop: 24 } }))
  .toEqual({ height: 350, offsetTop: 24, zoomed: false });
expect(computeKidViewport({ innerHeight: 700, visualViewport: null }))
  .toEqual({ height: 700, offsetTop: 0, zoomed: false });
expect(computeKidViewport({ innerHeight: 700, visualViewport: { height: 350, offsetTop: 24, scale: 2 } }))
  .toEqual({ height: 700, offsetTop: 0, zoomed: true });
```

- [ ] Uruchomić RED: `npx --yes pnpm@10.34.6 test:unit packages/kid-ui/src/layout/viewport.test.ts` i `test:e2e tests/e2e/kid-ui-layout.spec.ts -g "session frame|pinch zoom"`; zapisać oczekiwaną przyczynę porażki. Ten sam filtr obowiązuje późniejsze GREEN Zadania 1.
- [ ] Zaimplementować wskazane interfejsy; wszystkie tokeny ze spec pod selektorem Kid UI, media query motywu i bez globalnego CSS rodzica. Bez bibliotek ikon. Dodać style ramy i prawidłowy progress/remaining, bez stałych wartości z makiety.
- [ ] Ustawić `viewport-fit=cover` / wspierany w zainstalowanym Next wariant viewportu dziecka w obu layoutach, z `interactiveWidget: 'resizes-content'` jako pomocą dla Chromium; nie zakładać, że to zastępuje visualViewport ani zmieniać viewportu rodzica. Zachować `/` i `/kids/[childId]/learn`.
- [ ] Uruchomić GREEN tych samych testów, `test:e2e tests/e2e/navigation.spec.ts`, `typecheck`; potwierdzić powrót do rodzica i brak utraty wartości pola przy resize. Zapisać dowody, commit `feat: add responsive kid session frame` tylko z plikami tego zadania.

## Zadanie 2: Instrukcja, wybory i prezentacja materiału

**Pliki:** nowe `exercise-presentation.ts`, `.test.ts`, `ExerciseFrame.tsx`; modyfikacje `ExerciseView.tsx`, `ExposureView.tsx`, `ListeningView.tsx`, `ReadingView.tsx`, `Visual.tsx` tylko gdy niezbędny styl, `styles.css`, `messages.ts`, `kid-ui-layout.spec.ts`.

**Interfejsy:**

- `getExercisePresentation(task: TaskDto): {instruction: string; icon: KidIconName}` — dokładnie instrukcje tabeli §4 spec, z `messages.kid`, bez wydobywania prywatnej odpowiedzi.
- `ExerciseFrame({task, content, actions, secondaryActions}: {task: TaskDto; content: ReactNode; actions?: ReactNode; secondaryActions?: ReactNode}): ReactElement`. Jest wspólną kompozycją instrukcji, elastycznego materiału i stref akcji w ramie z Zadania 1; późniejsze widoki nie dodają własnych nagłówków instrukcji. `actions`/`secondaryActions` są przekazanymi elementami, nie nowymi handlerami.

- [ ] Dodać jednostkowy test mapowania wszystkich 8 rodzajów oraz browser RED: `instruction is separated from material for every prompt`, `listening shows a named icon button without answer disclosure`, `exposure keeps image and both audio actions visible`, `long options remain readable and selectable`.
- [ ] Uruchomić nowe testy przed implementacją; potwierdzić RED dotyczący układu lub dostępnych nazw.
- [ ] Wdrożyć frame oraz cztery rodzaje w trzech View: exposure/listening/reading/reverse_recognition. Odsłuch 96/48 px w zadaniu listening, małe odsłuchy przy słowie/przykładzie; obraz dostosowuje się do wysokości przez contain, bez nowej generacji i bez ucinania znaczącej części. Zachować wszystkie opcje, stable ids i handlers.
- [ ] Zachować polskie etykiety w `messages.ts`; instrukcja bez tła/ramki, osobno od słowa. Obraz/symbol tylko z odpowiedniego promptu. Nie dodawać obrazka w listening/recall ani domyślnych ikon znaczenia na podstawie tytułu.
- [ ] GREEN mapowania/macierz UI, istniejące `Visual.test.ts`, E2E exposure i ujawnień z `kid-flow.spec.ts`, `typecheck`. Sprawdzić błąd obrazka, brak obrazu, number/color/sequence, tekst 120 i przykład 300 znaków. Commit `feat: redesign kid instructions and recognition tasks`.

## Zadanie 3: Pisanie, klawiatura i nagrywanie

**Pliki:** `WrittenView.tsx`, `LetterCompletionView.tsx`, `SpeechView.tsx`, `SpeechRecordButton.tsx`, `styles.css`, `kid-ui-layout.spec.ts`, `speech-recording-ux.spec.ts`; istniejące testy gestu/kontrolera.

**Interfejsy:** użyć frame Zadania 2 i obecnego `ExerciseProps`/`ExerciseHandlers`; brak nowego API. Zachować `key={task.taskId}` dla resetowania nowego zadania, nie kluczować po rozmiarze viewportu/feedbacku. `recordingMode` pozostaje z profilu.

- [ ] Dodać RED `written and letter inputs preserve value during viewport shrink`, `all written actions stay reachable at height 350`, `speech supports profile hold and toggle without a child mode picker`, `long word keeps complete answer available`. Asercje: prompt/pole/check w widocznym viewport; nieutracony wpis i wszystkie luki; istniejące secondary actions osiągalne; brak autokorekty/spellcheck/capitalization.
- [ ] Potwierdzić RED w `test:e2e tests/e2e/kid-ui-layout.spec.ts -g "written|letter|speech"`; nie traktować wirtualnego resize jako dowodu działania fizycznej klawiatury.
- [ ] Przenieść cztery rodzaje w trzech View do frame; uporządkować check/record/secondary actions. Dopasować obraz i odstępy do wysokości, nie zmniejszać pól dotykowych. W speech zachować przygotowanie, starting/recording/stopping, wskaźnik poziomu i instrukcję gestu.
- [ ] Zastąpić emoji sterujące `KidIcon` bez zmiany obsługi pointer capture, release podczas starting, cancel/blur/visibility/unmount, limitów i keyboard activation. Nie dodawać przełącznika hold/toggle w UI dziecka.
- [ ] GREEN nowych testów i istniejących `recording-gesture.test.ts`, `session-controller.test.ts`, `test:e2e tests/e2e/speech-recording-ux.spec.ts`, `typecheck`. Ręczny smoke w emulacji touch; commit `feat: fit written and speech tasks to mobile viewport`.

## Zadanie 4: Wynik w ramie, bez dopisywania wysokiej karty

**Pliki:** nowy `screens/AnswerFeedback.tsx`; `LearnScreen.tsx`, `SpeechFeedbackCard.tsx`, `styles.css`, `messages.ts`, testy UI; po zastąpieniu użycia usunięcie `FeedbackDialog.tsx`.

**Interfejsy:** `AnswerFeedback({dto, retry, busy, onNext}: {dto: FeedbackDto | null; retry: boolean; busy: boolean; onNext: () => void}): ReactElement`; ton i tekst z dotychczasowego mapowania feedbacku, bez oceny po stronie klienta. `SpeechFeedbackCardProps` i `describeSpeechFeedback` zachowują obecny sens.

- [ ] RED: `correct choice stays readable with success and next action`, `written feedback closes keyboard without losing result`, `speech feedback replaces central material and preserves reference actions`, `speech feedback preserves content grade separately from pronunciation`, `mock test does not reveal solution after submission`. Czwarty test zawiera: `great` + wymowa unavailable → dotychczasowa pochwała treści i osobna awaria; `content_matched` + speech matched → „To właściwe słowo.” i obecny ton treści bez „Świetnie!”; `not_assessed` + uncertain → neutralnie. Dodać długie fragmenty/legendę i error audio; expected actions na ekranie.
- [ ] Uruchomić nowe E2E i jednostki tonu/opcji/mapowania mowy; potwierdzić oczekiwany RED.
- [ ] Osadzić wynik wyboru/pisma w strefie wyniku. Poprawna opcja zachowuje kontrast, ✓ i stan disabled bez opacity. Wynik pisma zamienia dialog na część ramy; autofocus opuszcza input, nie wysyła odpowiedzi. Focus management i announcement są jawne, a nie oparte na `scrollIntoView` dużej karty.
- [ ] Przy wyniku mowy renderować `SpeechFeedbackCard` w centralnej części zamiast powielania obrazu i wszystkich pierwotnych akcji. Zachować heardText gating, wzorzec, semantykę fragmentów, legendę, dostępne retry/skip/next i reference audio. Scrollować tylko długie szczegóły, pozostawiając działania widoczne.
- [ ] Zachować widoki neutralnych awarii, ujawnienia i mock `answerSaved`. Usuń tylko niepotrzebny dialog oraz scroll/blokadę body wynikającą z jego starego użycia, nie obsługę awarii/ekspozycji.
- [ ] Dostosować istniejący test `tests/e2e/kid-flow.spec.ts` „popup wyniku mieści się w ekranie telefonu bez przewijania”, zaczynający się około linii 415: zastąpić wymaganie `body.style.overflow === 'hidden'` i modalnej izolacji focusu asercjami osadzonego wyniku, zamknięcia klawiatury i dostępnej akcji. Zachować przypadki długiej treści, retry, utraty sieci i odzyskiwania; nie usuwać testu dla uzyskania GREEN.
- [ ] GREEN nowych E2E oraz `option-outcome.test.ts`, `feedback-tone.test.ts`, `speech-feedback-view.test.ts`, `test:e2e tests/e2e/mock-test.spec.ts tests/e2e/speech-recording-ux.spec.ts`, `typecheck`. Commit `feat: keep kid feedback and next actions visible`.

## Zadanie 5: Karty zestawów i stały mikrofon

**Pliki:** nowe `deck-presentation.ts`, `.test.ts`, `kid-decks-layout.spec.ts`; `DeckScreen.tsx`, `KidApp.tsx`, `styles.css`, `messages.ts`; helpers fixture.

**Interfejsy:**

- `buildDeckPages(decks: readonly KidDeckDto[], cardsPerPage: 1 | 2): readonly {kind: 'recommended' | 'other'; decks: readonly KidDeckDto[]}[]` — stable grupy i kolejność, pusty input daje pustą listę; nie mieszać grup w stronie.
- `formatDeckTestDate(date: string | null, currentYear: number): string | null` — date-only, polskie skróty, bieżący rok pominięty, inny widoczny, null/niepoprawna data daje null. Rok bierze render z bieżącej daty rodziny/hosta, nie UTC parsowania terminu; testy podają rok jawnie.
- Dotychczasowe sygnatury `DeckScreen` i jego `onStart`/`onMockTest`/toggle/headerActions pozostają bez zmiany.

- [ ] RED jednostek: polecane/pozostałe i kolejność; 0/1/2/4 zestawy; strony; null/invalid/leap date, rok, strefy Europe/Warsaw/America/Los_Angeles z tym samym dniem. RED E2E: `deck card actions address the same deck`, `all assigned decks remain reachable`, `unavailable mock test is omitted`, `empty and denied microphone states permit recovery`, `page is clamped after deck list changes`.
- [ ] Uruchomić jednostki oraz `test:e2e tests/e2e/kid-decks-layout.spec.ts` przed kodem i zapisać RED.
- [ ] Wdrożyć Karty zestawów: header/link rodzica, powitanie, polecane/pozostałe, karta z dwiema oddzielnymi akcjami bez zagnieżdżonych buttonów; prawdziwa data/liczba. Do dwóch zestawów użyć stron o maksymalnie dwóch kartach, przy większej liście jedna karta na stronę w telefonie. Zachować dostęp do wszystkich grup oraz ograniczać stronę po zmianie danych.
- [ ] Przenieść dostępny przełącznik microphone do dolnej części, zachowując preferencję urządzenia i tekst odmowy. Nie wymuszać getUserMedia na samym renderze i nie zmieniać recordingMode. Istniejący rodzic link prowadzi do tej samej autoryzowanej trasy.
- [ ] GREEN jednostek/menu E2E, `test:e2e tests/e2e/navigation.spec.ts tests/e2e/mock-test.spec.ts`, `typecheck`. Sprawdzić długą nazwę i font 200%, aktywną sesję/konflikt oraz wszystkie karty; commit `feat: redesign kid deck selection as grouped cards`.

## Zadanie 6: Spójność pozostałych ekranów i regresje przepływu

**Pliki:** `ProfileScreen.tsx`, `SummaryScreen.tsx`, `MockTestSummaryScreen.tsx`, `KidApp.tsx`, `styles.css`, wybrane istniejące E2E, `kid-ui-layout.spec.ts`. Bez nowej logiki raportów.

**Interfejsy:** `KidPage(mode='flow')` dla list i długich podsumowań; istniejące props/handlery ekranów pozostają. Ekrany krótkiej decyzji mogą użyć ograniczonej ramy tylko jeśli wszystkie działania mieszczą się również w fallbacku dostępności.

- [ ] Dodać RED smoke `profile, ready, conflict and summary retain reachable navigation under new theme`, z długim podsumowaniem i 200% fontem. Asercje obecnych informacji, przeglądania całego raportu, powrotu, start/cancel/resume; nie wymuszać zero scrolla na raporcie.
- [ ] Potwierdzić RED, następnie dostosować wyłącznie powierzchnie, ikony i przyciski do tokenów. Nie przepisywać `computeMockTestScore` ani tekstów o samodzielnym postępie. Sprawdzić rodzica po powrocie: tło, formularze, scroll, viewport i focus niezależne od Kid UI.
- [ ] Uruchomić pełną macierz nowych UI E2E oraz istniejące `kid-flow`, `navigation`, `mock-test`, `speech-recording-ux`, `learning-algorithm`, `privacy`, `parent-flow`; przejrzeć trace off dla przypadków audio. Bez zapisywania prywatnego nagrania ani dodawania testowej syntezy wyniku po stronie klienta.
- [ ] Uruchomić `test:unit`, `test:integration`, `typecheck`, `build` zgodnie z istniejącymi skryptami. R01/R04/R05/R07: wskazać konkretne istniejące przypadki i dowody ujawnień/reload/budżetu/wariantu. R02/R03/R06 nie są implementowane ponownie; istniejący pełny integration chroni media, niezmienność i usuwanie profilu.
- [ ] Zapisać wyniki i ograniczenia osobno dla jednostek, PostgreSQL, E2E, kompilacji. Commit `refactor: align kid navigation screens and verify regressions`.

## Zadanie 7: Odbiór urządzenia, dokumentacja i niezależne review

**Pliki:** nowe `docs/superpowers/reviews/2026-10-11-kid-ui-redesign.md`, dziennik implementacji; aktualizacja `docs/SPEC.md`, `architecture.md`, `folder-structure.md`, `implementation-plan.md` tylko w obszarze layoutu/UX i testów; `docs/schema.sql` bez zmian.

**Interfejsy:** paczka review obejmuje spec, plan, pełny `BASE_SHA..HEAD_SHA`, niezacommitowany diff i dowody; device checklist zawiera tylko parametry środowiska/obserwacje, nie prywatne treści dzieci.

- [ ] Przeprowadzić próbę Galaxy S25 według §6 spec z realnymi wartościami viewportu. Zapisać browser/PWA/paski/klawiaturę/hold/toggle i wszystkie rodzaje; jeżeli sprzęt niedostępny, oznaczyć odbiór jako niewykonany i uzgodnić sposób jego uzupełnienia, bez deklaracji gotowości na S25.
- [ ] Zaktualizować dokumentację architektury pod nową ramę, zapisany wyjątek dostępności i granice flow/session. Nie zmieniać historycznych kontraktów modelu danych. `git diff --check` oraz kontrola odnośników.
- [ ] Wykonać self-review pokrycia spec i checklisty; przygotować paczkę `requesting-code-review` całej gałęzi. Dedykowany recenzent używa jawnie najbardziej zaawansowanego dostępnego modelu z wykluczeniem GPT Astra. Review nie deleguje implementacji ani nie uruchamia następnych recenzentów.
- [ ] `receiving-code-review`: zweryfikować każdą uwagę, naprawić Critical/Important z dowodem RED→GREEN dla zachowania, uzasadnić odrzucenia, zapisać Minor. Ponownie review tylko poprawek i ich wpływu, gdy potrzebne.
- [ ] `verification-before-completion`: świeże adekwatne komendy po ostatnich zmianach, spójny zakres diffu, brak materiałów/sekretów testowych w commicie. Nie uruchamiać kolejnych pełnych suite bez nowych zmian/uwag.
- [ ] `finishing-a-development-branch`: push gałęzi i PR do main z opisem finalnej funkcji, niezależnym review i rzeczywistymi wynikami/lukami urządzenia. PR załączyć do zadania. Nie scalać; właściciel używa squash. Worktree pozostaje do iteracji PR.

## Kryterium zamknięcia

Wszystkie zadania mają dowody; cały uzgodniony zakres został niezależnie oceniony; poprawki Critical/Important rozwiązane; istnieje PR do main; odbiór S25 jest wykonany lub wyraźnie oznaczony jako brak, bez udawania pełnego ukończenia celu urządzenia. Plan wymaga oceny właściciela przed wykonaniem i nie stanowi dowodu gotowej aplikacji.

## Polecenia weryfikacji

Skróty `test:e2e`, `typecheck` itd. w zadaniach oznaczają istniejące skrypty uruchamiane przez poniższy przypięty pnpm; ścieżki i `-g` z danego kroku przekazać po nazwie skryptu. E2E uruchamia istniejący global setup PostgreSQL/web/worker z fake-providerami, nie produkcję.

```powershell
npx --yes pnpm@10.34.6 test:unit
npx --yes pnpm@10.34.6 test:integration
npx --yes pnpm@10.34.6 test:e2e tests/e2e/kid-ui-layout.spec.ts tests/e2e/kid-decks-layout.spec.ts
npx --yes pnpm@10.34.6 test:e2e tests/e2e/kid-flow.spec.ts tests/e2e/navigation.spec.ts tests/e2e/mock-test.spec.ts tests/e2e/speech-recording-ux.spec.ts tests/e2e/learning-algorithm.spec.ts tests/e2e/privacy.spec.ts tests/e2e/parent-flow.spec.ts
npx --yes pnpm@10.34.6 typecheck
npx --yes pnpm@10.34.6 build
git diff --check
```
