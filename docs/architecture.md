# Architektura — Rodzinny asystent nauki AI

Wersja: 1.2, po review pakietu przed implementacją • 7 października 2026  
Podstawa: SPEC.md 1.1 oraz późniejsze ustalenia: Next.js + TypeScript, PWA z możliwością późniejszego użycia Kid Mode w Capacitor.  
Dokumenty towarzyszące: schema.sql, folder-structure.md, implementation-plan.md — wersja 1.2; SPEC pozostaje w wersji 1.1.

Poprawki 1.1: serwerowe rejestrowanie ujawnień, niezmienne zasoby i historia, jawne zakończenie Exposure, planowanie sprawdzeń przed podpowiedziami, generowanie zasobów niezależne od edycji szkicu i poprawna ocena wariantów odpowiedzi ustnych.

Poprawki 1.2: bootstrap pierwszego rodzica, zakres ochrony endpointu mediów, pełny cykl życia sesji (wznowienie, przeterminowanie, stany terminalne), nośnik kierunku dla opanowania reading, leniwa finalizacja przeterminowanych prób, egzekwowanie limitu czasu sesji, semantyka stanów review i retired_at, mapowanie błędów triggerów oraz wspólny katalog komunikatów UI.

## 1. Decyzja główna

Jeden modularny monolit w jednym repozytorium, dwa procesy wykonawcze i jedna baza:

- **web:** Next.js — panel rodzica, host interfejsu dziecka i API;
- **worker:** Node.js — generowanie treści, ilustracji i TTS;
- **db:** PostgreSQL — dane aplikacji i trwała kolejka Graphile Worker.

Web i worker korzystają z tego samego kodu serwerowego oraz schematu bazy. To nie są niezależne mikroserwisy. Wdrożenie odbywa się jednym projektem Docker Compose w Coolify. Web i worker mogą być zbudowane z jednego obrazu z innym poleceniem startowym.

To jawne doprecyzowanie SPEC §27: „jeden deploy aplikacji” oznacza wspólne wdrożenie projektu, a nie obowiązek zmieszczenia wszystkich zadań w jednym procesie. Nie dodajemy Redis, brokera wiadomości, osobnego serwera API ani klastra.

## 2. Rozważone warianty

| Wariant | Korzyść | Koszt | Decyzja |
| --- | --- | --- | --- |
| Next.js, wszystko w obsłudze HTTP | Najmniej procesów | Słaba kontrola długich generacji, retry i restartów | Odrzucony dla przygotowywania materiału |
| Next.js + worker + PostgreSQL | Wspólny język i logika, trwałe zadania | Jeden dodatkowy proces do utrzymania | Wybrany |
| React/Vite + osobny backend | Pełna niezależność klientów i backendu | Dodatkowy framework, kontrakty i cykl wdrożeń | Możliwy później, niewymagany teraz |

## 3. Stack i zasady wersji

| Warstwa | Wybór |
| --- | --- |
| Web | Next.js App Router, React, TypeScript strict, runtime Node.js |
| Kid UI | Biblioteka React/TypeScript, bez importów z Next.js |
| Kontrakty wejścia/wyjścia | Zod + jawne DTO HTTP/JSON |
| UI | Tailwind CSS; proste komponenty dostosowane do dziecka |
| Baza i zapytania | PostgreSQL, Drizzle ORM, sterownik pg |
| Migracje | Drizzle Kit generujący SQL do przeglądu i zatwierdzenia |
| Kolejka | Graphile Worker w tej samej instancji PostgreSQL, własny schemat narzędzia |
| Pliki | Prywatny trwały wolumen /data/media; interfejs MediaStore |
| Testy domeny | Vitest, zegar podawany jako argument |
| Testy integracji | Vitest + rzeczywisty PostgreSQL przez Docker/Testcontainers |
| Testy przepływu | Playwright oraz ręczna próba mikrofonu na urządzeniu dziecka |
| Narzędzia | pnpm workspaces; bez Nx/Turborepo na start |
| Wdrożenie | Docker Compose, Coolify, HTTPS |

Przy implementacji pinujemy konkretne wspierane stabilne wersje, obraz Node LTS i obraz PostgreSQL; żadnych zależności produkcyjnych na tagu latest ani wersji RC. Nie wpisujemy tu niezweryfikowanych numerów jako zobowiązania. Wybrane wersje trafią do lockfile i obrazów w pierwszym zadaniu implementacyjnym.

SQL w schema.sql jest przeglądowym modelem początkowym. Podczas implementacji należy odwzorować go w Drizzle i odtąd utrzymywać jeden autorytatywny schemat TS z migracjami SQL; nie rozwijać dwóch niezależnych definicji.

## 4. Granice kodu

| Część | Odpowiedzialność | Czego nie robi |
| --- | --- | --- |
| contracts | DTO, walidacja, typy bez sekretów oraz wspólny katalog komunikatów UI | Nie importuje bazy ani SDK AI |
| kid-ui | Zadania, ekran profilu, audio, mikrofon, feedback | Nie oblicza autorytatywnego postępu |
| server/domain | Reguły nauki, wsparcie, ocenianie pisowni i harmonogram | Nie zna Next.js, SQL ani Azure |
| server/modules | Przypadki użycia i granice transakcji | Nie renderuje UI |
| server/db | Drizzle, migracje, konkretne operacje zapisu/odczytu | Nie zawiera reguł dydaktycznych |
| server/providers | Adaptery LLM/TTS/STT/wymowy/obrazów i plików | Nie decydują o opanowaniu słowa |
| web | Cienkie endpointy i hostowanie widoków | Nie duplikuje logiki workerów |
| worker | Pobranie trwałego zadania i wywołanie przypadków użycia | Nie ma publicznego API ani nagrań dzieci w kolejce |

Nie budujemy ogólnego frameworka repozytoriów ani osobnego pakietu na każdą tabelę. Interfejsy wprowadzamy na granicach zewnętrznych: AI, pliki, zegar i transakcja. Polityka importów wyklucza server w browser bundle; CI sprawdza te zależności.

## 5. Przygotowanie do Androida

### Trasy web rodzica i dziecka

- `/` renderuje panel rodzica.
- `/learn` osadza KidApp. Gdy rodzina ma wiele profili, dziecko wybiera profil; przy jednym profilu ekran wyboru jest pomijany. Jest to także `start_url` PWA.
- `/kids/{childId}/learn` otwiera naukę z wybranym profilem. Trasa używa trwałego UUID profilu, a host przekazuje go do KidApp jako `initialChildId`. Nieznany lub usunięty identyfikator wraca do listy dostępnych profili.
- Panel rodzica pokazuje przy każdym profilu link do jego trasy nauki. Kid UI nie zawiera linku do panelu rodzica.

