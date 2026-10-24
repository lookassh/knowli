# Plan implementacji responsywnego Kids UI w Mantine

> Szczegółowy plan wykonania według `superpowers:writing-plans`: [2026-10-24-kid-ui-mantine.md](../../docs/superpowers/plans/2026-10-24-kid-ui-mantine.md). Ten dokument pozostaje specyfikacją celu, zachowania i odbioru; realizację prowadzić według zadań w nowym planie.

Data: 2026-10-24. Status: realizacja rozpoczęta; szczegółowy status zadań w `docs/superpowers/plans/2026-10-24-kid-ui-mantine.md`.

## 1. Cel i baza pracy

Wdrożyć w produkcyjnym `packages/kid-ui` wygląd zaakceptowanej makiety Mantine, z reużywalnym układem `KidScreen.Header`, `KidScreen.Content`, `KidScreen.Actions`, na rzeczywistych danych i istniejących przypadkach użycia Knowli.

- Worktree: `C:\Users\looka\.codex\worktrees\kid-ui-mantine\knowli`.
- Lokalny branch: `feature/kid-ui-mantine`.
- Baza: aktualne po `git fetch origin main` `origin/main`, commit `c8758e8827c2045c4af3872be32ecdbe84aed8a1` — „Pokaż dziecku zatwierdzony czas nauki (#113)”.
- Referencja: `C:\Users\looka\.codex\worktrees\0f7c\knowli\.planning\sketches\002-kid-mantine-flutter`.
- Podgląd referencji: `http://192.168.50.20:5180/?variant=A&screen=profile`. Dostępność serwera nie jest warunkiem realizacji — źródła referencji są lokalne.
- Bazą wizualną jest A „Spokojna noc”: granat, błękitne akcenty, Manrope, duże karty, mało dekoracji. B/C i eksperyment Material 3 pozostają makietami; nie dokładamy użytkownikowi ustawień wariantów ani wyboru biblioteki.

Wcześniejsze worktree, makiety i procesy innych sesji pozostają odrębne. Ten plan nie autoryzuje push, PR, merge ani deploy. Kolejny krok po uzgodnieniu planu to realizacja etapu 1.

## 2. Wiążące ustalenia zachowania

1. **Kliknięcie odpowiedzi/kafelka natychmiast wysyła odpowiedź.** Nie dodajemy potwierdzenia „Sprawdź” po wyborze, lokalnego bufora wyboru ani dodatkowego etapu. Dotyczy też wyborów w lekcjach i kartkówkach, zgodnie z aktualnym handlerem.
2. W oczekiwaniu pokazujemy neutralnie wybraną opcję i blokujemy kolejne wysyłki. Werdykt pochodzi wyłącznie z API. Po pomyłce pozostają opcje oraz dotychczasowa możliwość ponowienia.
3. „Sprawdź” pozostaje w zadaniach pisemnych, lukach i układaniu odpowiedzi, tam gdzie jest dzisiaj. Zachowujemy Enter oraz skróty wyboru, focus i blokady `busy`.
4. „Nie pamiętam”, „Pomiń”, odsłuch i zakończenie wywołują istniejące handlery. Nie dodajemy ogólnej podpowiedzi ujawniającej treść ani dialogu końca tylko dlatego, że występowały w demonstracji.
5. Parametry, liczba zadań, pozostały budżet, cele kartkówki i wynik pochodzą z serwera. Makietowe „6 pytań”, 62,5% postępu, przykładowe odpowiedzi, „+4 pkt” i lokalny klucz nie trafiają do aplikacji. Przy nieznanym całkowitym budżecie pokazujemy prawdziwe „Jeszcze N” zamiast wymyślonego procentu.
6. Zachowujemy aktualne zasady mikrofonu, automatycznego startu po uzyskanej zgodzie, trybu profilu hold/toggle, ręcznej próby i retry. Rozpoznanie, wymowa, cisza i awaria pozostają odrębnymi stanami. Nagrania nie są zapisywane ani logowane.
7. Publikowane ilustracje i audio dostarcza `MeaningVisualView`/adapter mediów po autoryzacji. Dekoracyjny kot z makiety nie zastępuje znaczenia słowa ani wszystkich okładek. Awatar respektuje `avatarKey`, a profile i zestawy mają rzeczywiste nazwy i identyfikatory.
8. Zachowujemy ukończenie ekspozycji bez próby, samodzielność i skutki ujawnień. UI nie ocenia odpowiedzi i nie obchodzi istniejących blokad/routingu.
9. Podsumowanie pojawia się od razu. Stan aktywności i punktów aktualizuje się istniejącym odczytem, związanym z dzieckiem i sesją; brak drugiej wysyłki raportu przy rerenderze, zmianie motywu czy profilu.
10. Zachowujemy zmianę #113: zatwierdzony czas nauki (minuty i sekundy, bez zaokrąglania w górę), osobny stan niedostępności, rzeczywiste punkty. Brak danych nie oznacza zera.

## 3. Aktualne punkty integracji

| Obszar | Istniejące pliki | Zamierzona zmiana |
|---|---|---|
| Składanie widoków i sesja | `packages/kid-ui/src/KidApp.tsx`, `session/useLearningSession.ts`, `session/session-controller.ts` | Provider i prezentacja; kontroler nadal zarządza zachowaniem |
| Viewport | `layout/KidPage.tsx`, `layout/viewport.ts` i jego testy | Zachować jeden mechanizm wysokości, offsetu i fallbacku zoom; nie kopiować globalnego hooka z makiety |
| Rama zadania | `exercises/ExerciseFrame.tsx`, `screens/LearnScreen.tsx` | Przebudować prezentację na `KidScreen`, zachowując znaczenie slotów i propsów |
| Dyspozytor ćwiczeń | `exercises/ExerciseView.tsx`, `exercises/types.ts` | Zachować wyczerpujące rozgałęzienie po prompt.kind i handlery |
| Profile i materiały | `screens/ProfileScreen.tsx`, `screens/DeckScreen.tsx`, `screens/deck-presentation.ts` | Nowe karty i układ z bieżących DTO; rekomendacje, inne zestawy, wznowienie, terminy, gwiazdki |
| Feedback i mowa | `screens/AnswerFeedback.tsx`, `screens/SpeechFeedbackCard.tsx`, `exercises/SpeechRecordButton.tsx` | Spójne komponenty wizualne bez zmiany gestów i wiarygodności wyniku |
| Wyniki | `screens/SummaryScreen.tsx`, `MockTestSummaryScreen.tsx`, `LessonMockTestSummaryScreen.tsx`, `SessionActivityResultView.tsx` | Motyw i layout, bez blokowania wyników i utraty zatwierdzonego czasu |
| Host Next | `apps/web/src/kid/KidLearningHost.tsx`, `app/(kid)/layout.tsx`, `app/kids/layout.tsx` | Import stylów/fontów i integracja klientowa; istniejący viewport wyłącznie na trasach dziecka |
| Wspólne teksty | `packages/contracts/src/messages.ts` | Ewentualne nowe polskie etykiety w istniejącym katalogu, bez zmiany DTO |

`KidPage` już rozróżnia naturalny przepływ od sesji. Nie zastępujemy tego bezwarunkowym `height: 100vh`, globalnym `overflow: hidden` ani mechanizmem z demonstracji.

## 4. Docelowe komponenty

Proponowane ścieżki (mogą zostać dopasowane do istniejących nazw bez tworzenia drugiej równoległej warstwy):

```text
packages/kid-ui/src/
  theme/
    KidThemeProvider.tsx
    kid-theme.ts
    kid-theme.module.css
    mantine.css
  layout/
    KidPage.tsx                 # istniejący właściciel viewportu
    viewport.ts                 # istniejące wyliczenia i testy
    KidScreen.tsx
    KidScreen.module.css
  components/
    ActionButton.tsx
    AnswerGrid.tsx
    AnswerTile.tsx
    AnswerField.tsx
    SessionProgress.tsx
    ProfileCard.tsx
  exercises/
    ExerciseFrame.tsx           # adapter istniejącego kontraktu na nową ramę
    ...                        # istniejące widoki ćwiczeń
```

- Provider, tokeny i komponenty należą do przenośnego `@learning/kid-ui`, bez Next.js i serwera w importach.
- Mantine `factory`, kontekst i Styles API służą jednemu zestawowi komponentów z możliwością theme/defaultProps, a nie osobnej bibliotece ogólnego przeznaczenia.
- `KidScreen` obsługuje tryb sesji i zwykłego widoku, nie tworzy drugiego właściciela viewportu. Nie kluczujemy go wysokością, breakpointem, liczbą opcji ani stanem feedbacku.
- `Header`: nawigacja/status oraz instrukcja/postęp. `Content`: materiał i wynik. `Actions`: stały główny i pomocniczy slot. Wynik wyboru rezerwuje swoją przestrzeń w Content; wynik tekstowy używa obszaru materiału.
- `ExerciseFrame` zachowuje swoje obecne propsy (`content`, `actions`, `secondaryActions`, `result`, `resultActions`, `reserveResult`) jako adapter podczas migracji. Ustalić jedno miejsce renderowania Header; nie dublować paska i instrukcji między LearnScreen a ćwiczeniem.
- `AnswerGrid` renderuje 3/4 opcje w dwóch kolumnach; trzecia pozostaje w lewej kolumnie. Kafelek jest semantycznym przyciskiem, z polską nazwą dostępną i stanami pending/correct/wrong. `onChoose` bezpośrednio uruchamia `handlers.onAnswerChoice`.
- `ActionButton` ujednolica wielkość, priorytet i stan oczekiwania, zachowując ref, focus i gesty. Nie owijamy każdego prymitywu Mantine bez potrzeby.
- `Question` nie zna klucza odpowiedzi. Buduje bodziec wyłącznie z dozwolonego promptu; istniejące lokalizowane instrukcje i `MeaningVisualView` pozostają źródłem treści.
- Formatowanie zwykłego TypeScript/JSX i CSS Modules, bez skompresowanych kilkusetznakowych linii demonstracji, globalnych selektorów `.mantine-Button-root` i `!important` jako strategii migracji.

Przykład docelowej kompozycji wyboru (schemat, nie gotowy plik):

```tsx
<KidScreen mode="session">
  <KidScreen.Header>
    <SessionProgress remaining={remaining} />
    <ExerciseInstruction task={task} />
  </KidScreen.Header>
  <KidScreen.Content>
    <Question task={task} />
    <AnswerGrid
      options={options}
      outcomes={optionOutcomes}
      disabled={busy}
      onChoose={handlers.onAnswerChoice}
    />
    <AnswerFeedback feedback={feedback} />
  </KidScreen.Content>
  <KidScreen.Actions>
    <div data-slot="primary">{resultActions}</div>
    <div data-slot="secondary">{secondaryActions}</div>
  </KidScreen.Actions>
</KidScreen>
```

W tym przykładzie **nie ma przycisku zatwierdzania wyboru**. Dla pisania Content zawiera `AnswerField`, a Actions „Sprawdź” i obecne akcje pomocnicze. Docelowa implementacja musi zachować osobne sloty obu rodzajów akcji, także gdy główna jest pusta przed oceną wyboru.

## 5. Etapy realizacji

### Etap 1 — zależności, motyw, izolacja i rama

Pliki: `packages/kid-ui/package.json`, jego peer/dev deps, `apps/web/package.json` w niezbędnym zakresie, `pnpm-lock.yaml`, `theme/*`, `layout/KidScreen*`, style wejściowe i host.

1. Na początku skopiować potrzebne tokeny, font i licencję z referencji do docelowych źródeł; nie importować niczego z `.planning` w runtime. Nie kopiować Vite, katalogu makiet, fixture, demonstracyjnego oceniania ani ustawień 3 wariantów.
2. Przypiąć `@mantine/core` i `@mantine/hooks` do wspólnej wersji 9.7.3 użytej w referencji. Zweryfikowano peer deps: React/React DOM `^19.2.0`, hooks dokładnie `9.7.3`. Lock bazy ma React/React DOM 19.3.0; wyrównać deklarowane peer/dev zakresy kid-ui z faktycznym wymaganiem, zadeklarować React DOM jako peer, nie instalować drugiej kopii Reacta. Sprawdzić to `pnpm why react react-dom` i typecheckiem.
3. Jeden `KidThemeProvider` na część dziecka, stały wrapper i zakres zmiennych `.kid-theme`. Polski interfejs, wymuszony ciemny motyw, self-hostowany font z OFL i fallback. Nie wymuszać color-scheme na całym `<html>` wspólnym z panelem rodzica.
4. **Osobno rozwiązać globalny CSS Mantine.** Sam provider nie izoluje resetu `body`, `:root`, `button`, `input`. Wybrać importy stylów komponentów i minimalną bazę ograniczoną do części dziecka po inspekcji zależności CSS. Użyć kontrolowanej kolejności/warstw CSS. Nie pomijać wymaganych stylów prymitywów. Portale tooltipów/dialogów renderować we właściwym kontenerze motywu albo jawnie zapewnić im te same zmienne. To pierwszy punkt weryfikacji, zanim zacznie się przenoszenie ekranów.
5. Zapewnić obsługę obu tras hosta (`/` i `/kids/{childId}/learn`) bez zmiany ich publicznych URL, metadanych, PWA ani autoryzacji. Kid-ui ma działać także poza hostem Next.
6. Zbudować `KidScreen` nad obecną obsługą viewportu; w tym etapie sprawdzić długą treść, pusty główny slot, klawiaturę, zoom, safe-area i stan SSR/hydration.

Warunek ukończenia: typy i build przechodzą, szkielet działa na fake fixture, nie ma błędów hydration/ResizeObserver ani skakania, a wygląd panelu rodzica jest taki sam przed wizytą u dziecka i po powrocie. Szczególnie sprawdzić nawigację klientową z pozostającymi w pamięci stylesheetami.

### Etap 2 — pionowy fragment: pisanie i wybór obrazka

Pliki: `WrittenView`, `PictureListeningView`, `LearnScreen`, `ExerciseFrame`, `AnswerGrid/Tile/Field/ActionButton` i feedback.

1. Dodać najpierw znaczące testy regresji: pojedynczy tap → dokładnie jedna próba, neutralny pending, brak lokalnego werdyktu, blokada kolejnych tapów i zachowanie opcji; wpis → Enter/Sprawdź → odpowiedź → retry bez utraty draftu przy resize.
2. Odtworzyć styl A na tych dwóch ćwiczeniach, podpinając istniejące `ExerciseHandlers`, media i kontroler. Zostawić `useChoiceKeyboard`, refy, dostępne nazwy, autofocus i cooldown w odpowiednich miejscach.
3. Wprowadzić adapter ExerciseFrame; można już migrować wspólną ramę wszystkich ćwiczeń, ale ich istniejąca zawartość musi pozostać działająca i nadal dostawać potrzebne style do czasu własnego etapu.
4. Sprawdzić nie tylko sukces, ale także pomyłkę, „Nie pamiętam”, pominięcie, retry, offline, błąd wysyłki i błąd audio.

Warunek ukończenia: dwa prawdziwe ćwiczenia działają z API, kontroler zachowuje kontrakt, wszystkie cztery obrazki są widoczne na 360 × 640 przy normalnym powiększeniu, a pisanie działa z ograniczoną wysokością.

### Etap 3 — słówka, obrazki i mowa

Pliki: pozostałe `exercises/*View.tsx`, `MeaningVisualView`, `SpeechRecordButton`, `SpeechFeedbackCard`, `AnswerFeedback`.

- Przenieść ekspozycje, tekstowe wybory, recall/spelling, luki i wszystkie typy obrazkowe.
- Zachować identyfikator zadania jako granicę resetu; ukrycie/wymiana treści na wynik i zmiana wysokości nie resetują literek, pól ani wybranego stanu.
- Mowę przenieść wizualnie bez zmiany rejestratora, VAD, sygnałów start/stop, przejęcia gestu i zwalniania zasobów. Dla niskiego viewportu nie przenosić nagrywania pisemnej odpowiedzi do głównego slotu kosztem stabilności „Sprawdź”.
- Odsłuchy instrukcji i materiału zachowują autoryzację, błąd, retry oraz przerwanie nagrywania. Rodzic/AI/konfiguracja nie pojawiają się w zadaniu.

Warunek ukończenia: pełny cykl wszystkich typów słownictwa, dostępność bez mikrofonu, brak fałszywych błędów wiedzy przy ciszy/niepewności/awarii, R04 i R07 nadal spełnione.

### Etap 4 — lekcje i kartkówki

Pliki: `exercises/lesson/*`, ekran gotowości kartkówki, oba podsumowania i ich helpery.

- Przenieść karty, zauważanie, wybory, krótkie odpowiedzi, układanie bloków, luki, poprawianie i przekształcanie zdań, odpowiedzi otwarte.
- Układanie korzysta z prawdziwych ID bloków i `onAnswerSequence`, nie tablicy słów z makiety. Limity i walidacja pól odpowiadają aktualnemu API.
- Zachować różnice przedmiotów, konfigurowalne audio i wyłączenie target audio w gramatyce. Nie dodawać makietowego głośnika do ćwiczenia, które nie ma wydanego audio.
- Kartkówka ma rzeczywistą konfigurację/budżet i brak bieżącego werdyktu. Wybór nadal wysyła się natychmiast. Omówienie, rozwiązania, odsłuchy, ładowanie i ponowienie szczegółów korzystają z aktualnych kontraktów i autoryzacji.

Warunek ukończenia: pełne testy lekcji i obu kartkówek przechodzą, nie dodano lokalnego oceniania ani wywołań modelu przez nowy UI.

### Etap 5 — profile, zestawy i podsumowanie

Pliki: `ProfileScreen`, `DeckScreen`, oba podsumowania, `SummaryScreen`, `SessionActivityResultView`, `KidApp`, istniejące prezentery.

- Karty profili mają rzeczywiste awatary, oznaczenie nieczytającego dziecka i punkty; start od wyboru profilu zachowany także dla jednego dziecka.
- Zestawy zachowują rekomendowane/inne, wszystkie przypisania, okładki, gwiazdki, terminy, wznowienie/zamknięcie istniejącej sesji i dostępność kartkówki. Nie zastępować obecnej listy makietowymi 3 pozycjami ani filtrem, który ukrywa przypisany materiał.
- Stan mikrofonu nie pyta sam o zgodę. Profile i zestawy mają dostęp do rzeczywistego chronionego panelu rodzica, a nie demonstracyjnego dialogu.
- Zatwierdzony dzienny czas, czas sesji, punkty, ich niedostępność i oczekiwanie zachowują znaczenie z `origin/main` #113. Nie blokować nawigacji oceną aktywności.
- Długie listy, omówienia i ekranowe stany błędów korzystają z trybu `flow`; nie wymuszamy ich zmieszczenia na jednym ekranie.

Warunek ukończenia: wszystkie realne stany mają nową prezentację, zachowane przejścia i dane; zmiana profilu podczas oczekiwania nie miesza wyników.

### Etap 6 — regresje, cleanup, dokumentacja i review

- Usuwać stare selektory po migracji ich ostatniego konsumenta. Nie utrzymywać drugiego UI ani stale obu theme providerów. Sprawdzić importy i brak nieużywanych zależności.
- Zachować stabilne selektory testowe lub przemyślanie zaktualizować lokalizatory. Nie „naprawiać” testów przez osłabienie asercji geometrii, samodzielności, dostępności czy liczby żądań.
- Uzupełnić dokumentację architektury i struktury o nowe komponenty i Mantine. Jeżeli zmiana etykiety naprawdę zmienia znaczenie danych, wrócić do analizy kontraktu przed implementacją tej zmiany.
- Zrobić review zmian i usunąć wykryte regresje przed zgłoszeniem gotowości; sposób/niezależnego wykonawcę review dobrać w fazie wykonania do obowiązujących instrukcji. Ten plan nie uruchamia agentów.
- Oddzielnie zapisać wyniki automatyczne i odbiór fizycznego telefonu. Bez fizycznego odbioru nie opisywać S10e/PWA jako potwierdzonych.

Warunek ukończenia: spełnione kryteria poniżej, dokumentacja zgodna z kodem, brak zmian API lub jawnie wyjaśniony odstęp przed ich realizacją. Publikacja zmian i wdrożenie wymagają osobnego polecenia właściciela.

## 6. Weryfikacja i kryteria odbioru

### Testy i ich infrastruktura

- Dla zmian interakcji i układu stosować RED → GREEN: najpierw uchwycić konkretną regresję, następnie minimalna implementacja i odpowiedni zestaw kontroli.
- Obecny Vitest ma środowisko `node`; np. `screens/reward-summary.test.tsx` ręcznie wywołuje komponenty i rozwija ich drzewo. Taka metoda nie jest poprawna dla komponentów Mantine z hookami/providerem. Przenieść odpowiednie testy renderowania na prawdziwy render Reacta z providerem (SSR dla samego tekstu albo DOM dla interakcji), zachowując ich asercje zatwierdzonego czasu i punktów. Dla nowych testów DOM dodać przypięte `jsdom` i `@testing-library/react` do infrastruktury dev Vitest; użyć odrębnych plików/konfiguracji lub adnotacji środowiska, bez zmiany wszystkich testów domenowych na DOM.
- Domknąć provider/ResizeObserver/matchMedia wyłącznie w środowisku testowym, jeśli wymaga tego renderer. Testy kontrolera i domeny nadal bez przeglądarki, bazy i sieci.
- Do testów widoków używać `tests/e2e/helpers/kid-ui-fixture.ts` i fikcyjnych kontraktowo poprawnych danych. Nie kopiować mechanizmu oceniania z galerii.

### Macierz zachowania

| Obszar | Kryterium |
|---|---|
| Wybory | Tap/klawiatura → jedno żądanie, brak „Sprawdź”, neutralny pending, wynik z API, poprawne retry |
| Pisanie i luki | Enter/Sprawdź, focus, brak utraty draftu i pozycji przy resize oraz otwarciu/zamknięciu klawiatury |
| Geometria | W stałym viewporcie header, instrukcja, materiał i sloty akcji stabilne między odpowiedzią, processing, feedbackiem i retry |
| Telefony | 360 × 640, 360 × 760 oraz skrócona widoczna wysokość ok. 320–420 px; wszystkie 3/4 obrazki widoczne w zwykłym zadaniu, bez poziomego overflow |
| Tablet/desktop | 768 × 1024 i 1440 × 960; ograniczenie czytelnej szerokości, sensowne kolumny i długie listy |
| Dostępność | Touch co najmniej 44 × 44, kolejność tab, focus po zmianie zadania, aria-live, nazwy kafelków, brak informacji tylko kolorem, reduced motion, 200% tekstu/zoom |
| Ruchome UI przeglądarki | Paski adresu, offset visualViewport, orientacja i pinch zoom; fallback do flow przy zoomie, brak blokady treści przez overflow hidden |
| Mowa | Pierwsza zgoda, auto-start, retry bez auto-startu, cisza, błąd, anulowanie/przełączenie profilu; zwolnienie streamu i buforów |
| Sieć i media | Błąd, retry, brak fałszywego sukcesu offline; odsłuch wyłącznie wydanej treści |
| Wyniki | Natychmiastowe podsumowanie, async aktywność i czas #113, brak punktów przy błędzie, wynik przypięty do sessionId/childId |
| Rodzic | Bez zmian wyglądu/autoryzacji na `/parent`, również po client-side przejściu rodzic → dziecko → rodzic |
| R01/R04/R07 | Reload/dwie przeglądarki, ukończenie ekspozycji bez próby, warianty mowy; pozostałe R02/R03/R05/R06 pozostają chronione istniejącą regresją domeny/integracji |

Ważne istniejące zestawy: `kid-ui-layout.spec.ts`, `kid-layout-stability.spec.ts`, `kid-decks-layout.spec.ts`, `picture-choice-layout.spec.ts`, `picture-recognition-layout.spec.ts`, `kid-flow*.spec.ts`, `speech-recording-ux.spec.ts`, `kid-activity-lifecycle.spec.ts`, `mock-test*.spec.ts`, `lesson-kid.spec.ts`, `lesson-mock-test.spec.ts`.

### Polecenia na końcu implementacji

Wszystkie uruchamiać w nowym worktree. Definicje sprawdzono w `package.json` bazy.

```powershell
corepack pnpm test:unit
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e
git diff --check
```

W trakcie etapów uruchamiać odpowiednie małe podzbiory; na początku nie odpalać pełnego monorepo ani E2E. `test:e2e` uruchamia własny PostgreSQL/worker/web z fake providerami i wymaga dostępnego Docker/środowiska testowego. `test:integration` uruchomić w zakresie zmian i zawsze, gdy zmieni się kontroler/transport lub ujawnianie; przy zmianie wyłącznie prezentacji uzasadnić adekwatność wybranego zakresu. Brak zmian adapterów LLM nie wymaga kosztownej nowej próby prawdziwego modelu w tym zadaniu.

Odbiór ręczny: rzeczywisty Galaxy S10e w przeglądarce i PWA, niska jasność wieczorem, klawiatura otwarta/zamknięta, pola i kafelki, audio, mikrofon, rotacja i zakończenie. Zapisać wersję przeglądarki i rzeczywisty viewport. Nie wpisywać z góry 360 × 760 jako zmierzonej wartości urządzenia.

## 7. API, MCP i granice zadania

Zakładamy brak zmian endpointów, schematów DTO, bazy, schedulera, zasad samodzielności, naliczania czasu/punktów i autoryzacji. W takim zakresie adapter MCP, schemaVersion i `integrations/umiem-mcp/skills/umiem-learning/SKILL.md` pozostają bez zmian; uzasadnienie zamieścić w dzienniku/ewentualnym PR. Zmiana samego katalogu tekstów UI nie tworzy nowego kontraktu API.

Jeżeli implementacja ujawni konieczność zmiany pola, parametrów lub znaczenia danych, zatrzymać zależny fragment i ponownie ocenić API → MCP → skill zgodnie z AGENTS.md. Nie usuwać historycznych danych ani nie zmieniać reguł, aby dopasować je do scenariuszy galerii.

Poza zakresem: migracja na Flutter, aplikacja natywna, warianty B/C/D w ustawieniach, przeprojektowanie panelu rodzica, nowy backend, nowe typy ćwiczeń, offline, nowe nagrody i publiczne wystawienie instancji.

## 8. Stan przygotowania planu — rzeczywiście wykonane

- [x] `git fetch origin main`, odczyt SHA i utworzenie osobnego zarządzanego worktree.
- [x] Utworzenie lokalnego `feature/kid-ui-mantine` na wskazanym `origin/main`.
- [x] Odczyt nowego AGENTS.md, skryptów, aktualnych komponentów i odpowiednich sekcji dokumentacji.
- [x] Ujęcie zmiany #113 względem poprzedniego worktree: zatwierdzony czas i stan niedostępności.
- [x] Potwierdzenie istniejących handlerów, viewportu i natychmiastowego wysyłania wyboru.
- [x] Szybki baseline: `vitest run --config vitest.unit.config.ts packages/kid-ui/src/layout/viewport.test.ts packages/kid-ui/src/exercises/option-outcome.test.ts` — **2 pliki / 13 testów, PASS**.
- [x] Sprawdzenie peer dependencies Mantine 9.7.3 w rejestrze i oficjalnych instrukcji Next/CSS.
- [ ] Realizacja etapów 1–6 — jeszcze nierozpoczęta.
- [ ] Pełna walidacja implementacji, review i odbiór fizycznego telefonu — przyszłe sprawdzenia.

Hook post-checkout automatycznie skopiował ignorowany `.env` i zainstalował brakujące zależności istniejącego lockfile przez `corepack pnpm install --prefer-offline --frozen-lockfile`. Sekretów nie odczytywano ani nie zapisywano w tym planie. Nie wykonywano push, PR, merge, deploy ani restartu galerii.

## 9. Źródła do realizacji

- `docs/SPEC.md`: §6, §12, §14–16, §19.1, §29a, §34–36.
- `docs/architecture.md`: §5 (przenośność i responsywny układ), §19 (lekcje i przedmioty).
- `docs/folder-structure.md`: §3; `docs/implementation-plan.md`: regresje R01–R07.
- [Mantine + Next.js](https://mantine.dev/guides/next/).
- [Globalny CSS Mantine](https://mantine.dev/styles/global-styles/) — powód oddzielnej kontroli izolacji.
- [Style, zależności CSS i warstwy](https://mantine.dev/styles/mantine-styles/).
- Referencyjny `KidScreen.tsx`, `KidScreen.module.css`, `theme.ts`, `styles.css`, `catalog.ts`, font i OFL z makiety 002. Ich kod i pomiary są materiałem projektowym, nie dowodem integracji produkcyjnej.
