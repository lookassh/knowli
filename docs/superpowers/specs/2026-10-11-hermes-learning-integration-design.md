# Umiem! → Hermes: przykładowe API i MCP

**Status: specyfikacja i plany A/B/C zaakceptowane przez właściciela 2026-10-11, implementacja jest w toku w izolowanych repozytoriach Knowli i Hermes-szkola. Produkcyjne wdrożenie Coolify, token i wysyłka prawdziwego raportu nie są częścią tej zgody. Wszystkie dane testowe są fikcyjne.**

Cel: Hermes może pobrać ostatnie dni nauki osobno dla każdego dziecka, aktualny postęp i nadchodzące sprawdziany, a następnie wykorzystać te fakty w rodzinnym podsumowaniu albo odpowiedzieć na pytanie rodzica. Umiem! wylicza dane; Hermes formułuje tekst. W tej propozycji nie zmieniamy reguł oceniania ani uczenia.

## 1. Jedno narzędzie MCP

Nazwa: `umiem_get_learning_overview`.

Opis dla agenta: „Pobierz dzienną aktywność dzieci z ostatnich dni, aktualny postęp według umiejętności i sprawdziany zaplanowane w Umiem!. Nie utożsamiaj poprawnych odpowiedzi z trwałym opanowaniem. Brak aktywności oznacza brak zapisanych zdarzeń w Umiem!, a nie brak nauki poza aplikacją.”

Przykładowe wywołanie:

```json
{
  "days": 3,
  "upcomingTestDays": 14
}
```

Opcjonalnie `childId` ogranicza wynik do jednego dziecka. Bez niego narzędzie zwraca wszystkie dzieci dostępne dla tokenu. W pierwszej wersji token może obejmować całą rodzinę. Nie wprowadzamy tu kont ani modelu wielorodzinnego.

Parametry narzędzia odpowiadają parametrom API. MCP zwraca strukturę odpowiedzi jako `structuredContent`; tekstowy fallback zawiera ten sam JSON. Token i adres serwera są konfiguracją adaptera, nie argumentami dostępnymi modelowi. Adapter używa wyłącznie tego endpointu i nie udostępnia narzędzia do dowolnych zapytań HTTP ani do zapisu w Umiem!.

## 2. Endpoint HTTP

```http
GET /api/v1/integrations/learning-overview?days=3&upcomingTestDays=14
Authorization: Bearer <token integracji Hermesa>
Accept: application/json
```

Przykład dla jednego dziecka:

```http
GET /api/v1/integrations/learning-overview?days=7&upcomingTestDays=14&childId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

| Parametr | Domyślnie | Znaczenie |
| --- | --- | --- |
| `days` | 7 | 1–31 ostatnich dni kalendarzowych, włącznie z dniem wykonania zapytania |
| `upcomingTestDays` | 14 | 1–90 dni kalendarzowych na sprawdziany, włącznie z dzisiejszym dniem |
| `childId` | brak | UUID jednego dziecka; brak oznacza wszystkie dostępne dzieci |

Strefa pochodzi z konfiguracji rodziny, początkowo `Europe/Warsaw`. Klient jej nie nadpisuje. Przykład wygenerowany 11 października 2026 o 19:00 obejmuje naukę 9–11 października i sprawdziany 11–24 października. Granice dni liczymy według lokalnych dat, z uwzględnieniem zmiany czasu, a nie jako wielokrotności 24 godzin.

Odpowiedź: HTTP 200, `Content-Type: application/json`, `Cache-Control: no-store`.

Pełna odpowiedź przykładowa znajduje się w pliku `2026-10-11-hermes-learning-overview.example.json` obok tego dokumentu. Pokazuje dwoje dzieci, trzy dni, brak aktywności jednego dnia, próbę kartkówki, aktualny postęp i planowany sprawdzian.

## 3. Struktura odpowiedzi

```text
schemaVersion
learningTimeDefinition { method, maxGapSeconds }
generatedAt
timezone
period { from, to, days }
plannedTestsPeriod { from, to, days }
children[]
  childId, childName
  learningTime { seconds, estimated }
  dailyActivity[]
    date, isPartialDay, hasRecordedActivity
    learningTime { seconds, estimated }
    sessionsWithActivity, submittedAttempts, pendingAttempts
    decks[] { deckId, deckVersionId, deckTitle, deckVersionNumber, assessmentCounts[] }
    mockTests[]
  currentProgress[]
    deckId, deckVersionId, deckTitle, deckVersionNumber, totalItems
    skills[], practiceItems[], practiceItemsTruncated
  plannedTests[] { assignmentId, deckId, deckTitle, date, daysUntil, goals, source }