Kid Mode komunikuje się przez /api/v1/kid. Nie używa Server Actions ani pobierania danych przez Server Components jako warunku działania sesji. Next.js dostarcza tylko stronę startową i osadza KidApp. Routing wewnętrzny dziecka pozostaje w prostym module widoków; do wznowienia sesji wystarczy identyfikator zapisany lokalnie.

API klienta ma konfigurowalny baseUrl. W web jest same-origin. W przyszłości mały host Vite + Capacitor może spakować tę samą bibliotekę kid-ui i wskazać zdalne API. Nie eksportujemy całego Next.js statycznie i nie przenosimy backendu do telefonu.

MediaRecorder, odtwarzacz i lokalne ustawienia są za adapterami platformowymi. Dla Androida można podmienić obsługę uprawnień lub nagrywania bez przebudowy ćwiczeń. Panel rodzica pozostaje webowy. Przyszły klient mobilny wymaga osobnego rozwiązania sesji dostępu, dozwolonych originów, aktualizacji i uprawnień; nie ustawiamy dziś CORS na *. Offline i synchronizacja historii nie są implementowane.

## 6. Dane i wersjonowanie

### 6.1. Trzy różne tożsamości

1. **learning_item:** trwały element w zestawie, np. konkretne słowo Thursday.
2. **item_revision:** treść tego elementu w określonej wersji zestawu.
3. **skill_version:** wersja znaczenia i zasad oceny jednej umiejętności tego elementu.

Opublikowane rewizje są niezmienne. Edycja tworzy nowy draft całej wersji zestawu. Draft może być edytowany do publikacji. Generacja treści zestawu zapisuje wynik tylko przy zgodnym numerze edycji draftu. Generacja audio/obrazu jest niezależnym zadaniem zasobu i nie podlega numerowi edycji całego szkicu; podpięcie wyniku wymaga zgodności jego fingerprintu z aktualnym zapotrzebowaniem karty. Sesja przypina deck_version i learning_policy, więc publikacja w jej trakcie nie zmienia pytań ani progów.

item_revision_skills wskazuje skill_version osobno dla listening, reading, recall, pronunciation i spelling. Wersja kosmetyczna ponownie używa tych samych kluczy. Nowe znaczenie tworzy nowe klucze dla listening/reading/recall. Nowe angielskie słowo tworzy nowe klucze wszystkich umiejętności. Zmiana reguł pisowni tworzy nowy klucz spelling. Zmiana wariantów wymaga jawnej mapy wpływu; nie ma automatycznego „wszystko zachowaj”.

skill_version zawiera niezmienne kryteria i opcjonalny poprzedni klucz. Dla nowego klucza nie kopiujemy statusu mastered; pokazujemy „do ponownego sprawdzenia”, z możliwością podglądu poprzednich wyników. Próba starej sesji aktualizuje wyłącznie stare klucze. Stara historia nigdy nie awansuje nowego klucza przez sam zgodny item_id.

### 6.2. Projekcje postępu

child_skill_progress ma klucz (child_id, skill_version_id). Jest cache'em aktualnego wyniku, a nie jedyną historią. Źródłem są attempts, assessments i wydarzenia ekspozycji. Zapis oceny oraz aktualizacja projekcji następują w jednej transakcji. Rekalkulację wykonujemy jawnie z wersjonowanym algorytmem; nie przepisuje ona historycznych ocen.

Po wydaniu zadania nie można zmieniać jego treści, klucza odpowiedzi, przypiętych identyfikatorów ani kontekstu. Zmienia się wyłącznie stan zadania. Oceny wolno wstawić tylko do próby processing, pod blokadą jej wiersza, przed jednokrotną finalizacją. Wydarzenia i ich ekspozycje są zapisywane atomowo i zamrażane przed udostępnieniem treści. SQL blokuje późniejsze dopisanie/usunięcie/zastąpienie ocen i zmianę ekspozycji. Usuwanie tych rekordów jest dozwolone przez kontrolowane usunięcie profilu: triggery dopuszczają kaskadę tylko wtedy, gdy nadrzędny profil już nie istnieje. Zwykłe usunięcie próby, zadania lub oceny przy istniejącym profilu jest zabronione. Wyjątki z triggerów zabezpieczeń są mapowane na wspólny format błędu API z kodem typu immutable/conflict i krótkim polskim komunikatem; surowy tekst SQL nie trafia do klienta.

Nie ma pojedynczego stage dla karty. Zestaw i materiały są wspólne, a przypisanie, termin sprawdzianu, sesje i postęp należą do dziecka.

### 6.3. Relacje i ograniczenia

schema.sql zawiera FK i klucze złożone chroniące przed przypisaniem sesji do cudzej wersji zestawu lub wyniku do innego dziecka. JSONB przechowuje wersjonowane treści i kontekst, ale profile, przypisania, próby i powiązania pozostają relacyjne. Domena waliduje JSON przez Zod.

Zestaw może zostać wycofany bez fizycznego usuwania jego rewizji. Usunięcie elementu ze szkicu sprawia, że znika on z nowej wersji, a learning_items.retired_at oznacza element nieobecny w bieżącej wersji — historia jego prób pozostaje czytelna. Ponowne dodanie tego samego słowa tworzy nowy learning_item z nowymi kluczami umiejętności; stara historia nowego klucza nie awansuje. Usunięcie profilu usuwa jego sesje, próby, wydarzenia i projekcje w transakcji, zachowując wspólne materiały. Fizycznego kasowania opublikowanego materiału z historią nie ma w zwykłym edytorze.

## 7. Przygotowanie i publikowanie zestawu

1. POST rodzica przyjmuje prompt i klucz idempotencji; tworzy deck, draft oraz generation_run.
2. Ta sama transakcja rejestruje zadanie w Graphile Worker przez SQL na tej samej sesji bazy. Nie ma luki „zapisano rekord, lecz nie wysłano zadania”.
3. Worker wywołuje LLM, waliduje JSON, zapisuje elementy i proponowane warianty odpowiedzi. Nie publikuje. Po sukcesie generacji draft przechodzi w stan review — szkic kompletny, oczekujący na przegląd rodzica; stany draft i review są równie edytowalne, a indeks one_editable_version_per_deck obejmuje oba.
4. Osobne, współdzielone zadania zasobów przygotowują wymagane TTS oraz sensowne ilustracje object/action. Kolory, liczby i sekwencje to dane do deterministycznego renderowania.
5. Rodzic przegląda treść oraz zasoby. Po każdej edycji reconcileDraftAssets porównuje wymagane fingerprinty ze stanem powiązań: zachowuje zgodne, odłącza niezgodne i w tej samej transakcji rezerwuje/zleca brakujące. Zmiana tytułu nie unieważnia zadań audio. Po zmianie tekstu zmienia się fingerprint audio; stary plik nie jest podpinany do nowej treści.
6. Publikacja jest transakcją: sprawdza wersję draftu, kompletność obowiązkowego audio, zatwierdzenie treści i stan obrazów. Obraz może być świadomie pominięty. Wymagany TTS nie może być pominięty dla pełnego zestawu językowego.
7. Transakcja ustawia stan published i aktualny wskaźnik deck.published_version_id. Nie podmienia wersji aktywnych sesji.

