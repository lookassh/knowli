# Plan naprawy i optymalizacji sześciu speców E2E

Status: plan do implementacji przez GPT Luna. Ten dokument nie oznacza rozpoczęcia implementacji.

## 1. Cel, punkt wyjścia i granice

Przyspieszyć przygotowanie danych, poprawić synchronizację i zachować wartościowe dowody E2E. Nie przepisywać całego zestawu testów ani logiki aplikacji.

Analiza kodu: worktree `d5a5/knowli`, branch `feature/e2e-speed-optimizations`, HEAD `09298c23861bcdef371d29030ed9790c7f6a8fbd`. Przed implementacją sprawdzić bieżący HEAD, różnice względem świeżego `origin/main` i instrukcje AGENTS.md. Nie zakładać, że ten snapshot nadal jest aktualny; nie przełączać wspólnego checkoutu bez sprawdzenia jego użytkowników.

Czasy referencyjne z jednego zielonego przebiegu CI [39158485412](https://github.com/lookassh/knowli/actions/runs/39158485412):

| Plik | Testy | Suma czasów przypadków |
| --- | ---: | ---: |
| lesson-parent.spec.ts | 8 | 67,8 s |
| lesson-archive.spec.ts | 6 | 45,5 s |
| lesson-real-flow.spec.ts | 2 | 39,2 s |
| manual-deck-flow.spec.ts | 13 | 36,2 s |
| kid-flow.spec.ts | 10 | 64,6 s |
| parent-flow.spec.ts | 14 | 64,6 s |

To czasy całych testów, nie pomiary poszczególnych operacji. Suma nie jest czasem ściennym CI: testy znajdują się w różnych shardach. Nie obiecywać konkretnego procentu poprawy ani porównywać lokalnego Windows bezpośrednio z runnerem Linux.

### Wymagane ograniczenia

- Zachować Node/pnpm, `workers: 1`, `fullyParallel: false`, obecną liczbę shardów i domyślne opóźnienia providerów. Bun, nowe CI i zmiany produkcyjnego pollingu są poza zakresem.
- Nie usuwać asercji domeny, autoryzacji, trwałości, błędów, dwóch okien ani prawdziwego toru nagrywania w celu uzyskania lepszego czasu.
- Przygotowanie danych może pomijać UI/generowanie, jeżeli dany przypadek ich nie testuje. Sama sprawdzana operacja nadal przechodzi przez prawdziwy web/API i bazę.
- Każdy przypadek otrzymuje własne ID. Bez współdzielonej mutowalnej lekcji w `beforeAll`, usuwania cudzych profili, truncate/reset całej bazy lub zależności od kolejności testów.
- Bez nowych endpointów testowych w aplikacji. Fixture działa tylko z procesu testowego, na bazie wskazanej przez plik świata E2E.
- Nie uruchamiać `runDueGenerationWork` jako ogólnego „drain queue” obok istniejącego workera. Mógłby przejąć pracę innych testów; nie przyspieszać w ten sposób fixture'ów.
- Nie wyłączać triggerów, ograniczeń ani nie modyfikować opublikowanej treści. Nie zapisywać nagrań do plików/logów/trace.
- Zmiany API, bazy i MCP nie są potrzebne. Jeśli implementacja zaczyna ich wymagać, ograniczyć zakres i opisać przeszkodę zamiast dodawać obejście produkcyjne.

## 2. Kolejność i pomiar

1. Przygotowanie i pomiar referencyjny sześciu plików.
2. Helpery gotowych danych i logowania; najpierw fixture lekcji.
3. `lesson-archive.spec.ts`.
4. `lesson-parent.spec.ts`.
5. `parent-flow.spec.ts`.
6. `manual-deck-flow.spec.ts`.
7. `kid-flow.spec.ts`.
8. `lesson-real-flow.spec.ts`.
9. Pomiar końcowy i regresja całego E2E.

Przed uruchomieniem: sprawdzić `node_modules`; jeśli istnieje i manifesty się nie zmieniają, nie instalować. Brak `.env` uzupełnić przez `node scripts/setup-worktree.cjs --skip-install`. Odczytać aktualny `package.json`.

Nie uruchamiać pełnego monorepo jako baseline. Po wstępnym odczycie konfiguracji wykonać celowany pomiar tych sześciu plików. Polecenie bazowe:

```powershell
corepack pnpm test:e2e tests/e2e/lesson-archive.spec.ts tests/e2e/lesson-parent.spec.ts tests/e2e/parent-flow.spec.ts tests/e2e/manual-deck-flow.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/lesson-real-flow.spec.ts
```

Osobny przebieg otrzymuje własne `UMIEM_TEST_RUN_ID` i wolne `UMIEM_E2E_PORT` oraz `UMIEM_WORKER_HEALTH_PORT`. Użyć `tests/test-run-config.ts`; nie uruchamiać dwóch światów na domyślnych portach i `.world.json`. Zmienne w PowerShell ustawić w bieżącym procesie na czas polecenia i przywrócić w `finally`.

Do pomiarów dodać nazwane `test.step`: logowanie/przygotowanie, otwarcie edytora, generowanie/media, właściwa operacja, sprawdzenie trwałości. Reporter JSON może być zapisany do ignorowanego katalogu wyników poza `tests/e2e`, bez payloadów dzieci i mediów. W razie braku informacji o czasach kroków użyć pomiaru czasu samych helperów, bez logowania DTO. Nie włączać trace/HAR/video dla `kid-flow`.

Końcowo porównać trzy przebiegi przed i po w tym samym środowisku i tej samej konfiguracji. W tabeli podać medianę per plik, przygotowania i całego przebiegu, liczbę testów, failures/retries oraz koszty startu osobno. Pierwszy przebieg zawiera kompilację tras; pokazać go osobno. Nie przedstawiać pojedynczego zielonego przebiegu jako dowodu stabilności.

## 3. Helpery wspólne — implementować tylko potrzebne warianty

### 3.1. Połączenie ze światem i sesja rodzica

Nowe małe helpery w `tests/e2e/helpers/`, np. `world-database.ts`, `parent-session.ts`, `ready-material.ts`. Nazwy są propozycją; nie budować frameworka fixture'ów.

- Odczytywać `readTestRunConfig(process.env).worldFile`. Nie używać produkcyjnego `DATABASE_URL` jako fallbacku. Brak pliku/konfiguracji ma przerwać test.
- Zamknąć pulę w teardown odpowiedniego fixture'a. Nie pozostawiać kilku niezarządzanych pul na plik.
- Dla testów niezwiązanych z logowaniem użyć `page.request` do setup/login z PIN-em testowym. Cookies z tego kontekstu są potem używane przez tę samą stronę.
- Dla testów profili: login API → utworzenie profilu API → pierwsze `goto('/parent')`. To eliminuje logowanie w UI i dodatkowy reload. Nie zastępować tym testów logowania w innych plikach.
- Zwracać ID profilu/deck/version/draft; lokatory wiązać z ID. Tytuł/imię z unikalnym sufiksem.

### 3.2. Gotowy szkic i gotowa opublikowana lekcja

Punkt odniesienia: `tests/fixtures/lesson-world.ts`, używany już w integracji. Nie podłączać go bez analizy: domyślny świat ma uproszczoną pulę, a jego istnienie nie potwierdza zgodności z walidacją pełnego edytora/publikacji.

Rekomendowane wykonanie:

1. Dodać helper gotowej lekcji w `tests/fixtures/`, wspólny dla integracji i E2E. Zachować dotychczasowe domyślne zachowanie `lessonWorld`; nie zmieniać po cichu istniejących fixture'ów.
2. Wspierać tylko potrzebne parametry: `title`, `objectiveIds`, stan `draft|published`, opcjonalne przypisanie. Zapewnić polskie instrukcje i edytowalne przykłady.
3. Tworzyć rzeczywiste rekordy, skill mappings i kontekst lekcji w jednej transakcji, z poprawnym porządkiem draft → revisions → publikacja. Korzystać z istniejących generatorów deterministycznych/walidatorów i obliczania kluczy; nie kopiować reguł silnika ani wymyślać niepoprawnych target keys.
4. Dla szkicu edytora spełnić wymagane minima pokrycia (sprawdzić bieżące reguły; w analizowanej wersji guided ≥3, productive ≥4, independent ≥2 na cel). Present Simple nie wymaga TTS.
5. Opublikowany fixture ma być poprawny do odczytu i rozpoczęcia prawdziwej sesji. Bez sztucznych ocen lub postępu, chyba że dany test jawnie przygotowuje należne sprawdzenie.
6. Dodać mały, znaczący test integracyjny helpera: odczyt przez aktualny kontrakt, edycja szkicu i publikacja przez rzeczywisty przypadek użycia, a dla opublikowanej lekcji przypisanie i start sesji. Nie wystarczy samo udane INSERT.

Jeżeli zgodny fixture okazuje się zbyt rozbudowany, w pierwszym etapie pozostawić dotychczasowe tworzenie API i odnotować brak oszczędności. Nie zastępować prawdziwego API mockami po to, by formalnie zakończyć punkt.

### 3.3. Słówka i media — ostrożniej niż lekcje

Dla ręcznej edycji szkicu wystarczą 2–3 poprawne słowa zamiast siedmiu wygenerowanych. Dla sesji dziecka fixture musi zapewnić zróżnicowane znaczenia, potrzebne dystraktory, zgodne media/fingerprinty i rzeczywiste bajty zasobów, jeżeli UI je pobiera.

- Sam rekord `approved/ready` bez dostępnego blobu nie jest poprawnym fixture'em do testu odtwarzania.
- `picture-fixtures.ts` to mocki DTO dla UI; nie traktować ich jako gotowej bazy dla prawdziwego E2E.
- Nie współdzielić mutowalnych zestawów między przypadkami. Można reużywać deterministyczną definicję danych.
- Jeśli potrzebny jest zapis gotowych mediów, użyć istniejącego MediaStore i tych samych ustawień co web. Plik świata obecnie zawiera tylko `databaseUrl`. Dopuszczalne jest dodanie do niego `mediaRoot` i aktualizacja typu/helpera w testach; nadal bez endpointu aplikacji i bez nagrań dziecka na dysku.
- Media publikować jako niezmienne przed publikacją wersji. Nie psuć współdzielonego cache ani istniejących integracyjnych fixture'ów.
- Wdrażać gotowe media dopiero po stabilnym etapie lekcji. Jeśli koszt helpera przewyższa spodziewany zysk, zachować `createAssignedDeck` i zakończyć pozostałe poprawki tego pliku z jawną informacją o odłożonym zakresie.

## 4. lesson-archive.spec.ts

### Co zmienić

Obecny `createLesson` w pięciu przypadkach wykonuje API create → oczekiwanie na generację → rename → oczekiwanie na assets → publish → reload. To przygotowanie do archiwizacji, nie jej przedmiot.

### Jak

- Zastąpić tę ścieżkę helperem gotowej lekcji, osobnej w każdym teście. Gotowy draft wystarcza do testów transportu, blokady podwójnego wysłania i wygaśnięcia sesji; pierwszy pełny przypadek niech używa opublikowanej wersji.
- Login i przygotowanie wykonać przed pierwszym otwarciem listy, aby uniknąć reloadu wyłącznie do odświeżenia danych przygotowanych przez test.
- Połączyć `returns focus to the archive filter...` z pierwszym testem: pierwszy już sprawdza fokus filtra po archiwizacji. Zachować tę asercję i usunąć tylko identycznie pokryty osobny przypadek.
- Zachować anulowanie Escape/przyciskiem, brak archiwizacji po anulowaniu, tytuł 200 znaków, ukrycie po reloadzie, pokazanie archiwum i otwarcie podglądu.
- Zachować realne wywołanie archiwizacji w testach retry, double-submit i logout. Route służy tylko kontroli transportu/czasu odpowiedzi.
- Teardown bramki odpowiedzi pozostaje w `finally`. Sprawdzać stan backendu i liczbę żądań tam, gdzie obecnie są dowodem zachowania.
- Test archiwalnych słówek nadal tworzy rzeczywisty zestaw przez API; nie wymaga fixture'a lekcji.

### Akceptacja

5 testów zamiast 6, bez utraty unikalnych asercji; brak generowania/publikowania w przygotowaniu przypadków błędów. Archiwizacja nadal potwierdzona w prawdziwej bazie. Integracja `lesson-parent-api.test.ts` nadal dowodzi zachowania historii i blokady nowych sesji.

## 5. lesson-parent.spec.ts

### Podział przypadków

| Przypadek | Przygotowanie i zachowany przedmiot testu |
| --- | --- |
| defaults the pool size... | Formularz UI; nie tworzy gotowej lekcji. Bez zmian semantyki. |
| parent can safely restart... | Prawdziwe uruchomienie i restart generowania przez UI; zachować delay i worker. |
| generates a multi-objective... | Prawdziwe tworzenie UI i generowanie puli 3 celów; zachować kontrolę instrukcji, typów i braku audio. |
| creates a lesson, reviews... | Zachować pełny przepływ lekcji, błąd walidacji, usuwanie independent, regenerację, publikację i przypisanie. Profil utworzyć API przed wejściem do UI. |
| guards against leaving... | Gotowy szkic z helpera → otwarcie przez listę → zmiana → dialog → pozostanie w edytorze. |
| shows a version conflict... | Gotowy szkic → dwa rzeczywiste okna i zapisy → 409 → wczytanie zdalnej wersji. Nie zastępować drugiego okna samym mockiem 409. |
| keeps the lesson editor usable... | Gotowy szkic z reprezentatywną treścią i przykładami → oba viewporty i dotychczasowe asercje. |
| parent edits an AI example... | Gotowy szkic → edycja/dodanie przykładu UI → PATCH → trwałość po ponownym otwarciu. |

### Dodatkowe naprawy

- W teście przykładów czekać na odpowiedź PATCH i status 200 przed `goto`. Sam `waitForRequest` potwierdza wysłanie, ale nie zakończenie zapisu.
- Tworząc dziecko przez API, zachować wszystkie potrzebne pola i ostrzeżenia UI; nie „poprawiać” canRead tylko dlatego, że nazwa scenariusza sugeruje inny profil. Obecny test sprawdza ostrzeżenie o czytaniu.
- Nie zmniejszać puli trzech celów poniżej wymagań pokrycia. Nie usuwać regeneracji z pełnego przepływu.

### Akceptacja

8 testów pozostaje. Cztery testy edytora nie uruchamiają generacji; trzy przypadki, których przedmiotem jest generacja/restart/pełny przepływ, nadal używają prawdziwego workera. Konflikt i trwałość zachowane.

## 6. parent-flow.spec.ts

### Profile

- Przepisać `profileForEditing`: login API → create child API → goto → otwarcie Dzieci → wiersz po ID. Usunąć login UI i reload służący wyłącznie przygotowaniu.
- Zachować Enter, anulowanie, focus, nieznany avatar, whitespace, częściowe PATCH, błędy zapisu i odświeżenia, blokowanie formularza oraz usunięcie w drugim kliencie.
- Oba konteksty w teście współbieżności nadal wykonują rzeczywiste operacje. `storageState` kopiować po zalogowaniu. Zamknąć dodatkowy kontekst w `finally`.
- W teście ostrzeżenia o współdzielonym avatarze przygotować oba profile przed pierwszym renderem listy.

### Zestawy

- Pełny obieg rodzica zachować z generowaniem, przejściem pending → ready, błędem przed gotowym TTS, odtworzeniem poprawnego zasobu/MIME, pominięciem ilustracji, dwiema datami, nową wersją i ponowną publikacją.
- Zastąpić stałe imiona/tytuły unikalnymi; przypisania lokalizować po dziecku/ID zamiast `assignment-row-0/1`, jeśli to możliwe przy istniejącym DOM.
- Test „ręczna edycja zestawu” zaczyna od gotowego szkicu 2–3 słów. Zachować add → incomplete validation → save → remove → retitle → reload. Dostosować indeksy/liczebności do mniejszej puli; nie zachowywać magicznych 7/8 tylko po starej fixture.
- Oczekiwanie na nowe TTS po dodaniu słowa pozostawić w pierwszej implementacji. Usuwanie tego oczekiwania wymaga wykazania równoważnego pokrycia mediów w pozostałych testach.
- Końcowe `kid/decks` dla zerowego, nieistniejącego childId dowodzi tylko 404. Zastąpić je rzeczywistym sprawdzeniem przypisanego dziecka: szkic niedostępny przed publikacją, po publikacji widoczna właściwa wersja. Wykorzystać istniejące ID i kontrakty, bez ujawniania klucza odpowiedzi.

### Akceptacja

14 testów pozostaje; brak dodatkowego reloadu w przygotowaniu edycji profilu. Ręczna edycja nie uruchamia generacji treści. Pełny przepływ mediów nadal realny, a asercja dostępności materiału sprawdza deklarowany warunek.

## 7. manual-deck-flow.spec.ts

### Co pozostawić

Zachować większość 13 krótkich testów. Tworzenie manualne jest tu przedmiotem testu; nie zastępować go we wszystkich przypadkach gotową fixture. Zachować ID po niepewnym create, brak pola items w zmianie tytułu, brak generowania treści, pending controls i zachowanie po błędzie odświeżenia.

### Naprawa odpowiedzi pollingu w locie

1. Obecne `readReceived` oznacza przechwycenie GET, a `readRelease` zwalnia jego odpowiedź. Po release test sprawdza pole już wcześniej ustawione na „kotek”, więc może zakończyć się przed przetworzeniem starej odpowiedzi.
2. Dodać sygnał zakończenia konkretnej przechwyconej odpowiedzi i poczekać na obserwowalny efekt jej zastosowania w UI (np. zmianę niezależnego stanu zasobu z tej odpowiedzi). Sam `waitForResponse`/zakończenie `route.fulfill` nie dowodzi jeszcze renderu.
3. Najpierw sprawdzić, czy prawdziwe stare DTO zawiera taki rozróżnialny stan. Jeśli nie, użyć kontrolowanego DTO w tym jednym GET wyłącznie w teście UI wyścigu, z jawnym opisem granicy; prawdziwy zapis i baza pozostają. Bez produkcyjnego test-haka.
4. Po potwierdzeniu efektu odpowiedzi sprawdzić „kotek”, zapisać zmianę i potwierdzić ją odczytem rzeczywistego draftu. Wszystkie bramki zwalniać w `finally`.
5. Test powinien wykryć regresję nadpisywania brudnego formularza. Dowieść tego chwilowym odtworzeniem błędu w kodzie i RED, następnie przywrócić kod i uzyskać GREEN; nie zostawić zmiany produkcyjnej, jeśli obecne zachowanie jest poprawne.

### Pozostałe

- Login API dopuszczalny, bo te przypadki nie testują uwierzytelniania.
- Tworzenie dziecka w końcowym przepływie można przygotować API. Zachować sprawdzanie widoczności standardowego materiału dla nieczytającego dziecka.
- Screenshoty w tym i pozostałych plikach to diagnostyka, nie porównania wizualne. W pierwszym etapie pozostawić je. Optymalizować dopiero, jeśli pomiar wykaże istotny koszt; nie usuwać asercji geometrii/viewportów.

### Akceptacja

13 testów; test wyścigu czeka na przetworzenie odpowiedzi, nie tylko jej wysłanie. Manualny create/edit/publish i zachowanie błędów nadal pokryte.

## 8. kid-flow.spec.ts

### Izolacja i znaczenie pierwszego testu

- Usunąć pętlę usuwającą wszystkie istniejące dzieci. Każdy test tworzy własny profil z unikalnym imieniem; wybiera go po ID lub jednoznacznym lokatorze.
- Zmienić nazwę pierwszego testu na odpowiadającą rzeczywistości, np. „wybór profilu prowadzi sesję do obiecanego końca”. Obecny kod wybiera profil, choć nazwa mówi o jego pominięciu.
- Jeśli chcemy utrzymać osobny dowód zachowania przy dokładnie jednym profilu, dopisać go w `kid-flow-screens.spec.ts` z fixture'em jednego profilu. To świadomie test UI, nie dowód izolacji prawdziwej bazy. Nie czyścić wspólnego świata dla tego warunku.
- Zachować istniejący test dwóch profili i oddzielnych prawdziwych sesji.

### Sterowanie sesją i obiecany budżet

- Nie skracać sesji przez ręczną zmianę taskBudget ani przygotowanie ocen, które stanowią przedmiot testu końca.
- Ujednolicić duplikujące się pętle sterowania. Oczekiwać na konkretny taskId/stan odpowiedzi i aktywne kontrolki danego ćwiczenia, a nie brak wszystkich disabled elementów w całym dokumencie.
- Usunąć `.catch(() => undefined)` w `settled`. Timeout ma zgłaszać czytelny błąd z taskId i rodzajem ćwiczenia, bez treści nagrań.
- Zamiast fallback `waitForTimeout(500)` obsłużyć znane przejścia/rodzaje zadania; nieznany stabilny stan kończy test diagnostycznym błędem. Limit kroków zachować jako zabezpieczenie.
- Zapisać sessionId/taskBudget z prawdziwej odpowiedzi start. Przy pierwszym pokazaniu licznika porównać liczbę z `remainingAssessed` i policzyć kolejne unikalne oceniane zadania zgodnie z semantyką serwera.
- Uwaga na błąd o jeden: bieżące zadanie może wchodzić do pozostałego budżetu. Prezentacje i retry tej samej próby nie są nowymi ocenianymi zadaniami. Potwierdzić regułę w `sessions.ts`/DTO przed napisaniem asercji.
- Potwierdzić completed po stronie serwera oraz brak dokładania zadań ponad obietnicę. Zachować ilustrację, przykład audio i prawdziwy tor nagrywania.

### Media i przygotowanie materiału

- `waitForTimeout(350)` w fake nagrywaniu jest kandydatem do usunięcia, bo fixture dostarcza WebM z metadanymi 2 s oraz zdekodowany bufor 2 s. Najpierw sprawdzić guardy czasu w browser/controller i znaczenie tego oczekiwania.
- Zastąpić wait sygnałem gotowości faktycznego fake MediaRecorder, jeśli potrzebny. Po usunięciu sprawdzić odpowiedź serwera, modality audio oraz faktyczne wywołanie stop track; sam zielony DOM nie wystarcza.
- Gotowe opublikowane słówka wdrożyć według 3.3; zachować wymagane 3 różne elementy tam, gdzie `seedDue` używa indeksów 0/1/2 i gdzie potrzebne są dystraktory. Nie zmniejszać danych mechanicznie do jednego słowa.
- Jeżeli fixture mediów jest odłożony, zachować `createAssignedDeck`; jego pętle powinny od razu zgłaszać terminalne failed i nie próbować publish w ciasnej pętli bez przerwy po nieoczekiwanym błędzie.

### Akceptacja

10 rzeczywistych testów pozostaje, opcjonalnie jeden dodatkowy UI test pojedynczego profilu w innym pliku. Brak kasowania cudzych danych i ignorowanych timeoutów. Test końca sprawdza budżet; mikrofon, offline bez sukcesu, dwa profile, należne sprawdzenia, podsumowanie i nieczytający profil nadal działają. Trace nadal wyłączony.

## 9. lesson-real-flow.spec.ts

### Pierwszy scenariusz — zachować pełny przepływ

Zachować rzeczywiste tworzenie i zatwierdzenie lekcji przez rodzica, sesję dziecka, reload, brak nowych prób/ocen po reloadzie, dwa błędy, kolejną sesję wsparcia, brak independent/confirmation credit oraz postęp widoczny rodzicowi po reloadzie. To celowy test połączenia warstw.

- Profil można przygotować API przed otwarciem formularza lekcji. Nie zastępować interakcji dziecka SQL-em.
- Nie usuwać zapytań o assessments/attempts ani porównania przed/po. Krótsze helpery SQL są dopuszczalne bez zmiany ich znaczenia.
- Zachować jawne sprawdzenie assets=[] i braku audio. Oczekiwanie na „nie ma generowania audio” można usunąć tylko tam, gdzie jest natychmiast redundantne względem tej samej już odczytanej informacji; nie deklarować z tego dużej oszczędności.

### Drugi scenariusz — gotowa lekcja wielu celów

- Zastąpić powtórne UI create/review/publish helperem poprawnej opublikowanej lekcji dla question/negative/short_answers i przypisaniem do własnego dziecka.
- Zachować wszystkie trzy cele, poprawne przykłady, wystarczającą pulę, brak audio, rzeczywisty start, odpowiedź, assessment, reload/wznowienie bez duplikacji i odczyt postępu rodzica.
- Nie twierdzić, że odpowiedź na jedno wylosowane ćwiczenie pokrywa interakcję wszystkich trzech celów. Obecny test sprawdza zawartość puli i jeden rzeczywisty assessment. Nazwa/opis powinny oddawać tę granicę; nie rozszerzać go teraz do trzech długich sesji.
- Sprawdzenie rzeczywistego generowania wielocelowego nadal pozostaje w `lesson-parent`.

### Akceptacja

2 testy; jeden kompletny przepływ z workerem pozostaje. Drugi nie generuje materiału jako przygotowania, ale nadal sprawdza prawdziwe API/bazę i UI obu klientów.

## 10. Weryfikacja, zatrzymanie rozszerzania zakresu i przekazanie

Po każdym zmienionym specu uruchomić tylko ten plik, np. `corepack pnpm test:e2e tests/e2e/lesson-archive.spec.ts`. Po zmianie współdzielonego helpera uruchomić jego konsumentów, a nie ponownie pełne monorepo.

Test poprawności fixture'a uruchomić wskazanym plikiem w istniejącej konfiguracji, np. `corepack pnpm test:integration tests/integration/<nowy-test-fixture>.test.ts`. Nie importować `tests/integration/helpers.ts` do runtime helpera E2E, jeżeli import uruchamia dodatkowy kontener/setup Vitest. Typ puli brać z istniejących typów serwera/pg.

Przed końcem:

1. `corepack pnpm typecheck`.
2. Celowane testy integracyjne fixture'ów oraz `tests/integration/lesson-parent-api.test.ts`, jeśli zmieniono wspólne przygotowanie lekcji.
3. Trzy porównywalne przebiegi zmienionych sześciu plików; dla napraw synchronizacji także celowane powtórzenia danego przypadku (`--repeat-each=3`), z unikalnymi danymi.
4. Jeden pełny `corepack pnpm test:e2e`, aby wykryć wpływ nowych fixture'ów na wspólny świat i inne specy.
5. `git diff --check` i przegląd usuniętych asercji, zakresu plików oraz cleanup.
6. Jeśli zmienił się tylko kod testów i dokumentacja, build/unit całego repo nie są dodatkowym dowodem tych poprawek. Jeśli jednak zmieniono runtime aplikacji, rozszerzyć weryfikację adekwatnie i wyjaśnić powód zmiany zakresu.

Oczekiwany bilans testów: sześć plików 53 → 52 (wyłącznie duplikat focus w archive); opcjonalny test UI pojedynczego profilu liczony osobno. Każda inna zmiana liczby wymaga wskazania, gdzie zachowano pokrycie.

Kryterium wyniku: wszystkie zachowane scenariusze przechodzą; mniej przygotowania przez generowanie i reload; naprawione pozorne asercje synchronizacji/budżetu; brak nowego uzależnienia od kolejności. Jeśli wynik czasowy jest niejednoznaczny, zgłosić go jako niejednoznaczny. Nie usuwać pokrycia, by osiągnąć zakładany procent.

Raport GPT Luna ma zawierać: zmienione pliki, mapę zachowanych/przeniesionych asercji, wykonane polecenia i wyniki, mediany przed/po z warunkami pomiaru, przypadki RED→GREEN dla napraw testów, odłożone punkty i przyczynę. Szczególnie oddzielić gotowe dane od mockowanych odpowiedzi UI.

Nie tworzyć osobnego PR dokumentacyjnego, nie pushować i nie scalać w ramach tego planu. Plan nie jest poleceniem uruchomienia GPT Luna ani implementacji; służy jako kompletna instrukcja po przekazaniu zadania przez właściciela.