```

`generatedAt` jest chwilą spójnej migawki odczytu w UTC. `currentProgress` opisuje stan w tej chwili. Odpowiedź nie udaje archiwalnych migawek opanowania na koniec każdego dnia. Taki trend byłby osobnym rozszerzeniem wymagającym odtworzenia właściwych wersji materiału i polityki z historii.

### Dzienna aktywność (`dailyActivity`)

- Każde dziecko otrzymuje dokładnie `days` wpisów, od najstarszego do najnowszego. Dni bez zdarzeń pozostają w odpowiedzi z zerami i pustymi listami.
- `isPartialDay: true` oznacza dzisiejszy dzień: wynik obejmuje tylko zdarzenia znane w chwili migawki.
- `hasRecordedActivity` uwzględnia zapisane działania dziecka: odpowiedzi, pominięcia, zamknięte prezentacje i ujawnienia. Sam start/wznowienie sesji oraz odczyt raportu przez rodzica nie stanowią ćwiczenia. Przy aktywności bez ocen lista `assessmentCounts` może być pusta.
- `sessionsWithActivity` to liczba różnych sesji z taką aktywnością tego dnia. Sesja przechodząca przez północ może wystąpić w obu dniach; liczba nie jest liczbą zakończonych sesji.
- `submittedAttempts` liczy różne zapisane próby odpowiedzi według `received_at`; obejmuje także nieocenione i oczekujące na analizę. Retry z tym samym identyfikatorem nie zwiększa liczby. Prezentacja i pominięcie nie są próbami odpowiedzi.
- `pendingAttempts` to część tych prób, które nadal oczekują na analizę. Nie zwiększają jeszcze liczników ocen i nie stanowią błędnej wiedzy.
- `assessmentCounts` liczy utrwalone oceny, osobno dla każdej umiejętności. `independentCorrect` = poprawne i samodzielne; `correctNotIndependent` = poprawne, ale niekwalifikujące się jako samodzielne; `incorrect` = błędne; `unassessed` = nieocenione. Każda ocena trafia do jednej kategorii. Liczniki nie oznaczają liczby różnych opanowanych słów.
- Jedna odpowiedź pisemna może tworzyć dwie oceny: Recall i pisowni. Dlatego suma ocen może być większa od `submittedAttempts`. Poprawne niesamodzielne odpowiedzi obejmują także niedawne ujawnienie lub kolejną próbę, nie tylko jawną podpowiedź.
- Oceny przypisujemy do dnia otrzymania próby, a nie dnia ukończenia analizy mowy. Ponowny odczyt może uzupełnić starszy dzień po ukończeniu analizy; odpowiedź jest aktualnym widokiem, nie niezmiennym raportem dziennym.
- Zestawy historyczne wskazują wersję używaną w sesji. Edycja tytułu lub materiału nie przepisuje historycznych informacji. Historyczne wyniki dotyczą również zestawu, który obecnie nie jest przypisany.
- `mockTests` zawiera utrwalone raporty prób zakończonych danego dnia, według lokalnej daty `endedAt`. Liczniki ocen tych prób są już w `assessmentCounts`; nie należy dodawać ich drugi raz. Częściowa próba ma `complete: false`.
- Odczyt integracyjny nie zamyka aktywnych sesji, nie tworzy raportów kartkówek, nie zapisuje ekspozycji i nie zmienia postępu. Korzysta wyłącznie z już zapisanych danych. Aktywna próba kartkówki bez utrwalonego raportu nie pojawia się jeszcze w `mockTests`; jej zapisane odpowiedzi nadal są widoczne w aktywności dziennej.
- W raportach kartkówek `totalItems` obejmuje pełny zakres umiejętności, a `taskBudget` wydaną porcję. `notTested` obejmuje pominięte, nieocenione i niewydane elementy; `skipped` oraz `unassessed` są jego podzbiorami. To pola istniejącego raportu, bez nowego sposobu oceny.

### Czas nauki (`learningTime`) — uzupełnienie właściciela 2026-10-11

API zwraca czas dla każdego wpisu `dailyActivity[].learningTime` i łącznie dla dziecka w wybranym okresie jako `children[].learningTime`. Wartość `seconds` jest liczbą całkowitą sekund albo null; `estimated: true` jawnie oznacza szacunek. Przykład dla dzisiaj:

```json
{
  "date": "2026-10-11",
  "learningTime": { "seconds": 1380, "estimated": true }
}
```

Hermes przedstawia to jako „Szacowany czas nauki: 23 min”. Dla 1–59 sekund pokazuje „poniżej 1 min”, a dla większych wartości zaokrągla liczbę minut w dół. Znane 0 s z dodatniego przedziału krótszego niż sekunda i hasRecordedActivity=true także prezentuje jako „poniżej 1 min”; 0 s przy braku aktywności pozostaje brakiem zapisu, nie wnioskiem o nauce poza aplikacją. Zaokrąglenie dotyczy tylko tekstu, nie API. Etykieta dla całego okresu ma jawny zakres, np. „Szacowany czas nauki z ostatnich 3 dni: 33 min”. Nie dodajemy osobnego tekstu prezentacji do DTO.

Najmniejszy wariant wykorzystuje już zapisane zdarzenia; nie wymaga nowej telemetrii klienta ani migracji historii. Nie wyliczamy czasu jako ended_at minus started_at: koniec sesji może być zapisany długo po odejściu dziecka. To szacunek na podstawie działań, nie pomiar uwagi ani czasu, gdy dziecko tylko patrzy na ekran. Krótkie oczekiwanie na serwer może wejść do szacunku. Dokładniejszy licznik aktywnego ekranu jest osobnym rozszerzeniem.

Definicja metody w głównym obiekcie: `learningTimeDefinition={method:"activity_intervals_v1",maxGapSeconds:120}`. Proponowany próg 120 sekund jest stałą metody raportowania, nie polityką oceny prób. Zmiana metody/progu wymaga jawnego oznaczenia nowej definicji, żeby nie porównywać niezgodnych wyników.

1. Dla każdej sesji zbierz czas otrzymania prób (także skip) i zamkniętych zdarzeń aktywności z allowlist spec §7. Nie dodawaj czasu start/resume, samego feedback_issued, completed_at providera ani odczytu raportu. Usuń duplikaty czasów w ramach sesji i posortuj je.
2. Licz przedział między kolejnymi punktami tylko wtedy, gdy odstęp jest dodatni i nie przekracza 120 sekund. Odstęp dokładnie 120 sekund liczy się w całości; większy nie liczy się wcale. Nie dodawaj automatycznie 120 sekund na końcu ani czasu od ostatniego punktu do generatedAt. Nie łącz punktów różnych sesji.
3. Odczytaj także punkty do 120 sekund przed początkiem okresu, żeby poprawnie przyciąć przedział przechodzący przez jego granicę. Nie bierz punktów po generatedAt. Przytnij przedziały do okresu i chwili migawki. Sumuj unię przedziałów per dziecko, więc nakładające się sesje/dwie przeglądarki nie podwajają czasu.
4. Podziel przedziały na lokalne dni według timezone rodziny, także przez północ i DST. Sumuj milisekundy dzienne i dopiero potem obetnij niepełną sekundę. Nie sumuj niezależnie zaokrąglonych luk.
5. Dzień bez zapisanej aktywności ma seconds=0. Dzień z aktywnością, ale bez żadnego dodatniego kwalifikującego przedziału, ma seconds=null: za mało danych, a nie „0 min nauki”. W pozostałych dniach zwróć oszacowane sekundy. estimated jest zawsze true w tej wersji.
6. Łączny wynik dziecka jest sumą dziennych sekund; jeśli choć jeden dzień ma null, łączny seconds także jest null. Hermes może nadal pokazać poprawnie oszacowane dni, ale nie przedstawia sumy niepełnego okresu jako kompletnej.

Przykład fikcyjny: Ola 9 października 600 s, 10 października 0 s, 11 października 1380 s; razem 1980 s (33 min). Kuba bez zdarzeń: 0 s. Brak danych API pozostaje statusem unavailable; nie staje się seconds=0 ani null w odpowiedzi sukcesu. Redukcja kontekstu zachowuje dzienne i łączne learningTime wraz z definicją metody oraz estimated.

### Aktualny postęp (`currentProgress`)

Lista obejmuje aktualnie przypisane opublikowane zestawy. Każdy zestaw zawiera pięć umiejętności: `listening`, `reading`, `recall`, `pronunciation`, `spelling`.

| Pole | Interpretacja dla Hermesa |
| --- | --- |
| `mastered` | Opanowane według reguł aplikacji, z wymaganym potwierdzeniem po przerwie |
| `needsConfirmation` | Wymaga potwierdzenia; także po zmianie kryteriów materiału |
| `needsReconfirmation` | Wcześniej opanowane, teraz wymaga ponownego potwierdzenia |
| `practicing` | Nadal ćwiczone |
| `notAssessed` | Brak wiarygodnej oceny tej umiejętności |

Dla każdej umiejętności suma pięciu statusów równa się `totalItems`. Nie sumujemy różnych umiejętności ani zestawów w jedną liczbę „opanowanych słów”. Ten sam element może należeć do kilku zestawów.

`practiceItems` to maksymalnie 5 elementów na zestaw z potwierdzonymi trudnościami, ostatnio obserwowanymi w raportowanym okresie, w aktualnej wersji umiejętności i polityki. Uwzględniamy późniejsze wiarygodne oceny także spoza okresu: trudność danej umiejętności usuwa późniejsza poprawna samodzielna odpowiedź. Poprawna odpowiedź niesamodzielna ani wynik nieoceniony jej nie usuwają. „Nie pamiętam” może utworzyć trudność; pominięcie i awaria techniczna nie mogą. Kolejność: najnowsza trudność, potem stały identyfikator elementu. `practiceItemsTruncated` sygnalizuje obcięcie listy. Brak wpisu nie oznacza pełnego opanowania; jest to lista konkretnych dowodów trudności, nie wszystkich elementów do nauki.

### Sprawdziany (`plannedTests`)

Źródłem są przypisania Umiem!: termin `testDate` i skonfigurowane `testGoals`. Nie pobieramy tutaj terminów z dziennika szkolnego i nie dopasowujemy ich automatycznie po tytule. Hermes może zestawić źródła we własnym podsumowaniu, zachowując ich pochodzenie.

Lista obejmuje terminy od dzisiaj do końca `plannedTestsPeriod`, posortowane po dacie i identyfikatorze przypisania. `daysUntil` to różnica dat kalendarzowych względem lokalnego dnia migawki. `source` ma wartość `umiem_assignment`. Cele mają obecne wartości `recall`, `spelling`, `listening`.

Postęp dla sprawdzianu można znaleźć po `deckId` w `currentProgress`. Nie zwracamy przewidywanej oceny szkolnej ani sztucznego procentu „gotowości”. Pusta lista oznacza brak terminów zapisanych w Umiem! w tym zakresie, nie brak sprawdzianów w szkole.

## 4. Dostęp i awarie

- Osobny token integracji z zakresem `learning:read`, możliwy do odwołania, z hashem po stronie serwera. Nie zastępuje autoryzacji rodzica w istniejących endpointach i nie daje uprawnień do mutacji, mediów ani surowych rekordów.
- Token przekazywany tylko w nagłówku przez adapter MCP; nie występuje w URL, odpowiedzi, promptach i logach. Sekret pozostaje w konfiguracji Hermesa poza kontekstem modelu.
- Dostęp przez HTTPS i istniejącą, uzgodnioną bramę dostępu. Nie otwieramy bazy danych ani nowego publicznego portu. Połączenie z faktycznym wdrożeniem i jego bramą pozostaje do zweryfikowania.
- Jedna odpowiedź jest wyliczana w spójnej migawce bazy. Błąd odczytu nie zwraca HTTP 200 z zerami. Adapter ma timeout 10 sekund, jedno ponowienie przy przejściowym błędzie transportu/5xx; przy 429 respektuje `Retry-After`, o ile mieści się w budżecie 25 sekund całego wywołania. Nie ponawia 400/401/403/404.
- Błędy API zachowują istniejący format `{ code, message, retryable, requestId }`. Statusy: 400 nieprawidłowe parametry; 401 brak/nieprawidłowy token; 403 brak zakresu `learning:read`; 404 nieistniejące lub niedostępne dziecko; 429 limit; 503 przejściowy brak danych.
- Przykład 503:

```json
{
  "code": "learning_summary_unavailable",
  "message": "Nie udało się pobrać podsumowania nauki.",
  "retryable": true,
  "requestId": "22222222-2222-4222-8222-222222222222"
}
```

- Przy błędzie MCP zwraca `isError: true` i jawny status niedostępności. Hermes informuje o braku danych, zamiast wnioskować, że dzieci nie ćwiczyły. Starszej odpowiedzi nie przedstawia jako dzisiejszej.
- Raport nie zawiera nagrań, transkrypcji, technicznych score'ów wymowy, answer keys ani pełnej historii odpowiedzi. Imiona, tytuły zestawów i ograniczona lista słów do powtórzenia trafiają do modelu Hermesa jako dane, nie instrukcje; to zakres proponowanej integracji do akceptacji przed uruchomieniem.

## 5. Przykład interpretacji

Na podstawie fikcyjnej odpowiedzi Hermes może napisać:

> Ola ćwiczyła dni tygodnia w piątek i dziś; w sobotę nie ma zapisanej aktywności. Szacowany czas nauki dziś: 23 min; z ostatnich 3 dni: 33 min. Dziś ma 6 poprawnych samodzielnych odpowiedzi z przypominania i 5 z pisowni. Według aktualnego postępu opanowała przypominanie 4 z 7 słów i pisownię 3 z 7. Do powtórzenia: pisownia „Wednesday”. Na czwartek 15 października ma zapisany w Umiem! sprawdzian z przypominania i pisowni. W próbnej kartkówce sprawdzono porcję 4 z 7 słów; 3 pozostałe nie były sprawdzone. Kuba nie ma zapisanej aktywności z ostatnich trzech dni ani przypisanych opublikowanych zestawów.

Nie może zamienić tego w „Ola opanowała dziś 6 nowych słów” ani „Kuba przez trzy dni się nie uczył”.

## 6. Checklista tego etapu

- [x] Sprawdzono istniejące DTO postępu i próbnych kartkówek oraz granice autoryzacji.
- [x] Wybrano kierunek: API raportowe i adapter MCP tylko do odczytu, zgodnie z decyzją właściciela.
- [x] Przygotowano kontrakt, reguły liczenia i fikcyjną odpowiedź do przeglądu.
- [x] Właściciel zaakceptował przedstawiony przykład i polecił przygotowanie planu 2026-10-11.
- [x] Zapisano specyfikację i przykład w repozytorium; przygotowanie planów A/B/C jest zakresem bieżącego polecenia.
- [ ] Implementacja, niezależny review i testy rzeczywistego połączenia pozostają przyszłymi etapami. Nie wykonano wdrożenia, modyfikacji konfiguracji Hermesa ani wysyłki raportu.

## 7. Proponowane szczegóły wykonawcze — do przeglądu razem z planami

### Podział odpowiedzialności

Plan A: Knowli — kontrakty, token, odczyt bazy i HTTP. Plan B: Knowli — serwer MCP Python/stdio w integrations/umiem-mcp i skill w integrations/umiem-mcp/skills/umiem-learning/SKILL.md. Plan C: Hermes-szkola — instalacja wersji MCP/skilla z Knowli, klient raportu i profil rodzinny. Domyślnie wykonuje je bieżący agent bez delegowania implementacji. Osobny recenzent przed PR jest wymagany przez AGENTS.md Knowli. Przy zmianach API obowiązuje opisana tam kontrola aktualizacji adaptera, przenośnego schematu, testów i SKILL.md w tym samym PR. Samo przygotowanie planów nie uruchamia wdrożenia.

SDK MCP występuje tylko w osobnym pakiecie Python integrations/umiem-mcp tego repo, nie w web/worker ani domenie. U Hermesa pakiet i skill są instalowane z konkretnej wersji Knowli we własnym środowisku Python, bez dodatkowego kontenera, globalnej zmiany runtime ani lokalnego forka źródeł. SDK linii v1 jest zgodne z obecnymi importami ClientSession/stdio_client; deklaracja `mcp>=1.28,<2` zapobiega niezamierzonej migracji do v2. Ostateczne wersje mcp/httpx/jsonschema i zależności przechodnich przypina `uv.lock` podczas wykonania planu B. Źródło: [oficjalna dokumentacja SDK v1](https://github.com/modelcontextprotocol/python-sdk/blob/v1.x/README.md), [zależności SDK](https://github.com/modelcontextprotocol/python-sdk/blob/v1.x/pyproject.toml), sprawdzone 2026-10-11. Minimalny Python adaptera: 3.11.

MCP ma jedno narzędzie `umiem_get_learning_overview`, z readOnlyHint=true, destructiveHint=false, idempotentHint=true i openWorldHint=true. Ostatnia wartość wskazuje połączenie z API. Te metadane nie zastępują autoryzacji serwera. Bez zasobów, promptów, narzędzi mutujących i dowolnego URL w argumentach.

### Token i ochrona endpointu

Tabela `integration_tokens`: id (UUID), name, token_hash (SHA-256, unique), scopes (text[]; jedyny obsługiwany scope to learning:read, dopuszczalna także pusta lista), created_at, revoked_at (nullable). Token obejmuje całą rodzinę; childId filtruje dane, nie nadaje nowych uprawnień. Dodanie zakresu per dziecko i kont wielorodzinnych pozostaje poza zakresem.

Operator tworzy/listuje/odwołuje token przez CLI w obrazie workera; nie powstaje dodatkowy ekran ani publiczny endpoint zarządzania tokenami. Wygenerowany sekret: co najmniej 32 losowe bajty CSPRNG, z prefiksem i publicznym id dla wyszukania rekordu. Pełny sekret przechowuje wyłącznie chroniony plik docelowy utworzony bez nadpisania. CLI nie wypisuje sekretu. Lista pokazuje tylko id/nazwę/scopes/czas/stan. Linux: plik 0600; Windows: sprawdzony ACL ograniczony do operatora. Nieudany zapis pliku nie tworzy aktywnego tokenu. Odczyt API nie aktualizuje last_used_at, nie usuwa danych i nie tworzy sesji rodzica. Odwołanie obowiązuje dla kolejnego żądania.

Limit: 60 poprawnie uwierzytelnionych żądań na minutę/token/proces, 429 z Retry-After; lokalny limiter nie jest globalnym limitem dla wielu replik. Aktualna implementacja celuje w jeden proces web; brama może dodatkowo ograniczać ruch anonimowy. Nie dodajemy Redis. Digesty porównujemy stałoczasowo, sekretów nie logujemy.

### Dane i spójność

Jedna transakcja PostgreSQL REPEATABLE READ, READ ONLY, timeout zapytań 8 s, wspólne generatedAt z kontrolowanego zegara. Wszystkie czytniki używają tego samego Tx/Executor, także token, profil, strefa rodziny i bieżący postęp. Nigdy wywołanie getProgress korzystające z osobnej puli wewnątrz tej transakcji. Odczyt postępu współdzieli istniejące mapowanie statusów i zmian wersji z raportem rodzica; nie zmienia reguł uczenia ani cache'u projekcji.

Pominięcie jest dziś zapisywane jako attempts.modality=skip; submittedAttempts i pendingAttempts jawnie je filtrują. Do aktywności zaliczamy attempts (także skip) oraz zamknięte presentation_completed, prompt_issued, audio_issued i hint_issued. Nie zaliczamy start/resume ani samodzielnych feedback_issued, które mogą powstawać przy ponownym odczycie podsumowania. Próby i zdarzenia liczymy po własnych kluczach, a sesje po unii sessionId; join ocen lub ekspozycji nie może powielać liczników. Dla historycznego dnia używamy received_at próby lub occurred_at zdarzenia. Wykluczamy zdarzenia przyszłe względem generatedAt.

Dzienny raport pokazuje wszystkie zapisane oceny, również z historycznej polityki; nie awansuje przez to nowych kryteriów. practiceItems ograniczamy do aktualnych skill_version i aktualnej polityki profilu (fallback CURRENT_POLICY_ID); kwalifikację dowodów bierzemy z istniejącego readSkillHistories/qualifyProjectionEvidence. Zapisane skipped i unevaluated nie stają się incorrect. Końcowa kolejność dowodów: received_at, attempt id, skill; niejednoznacznej równoczesnej kolejności nie rozstrzyga klient.

Nie obcinamy cicho dni, dzieci, zestawów ani kartkówek. Limity dotyczą tylko liczby dni i maksymalnie 5 practiceItems z flagą obcięcia. Limit transportowy adaptera: 2 MiB; większa odpowiedź powoduje jawny błąd learning_summary_too_large, nigdy sukces z częściowymi danymi. Rodzic może wtedy użyć childId lub krótszego okresu.

Błędy integracji mają Cache-Control: no-store także przy 401/403/404/429/503. Nie ujawniamy driver cause, URL bazy, odpowiedzi bramy, nagłówka Authorization ani prywatnego body. Dodajemy learning_summary_unavailable (503, retryable=true) do istniejącego katalogu errors/messages. Nie zmieniamy globalnego logowania niezwiązanych endpointów; integracja ma zredagowaną granicę błędów.

### Użycie przez Hermesa

Konfiguracja adaptera: UMIEM_BASE_URL (HTTPS, stała baza bez userinfo/query/fragment), UMIEM_READ_TOKEN_FILE (absolutna ścieżka do chronionego sekretu). Nie akceptujemy URL/tokenów od modelu; nie podążamy za redirectami i nie wyłączamy weryfikacji TLS. Loopback HTTP jest dopuszczalny wyłącznie w izolowanych testach, z jawnym test_mode. 10 s na próbę, jedno ponowienie, 25 s całego wywołania łącznie z oczekiwaniem. Retry-After obsługuje sekundy i HTTP-date, mieści się w pozostałym budżecie; 3xx/400/401/403/404, błędny JSON, nieobsługiwana wersja i naruszenie kontraktu nie są ponawiane.

Wieczorny report worker pobiera przez ClientSession dokładnie jedno wywołanie narzędzia MCP z days=7 i upcomingTestDays=14 przed wywołaniem modelu; kontekst: learning_overview {status: ok|unavailable|disabled, data?, errorCode?}. Morning oraz sync nie pobierają tych danych. Wyłączona integracja nie sugeruje awarii. Nieudany odczyt daje unavailable i nie przerywa szkolnej części raportu. Nie zapisujemy odpowiedzi do dzienniczek.md ani rodzina.md jako drugiej listy prawdy. Ponowienie przygotowanego raportu korzysta z utrwalonego tekstu i nie pobiera ponownie API.

Przed dodaniem danych do kontekstu stosujemy limit 4000 tokenów dla sekcji nauki. Redukcja deterministyczna zachowuje wszystkich childId, wszystkie raportowane daty, wszystkie plannedTests, dzienne i łączne learningTime oraz learningTimeDefinition: agreguje dzienne liczniki umiejętności po zestawach; pomija szczegóły kartkówek i practiceItems, jeśli potrzebne. Oznacza compacted=true i wymienia usunięte kategorie. Jeśli rdzeń wciąż przekracza limit, przekazuje unavailable/errorCode=learning_context_too_large, bez pozorowania pełnego odczytu. Narzędzie MCP w rozmowie nadal zwraca pełne API.

Rodzinny profil udostępnia toolset mcp-umiem i konfigurację mcp_servers.umiem. Szkolne numery kont nie są UUID profili Umiem!; nie dopasowujemy dzieci tylko po imieniu ani nie utożsamiamy dwóch sprawdzianów przez podobny tytuł. Raport zachowuje childId/nazwę i źródło terminów. Harmonogram Morning/Evening/Sync pozostaje bez zmiany; obecny Evening nie uruchamia się w sobotę. Ewentualny dodatkowy sobotni raport wymaga osobnego ustalenia.

### Kryteria akceptacji całości

1. Narzędzie MCP daje kompletny poprawny JSON dla 7 dni, także pustych, dla wszystkich dzieci lub wskazanego childId.
2. Daty i sprawdziany działają na granicy północy oraz obu zmianach DST; dzisiejszy dzień jest partial.
3. Dzienna aktywność, opanowanie i raport kartkówki zachowują osobne znaczenia; brak mowy nie oznacza błędnej wiedzy.
4. Token odwołany/pusty/błędny nie daje dostępu; nie umożliwia mutacji ani użycia Parent API.
5. Odczyt pozostawia wszystkie tabele uczenia niezmienione i nie finalizuje oczekujących sesji ani mowy.
6. Awaria MCP/API nie jest brakiem aktywności i nie blokuje istniejącego wieczornego raportu szkolnego.
7. Usunięty profil znika z kolejnego odczytu; wynik jednego dziecka nie przenika do drugiego.
8. Testy przed wdrożeniem używają wyłącznie fikcyjnych danych, bez modelu, realnych providerów i wysyłki WhatsApp. Próba z prywatnymi danymi/model/dostarczenie pozostają osobnymi obserwacjami po zgodzie na wdrożenie.
9. Każdy dzień i cały okres zawierają learningTime; przerwy >120 s i nakładające się sesje nie zawyżają wyniku. Hermes oznacza oszacowanie i nie przedstawia null jako 0 minut.

### Właściciel kodu i skilla — ustalenie 2026-10-11

Źródła MCP i SKILL.md są utrzymywane razem z API w Knowli. Repozytorium Hermesa zawiera wyłącznie klienta raportu, instalator i konfigurację konsumenta; nie kopię źródeł rozwijaną niezależnie. Wydanie adaptera, schema i skilla pochodzi z tego samego commita. AGENTS.md wymaga aktualizacji lub uzasadnienia braku wpływu przy każdej zmianie API. Kryterium akceptacji: manifest/stdio smoke potwierdza zgodność wydania, a native profil Hermesa odczytuje zainstalowany skill o zgodnym hashu. Kontrola u Hermesa jest dowodem wdrożenia, nie wynikiem samego PR w Knowli.