Domyślne ograniczenia MVP: do 50 elementów na zestaw, do 120 znaków celu/źródła, 300 znaków przykładu i 4000 znaków promptu. To limity operacyjne do zmiany w konfiguracji, nie nowe wymagania dydaktyczne. Niepełny zestaw trafia do poprawy. Kompletność zamkniętych tematów, np. dni tygodnia, można sprawdzić prostą regułą; nie budujemy uniwersalnego katalogu wiedzy.

## 8. Zadania w tle i zasoby

Graphile Worker wykonuje zadania co najmniej raz. job_key nie zastępuje trwałej idempotencji aplikacji. Dla generowania treści generation_run jest związany z draftem i expected_edit_number; dla TTS/obrazu wiąże się wyłącznie z asset_id, bez deck_version_id i numeru edycji. Jeden run zasobu może obsłużyć wiele szkiców.

Fingerprint TTS obejmuje dokładny tekst, locale, provider, model, głos i parametry; nie utożsamiamy go z target_key ekspozycji. Fingerprint obrazu obejmuje prompt, provider/model, rozmiar, jakość i format; startowe domyślne ustawienia to low + WebP (high/png kosztowało ~0,17 USD za obraz przy kartach wyświetlanych w ~300 px). Pełne żądanie obrazu przewozi metadana zasobu do executora, więc faktyczne wywołanie API nie może się rozjechać z fingerprintem. media_assets ma unikalność (fingerprint, generation_number). Zwykłe żądanie używa zgodnego gotowego zasobu albo dołącza do istniejącej generacji. Świadoma regeneracja tworzy nowy numer generacji i nowe asset_id, także dla tych samych ustawień. Nigdy nie zastępuje już zatwierdzonego zasobu starej wersji.

Rezerwacja generacji dla fingerprintu odbywa się w krótkiej transakcji pod blokadą tego klucza. Dokładnie jeden generation_run przypada na asset_id. Zasób ma własny lease_token/lease_until; finalizacja TTS/obrazu jest compare-and-set na aktualnym właścicielu lease zasobu. Generacja treści używa lease w generation_run. Nie trzymamy transakcji przez czas wywołania dostawcy.

MediaStore.putImmutable(bytes) wylicza hash zawartości i zapisuje plik bez nadpisania istniejących bajtów. Jeśli blob o tym hashu już istnieje, sprawdza zgodność i ponownie go używa. Gotowy media_asset (state=ready, storage_key, content_sha256, metadane) jest niezmienny na poziomie SQL. Różne rekordy mogą wskazywać ten sam niezmienny blob. Spóźniony worker może pozostawić niepodpięty blob, lecz nie zmieni gotowego asset ani pliku używanego przez opublikowany materiał. Automatyczny garbage collector nie jest częścią MVP; ewentualne porządkowanie nigdy nie usuwa blobów mających referencje.

Po ukończeniu zasobu worker w jednej transakcji, po skutecznym CAS lease, aktualizuje wyłącznie globalny asset/run. Nie nadpisuje powiązań draftu. revision_assets przechowuje expected_fingerprint oraz wskazanie wybranej generacji; publikacja i zatwierdzanie sprawdzają zgodność fingerprintów i stan ready. Jeśli rodzic w międzyczasie zmieni kartę, stary wynik może pozostać w cache, ale nie zostanie automatycznie podpięty do zmienionej treści. Edycja ponownie uzgadnia wymagane zasoby; retry generacji zasobu nie zależy od starego edit_number. Świadome pominięcie obrazu pozostaje zachowane, dopóki rodzic nie zmieni decyzji lub znaczenia wizualizacji.

Odpowiedź usługi może zaginąć po opłaconym wykonaniu, więc nie obiecujemy braku podwójnej opłaty w każdym możliwym scenariuszu. Gwarantujemy jednokrotną logiczną finalizację i niezmienność wybranego wyniku.

Retry: maksymalnie trzy automatyczne próby, opóźnienia i jitter. Błędy walidacji/konfiguracji nie są bez końca ponawiane. Wątpliwy timeout płatnej generacji jest pokazywany rodzicowi przed ręcznym ponowieniem. Początkowa równoległość: 2, z limitem 1 dla obrazów. Postęp jest odczytywany przez polling.

MediaStore ma putImmutable/get; MVP używa prywatnego wolumenu. Odczyt zatwierdzonego zasobu odbywa się po opaque media ID, nie po ścieżce od klienta. Ochrona endpointu mediów jest konkretna: zwraca wyłącznie zasoby state=ready, działa tylko same-origin z wyłączonym CORS (przyszły host mobilny będzie wymagał świadomej zmiany tej zasady), nie listuje zawartości i nie przyjmuje ścieżek. Kid Mode nie ma własnej autoryzacji — dostępnością steruje fakt, że media ID dziecko otrzymuje wyłącznie w DTO zadania albo w zgłoszeniu odsłuchu po zapisanej ekspozycji, a rodzic w DTO szkicu. Worker ma RW, web RO przy konwersji głosu w pamięci. Kid API wydaje autoryzację odsłuchu w kontekście kroku zadania po zapisaniu ekspozycji, a sam endpoint pliku nie wyznacza czasu ekspozycji. Publicznego katalogu /data nie udostępniamy.

## 9. Sesja, ekspozycje i harmonogram

### 9.1. Pytanie jest obiektem serwerowym

SessionTask zapisuje typ, rewizję elementu, wersję polityki, opcje z nieznaczącymi identyfikatorami oraz prywatny answer_key. Publiczny DTO nie zawiera rozwiązania ukrytego zadania, ocen ani parametrów providera. Pokazanie odpowiedzi następuje po odpowiedzi lub świadomym „Nie pamiętam”.

Start/resume zapewnia jedną aktywną sesję dziecka, zamiast dwóch konkurujących na dwóch urządzeniach: start dla tej samej talii wznawia aktywną sesję, a start dla innej talii kończy ją stanem ended i tworzy nową. Aktywna sesja jest wznawialna do 30 minut od ostatniego zdarzenia (wydanie zadania, próba albo ujawnienie); późniejszy start lub wznowienie zamyka przeterminowaną sesję jako ended i otwiera nową. Wartość 30 minut to parametr startowy. Stany terminalne różnią się znaczeniem: completed to jawny koniec z podsumowaniem (POST /end po wyczerpaniu budżetu lub decyzji dziecka), a ended to zamknięcie systemowe bez podsumowania (nadpisanie nową sesją albo przeterminowanie). Jedna sesja nie oznacza wyłączności przeglądarki: ujawnienia i odpowiedzi wszystkich klientów podlegają tej samej blokadzie serwerowej. Unikalny indeks w bazie wymusza tę zasadę. Krótka blokada wiersza sesji serializuje kolejne zadania i próby, bez blokowania na czas odpowiedzi dziecka.

### 9.1a. Zakończenie prezentacji i zadania

POST /api/v1/kid/tasks/:id/complete-presentation przyjmuje clientCommandId i kończy tylko zadanie exposure: issued → completed. Nie tworzy attempt ani assessment i nie zużywa budżetu ocenianych zadań. Endpoint attempts odrzuca odpowiedzi do exposure; prezentację można również zakończyć przez zamknięcie całej sesji. Kolejne wywołanie dla tego samego zakończonego task zwraca ten sam rezultat, bez zakończenia nowego zadania. Polecenie dla zadania ocenianego jest odrzucane.

Dla zadań ocenianych pierwsza błędna odpowiedź może pozostawić task w issued dla drugiej próby. Poprawna odpowiedź kończy task jako answered. Drugi błąd lub „Nie pamiętam” kończy go jako answered i kieruje do wsparcia, a „Pomiń” do skipped. „Nie pamiętam” w kontekście niezależnym zapisujemy jako ocenę incorrect z reason dont_remember i independent=true: przerywa serię sukcesów, ale nie tworzy mylonej pary; „Pomiń” zostawia wyłącznie próbę modality skip, bez ocen. Błąd techniczny nie nalicza błędu wiedzy i pozwala ponowić nagranie albo pominąć. next nie zamyka zadań domyślnie: dla issued zwraca to samo zadanie, a nowe tworzy dopiero po terminalnym stanie poprzedniego. Serwer kontroluje warunki przejścia pod blokadą sesji; odpowiedź dla zakończonego task nie tworzy kolejnej próby. Transportowy retry istniejącego attempt zwraca jego wynik.

### 9.2. Wydarzenia kontaktu i ujawnienia

learning_events zapisuje kontakt i ujawnienie, a event_exposures zawiera target_key dla każdego ujawnianego angielskiego celu, także dystraktora. target_key to hash tekstu po Unicode NFC, przycięciu zewnętrznych spacji, lowercase i dołączeniu locale. Warianty mają własne klucze. Nie stosujemy dopasowania rozmytego. Śledzenie ekspozycji jest wspólne dla tego dziecka między sesjami i zestawami, bez współdzielenia opanowania różnych kart.

**Serwer zapisuje konserwatywną ekspozycję przed wydaniem treści.** W jednej transakcji pod blokadą sesji tworzy learning_event, komplet event_exposures i zamyka event; dopiero po commit zwraca prompt, podpowiedź, feedback lub zgodę na odtworzenie audio. Jeśli odpowiedź sieciowa zaginie, przyjmujemy możliwość ujawnienia, zamiast ryzykować zawyżenie samodzielności. Event i ekspozycje stanowią niezmienny zapis.

POST /tasks/:id/disclosures z serwerowym stepId wydaje podpowiedź albo autoryzuje każde odtworzenie wzorca. Przeglądarka nie pokazuje ukrytego wzorca ani nie odtwarza go z cache przed potwierdzeniem serwera. Ponowne wydanie treści po reloadzie lub retry rejestruje nowy czas możliwej ekspozycji; ocena zakończonej próby pozostaje ta sama. Client event wyświetlenia/odsłuchu jest opcjonalnym potwierdzeniem obserwacyjnym, nigdy warunkiem istnienia ekspozycji. Brak potwierdzenia, reload i druga karta nie usuwają serwerowego zapisu.

Przy przejściu dalej serwer konserwatywnie zapisuje końcowy kontakt z treścią rozwiązania, która mogła pozostawać widoczna w poprzednim kroku. Powrót z tła wymaga odświeżenia kroku; podczas utraty sieci UI ukrywa wzorce i blokuje nowe odsłuchy/oceniane próby. Nie próbujemy dowodzić, czy dziecko rzeczywiście patrzyło na ekran. To prosta ostrożna polityka pomiaru, nie mechanizm antyoszustw.

Przy przyjęciu odpowiedzi serwer pod tą samą blokadą wylicza i zapisuje jej kontekst kwalifikacji według autorytatywnego czasu received_at. Dla mowy kontekst jest zamrożony przed wywołaniem usług; 30 sekund analizy nie może zamienić próby z 299 sekund w niezależną. Ujawnienie feedbacku następuje po tej kwalifikacji i nie zmienia jej wstecznie. Ujawnienie na drugim kliencie przed przyjęciem odpowiedzi jest uwzględnione dzięki wspólnej kolejności transakcji.

Sesja i client response zawierają identyfikator zadania/kroku. Odpowiedź dla starego kroku nie wydaje niejawnie nowego zadania. Wszystkie endpointy ujawniające treść, także odczyt zakończonego attempt, stosują tę samą barierę przed zwróceniem feedbacku.

### 9.3. Polityka początkowa

`learning_policy` jest niezmiennym JSON-em identyfikowanym np. `learning-v1`, przypiętym do sesji. Rozstrzygnięcie polityki dla sesji to `child.policy_id ?? CURRENT_POLICY_ID`; dzieci bez przypiętej polityki używają bieżącej wersji, domyślnie `learning-v2`. Polityka odwzorowuje SPEC: 300 sekund od ujawnienia, trzy ostatnie kwalifikujące sukcesy, potwierdzenie innego dnia i po 12 godzinach, dwa błędy przed wsparciem. Warunek 12 godzin bierze kontakt z poprzednich sesji zapisany przy starcie aktualnej sesji; późniejszy kontakt w bieżącej sesji nie kasuje tej historycznej podstawy, lecz nadal obowiązuje warunek 300 sekund.

Zmiana progów wymowy dziecka tworzy niezmienną wersję polityki o identyfikatorze `child-<id>-<n>` i przypina ją do profilu; sesje już rozpoczęte zachowują poprzednią wersję. `learning-v2` ustawia progi 70/50: wynik od progu „dobrze” jest poprawny, od progu „prawie” do progu „dobrze” jest częściowy, a wynik poniżej progu „prawie” jest nieoceniony. Rodzic może pobrać listę ostatnich ocen z wynikiem providera i pasmem. Recall i spelling mają osobne wyniki. Dla reading kierunek ćwiczenia jest zachowany: ocena rozpoznawania zapisuje direction (en→pl albo pl→en) w details, a opanowanie wymaga, aby wśród trzech ostatnich kwalifikujących sukcesów znalazł się co najmniej jeden w każdym kierunku. Projekcja liczy kierunki z ocen; child_skill_progress nie dostaje osobnej kolumny kierunku. Listening i reading wstępnie używają trzech wiarygodnych prób z potwierdzeniem po przerwie, bez reguły 300 sekund odnoszącej się do przypominania angielskiego rozwiązania. Wymowa korzysta z pasm skalibrowanych w próbie technicznej i potwierdzenia w późniejszej sesji; widoczny wzorzec jest dla niej dozwolony.

Proponowany scheduler v1: priorytety zamiast trudnego do wyjaśnienia losowego score.

Na początku planowania serwer rezerwuje należne, już kwalifikujące się sprawdzenia Recall/pisowni przed ponownym ujawnieniem ich celów. Dopóki taki sprawdzian oczekuje, inne zadanie nie może pokazać/odtworzyć celu ani użyć go jako dystraktora lub jawnego fragmentu wyrazu. Scheduler dobiera inne dystraktory, mniej opcji albo najpierw wykonuje zarezerwowany sprawdzian. Zapisuje decyzję w kontekście sesji. Po sprawdzeniu lub świadomym pominięciu zwalnia rezerwację; podpowiedź poproszona przez dziecko kończy niezależne sprawdzanie jako wspomagane. Feedback ujawnia wyłącznie rozwiązanie własnego zadania i treści, które to zadanie już pokazało; nie nazywa celów objętych aktywną rezerwacją. Gdy ten sam cel wymaga Recall i pisowni, jedna odpowiedź pisemna może dostarczyć obu wyników, zanim feedback ujawni słowo.

Nie wymuszamy sprawdzania nieznanych słów ani oczekiwania na zegar. Jeśli warunek przerwy nie jest spełniony, wybieramy utrwalanie i planujemy niezależny sprawdzian na później. Testy obejmują kolejną sesję znającego materiał dziecka, nie tylko pierwszą naukę.

Zestaw można ćwiczyć w dowolnym momencie (uzupełnienie wersji 1.1): gdy dla dziecka nic nie jest należne i nie ma nowego materiału, scheduler wydaje jako ostatni priorytet lekkie utrwalanie rozpoznawania (słuch/tekst) już rozpoczętych elementów — reason `extra-practice`, obrót deterministyczny wg pozycji i ordinalu, elementy w pełni opanowane na końcu kolejki, rezerwacje sprawdzeń obowiązują jak w każdej innej ścieżce. Zadanie jest oceniane i mieści się w zwykłym budżecie sesji; jakość dowodów chroni reguła niezależności (SPEC §18: próba w ciągu 5 minut od ujawnienia wzorca to utrwalanie), więc dodatkowe ćwiczenie nie zawyża serii kwalifikujących ani nie zastępuje zaplanowanego sprawdzianu. Lista zestawów dziecka zawiera pole `recommended` (true, gdy w wersji jest teraz zaplanowana praca: należne sprawdzenie, powtórka, czekające wprowadzenie etapu albo nieprzerobiony element); klient pokazuje te zestawy w sekcji „Rekomendowane”, a wybór dowolnego przypisanego zestawu pozostaje możliwy zawsze.

Wprowadzanie kolejnych etapów (uzupełnienie wersji 1.2, SPEC §13): element, którego rozpoznawanie ma samodzielny sukces (aktualna seria słuchu albo tekstu ≥ 1), a przypominanie nie było jeszcze zadaniem, przechodzi do pierwszego zadania recall (reason `stage-introduction`; jedna pisemna odpowiedź ocenia też pisownię), a po nim — przy zgłoszonym mikrofonie — do pierwszego zadania wymowy. Wprowadzenie bierze co drugi slot sesji (nieparzysty ordinal od zera), aby nowy materiał, należne powtórki i utrwalanie nie czekały na całą falę nowego etapu i sesja zachowywała miks typów zadań. Etap „wprowadzony” pamięta historia zadań dziecka (dowolne zadanie recall/speech tego elementu), więc próba technicznie nieoceniona nie zapętla wprowadzania; cel objęty rezerwacją sprawdzenia nie jest wprowadzany, bo widok wymowy ujawnia słowo. Bez mikrofonu wymowa się nie pojawia, a przypominanie i pisownia działają normalnie.

Po tej ochronie kolejności obowiązują pozostałe priorytety. Najpierw zaległe sprawdzenia i trudności aktualnego zestawu, potem znane łatwiejsze elementy i nowe porcje po 2–3. Co najmniej co trzecie zadanie po serii trudności jest łatwiejsze. Ten sam element nie wraca od razu po dwóch błędach; wyjątkiem jest pokazanie wzorca jako wsparcie.

Początkowe odstępy po sukcesach: 1 dzień, 3 dni, 7 dni; po trudności — powrót po innych elementach w sesji oraz następnego dnia. Błędy techniczne nie przesuwają harmonogramu jak błędy wiedzy.

Termin sprawdzianu jest opcjonalny i należy do przypisania dziecka. Nowa sesja kopiuje `assignment.testDate` oraz strefę rodziny do prywatnego `learning_sessions.context`; resume używa tej migawki, a legacy bez pola nie pobiera późniejszej daty przypisania. Czysta funkcja `isTestPreparationWindow` wyznacza granice przez lokalny początek dnia w IANA timezone: otwarcie dokładnie 48 godzin wcześniej i cały lokalny dzień sprawdzianu. Nie dodajemy kolumny sesji ani DTO dziecka.

Po należnym sprawdzeniu Recall/pisowni, wsparciu i poprawce po wsparciu scheduler wybiera w tym oknie wcześniej ujawniony cel z sukcesem rozpoznawania, który nie ma jednocześnie opanowanych Recall i pisowni. Deterministyczne sortowanie preferuje `needs_reconfirmation`, potem wymagającą ćwiczeń pisownię, Recall i pozycję w talii. Zadanie jest zwykłym ocenianym `recall` bez ujawnionych celów i zużywa istniejący budżet. Historia pieczętowanych `event_exposures` określa, czy słowo było wcześniej widoczne; historia `session_tasks.context.reason` zapobiega ponownemu wydaniu tego samego przygotowania i przechowuje dwa ostatnie oceniane powody. Po dwóch kolejnych `test-preparation` scheduler wstawia `test-preparation-break` z łatwym rozpoznawaniem, jeśli istnieje bezpieczny rozpoczęty element. Przy braku kandydata kontynuuje zwykłe bezpieczne priorytety. Rezerwacje chronią cele i dystraktory jak w innych zadaniach. Zmiana terminu nie wpływa na aktywną sesję; kryteria opanowania, obsługa pominięcia i „Nie pamiętam” pozostają bez zmian.

Sesja domyślnie ma budżet 12 ocenianych zadań i do 10 minut, z możliwością wcześniejszego końca. To maksymalny budżet, nie obowiązek. Ponowienia i zadania wspomagające mieszczą się w nim; prezentacja/feedback nie powiększają go. Po komunikacie „Jeszcze 3” rezerwujemy trzy pozostałe zadania, bez dokładania zadań naprawczych poza budżetem. Limit czasu egzekwujemy tylko między zadaniami, przy planowaniu next: po jego przekroczeniu serwer nie wydaje nowych zadań ocenianych i prowadzi sesję do zakończenia; nie przerywa zadania w trakcie ani obietnicy „Jeszcze N” — zarezerwowane zadania są dokończone, bo obietnica wobec dziecka waży więcej niż miękki limit. Parametry są propozycjami startowymi architektury, do kalibracji z dzieckiem.

## 10. Zapis odpowiedzi i niezawodność

POST attempts przyjmuje clientAttemptId, taskId i odpowiedź. Unikalność (child_id, clientAttemptId) zabezpiecza retry. request_hash wykrywa ponowne użycie klucza z inną odpowiedzią i zwraca 409. Klient nie wysyła własnego score, expectedText ani informacji „opanowane”.

Dla odpowiedzi tekstowej cała ocena, zapis próby, ocen per umiejętność i projekcji jest jedną transakcją. Dla mowy rezerwujemy attempt w processing, wykonujemy analizę poza transakcją, następnie atomowo finalizujemy rekord i projekcje. Finalizacja jest jednokrotna przez compare-and-set stanu. Próby completed są niezmienne.

Retry przy completed zwraca ten sam wynik. Retry przy processing nie uruchamia drugiej płatnej analizy; klient otrzymuje 202 z adresem odczytu statusu. Jeśli proces padł, stare processing po 60 sekundach finalizuje się jako nieocenione; nowe nagranie jest nową próbą. Finalizacja przeterminowanych prób jest leniwa i nie ma osobnego joba w tle: readAttempt oraz submitAttempt dla tego samego zadania przed obsługą żądania zamieniają processing starsze niż 60 sekund w nieocenione, co otwiera drogę nowej próbie. Nie odtwarzamy analizy z utrwalonego audio, bo go nie przechowujemy.

Nie gwarantujemy zapisu odpowiedzi, która nigdy nie dotarła do serwera. UI pokazuje błąd/stan zapisu, a nie fałszywy sukces. Nie wprowadzamy pełnej kolejki offline.

## 11. Mowa: osobna ścieżka niskiego opóźnienia

Ocena nagrania dziecka jest krótkim żądaniem web → provider. Nie przechodzi przez trwałą kolejkę generowania obrazów, aby nie opóźniać feedbacku i nie przechowywać nagrań na czas oczekiwania.

Web przyjmuje nagranie przez ograniczony strumień: początkowo do 15 sekund i 2 MiB. Sprawdza rzeczywisty format, czas i rozmiar po dekodowaniu. Adapter formatu normalizuje dane w pamięci do formatu potwierdzonego próbą techniczną. Jeżeli wymagane jest narzędzie ffmpeg, działa przez stdin/stdout z limitami i bez plików nagrań. Wybór kodeka i dokładnej metody dekodowania jest wynikiem fazy 0, nie założeniem „każdy Blob działa”.

Łączny deadline analizy: 30 sekund; timeout daje nieocenione albo wiarygodny wynik częściowy. Przeglądarka zwalnia strumień mikrofonu po nagraniu, końcu zadania i zmianie widoku. Aplikacja, proxy, error tracker i logi nie zapisują body ani nagrań. Analiza kończy się zwolnieniem buforów także przy błędzie; awaria procesu nie pozostawia pliku audio.

SttProvider i PronunciationProvider mają niezależne wyniki. Nie oceniamy poprawności treści na podstawie score dla oczekiwanego tekstu. Wiarygodną transkrypcję najpierw dopasowujemy do odpowiedzi kanonicznej i całego zatwierdzonego zbioru wariantów. Inny zatwierdzony wariant jest poprawną treścią i może zaliczyć Recall. Jeśli wariant różni się od tekstu użytego do pronunciation assessment, jego wyniku nie przenosimy na wypowiedziany wariant: wykonujemy ocenę względem dopasowanego wariantu w ramach tego samego deadline albo zapisujemy pronunciation jako nieocenione. Dopiero wiarygodny tekst spoza zatwierdzonego zbioru jest błędną treścią; ocena wymowy oczekiwanego słowa jest wtedy nieadekwatna i nie obniża tej umiejętności. Niepewne rozpoznanie nie tworzy confusion. Poprawna treść plus nieudana ocena wymowy daje wynik częściowy.

Domknięcie zadania ćwiczenia wymowy (uzupełnienie wersji 1.2): w ćwiczeniu wymowy (§12.6) oceniamy samą wymowę, ale o zamknięciu zadania decyduje treść wypowiedzi. Wiarygodna transkrypcja zgodna z kluczem wykonuje ćwiczenie także wtedy, gdy wymowy nie udało się ocenić (brak pasm w polityce, awaria providera — SPEC §15.4): zadanie przechodzi w answered, wymowa zostaje nieoceniona z zachowanym wynikiem providera w details, a dziecko dostaje neutralny komunikat „Usłyszałem! Nie udało się ocenić wymowy”. Druga wiarygodna rozbieżność domyka zadanie bez żadnych ocen wiedzy (§15.3 kontynuowanie); próba techniczna zostawia drugie podejście, a „Pomiń” jest na ekranie wymowy dostępny zawsze.

Azure Pronunciation Assessment jest proszony o `Granularity: Phoneme`. Fonemy są dopasowywane do grup liter oczekiwanego słowa wyłącznie dla wizualnego feedbacku dziecka („dobrze”/„prawie”); UI dziecka nie otrzymuje punktów ani IPA, a grupy nie zmieniają oceny domenowej. Brak dopasowania fonemów pozostawia zwykły feedback wymowy. Lista prób kalibracyjnych jest dostępna wyłącznie w panelu rodzica i zawiera ostatnie wyniki usługi.

Pierwszy kandydat wymowy: Azure. Wzorzec TTS: OpenAI. Adapter LLM: OpenAI; późniejszy OpenRouter jest dodatkowym adapterem, bez zmiany domeny. ImageProvider: adapter usługi generowania obrazów wybranej w fazie 0. Konkretnych modeli, progów pewności i ich cen nie uznajemy tutaj za sprawdzone. Faza 0 weryfikuje działający zestaw modeli i kodeków, zapisuje konfigurację i ustala, czy ocena jest dostatecznie wiarygodna dla dziecka. Brak pozytywnego wyniku tej próby blokuje deklarację pełnego MVP, a nie prowadzi do udawania oceny wymowy przez STT.

## 12. API — minimalny kontrakt

Wspólny format błędu: {code, message, retryable, requestId}. Walidacja na granicy przez Zod, daty ISO UTC, deadline sprawdzianu jako lokalna data rodziny. Każdy endpoint rodzica sprawdza sesję niezależnie od widoczności przycisków.

| Grupa | Endpoint | Wynik |
| --- | --- | --- |
| Parent | POST /api/v1/parent/login; POST /logout | Cookie sesji lub błąd |
| Parent | GET/POST /api/v1/parent/children; PATCH/DELETE /children/:id | Profile i usunięcie danych dziecka |
| Parent | POST /api/v1/parent/decks/generate | 202 + generationRunId + deckId |
| Parent | POST /api/v1/parent/decks | 201 pusty szkic; retry z tym samym deckId zwraca 200 bez zmiany zawartości |
| Parent | GET /api/v1/parent/generation/:id | Stan i zwięzły błąd |
| Parent | GET /api/v1/parent/decks/:id | Draft, wersja publikowana, zasoby |
| Parent | POST /api/v1/parent/decks/:id/draft | 201 + nowy szkic z bieżącej opublikowanej wersji (elementy, klucze umiejętności i decyzje o mediach) |
| Parent | PATCH /api/v1/parent/drafts/:id | Edycja z expectedEditNumber |
| Parent | POST /api/v1/parent/drafts/:id/publish | Atomowa publikacja lub konflikt |
| Parent | PUT /api/v1/parent/assignments/:childId/:deckId | Przypisanie i termin |
| Parent | POST /api/v1/parent/decks/:id/archive | Wycofanie z nowych sesji |
| Parent | GET /api/v1/parent/progress?childId=&deckId= | Podsumowanie umiejętności i pomyłek |
| Kid | GET /api/v1/kid/profiles | Tylko nazwa i awatar |
| Kid | GET /api/v1/kid/decks?childId= | Przypisane opublikowane zestawy z flagą `recommended`, liczbą słów oraz liczbą elementów z opanowanym samodzielnym Recall |
| Kid | POST /api/v1/kid/sessions | Start lub resume z przypiętą wersją |
| Kid | POST /api/v1/kid/sessions/:id/next | Idempotentne wydanie aktywnego zadania |
| Kid | POST /api/v1/kid/tasks/:id/events | Opcjonalne potwierdzenie obserwacji; nie tworzy jedynego dowodu ujawnienia |
| Kid | POST /api/v1/kid/tasks/:id/disclosures | Zapis ekspozycji i wydanie podpowiedzi/autoryzacji odsłuchu |
| Kid | POST /api/v1/kid/tasks/:id/complete-presentation | Idempotentne zakończenie Exposure bez próby i oceny |
| Kid | POST /api/v1/kid/tasks/:id/attempts | Wynik tekstowy/wybór/nie pamiętam; multipart dla audio |
| Kid | GET /api/v1/kid/attempts/:id | Wynik trwającej lub zakończonej oceny |
| Kid | POST /api/v1/kid/sessions/:id/end | Koniec i podsumowanie |
| Media | GET /api/v1/media/:id | Zasób state=ready po opaque ID; same-origin, bez CORS; nie wyznacza ekspozycji |

Klient rodzica zachowuje migawkę formularza wraz z jego bazowym
`expectedEditNumber`. Polling nie zastępuje formularza rozpoczętego lokalnie;
409 ani próba edycji opublikowanego szkicu nie są ponawiane z nowszą wersją.
Po osobnym odczycie rodzic wybiera, czy jawnie przejść do aktualnego szkicu,
czy utworzyć nową wersję z opublikowanego materiału. To zachowanie nie dodaje
endpointu ani nie zmienia optimistic locking w API.

Podsumowanie sesji (SPEC §17, uzupełnienie 2026-10-09): `SessionSummaryDto` zawiera `independentSuccesses: { recall, spelling }` (liczby różnych elementów z poprawną niezależną oceną w tej sesji) oraz `practiceItems: [{ itemId, target, skills }]`, gdzie `skills` to przypominanie i/lub pisownia. Wpis do ćwiczenia powstaje z błędnej oceny, w tym „Nie pamiętam”; późniejszy poprawny niezależny wynik usuwa trudność tylko tej umiejętności. Poprawne odpowiedzi ze wsparciem, pominięcia i wyniki nieocenione nie usuwają trudności ani nie zwiększają samodzielnych sukcesów. Historia innych sesji i projekcja ogólnego postępu nie są wynikiem bieżącej sesji. Wynik jest utrwalany pod blokadą w `learning_sessions.context.summary` przy pierwszym zakończeniu; oczekująca analiza mowy nie przepisuje już pokazanego podsumowania. Kolejny odczyt zwraca ten sam wynik, ale ponownie zapisuje zamknięte ekspozycje wszystkich wyświetlanych wzorców przed odpowiedzią HTTP. Ekran pokazuje neutralny komunikat bez samodzielnych sukcesów i nie deklaruje opanowania słów.

Edycja obrazów, dodawanie/usuwanie kart i ponawianie konkretnego zasobu korzystają z PATCH draft lub dedykowanego polecenia retry generationRun; nie wymagają oddzielnego frameworka workflow. Szczegółowe DTO zdefiniuje pierwsza implementacja contracts na podstawie tych operacji. Całość Kid API, w tym odczyt attempts/:id, działa w zaufanym modelu bez autoryzacji dziecka (sekcja 13); odczyt zwraca stan i feedback, nigdy answer_key ani techniczny score.

## 13. Autoryzacja i prywatność

MVP pozostaje jednorodzinne. Hash hasła/PIN rodzica jest w bazie; scrypt z parametrami zapisanymi w formacie hasha, stałoczasowa weryfikacja i limit prób logowania. Cookie HttpOnly, Secure przy HTTPS, SameSite oraz kontrola Origin/CSRF przy mutacjach. Surowe tokeny sesji nigdy nie trafiają do bazy; przechowujemy ich hash i czas wygaśnięcia. Wygasłe parent_sessions są usuwane leniwie przy weryfikacji i przy logowaniu; indeks na expires_at ułatwia porządkowanie.

Pierwsze uruchomienie: dopóki w parent_credentials nie ma wiersza, ekran logowania pokazuje jednorazowy setup początkowego PIN-u/hasła zamiast formularza logowania. Pojedynczy wiersz o kluczu głównym id = 1 rozstrzyga próbę równoczesnej konfiguracji — wygrywa pierwsza, pozostałe dostają błąd i zwykły formularz. Po utworzeniu poświadczeń setup jest niedostępny; zmiana danych wymaga zalogowania.

Kid Mode nie ma kont dzieci. Wybór profilu nie jest zabezpieczeniem przed rodzeństwem. Dostęp do całej instancji jest zaufanym dostępem rodzinnym. Do czasu osobnego ustalenia zdalnego dostępu instancja nie jest publicznie wystawiana. Zalecany pierwszy wariant zdalny to prywatny VPN/brama dostępu przed aplikacją; wybór produktu jest poza tym etapem. Sam PIN rodzica nie zabezpiecza publicznego Kid API.

Dane logów: requestId, typ operacji, czasy, kody błędów; bez haseł, promptów zawierających dane dziecka, transkrypcji i audio. JSON historii zawiera wyłącznie potrzebny wynik. Usunięcie dziecka usuwa jego transkrypcje i próby. Retencja po stronie dostawców jest sprawdzana podczas konfiguracji usług; aplikacja nie może obiecać ich polityki w swoim imieniu.

## 14. Wdrożenie i eksploatacja

Compose zawiera web, worker i db oraz jednorazowy krok migrate. Najpierw migracje aplikacji i kolejki, potem uruchomienie web/worker. Tylko web jest wystawiony przez reverse proxy Coolify. PostgreSQL nie ma publicznego portu. Sekrety są w konfiguracji wdrożenia, nie w repozytorium ani w NEXT_PUBLIC_*.

Konfiguracja obejmuje DATABASE_URL, MEDIA_ROOT, FAMILY_TIMEZONE, provider/model dla LLM/TTS/STT/pronunciation/images, odpowiednie klucze, parametry głosów, MAX_AUDIO_BYTES, limity generowania i wersję polityki. Lokalny fake-provider jest dostępny wyłącznie w development/test.

Health: liveness procesu i readiness bazy; worker ma heartbeat. Błąd zewnętrznego AI nie restartuje całej aplikacji i nie blokuje istniejących zestawów tekstowych. Transakcyjne migracje są wykonywane raz, nie przez każdą replikę. W MVP uruchamiamy po jednej instancji web i worker.

Kopie zapasowe: codzienny pg_dump + kopia /data/media. Spójny backup na małej instancji można wykonać po zatrzymaniu workera i chwilowym zablokowaniu publikacji, pozostawiając bezpieczny snapshot bazy. Procedura odtworzenia obejmuje bazę, zasoby, migracje i konfigurację. Retencja proponowana: 7 kopii dziennych i 4 tygodniowe. Surowe nagrania nie występują w backupie.

## 15. Rozbudowa bez implementowania przyszłości

learning_items.kind ma miejsce na nowy typ; payload_version w rewizjach pozwala rozszerzać schematy treści. Nowy moduł source_material doda source_assets, fragmenty i powiązania ze źródłami, własne typy zadań i umiejętności. Nie tworzymy dziś pustych tabel OCR ani systemu wektorowego.

Nie zakładamy, że historia będzie używała pięciu umiejętności angielskiego. skill jest tekstowym kodem walidowanym przez rejestr domeny; rozszerzenie nie wymaga odtwarzania całej historii. Kid API może pozostać wspólne, ale nowe zadania mają jawny discriminator i payload_version.

## 16. Decyzje kosztowne do zmiany

| Decyzja | Dlaczego istotna | Przyjęte zabezpieczenie |
| --- | --- | --- |
| Treść vs postęp | Edycja materiału może fałszywie zachować opanowanie | Rewizje i klucze per umiejętność |
| Granica klient/serwer | Bez niej mobilny klient wymaga przepisywania przepływu | API i niezależne kid-ui |
| Historia i ekspozycje | Same liczniki nie wyjaśniają niedawnych podpowiedzi | Próby, oceny i wydarzenia z wersją reguł |
| Trwała kolejka | Generowanie może przepaść po zamknięciu strony | Transakcyjne enqueue i idempotentne zadania |
| Głos dziecka | Trwałe joby wymuszałyby retencję nagrań | Krótka ścieżka in-memory poza workerem generacji |
| Granica rodziny | Publiczna platforma wymaga nowego modelu izolacji | Jawnie jedna rodzina, brak pozornego multi-tenancy |
| Przechowywanie plików | Lokalne ścieżki w domenie utrudniają migrację do S3 | Opaque media ID + MediaStore |

Łatwe do zmiany są wygląd ekranów, wartości polityki i konkretne adaptery AI, o ile zachowują kontrakty. Wymiana SQL ORM nie jest celem, więc nie dokładamy ogólnej abstrakcji nad każdym zapytaniem.

## 17. Weryfikacja i ograniczenia propozycji

Plan implementacji zawiera mapę A01–A39 oraz próby błędów/restartów. Przed implementacją produktu należy zaakceptować dokumenty. Poprawki review R01–R07 są przypisane do etapów i scenariuszy regresji w planie. Schemat jest początkowym projektem do sprawdzenia w prawdziwym PostgreSQL; stan sprawdzenia tego pakietu opisuje sekcja „Weryfikacja pakietu” na końcu planu. Nie deklarujemy wykonanych testów aplikacji, której jeszcze nie zbudowano.

Parametry schedulera, progi wiarygodności wymowy i zachowanie klawiatury wymagają praktycznej próby. Wybranie TypeScript nie rozstrzyga skuteczności automatycznej oceny dziecięcej wymowy.

## 18. Dokumentacja wykorzystana przy projektowaniu

- Next.js, backend dla frontendu: https://nextjs.org/docs/app/guides/backend-for-frontend
- Next.js, self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- Next.js, ograniczenia static export: https://nextjs.org/docs/app/guides/static-exports
- Drizzle, migracje: https://orm.drizzle.team/docs/migrations
- Drizzle, generowanie migracji: https://orm.drizzle.team/docs/drizzle-kit-generate
- Graphile Worker, trwałe zadania i retry: https://worker.graphile.org/docs
- Graphile Worker, ograniczenia job_key: https://worker.graphile.org/docs/job-key
- Capacitor, pakowanie zbudowanych zasobów web: https://capacitorjs.com/docs/getting-started
- Azure, ocena wymowy: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment

Dokumentacja wspiera możliwości narzędzi. Wybór granic modułów, wersjonowania i polityki nauki jest propozycją projektową dla tej aplikacji.

### Edycja danych profilu (2026-10-09)

`PATCH /api/v1/parent/children/{id}` przyjmuje co najmniej jedno z pól `displayName` (trim, 1–80) i `avatarKey` (1–40); nieznane pola odrzuca. Wymaga sesji rodzica i kontroli Origin/CSRF. Zwraca 200 z `ChildDto`, 400 dla błędnych danych/UUID, 401/403 dla braku uprawnień i 404 dla nieistniejącego profilu. `updateChild(services, childId, input: ChildPatch): Promise<ChildDto>` wykonuje pojedynczy UPDATE tylko dostarczonych pól; zachowuje UUID, rok urodzenia, datę utworzenia, politykę i historię. Dwie edycje różnych pól nie nadpisują się; dla tego samego pola obowiązuje ostatni zapis w bazie. Brak migracji. Szczegóły: `superpowers/specs/2026-10-09-child-profile-edit-design.md`.
