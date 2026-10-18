# Architektura — Rodzinny asystent nauki AI

Wersja: 1.3, uzupełnienie o silnik lekcji i moduły przedmiotów • 12 października 2026 (bazowo 1.2 po review pakietu przed implementacją • 7 października 2026).
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

W `pnpm.overrides` (root `package.json`) znajdują się ograniczone nadpisania wersji zależności pośrednich zamknięte na konkretne, podatne resolucje: `postcss@8.4.31 → 8.5.29` (pin Next.js) i `esbuild@0.18.20 → 0.25.12` (`@esbuild-kit` przez drizzle-kit). Są celowo wąskie: gdy upstream przypinie wersje z łatkami, nadpisania przestaną pasować i należy je wtedy usunąć. Dependabot wywoła alert, jeśli po przyszłym bumpie wróci podatna wersja pod innym specem.

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

- `/` renderuje aplikację dziecka (KidApp osadzony przez KidLearningHost). Dziecko zawsze zaczyna od ekranu wyboru profilu (także przy jednym profilu). Ekrany wyboru profilu oraz talii zawierają link do panelu rodzica `/parent`, ukryty podczas sesji ćwiczeń. Jest to także `start_url` PWA.
- `/parent` renderuje panel rodzica (ParentApp) chroniony PIN-em, z linkiem powrotnym „Do nauki” (`/`).
- `/kids/{childId}/learn` otwiera naukę z wybranym profilem. Trasa używa trwałego UUID profilu, a host przekazuje go do KidApp jako `initialChildId`. Nieznany lub usunięty identyfikator wraca do listy dostępnych profili.
- Panel rodzica pokazuje przy każdym profilu link do jego trasy nauki (`/kids/{childId}/learn`).

Kid Mode komunikuje się przez /api/v1/kid. Nie używa Server Actions ani pobierania danych przez Server Components jako warunku działania sesji. Next.js dostarcza tylko stronę startową i osadza KidApp. Routing wewnętrzny dziecka pozostaje w prostym module widoków; do wznowienia sesji wystarczy identyfikator zapisany lokalnie.

API klienta ma konfigurowalny baseUrl. W web jest same-origin. W przyszłości mały host Vite + Capacitor może spakować tę samą bibliotekę kid-ui i wskazać zdalne API. Nie eksportujemy całego Next.js statycznie i nie przenosimy backendu do telefonu.

MediaRecorder, odtwarzacz i lokalne ustawienia są za adapterami platformowymi. Dla Androida można podmienić obsługę uprawnień lub nagrywania bez przebudowy ćwiczeń. Panel rodzica pozostaje webowy. Przyszły klient mobilny wymaga osobnego rozwiązania sesji dostępu, dozwolonych originów, aktualizacji i uprawnień; nie ustawiamy dziś CORS na *. Offline i synchronizacja historii nie są implementowane.

### Responsywny układ Kid UI

Przenośny `@learning/kid-ui` używa wspólnej ramy `KidPage` oraz prezentacji zadania `ExerciseFrame`. `KidPage` ma dwa jawne tryby: `session` ogranicza zadanie do aktualnie widocznego prostokąta, odczytywanego z `visualViewport` z fallbackiem do `100dvh`; `flow` zachowuje naturalną wysokość i przewijanie dla profili, wyboru zestawów i długich podsumowań. Zmiana rozmiaru, orientacji lub widocznego viewportu nie kluczuje ponownie drzewa zadania. Host dziecka udostępnia ustawienie viewportu na trasach Kid Mode, bez wpływu na wspólny layout i panel rodzica.

Przy powiększeniu gestem rama sesji wraca do naturalnego flow, aby zachować zoom i przewijanie. Dla długich treści lub małej dostępnej wysokości przewija się wyznaczona część szczegółów, a główna akcja pozostaje osiągalna; listy i raporty nie mają wymogu zerowego przewijania. To zasada prezentacji klienta. Nie zmienia endpointów ani kolejności operacji sesji: kontroler nadal autoryzuje próby, ekspozycje, odsłuch i zakończenie prezentacji. Rzeczywista zgodność z konkretnym telefonem/PWA wymaga osobnego odbioru urządzenia; test Playwright nie jest jego substytutem.

W trakcie zadania `ExerciseFrame` rezerwuje stałe sloty dla instrukcji, materiału oraz głównej i pomocniczej akcji. Wynik pisemny zastępuje treść materiału, a jego przyciski zajmują te same sloty co formularz; wybór odpowiedzi zachowuje opcje w treści i rezerwuje kompaktowy, przewijalny slot na krótki feedback. Nagrywanie odpowiedzi pisemnej pozostaje przy polu odpowiedzi, poza głównym slotem, aby jego dostępność i status nie zmieniały położenia przycisku „Sprawdź”. Przy niezmienionej geometrii zewnętrzne granice stref pozostają stałe; długie treści i wyniki przewijają się wewnątrz, zaś bardzo niski viewport może przewijać całą ramę. Są to wewnętrzne elementy prezentacji Kid UI bez wpływu na API, DTO, MCP ani skill klienta.

Po wybraniu odpowiedzi Kid UI od razu pokazuje neutralny stan oczekiwania i zaznacza wybór bez lokalnego werdyktu; właściwy feedback nadal pochodzi z serwera. W czasie przejścia istniejące sloty ekranu zachowują geometrię. To wyłącznie zachowanie prezentacji, bez zmiany DTO, kolejności operacji, raportu `learning-overview`, MCP i skilla Hermesa.

## 6. Dane i wersjonowanie

### 6.1. Trzy różne tożsamości

1. **learning_item:** trwały element w zestawie, np. konkretne słowo Thursday.
2. **item_revision:** treść tego elementu w określonej wersji zestawu.
3. **skill_version:** wersja znaczenia i zasad oceny jednej umiejętności tego elementu.

Opublikowane rewizje są niezmienne. Edycja tworzy nowy draft całej wersji zestawu. Draft może być edytowany do publikacji. Generacja treści zestawu zapisuje wynik tylko przy zgodnym numerze edycji draftu. Generacja audio/obrazu jest niezależnym zadaniem zasobu i nie podlega numerowi edycji całego szkicu; podpięcie wyniku wymaga zgodności jego fingerprintu z aktualnym zapotrzebowaniem karty. Sesja przypina deck_version i learning_policy, więc publikacja w jej trakcie nie zmienia pytań ani progów.

item_revision_skills wskazuje skill_version osobno dla listening, reading, recall, pronunciation i spelling. Wersja kosmetyczna ponownie używa tych samych kluczy. Nowe znaczenie tworzy nowe klucze dla listening/reading/recall. Nowe angielskie słowo tworzy nowe klucze wszystkich umiejętności. Zmiana reguł pisowni tworzy nowy klucz spelling. Zmiana wariantów wymaga jawnej mapy wpływu; nie ma automatycznego „wszystko zachowaj”.

skill_version zawiera niezmienne kryteria i opcjonalny poprzedni klucz. Dla nowego klucza nie kopiujemy statusu mastered; pokazujemy „do ponownego sprawdzenia”, z możliwością podglądu poprzednich wyników. Próba starej sesji aktualizuje wyłącznie stare klucze. Stara historia nigdy nie awansuje nowego klucza przez sam zgodny item_id.

### 6.2. Projekcje postępu

child_skill_progress ma klucz (child_id, skill_version_id, policy_id). Wersja polityki jest oddzielna od wersji algorytmu projekcji (`projection_version`, obecnie `proj-3`). Źródłem są attempts, assessments i wydarzenia ekspozycji; projekcje są odtwarzalne. Zapis oceny oraz aktualizacja projekcji następują w jednej transakcji. Pierwsze wydanie etapu (`first_issued_at`) i istnienie kwalifikującej oceny (`has_qualifying_assessment`) dotyczą tej samej umiejętności i polityki. Stara sesja zapisuje stan własnej polityki; lista i planer nie przejmują postępu innej polityki, gdy dla wybranej nie ma dowodów. Raport rodzica dla bieżącej wersji umiejętności wybiera projekcję z najpóźniejszym niepustym `last_reviewed_at` spośród polityk; przy remisie wybiera alfabetycznie mniejszy `policy_id`. Samo wydanie zadania bez oceny nie maskuje wcześniejszego wiarygodnego wyniku. Zmiana polityki profilu nie zeruje zatem stanu raportu; wybór trudności do ćwiczeń nadal używa aktywnej polityki. Rekalkulację wykonujemy jawnie z wersjonowanym algorytmem; nie przepisuje ona historycznych ocen.

`child_target_exposures` przechowuje pierwszy i ostatni czas zapieczętowanej ekspozycji w zakresie `(child_id, target_key)`, niezależnie od polityki i rewizji. MIN/MAX aktualizują się atomowo ze zdarzeniem i jego pieczęcią, również dla dystraktorów, feedbacku i ponownego odsłuchu. Pierwszy czas wystarcza do sprawdzenia, czy odpowiedź była kiedykolwiek ujawniona do chwili odczytu, a ostatni służy do terminów kwalifikacji kolejnego sprawdzenia. Historia nadal rozstrzyga audyt i odbudowę; projekcja nie zmienia zamrożonego kontekstu istniejącej próby.

Lista zestawów używa osobnego, wąskiego modelu odczytu: metadane widocznych wersji, właściwe projekcje i fakty pracy oraz jeden `now`, w jednej krótkiej migawce Repeatable Read/Read Only. Wspólne reguły domenowe obliczają terminy i `recommended`; tych zależnych od czasu decyzji nie utrwala się jako stałych flag. GET nie odtwarza historii, nie pobiera historycznych promptów i nie wykonuje bootstrapu ani naprawczych zapisów. Planer sesji może nadal pobierać dodatkowe dowody potrzebne do wyboru zadania. Lekcje mają zbiorczy odczyt lekkiej puli i wspólną czystą selekcję kartkówki; prompty i klucze powstają dopiero podczas startu pod istniejącą blokadą. Preferencja ćwiczeń niewidzianych z fallbackiem do widzianych pozostaje bez zmian.

`child_profiles.learning_projection_version` oznacza gotowość projekcji profilu. Migracja `0019` oznacza istniejące profile jako wymagające backfillu; nowe profile zaczynają z pustym, gotowym stanem. Rebuild ustawia gotowość dopiero po pełnym odtworzeniu stanu i faktów w transakcji dziecka. Zachowana tabela `child_skill_progress_legacy` służy wyłącznie przejściu migracyjnemu, bez odczytów runtime; po udanym apply wiersze dziecka są z niej usuwane. Procedurę przełączenia i rollbacku opisuje [runbook](operations/progress-rebuild.md).

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

Panel klienta przechowuje polecenie generacji i jego klucz do rozstrzygnięcia
niepewnej odpowiedzi transportowej. Retry ręczne wysyła identyczny payload;
klient uznaje 202 dopiero po walidacji UUID runu i zestawu, a następnie otwiera
edytor. Niepoprawna odpowiedź, 5xx lub utrata sieci pozostają niepewne.
Walidacja 400 i odmowa 401/403 kończą bieżące polecenie. Po potwierdzonym
sukcesie odświeżenie listy nie uruchamia ponownej generacji. Stan klienta nie
jest utrwalany i znika po przeładowaniu strony; kontrakt HTTP i deduplikacja
serwerowa pozostają bez zmian.

Domyślne ograniczenia MVP: do 50 elementów na zestaw, do 120 znaków celu/źródła, 300 znaków przykładu i 4000 znaków promptu. To limity operacyjne do zmiany w konfiguracji, nie nowe wymagania dydaktyczne. Niepełny zestaw trafia do poprawy. Kompletność zamkniętych tematów, np. dni tygodnia, można sprawdzić prostą regułą; nie budujemy uniwersalnego katalogu wiedzy.

## 8. Zadania w tle i zasoby

Graphile Worker wykonuje zadania co najmniej raz. job_key nie zastępuje trwałej idempotencji aplikacji. Dla generowania treści generation_run jest związany z draftem i expected_edit_number; dla TTS/obrazu wiąże się wyłącznie z asset_id, bez deck_version_id i numeru edycji. Jeden run zasobu może obsłużyć wiele szkiców.

Fingerprint TTS obejmuje dokładny tekst, locale, provider, model, głos i parametry; nie utożsamiamy go z target_key ekspozycji. Fingerprint obrazu obejmuje prompt, provider/model, rozmiar, jakość i format; startowe domyślne ustawienia to low + WebP (high/png kosztowało ~0,17 USD za obraz przy kartach wyświetlanych w ~300 px). Pełne żądanie obrazu przewozi metadana zasobu do executora, więc faktyczne wywołanie API nie może się rozjechać z fingerprintem. media_assets ma unikalność (fingerprint, generation_number). Zwykłe żądanie używa zgodnego gotowego zasobu albo dołącza do istniejącej generacji. Świadoma regeneracja tworzy nowy numer generacji i nowe asset_id, także dla tych samych ustawień. Nigdy nie zastępuje już zatwierdzonego zasobu starej wersji.

Rezerwacja generacji dla fingerprintu odbywa się w krótkiej transakcji pod blokadą tego klucza. Dokładnie jeden generation_run przypada na asset_id. Zasób ma własny lease_token/lease_until; finalizacja TTS/obrazu jest compare-and-set na aktualnym właścicielu lease zasobu. Generacja treści używa lease w generation_run. Nie trzymamy transakcji przez czas wywołania dostawcy.

MediaStore.putImmutable(bytes) wylicza hash zawartości i zapisuje plik bez nadpisania istniejących bajtów. Jeśli blob o tym hashu już istnieje, sprawdza zgodność i ponownie go używa. Gotowy media_asset (state=ready, storage_key, content_sha256, metadane) jest niezmienny na poziomie SQL. Różne rekordy mogą wskazywać ten sam niezmienny blob. Spóźniony worker może pozostawić niepodpięty blob, lecz nie zmieni gotowego asset ani pliku używanego przez opublikowany materiał. Automatyczny garbage collector nie jest częścią MVP; ewentualne porządkowanie nigdy nie usuwa blobów mających referencje.

Po ukończeniu zasobu worker w jednej transakcji, po skutecznym CAS lease, aktualizuje wyłącznie globalny asset/run. Nie nadpisuje powiązań draftu. revision_assets przechowuje expected_fingerprint oraz wskazanie wybranej generacji; publikacja i zatwierdzanie sprawdzają zgodność fingerprintów i stan ready. Jeśli rodzic w międzyczasie zmieni kartę, stary wynik może pozostać w cache, ale nie zostanie automatycznie podpięty do zmienionej treści. Edycja ponownie uzgadnia wymagane zasoby; retry generacji zasobu nie zależy od starego edit_number. Świadome pominięcie obrazu pozostaje zachowane, dopóki rodzic nie zmieni decyzji lub znaczenia wizualizacji.

Odpowiedź usługi może zaginąć po opłaconym wykonaniu, więc nie obiecujemy braku podwójnej opłaty w każdym możliwym scenariuszu. Gwarantujemy jednokrotną logiczną finalizację i niezmienność wybranego wyniku.

Retry: maksymalnie trzy automatyczne próby, opóźnienia i jitter. Błędy walidacji/konfiguracji nie są bez końca ponawiane. Wątpliwy timeout płatnej generacji jest pokazywany rodzicowi przed ręcznym ponowieniem. Początkowa równoległość: 2, z limitem 1 dla obrazów. Postęp jest odczytywany przez polling.

Worker wykonuje pojedynczą pętlę przelotów: następny startuje po zakończeniu poprzedniego, a każdy przelot wybiera sprawiedliwie maksymalnie dwa zadania różnych kolejek. Obrazy mają limit jednego zadania na przelot. Zatrzymanie procesu abortuje bieżącą pracę; `/health` zwraca 503, gdy aktywny przelot lub ostatni koniec pracy jest starszy niż `WORKER_HEALTH_STALE_MS` (domyślnie 900000 ms).

MediaStore ma putImmutable/get; MVP używa prywatnego wolumenu. Odczyt zatwierdzonego zasobu odbywa się po opaque media ID, nie po ścieżce od klienta. Ochrona endpointu mediów jest konkretna: zwraca wyłącznie zasoby state=ready, działa tylko same-origin z wyłączonym CORS (przyszły host mobilny będzie wymagał świadomej zmiany tej zasady), nie listuje zawartości i nie przyjmuje ścieżek. Kid Mode nie ma własnej autoryzacji — dostępnością steruje fakt, że media ID dziecko otrzymuje wyłącznie w DTO zadania albo w zgłoszeniu odsłuchu po zapisanej ekspozycji, a rodzic w DTO szkicu. Worker ma RW, web RO przy konwersji głosu w pamięci. Kid API wydaje autoryzację odsłuchu w kontekście kroku zadania po zapisaniu ekspozycji, a sam endpoint pliku nie wyznacza czasu ekspozycji. Publicznego katalogu /data nie udostępniamy.

## 9. Sesja, ekspozycje i harmonogram

### 9.1. Pytanie jest obiektem serwerowym

SessionTask zapisuje typ, rewizję elementu, wersję polityki, opcje z nieznaczącymi identyfikatorami oraz prywatny answer_key. Publiczny DTO nie zawiera rozwiązania ukrytego zadania, ocen ani parametrów providera. Pokazanie odpowiedzi następuje po odpowiedzi lub świadomym „Nie pamiętam”.

Start/resume zapewnia jedną aktywną sesję dziecka. Start tej samej talii i trybu wznawia aktywną sesję; inna talia lub tryb wymagają jawnego zakończenia poprzedniej (409), bez jej automatycznego zamknięcia. Aktywna sesja jest wznawialna do 30 minut od ostatniego zdarzenia; późniejszy start zamyka przeterminowaną sesję i otwiera nową. Trening zachowuje dotychczasowe znaczenie completed/ended. W kartkówce completed oznacza zakończenie wszystkich slotów porcji, ended — niepełną próbę, także po jawnym przerwaniu; oba mają trwały raport. Wydane zadanie jest ponownie czytane po uzyskaniu wspólnej blokady sesji, aby drugi klient nie użył starego stanu issued. Unikalny indeks nadal wymusza jedną aktywną sesję, a operacje nie blokują na czas odpowiedzi dziecka.

Począwszy od migracji 0017 nowy trening słówek przypina prywatny `training_plan` wersji 1 w transakcji startu. Skończona lista zawiera gotowe prompty i klucze, lecz nie tworzy `session_tasks`, prób ani ekspozycji. `next` pod blokadą wydaje slot o kolejnym ordinalu, zapisuje jego zamknięte ekspozycje i zwraca niezmienny task; retry/wznowienie czyta wydany task. Wersja planu i sloty są niezmienne; postęp wykonania wynika z wydanych/zakończonych/pominiętych `session_tasks`. Błąd odpowiedzi nie przebudowuje listy. Nowa sesja oblicza wsparcie z wcześniejszych rzeczywistych prób; pominięcie i wynik nieoceniony nie są trudnością. Aktywne sesje sprzed migracji z `training_plan IS NULL` zachowują dotychczasowego planera aż do końca. Tryb kartkówki i `mock_test_plan` pozostają odrębne. Kontrakt Kid API i `learning-overview` nie ulegają zmianie.

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

Wyjątek od deterministycznej kolejności (2026-10-15): dla wszystkich zestawów `picture`, niezależnie od `canRead`, po wyższych priorytetach, scheduler losuje z wykonalnych planów pytania i dopuszczalnej następnej prezentacji. Bootstrap obejmuje dwa słowa, jeśli istnieją; maksymalnie trzy nowe słowa oczekują pierwszego rozpoznawania. Pytania obejmują własne zakończone prezentacje i wcześniej rozpoczęty materiał, także już ćwiczony. Wybór ogranicza pierwszy dostępny priorytet opanowania i okno liczby pytań `usedThisSession - presentationsThisSession <= minimum + 1`, z minimum liczonym po odrzuceniu niewykonalnych planów. Nie wykluczamy ostatniego celu, więc dwa słowa nie wymuszają alternacji. Brak bezpiecznego planu zachowuje dotychczasowy jednorazowy fallback lub kończy sesję; nie pozwala przekroczyć limitu trzech. Moduł sesji przekazuje świeżą entropię z `node:crypto.randomInt` przez prywatne `selectionSeed`; domena pozostaje powtarzalna dla tych samych danych i seed. Losowanie dotyczy wyłącznie tworzenia nowego zadania pod blokadą sesji, a istniejący `issued` zachowuje ID, prompt, opcje i klucz. Krótkie sekwencje mogą przypadkowo się powtarzać. Zestawy standardowe zachowują dotychczasową kolejność. Flaga `canRead` nadal określa dostępne umiejętności i ćwiczenia oraz priorytet opanowania według `getVocabularyCapabilities`. Profil czytający zaczyna nowe słowo od słuchania, a w dalszym utrwalaniu zachowuje miks słuchu i obu kierunków reading przez `recognitionPlan` i `chooseReadingDirection`; przypominanie/pisownia i wymowa zgodnie z mikrofonem zachowują wcześniejsze reguły. Format i flaga czytania pozostają snapshotem sesji. API, MCP i skill konsumenta pozostają bez zmian: modyfikacja nie dotyczy kontraktów, ocen ani interpretacji danych.

Na początku planowania serwer rezerwuje należne, już kwalifikujące się sprawdzenia Recall/pisowni przed ponownym ujawnieniem ich celów. Dopóki taki sprawdzian oczekuje, inne zadanie nie może pokazać/odtworzyć celu ani użyć go jako dystraktora lub jawnego fragmentu wyrazu. Scheduler dobiera inne dystraktory, mniej opcji albo najpierw wykonuje zarezerwowany sprawdzian. Zapisuje decyzję w kontekście sesji. Po sprawdzeniu lub świadomym pominięciu zwalnia rezerwację; podpowiedź poproszona przez dziecko kończy niezależne sprawdzanie jako wspomagane. Feedback ujawnia wyłącznie rozwiązanie własnego zadania i treści, które to zadanie już pokazało; nie nazywa celów objętych aktywną rezerwacją. Gdy ten sam cel wymaga Recall i pisowni, jedna odpowiedź pisemna może dostarczyć obu wyników, zanim feedback ujawni słowo.

Nie wymuszamy sprawdzania nieznanych słów ani oczekiwania na zegar. Jeśli warunek przerwy nie jest spełniony, wybieramy utrwalanie i planujemy niezależny sprawdzian na później. Testy obejmują kolejną sesję znającego materiał dziecka, nie tylko pierwszą naukę.

Zestaw można ćwiczyć w dowolnym momencie (uzupełnienie wersji 1.1): gdy dla dziecka nic nie jest należne i nie ma nowego materiału, scheduler wydaje jako ostatni priorytet lekkie utrwalanie rozpoznawania (słuch/tekst) już rozpoczętych elementów — reason `extra-practice`, dla zestawów standardowych obrót deterministyczny wg pozycji i ordinalu, dla `picture` losowanie opisane powyżej, elementy w pełni opanowane na końcu kolejki, rezerwacje sprawdzeń obowiązują jak w każdej innej ścieżce. Dla dziecka nieczytającego priorytet opanowania uwzględnia tylko umiejętności dostępne w tej sesji według `getVocabularyCapabilities` (bez mikrofonu tylko słuchanie); historyczne reading/spelling pozostają w historii i nie blokują rotacji. Scheduler wybiera pierwszy wykonalny plan z uporządkowanej puli utrwalania; brak bezpiecznych opcji dla jednego celu nie kończy poszukiwania w pozostałych kandydatach. Kolejność pytań zachowuje deterministyczne priorytety, a kolejność odpowiedzi jest tasowana raz przy materializacji niezmiennego promptu. Zadanie jest oceniane i mieści się w zwykłym budżecie sesji; jakość dowodów chroni reguła niezależności (SPEC §18: próba w ciągu 5 minut od ujawnienia wzorca to utrwalanie), więc dodatkowe ćwiczenie nie zawyża serii kwalifikujących ani nie zastępuje zaplanowanego sprawdzianu. Lista zestawów dziecka zawiera pole `recommended` (true, gdy w wersji jest teraz zaplanowana praca: należne sprawdzenie, powtórka, czekające wprowadzenie etapu albo nieprzerobiony element); klient pokazuje te zestawy w sekcji „Rekomendowane”, a wybór dowolnego przypisanego zestawu pozostaje możliwy zawsze.

Wprowadzanie kolejnych etapów (uzupełnienie wersji 1.2, SPEC §13): element, którego rozpoznawanie ma samodzielny sukces (aktualna seria słuchu albo tekstu ≥ 1), a przypominanie nie było jeszcze zadaniem, przechodzi do pierwszego zadania recall (reason `stage-introduction`; jedna pisemna odpowiedź ocenia też pisownię), a po nim — przy zgłoszonym mikrofonie — do pierwszego zadania wymowy. Wprowadzenie bierze co drugi slot sesji (nieparzysty ordinal od zera), aby nowy materiał, należne powtórki i utrwalanie nie czekały na całą falę nowego etapu i sesja zachowywała miks typów zadań. Etap „wprowadzony” pamięta historia zadań dziecka (dowolne zadanie recall/speech tego elementu), więc próba technicznie nieoceniona nie zapętla wprowadzania; cel objęty rezerwacją sprawdzenia nie jest wprowadzany, bo widok wymowy ujawnia słowo. Bez mikrofonu wymowa się nie pojawia, a przypominanie i pisownia działają normalnie.

  Wizualne słuchanie w zwykłych zestawach (SPEC §35): czytający klient deklarujący istniejące `supportsPictureVocabulary` może dostać `picture_listening` dla zatwierdzonych i jednoznacznych wizualizacji. Wybór wizualny i tekstowy naprzemiennie per słowo, zaczynając od wizualnego, gdy bezpieczne opcje są wykonalne; niepowodzenie buildera opcji wraca do tekstowego listening. Sesja przechowuje capability flagę, a liczniki wariantów odtwarzane są z zadań i ich niezmiennego promptu. Obie formy oceniają wyłącznie listening; scoring, API DTO oraz raport MCP nie ulegają zmianie.

Po tej ochronie kolejności obowiązują pozostałe priorytety. Najpierw zaległe sprawdzenia i trudności aktualnego zestawu, potem znane łatwiejsze elementy i nowe porcje po 2–3. Co najmniej co trzecie zadanie po serii trudności jest łatwiejsze. Ten sam element nie wraca od razu po dwóch błędach; wyjątkiem jest pokazanie wzorca jako wsparcie.

Praca nad umiejętnością jest wyliczana osobno od jej statusu opanowania. `learning-snapshot.ts` odtwarza kwalifikujące oceny oraz ekspozycje dziecka. Pierwsze Recall i pisownia są planowane 24 godziny po pierwszej prezentacji; kolejne korzystają z terminów projekcji. Kwalifikacja odpowiedzi nadal wymaga braku podpowiedzi i 300 sekund od ostatniego ujawnienia. Jeżeli cel samodzielnej próby jest zarezerwowany, nie może wrócić jako prompt, audio, fragment ani dystraktor. Reader historii wiąże oceny jednocześnie z dzieckiem, `skill_version` i umiejętnością, a kierunek reading zachowuje się przy wyborze kolejnego zadania.

Dobór opcji jest wspólny dla rozpoznawania, pisowni z fragmentem i łatwej przerwy: teksty są normalizowane i deduplikowane, poprawna odpowiedź jest unikalna, a cel z rezerwacją nie może wyciec w opcjach. Selekcja wymaga co najmniej dwóch różnych odpowiedzi. Dla singletona lub niewystarczającej puli scheduler wybiera własny Recall po zakończonej prezentacji albo bezpiecznie odkłada zadanie; brak dystraktorów nie staje się dowodem wiedzy.

Cykl wsparcia jest rekonstruowany z wydanych zadań i odpowiedzi, bez osobnej kolejki. Dwa błędy w tym samym zadaniu lub „Nie pamiętam” tworzą maksymalnie jedną prezentację wsparcia i jedną poprawkę; typ poprawki uwzględnia błąd pisowni. Poprawka ma swój limit prób, po czym element wraca później. Pominięte i technicznie nieocenione zadania nie zwiększają licznika błędów. Scheduler najpierw obsługuje należne umiejętności spośród wcześniej ujawnionych kart, a nowe materiały dodaje porcjami. Po dwóch trudnych należnych sprawdzeniach może wstawić bezpieczne łatwe rozpoznawanie, o ile nie naruszy rezerwacji.

Widok `letter_completion` (uzupełnienie 2026-10-10) zamienia znaki `_` z istniejącego publicznego `fragment` na osobne jednoliterowe pola. Kid UI składa widoczne znaki i wpisane litery, następnie wysyła pełne słowo przez istniejącą odpowiedź tekstową. Klucz odpowiedzi pozostaje na serwerze; klient nie ocenia poprawności. Widoczne litery zachowują ekspozycję i kwalifikację jako wsparcie. Zmiana zadania czyści pola, ponowne podejście w tym samym zadaniu pozwala poprawić poprzedni wpis. Nowy ekran nie wymaga zmian DTO, schedulera, polityki ani bazy.

`skill-history.ts` kwalifikuje materiał dowodowy bez przepisywania ocen. Odbudowa `child_skill_progress` (słówka) oraz `child_objective_progress` (cele lekcji) korzysta z tych samych czytników ograniczonych do profilu i wspólnego zapisu projekcji; obie projekcje odbudowują się w JEDNYM przejściu, w jednej transakcji na dziecko (bez przełącznika zakresu). `progress:rebuild` najpierw raportuje dry-run; tryb apply działa w osobnej transakcji na dziecko, blokuje profil i odmawia pracy przy aktywnej sesji lub próbie `processing` — te blokady i odmowy obejmują także cele. Projekcja wybiera ostatnią wiarygodną ocenę właściwej wersji polityki. Odbudowa nie zmienia prób, ocen, ekspozycji, werdyktów modelu (w tym decyzji rodzica) ani podsumowań, a runbook wymaga przerwy serwisowej i zweryfikowanego backupu.

Początkowe odstępy po sukcesach: 1 dzień, 3 dni, 7 dni; po trudności — powrót po innych elementach w sesji oraz następnego dnia. Błędy techniczne nie przesuwają harmonogramu jak błędy wiedzy.

Termin sprawdzianu jest opcjonalny i należy do przypisania dziecka. Nowa sesja kopiuje `assignment.testDate` oraz strefę rodziny do prywatnego `learning_sessions.context`; resume używa tej migawki, a legacy bez pola nie pobiera późniejszej daty przypisania. Czysta funkcja `isTestPreparationWindow` wyznacza granice przez lokalny początek dnia w IANA timezone: otwarcie dokładnie 48 godzin wcześniej i cały lokalny dzień sprawdzianu. Nie dodajemy kolumny sesji ani DTO dziecka.

Po należnym sprawdzeniu Recall/pisowni, wsparciu i poprawce po wsparciu scheduler wybiera w tym oknie wcześniej ujawniony cel z sukcesem rozpoznawania, który nie ma jednocześnie opanowanych Recall i pisowni. Deterministyczne sortowanie preferuje `needs_reconfirmation`, potem wymagającą ćwiczeń pisownię, Recall i pozycję w talii. Zadanie jest zwykłym ocenianym `recall` bez ujawnionych celów i zużywa istniejący budżet. Historia pieczętowanych `event_exposures` określa, czy słowo było wcześniej widoczne; historia `session_tasks.context.reason` zapobiega ponownemu wydaniu tego samego przygotowania i przechowuje dwa ostatnie oceniane powody. Po dwóch kolejnych `test-preparation` scheduler wstawia `test-preparation-break` z łatwym rozpoznawaniem, jeśli istnieje bezpieczny rozpoczęty element. Przy braku kandydata kontynuuje zwykłe bezpieczne priorytety. Rezerwacje chronią cele i dystraktory jak w innych zadaniach. Zmiana terminu nie wpływa na aktywną sesję; kryteria opanowania, obsługa pominięcia i „Nie pamiętam” pozostają bez zmian.

Sesja domyślnie ma budżet 12 ocenianych zadań i do 10 minut, z możliwością wcześniejszego końca. To maksymalny budżet, nie obowiązek. Ponowienia i zadania wspomagające mieszczą się w nim; prezentacja/feedback nie powiększają go. Po komunikacie „Jeszcze 3” rezerwujemy trzy pozostałe zadania, bez dokładania zadań naprawczych poza budżetem. Limit czasu egzekwujemy tylko między zadaniami, przy planowaniu next: po jego przekroczeniu serwer nie wydaje nowych zadań ocenianych i prowadzi sesję do zakończenia; nie przerywa zadania w trakcie ani obietnicy „Jeszcze N” — zarezerwowane zadania są dokończone, bo obietnica wobec dziecka waży więcej niż miękki limit. Parametry są propozycjami startowymi architektury, do kalibracji z dzieckiem.

### 9.4. Tryb próbnej kartkówki (2026-10-10, #30)

`assignments.test_goals` to nullable zbiór recall/spelling/listening; `mock_test_task_count` jest integer 1–100 z domyślnym 10 i CHECK. Brak nowych pól w dotychczasowym PUT zachowuje konfigurację, a nowemu przypisaniu nadaje brak celu i liczbę 10. UI rodzica zapisuje cel, liczbę i datę razem.

`learning_sessions.mode` ma domyślne training; mock_test wymaga prywatnego `mock_test_plan` JSONB. CHECK wiąże tryb z obecnością planu, trigger blokuje zmianę trybu/planu i utrwalonego raportu. Plan w wersji 1 przechowuje requestedTaskCount, scope całego materiału oraz gotowe sloty z rewizjami, promptami, kluczami, opcjami i audio. Faktyczny taskBudget = slots.length. Każdy slot jest wydawany osobno jako session_task. `mock-test-plan.ts` preferuje brak dowodów, potem trudności, zachowuje poznane znaczenie przez zgodny recall skill_version i zamknięte ekspozycje. Odrzuca słuchanie bez gotowego audio lub różnych polskich opcji.

W mock_test odpowiedź finalizuje się ze stanem terminalnym zadania, feedback=null i stepId=null. Ta semantyka obowiązuje submit/read/retry/finalize także po zamknięciu. Audio odpowiedzi i hint nie są dostępne; odsłuch pytania listening wymaga zapisanej ekspozycji przed replay. Kwalifikacja ocen nadal używa rzeczywistego received_at i historii, także z innych zestawów. Limit 10 minut w tym trybie zamyka niepełną próbę; większa konfigurowana porcja nie zwiększa czasu. Stale start, next, end oraz odczyt po timeout korzystają z jednej ścieżki closeMockTest pod blokadą.

Raport jest raz zapisany w `context.mockTestReport`, z pełnym zakresem, szczegółowymi wynikami, jakością dowodów i projekcją opanowania na zakończenie. `independenceReason` jest osobne od `reason` poprawności, więc kapitalizacja nie ukrywa niedawnego wzorca; jakość dowodu dotyczy także ocen błędnych. `contextOf` zachowuje raport. Lista rodzica obejmuje wygasłe active i zamyka je pod blokadą przed pokazaniem częściowego wyniku. Kid summary zawiera rozwiązania tylko wydanych slotów; każdy odczyt ponownie pieczętuje ekspozycje przed HTTP. Odczyt rodzica nie tworzy takich ekspozycji. KidDeckDto dodaje mockTestAvailable oraz publiczne activeSession (id/mode albo null), co pozwala wznowić kartkówkę po reload i zaoferować powrót/zakończenie przy konflikcie. Prywatny plan, klucze i techniczne score'y nie opuszczają serwera.

Po review: listening odrzuca dystraktory o nakładających się znormalizowanych angielskich odpowiedziach (także zatwierdzonych wariantach), nie tylko o takim samym polskim tekście. Brak bezpiecznej porcji zwraca `mock_test_unavailable` z polskim komunikatem i powrotem do nauki. Kwalifikacja przy received_at bierze maksimum ujawnień odpowiedzi kanonicznej i wszystkich wariantów. Migawka kontaktów poprzednich sesji uwzględnia ich ekspozycje także w innym zestawie; warunek 12 godzin nie jest omijany przez zmianę wariantu. Historia zakończonych ocen pozostaje niezmienna.

Dodatkowe endpointy: `GET /api/v1/kid/sessions/:id/mock-test-summary` (po końcu, no-store), `GET /api/v1/parent/mock-tests?childId=&deckId=` (20 najnowszych zakończonych prób) i `GET /api/v1/parent/mock-tests/:sessionId`. Każda trasa rodzica wymaga sesji. DTO raportu zawiera tytuł i numer przypiętej wersji, requestedTaskCount, taskBudget, complete, wyniki per wybrana umiejętność i wiersze z przyczynami. Panel ładuje raport dla dziecka/zestawu z aktualnie odczytanego ProgressDto, razem z jawnym „Pokaż postępy”.

## 10. Zapis odpowiedzi i niezawodność

POST attempts przyjmuje clientAttemptId, taskId i odpowiedź. Unikalność (child_id, clientAttemptId) zabezpiecza retry. request_hash wykrywa ponowne użycie klucza z inną odpowiedzią i zwraca 409. Klient nie wysyła własnego score, expectedText ani informacji „opanowane”.

Dla odpowiedzi tekstowej cała ocena, zapis próby, ocen per umiejętność i projekcji jest jedną transakcją. Dla mowy rezerwujemy attempt w processing, wykonujemy analizę poza transakcją, następnie atomowo finalizujemy rekord i projekcje. Finalizacja jest jednokrotna przez compare-and-set stanu. Próby completed są niezmienne.

Retry przy completed zwraca ten sam wynik. Retry przy processing nie uruchamia drugiej płatnej analizy; klient otrzymuje 202 z adresem odczytu statusu. Jeśli proces padł, stare processing po 60 sekundach finalizuje się jako nieocenione; nowe nagranie jest nową próbą. Finalizacja przeterminowanych prób jest leniwa i nie ma osobnego joba w tle: readAttempt oraz submitAttempt dla tego samego zadania przed obsługą żądania zamieniają processing starsze niż 60 sekund w nieocenione, co otwiera drogę nowej próbie. Nie odtwarzamy analizy z utrwalonego audio, bo go nie przechowujemy.

Nie gwarantujemy zapisu odpowiedzi, która nigdy nie dotarła do serwera. UI pokazuje błąd/stan zapisu, a nie fałszywy sukces. Nie wprowadzamy pełnej kolejki offline.

## 11. Mowa: osobna ścieżka niskiego opóźnienia

Ocena nagrania dziecka jest krótkim żądaniem web → provider. Nie przechodzi przez trwałą kolejkę generowania obrazów, aby nie opóźniać feedbacku i nie przechowywać nagrań na czas oczekiwania.

Web przyjmuje nagranie przez ograniczony strumień: początkowo do 15 sekund i 2 MiB. Sprawdza rzeczywisty format, czas i rozmiar po dekodowaniu. Adapter formatu normalizuje dane w pamięci do formatu potwierdzonego próbą techniczną. Jeżeli wymagane jest narzędzie ffmpeg, działa przez stdin/stdout z limitami i bez plików nagrań. Wybór kodeka i dokładnej metody dekodowania jest wynikiem fazy 0, nie założeniem „każdy Blob działa”.

Łączny deadline analizy: 30 sekund; timeout daje nieocenione albo wiarygodny wynik częściowy. Przeglądarka zwalnia strumień mikrofonu po nagraniu, końcu zadania i zmianie widoku. Aplikacja, proxy, error tracker i logi nie zapisują body ani nagrań. Analiza kończy się zwolnieniem buforów także przy błędzie; awaria procesu nie pozostawia pliku audio.

Kid UI używa trybu gestu `hold | toggle` z wybranego profilu, przekazanego przez Kid Profile DTO. Rodzic ustawia go w panelu; przełącznik nie jest widoczny dla dziecka ani przechowywany lokalnie na urządzeniu. Puszczenie, anulowanie, utrata fokusu i limit zatrzymują rejestrator zgodnie z trybem. Po wyniku karta inline rozdziela `heardText`, status rozpoznania i status wymowy. Tekst pokazuje się tylko po confidence gate, a fragment `unknown` nie oznacza błędu. Ponowienie wraca do `idle` i nie rozpoczyna kolejnego nagrania.

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
| Parent | GET /api/v1/parent/progress?childId=&deckId= | Podsumowanie umiejętności i pomyłek oraz aktywność dziecka z ostatnich 7 dni (czas, podejścia, odpowiedzi, interakcje) |
| Kid | GET /api/v1/kid/profiles | Nazwa, awatar, tryb gestu nagrywania oraz opcjonalny czas aktywności sesji z dzisiejszego wiersza raportu (Europe/Warsaw); stan niedostępnego raportu jest osobny od zera |
| Kid | GET /api/v1/kid/decks?childId= | Przypisane opublikowane zestawy z flagą `recommended`, liczbą słów oraz liczbą elementów z opanowanym samodzielnym Recall |
| Kid | POST /api/v1/kid/sessions | Start lub resume z przypiętą wersją |
| Kid | POST /api/v1/kid/sessions/:id/next | Idempotentne wydanie aktywnego zadania |
| Kid | POST /api/v1/kid/tasks/:id/events | Opcjonalne potwierdzenie obserwacji; nie tworzy jedynego dowodu ujawnienia |
| Kid | POST /api/v1/kid/tasks/:id/disclosures | Zapis ekspozycji i wydanie podpowiedzi/autoryzacji odsłuchu |
| Kid | POST /api/v1/kid/tasks/:id/complete-presentation | Idempotentne zakończenie Exposure bez próby i oceny |
| Kid | POST /api/v1/kid/tasks/:id/attempts | Wynik tekstowy/wybór/nie pamiętam; multipart dla audio |
| Kid | GET /api/v1/kid/attempts/:id | Wynik trwającej lub zakończonej oceny |
| Kid | POST /api/v1/kid/attempts/:id/feedback-audio | Ponowna autoryzacja wzorca dla aktualnego wyniku; zapis ekspozycji przed wydaniem ID zasobu |
| Kid | POST /api/v1/kid/sessions/:id/end | Koniec i podsumowanie |
| Media | GET /api/v1/media/:id | Zasób state=ready po opaque ID; same-origin, bez CORS; nie wyznacza ekspozycji |
| Integration | GET /api/v1/integrations/learning-overview | Migawka raportowa z tokenem `learning:read`; osobny kontrakt JSON Schema, read-only i `Cache-Control: no-store` |

Endpointy lekcji (moduł gramatyki, 2026-10-12; szczegóły w sekcji 19 i `.kiro/specs/grammar-module/`):

| Grupa | Endpoint | Wynik |
| --- | --- | --- |
| Parent | POST /api/v1/parent/lessons/generate | 202 + generationRunId + deckId (szkic lekcji + zadanie generowania w jednej transakcji) |
| Parent | GET /api/v1/parent/subjects | Katalog przedmiotów i tematów do formularza lekcji |
| Parent | GET /api/v1/parent/lessons/:id | Szkic lekcji: ćwiczenia per reguła, karty, stan puli |
| Parent | POST /api/v1/parent/lessons/:id/regenerate | Dogenerowanie ćwiczeń wybranej reguły |
| Parent | POST /api/v1/parent/drafts/:id/publish | Publikacja lekcji z wymogiem pokrycia etapów (409 z listą brakujących) — wspólna ścieżka ze słówkami, rozgałęziona po `decks.kind` |
| Parent | GET /api/v1/parent/lessons/:id/verdicts | Lista ocen modelu (odpowiedź, werdykt, kategoria, komentarz) |
| Parent | POST /api/v1/parent/lessons/verdicts/:id/decision | Nadpisanie werdyktu rodzica (przyszłe odpowiedzi, bez wstecznego przeliczenia) |
| Parent | GET /api/v1/parent/lessons/:id/progress | Postęp per reguła i kategorie błędów |
| Kid | (wspólne) POST /api/v1/kid/sessions, /next, /attempts, /disclosures, /complete-presentation | Te same endpointy co słówka; serwer rozgałęzia po `decks.kind = 'lesson'` do modułu lekcji (selektor, prompty, ocena, podsumowanie). `AttemptInput` dodaje modality `sequence` (`itemIds`); prompty lekcji mają dyskryminator `lesson_*`. |

Dokładne nazwy tras parametryzuje pierwsza implementacja routera; kontrakt DTO lekcji jest w `packages/contracts/src/lessons.ts`.

Integracja Umiem! → Hermes działa przez endpoint Streamable HTTP `/api/mcp` w istniejącym procesie web, a nie bezpośrednio przez bazę. Token integracji ma osobny hash i możliwość odwołania; nie autoryzuje Parent/Kid API. Odczyt używa transakcji `REPEATABLE READ READ ONLY`, limitu per token współdzielonego z REST i ograniczonego DTO. Serwer MCP znajduje się w `apps/web/src/integrations/`; `integrations/umiem-mcp/` zawiera walidator kontraktu i skill konsumenta. Raport Hermesa pobiera dane tylko w Evening. Kontrakt i eksploatację opisuje `docs/integrations/hermes-learning.md`.

Klient rodzica zachowuje migawkę formularza wraz z jego bazowym
`expectedEditNumber`. Polling nie zastępuje formularza rozpoczętego lokalnie;
409 ani próba edycji opublikowanego szkicu nie są ponawiane z nowszą wersją.
Po osobnym odczycie rodzic wybiera, czy jawnie przejść do aktualnego szkicu,
czy utworzyć nową wersję z opublikowanego materiału. To zachowanie nie dodaje
endpointu ani nie zmienia optimistic locking w API.

Podsumowanie sesji (SPEC §17, uzupełnienie 2026-10-09): `SessionSummaryDto` zawiera `independentSuccesses: { recall, spelling }` (liczby różnych elementów z poprawną niezależną oceną w tej sesji) oraz `practiceItems: [{ itemId, target, skills }]`, gdzie `skills` to przypominanie i/lub pisownia. Wpis do ćwiczenia powstaje z błędnej oceny, w tym „Nie pamiętam”; późniejszy poprawny niezależny wynik usuwa trudność tylko tej umiejętności. Poprawne odpowiedzi ze wsparciem, pominięcia i wyniki nieocenione nie usuwają trudności ani nie zwiększają samodzielnych sukcesów. Historia innych sesji i projekcja ogólnego postępu nie są wynikiem bieżącej sesji. Wynik jest utrwalany pod blokadą w `learning_sessions.context.summary` przy pierwszym zakończeniu; oczekująca analiza mowy nie przepisuje już pokazanego podsumowania. Kolejny odczyt zwraca ten sam wynik, ale ponownie zapisuje zamknięte ekspozycje wszystkich wyświetlanych wzorców przed odpowiedzią HTTP. Ekran pokazuje neutralny komunikat bez samodzielnych sukcesów i nie deklaruje opanowania słów.

Feedback pisowni (issue #9, 2026-10-12): `FeedbackDto` może zawierać `spellingDiff` — porównanie zapisu dziecka (`given`) z właściwym wariantem (`expected`) w postaci segmentów `plain`/`pill`, wyłącznie przy rodzaju `spelling_hint`. Segmenty `expected` składają się dokładnie na `correctText`, który w tym przypadku jest najbliższym zatwierdzonym wariantem (i jako taki trafia do ujawnień feedbacku). Diff jest wyliczany wyłącznie na serwerze; klient go renderuje.

Edycja obrazów, dodawanie/usuwanie kart i ponawianie konkretnego zasobu korzystają z PATCH draft lub dedykowanego polecenia retry generationRun; nie wymagają oddzielnego frameworka workflow. Szczegółowe DTO zdefiniuje pierwsza implementacja contracts na podstawie tych operacji. Całość Kid API, w tym odczyt attempts/:id, działa w zaufanym modelu bez autoryzacji dziecka (sekcja 13); odczyt zwraca stan i feedback, nigdy answer_key ani techniczny score.

## 13. Autoryzacja i prywatność

MVP pozostaje jednorodzinne. Hash hasła/PIN rodzica jest w bazie; scrypt z parametrami zapisanymi w formacie hasha, stałoczasowa weryfikacja i limit prób logowania. Cookie HttpOnly, Secure przy HTTPS, SameSite oraz kontrola Origin/CSRF przy mutacjach. Surowe tokeny sesji nigdy nie trafiają do bazy; przechowujemy ich hash i czas wygaśnięcia. Wygasłe parent_sessions są usuwane leniwie przy weryfikacji i przy logowaniu; indeks na expires_at ułatwia porządkowanie.

Pierwsze uruchomienie: dopóki w parent_credentials nie ma wiersza, ekran logowania pokazuje jednorazowy setup początkowego PIN-u/hasła zamiast formularza logowania. Pojedynczy wiersz o kluczu głównym id = 1 rozstrzyga próbę równoczesnej konfiguracji — wygrywa pierwsza, pozostałe dostają błąd i zwykły formularz. Po utworzeniu poświadczeń setup jest niedostępny; zmiana danych wymaga zalogowania.

Kid Mode nie ma kont dzieci. Wybór profilu nie jest zabezpieczeniem przed rodzeństwem. Dostęp do całej instancji jest zaufanym dostępem rodzinnym. Do czasu osobnego ustalenia zdalnego dostępu instancja nie jest publicznie wystawiana. Zalecany pierwszy wariant zdalny to prywatny VPN/brama dostępu przed aplikacją; wybór produktu jest poza tym etapem. Sam PIN rodzica nie zabezpiecza publicznego Kid API.

Dane logów: requestId, typ operacji, czasy, kody błędów; bez haseł, promptów zawierających dane dziecka, transkrypcji i audio. JSON historii zawiera wyłącznie potrzebny wynik. Usunięcie dziecka usuwa jego transkrypcje i próby. Retencja po stronie dostawców jest sprawdzana podczas konfiguracji usług; aplikacja nie może obiecać ich polityki w swoim imieniu.

Surowe nagranie jest przetwarzane tylko w pamięci i nie trafia do bazy, kolejki, plików tymczasowych, logów, trace ani fixture. Kid DTO może zawierać wyłącznie wiarygodny, ograniczony `heardText` oraz jawne statusy i fragmenty; odtwarzanie referencyjne wymaga nowej autoryzacji dla bieżącej próby.

## 14. Wdrożenie i eksploatacja

Compose zawiera web, worker i db oraz jednorazowy krok migrate. Najpierw migracje aplikacji i kolejki, potem uruchomienie web/worker. Tylko web jest wystawiony przez reverse proxy Coolify. PostgreSQL nie ma publicznego portu. Sekrety są w konfiguracji wdrożenia, nie w repozytorium ani w NEXT_PUBLIC_*.

Konfiguracja obejmuje DATABASE_URL, MEDIA_ROOT, FAMILY_TIMEZONE, provider/model dla LLM/TTS/STT/pronunciation/images, odpowiednie klucze, parametry głosów, MAX_AUDIO_BYTES, limity generowania i wersję polityki. Lokalny fake-provider jest dostępny wyłącznie w development/test.

Health: liveness procesu i readiness bazy; worker ma heartbeat. Błąd zewnętrznego AI nie restartuje całej aplikacji i nie blokuje istniejących zestawów tekstowych. Transakcyjne migracje są wykonywane raz, nie przez każdą replikę. W MVP uruchamiamy po jednej instancji web i worker.

Kopie zapasowe: codzienny pg_dump + kopia /data/media. Spójny backup na małej instancji można wykonać po zatrzymaniu workera i chwilowym zablokowaniu publikacji, pozostawiając bezpieczny snapshot bazy. Procedura odtworzenia obejmuje bazę, zasoby, migracje i konfigurację. Retencja proponowana: 7 kopii dziennych i 4 tygodniowe. Surowe nagrania nie występują w backupie.

CI: GitHub Actions (`.github/workflows/ci.yml`) wykonuje pełny cykl — typecheck, testy unit, testy integracyjne (własny kontener postgres), build web oraz e2e na fake providerach — na każdym Pull Requeście i pushu do main. Branch protection wymaga zielonych checków `tests` i `e2e` oraz aktualnej gałęzi przed scaleniem, także dla administratora; produkcja deployuje się automatycznie z main, więc scalony kod przechodzi ten sam cykl.

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

## 19. Silnik lekcji i moduły przedmiotów (2026-10-12)

Uzupełnienie dodaje drugi rodzaj zestawu — **lekcję** — obok słówek, bez przepisywania istniejących ścieżek. Wymagania i projekt szczegółowy: `.kiro/specs/grammar-module/{requirements,design}.md` (wiążące). Poniżej decyzje architektoniczne odzwierciedlające kod `packages/server/src/domain/lessons/**` i `packages/server/src/modules/lessons/**`.

### 19.1. Silnik niezależny od przedmiotu i `SubjectModule`

Silnik lekcji (typy ćwiczeń, ocena, postęp per cel, selektor, pula, kartkówka, kontrakty i widoki dziecka) nie zna angielskiego ani gramatyki. Przedmiot jest wtyczką za interfejsem (`SubjectModule`, wzorzec Strategy + Registry, Open/Closed): dostarcza katalog tematów i celów, dozwolone typy ćwiczeń, normalizator odpowiedzi, kategorie błędów, profil promptów generacji/oceny, walidatory i flagę `ttsForAnswers`. Dodanie przedmiotu = nowy katalog `domain/lessons/subjects/<id>/` i jeden wpis w rejestrze. **Test architektoniczny** pilnuje, że moduły silnika (`domain/lessons/*.ts` poza `subjects/`) nie importują niczego z `subjects/` — zależność biegnie wyłącznie przez rejestr i interfejs. Przykładowy przedmiot nie-językowy (fixture „history-like") przechodzi walidację, generowanie (fake) i ocenę bez zmian w silniku (`testing/history-like-subject.ts`).

Słownik: lekcja = `decks.kind = 'lesson'`; ćwiczenie = `learning_items.kind = 'lesson_exercise'`; cel nauki = reguła gramatyki; umiejętność oceny = kod `objective` w rejestrze `SKILLS` (świadomie poza `REPORT_SKILLS` kontraktów). Normalizacja `focus` (element sprawdzany) używa normalizatora PRZEDMIOTU, nie bazowego — ten sam normalizator, co dla odpowiedzi, by porównanie było spójne.

### 19.2. Rozgałęzienie po `decks.kind`

Dziś moduły `sessions.ts`, `attempts.ts`, `mock-tests.ts`, `published-progress.ts`, `learning-overview.ts` nie czytały rodzaju zestawu. Moduł wprowadza rozgałęzienia jako nową pracę, z reużyciem (nie duplikacją) wspólnych fragmentów wydzielonych z obecnych modułów (blokada sesji, rezerwacja `processing`, idempotencja `clientAttemptId`/`request_hash`, zapis ekspozycji, leniwa finalizacja):

- `sessions.ts` (start/next/end) → dla `lesson` delegacja do `modules/lessons/lesson-sessions.ts` (selektor, prompty, podsumowanie);
- `attempts.ts` → delegacja zadań `lesson_*` do `lesson-attempts.ts`;
- `events.ts` → odsłuch w zadaniach tekstowych lekcji = wsparcie; podpowiedź niedostępna w kartkówce;
- `mock-tests.ts` → plan i raport lekcji per cel;
- `published-progress.ts`/`reporting.ts` → odrzucenie (`deck_kind_mismatch`) lub pominięcie lekcji;
- `learning-overview.ts` → **filtr `decks.kind = 'vocabulary'` we wszystkich odczytach**, więc kontrakt raportu Hermesa (v1, JSON Schema) jest nienaruszony i nie obejmuje lekcji;
- `kid.ts` → `KidDeckDto.kind`, `subjectTitle`, gwiazdki lekcji z opanowanych celów; dla słówek `independentlyRecalledCount` uwzględnia `recall: "mastered"` (dla `canRead: true`) albo `listening: "mastered"` lub `recall: "mastered"` (dla `canRead: false`, 2026-10-16);
- `progress-rebuild.ts` → odbudowa także `child_objective_progress` w tym samym przejściu i transakcji co słówka;
- `profiles.ts` (`deleteChild`) → kaskada obejmuje nowe tabele per dziecko.

Testy regresji słówek chronią każdy punkt rozszerzenia; obecność lekcji nie zmienia `ProgressDto` słówek, listy zestawów (poza nowymi polami) ani `learning-overview`.

### 19.3. Generowanie puli (worker)

Naprawy review PR #51 (2026-10-13): każdy surowy rekord przechodzi walidację kształtu pól tekstowych i wszystkich tablic przed konwersją do domeny. Zły rekord jest liczony jako odrzucony bez utraty poprawnej reszty puli. `lesson_transform` wymaga niepustego `statement`. Rodzic dostaje w autoryzowanym `lesson-catalog` wyłącznie identyfikatory, tytuły oraz `cards: [{title, body}]` do podglądu; pola modelowe pozostają na serwerze. Edytor pokazuje te same teksty kart i aktualne lokalne przykłady co interfejs dziecka, a PATCH.examples zapisuje zatwierdzane poprawki.

Sesja lekcji zapisuje `initialObjectiveProgress` przy starcie w prywatnym kontekście. Początkowy etap i limit nowych celów używają tej migawki, awans wynika z historii zadań sesji; bieżąca projekcja służy nadal należnym sprawdzeniom. Starsze aktywne sesje bez migawki rozpoznają wprowadzenie celu po pierwszym kroku historii. Finalizacja modelu ponawia wspólną blokadę i odczyt stanu sesji/próby; zamknięta sesja nie dostaje późnej oceny ani zmiany projekcji. Nieocenione oceny mają confirmationEligible=false w obu ścieżkach.

Nowa treningowa sesja lekcji zapisuje prywatny, niezmienny snapshot `training_plan` z kartami, promptami, kluczami odpowiedzi i ekspozycjami, a `next` wydaje slot po jego ordinalu. Plan utrzymuje budżet ocenianych zadań równy liczbie wykonalnych slotów; sam plan nie zapisuje prób ani sukcesów. Przy planowaniu kolejnej sesji ostatni oceniony wynik celu może dodać kartę wsparcia i prostszy etap guided; skip i unevaluated nie kasują ani nie tworzą potrzeby wsparcia. Aktywne sesje bez snapshotu nadal korzystają z dotychczasowego selektora, a już zapisana lista nie zmienia się po odpowiedzi. Kontrakt Kid DTO, MCP i skill raportowy nie zmienia się.

API → MCP → skill: rozszerzenie katalogu dotyczy wyłącznie panelu rodzica, nie narzędzi raportowych. `learning-overview` v1, przenośny schemat oraz skill Hermesa zachowują kontrakt i filtr wyłączający lekcje. Nie wymaga wdrożenia zmiany u konsumenta MCP; aktualizacja repo nie oznacza wdrożenia aplikacji.

Dodatkowe naprawy końcowego review: walidator domenowy używa schematu `LessonExerciseInputSchema` jako źródła kształtu i limitów, a następnie wymaga bodźca właściwego typowi. Edycja i publikacja walidują całą pulę, w tym duplikaty, bez usuwania ćwiczeń rodzica. Krótkie odpowiedzi zachowują `prompt` z kompatybilnością `stem`; warianty w edytorze są osobnymi wierszami, więc przecinek pozostaje częścią zdania. Kolejność ćwiczeń korzysta z historii danego dziecka we wszystkich sesjach, po `itemId`.

Leniwa finalizacja próby w kartkówce kończy aktywny slot jako `answered`, z `feedback=null`, bez wyniku wiedzy i bez drugiej odpowiedzi; po zamknięciu sesji nie zmienia stanu slotu ani raportu. Decyzja rodzica `overridden_incorrect` jest autorytatywna także bez kategorii błędu — brak kategorii oznacza brak szczegółowej podpowiedzi, a nie „nieocenione”; stare oceny są niezmienne.

Przykłady generacji są przyjmowane tylko dla celu bieżącej partii: niepuste teksty do 120 znaków, maksymalnie trzy; wadliwe przykłady nie usuwają poprawnych ćwiczeń. Rodzic może dopisać przykład. Zatrzymaną generację lekcji rodzic ponawia istniejącym endpointem retry: pod blokadą wersji i runu podbijany jest numer edycji szkicu oraz `expected_edit_number` runu. Finalizacja i terminalne zapisy sprawdzają bieżący numer edycji, licznik claimu i stan `running`, więc spóźniony worker nie dopisze ćwiczeń ani nie zmieni wyniku nowego wykonania. To jawne ponowienie, nie automatyczne wykrywanie martwego procesu; publikacja i niepowiązane zmiany rodzica są chronione.

Worker (`LlmProvider.generateLessonPool`) generuje pulę partiami per cel z docelowym rozkładem etapów (≈35% prowadzone, 45% produktywne, 20% samodzielne). Polityka `SubjectModule.poolDeduplication` wybiera unikalność odpowiedzi (domyślna dla przedmiotów niejęzykowych) albo ćwiczeń (gramatyka). Dla gramatyki `lessonExerciseIdentity` składa cel, typ i znormalizowany bodziec; zmiana ID opcji, hintu ani polecenia nie tworzy nowego zadania. `existingExercises` jest advisory dla modelu, a walidator egzekwuje brak powtórzonego bodźca. Różne zdania mogą używać tego samego `do`/`does`/`don't`/`doesn't`. Nie zmienia to `target_key`: wcześniejsze ujawnienie odpowiedzi nadal wyklucza ją z samodzielnego sprawdzianu także przy innym celu. Adapter OpenAI woła generację puli w trybie `json_schema` strict (structured outputs; enum typów ćwiczeń puli z przedmiotu — bez `lesson_card`, który wydaje deterministycznie scheduler, pola opcjonalne nullable, `examples` tablicą par `{objectiveId, examples}` tłumaczoną na record — strict mode nie wspiera map o dowolnych kluczach); prompt wymaga, by warianty odpowiedzi nie powtarzały odpowiedzi kanonicznej, 2–4 opcji z `correctOption` wskazującym jedną z nich oraz traktuje listy typów etapów jako menu ograniczone dozwolonymi typami celu. Strażnik kształtu surowych ćwiczeń akceptuje zarówno brak pola, jak i jawny `null` (strict schema zwraca każde pole). `pool-validation.ts` (ogólne) sprawdza istnienie celu/typu, niepusty `focus` będący podsekwencją odpowiedzi, poprawność `lesson_order`/`lesson_gap`/opcji, długości i wybraną przez przedmiot politykę deduplikacji; `subject.validateExercise` dokłada reguły przedmiotu. Pula jest zatwierdzana przez rodzica; nic nie jest generowane w trakcie sesji. TTS odpowiedzi kanonicznej przechodzi istniejącym potokiem mediów (`target_audio`) tylko dla przedmiotów, które jawnie włączają `subject.ttsForAnswers`; moduł angielskiej gramatyki ma tę opcję wyłączoną.

Schemat structured output wiąże `objectiveId` i `exerciseType` dla każdej partii; `transformId` i cel przykładu mają enum z żądania. Żądanie wielocelowe używa pełnych gałęzi `anyOf` z tym samym strict kształtem obiektu. Brak dozwolonego typu kończy się lokalnie przed HTTP, a walidator domenowy nadal sprawdza semantykę odpowiedzi.

Edycja rodzica, rezerwacja top-upu i finalizacja workera serializują się na blokadzie wiersza `deck_versions`. Dla szkicu może istnieć najwyżej jeden aktywny run lekcji; ponowione `clientRequestId` zwraca ten sam run. Zapis rodzica zwiększa `edit_number` i unieważnia aktywne runy. Udany top-up dopisuje treść, przykłady i media oraz zwiększa ten sam numer edycji atomowo. Worker sprawdza wersję przed LLM i ponownie pod blokadą przed zapisem, więc stary formularz dostaje konflikt, a opóźniona odpowiedź nie nadpisze nowszej edycji.

Diagnostyka generacji (2026-10-13, po incydencie prod): błędy i wyniki runów lekcji są logowane przez worker liniami `[lesson]` na stdout — start runu (deck, liczba celów, próba), błąd partii LLM (kod i informacja o ponawialności, bez body odpowiedzi), podsumowanie walidacji puli (surowe/zły_kształt/odrzucone/ważne + histogram reguł i do 3 przykładowych powodów) oraz wynik terminalny (state, kod błędu). `generation_runs.error_code` pozostaje źródłem stanu; logi ułatwiają diagnozę bez dostępu do bazy.

Adapter LLM lekcji klasyfikuje błędy HTTP/providerów bez zapisywania surowego body. Błędy konfiguracji, wyczerpany budżet, odmowa, niepełna lub błędna odpowiedź są terminalne; 408/5xx, błąd sieciowy i zwykłe 429 są ponawialne. 429 quota/spend jest terminalne. `Retry-After` zapisuje się w `generation_runs.next_attempt_at`; backoff 1/2 s z jitterem nie skraca poprawnego terminu. Worker nie claimuje runu przed terminem, a ręczne retry go czyści. Ta polityka dotyczy wyłącznie generowania lekcji; adaptery decków i mediów zachowują dotychczasową obsługę.

Pojedynczy request ma domyślny deadline 90 s, a cały run 10 min, konfigurowalne przez `UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS` i `UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS`. `UMIEM_LESSON_GENERATION_CANCEL_POLL_MS` (1 s) sprawdza, czy run nadal jest aktywny i przypięty do bieżącego `edit_number`. Timeout kończy run terminalnym `provider_timeout`; edycja rodzica lub retry abortuje request, a shutdown oddaje nadal aktualny run do kolejki bez cofnięcia `attempts`. Provider ignorujący abort nie może zatrzymać workera ani później zapisać wyniku.

Reguły języka bodźców i odpowiedzi dostarcza profil przedmiotu: dla Present Simple `lesson_open_answer.prompt` to zdanie źródłowe po polsku, a `answer` i `acceptedAnswers` są po angielsku. Walidator odrzuca prompt równy odpowiedzi lub zatwierdzonemu wariantowi (po normalizacji); nie próbuje ogólnie wykrywać języka. Walidacja luki bierze pod uwagę operator i czasownik po podstawieniu: `She ___ play tennis.` + `does not` + `hint=do` jest poprawne, lecz `She ___ plays tennis.` z tym samym operatorem — nie.

### 19.4. Ocena hybrydowa z cache i `processing`

`lesson-attempts.ts` reużywa ścieżki prób słówek. Dla typów zamkniętych i dopasowania deterministycznego: ocena, zapis ekspozycji, projekcja celu i finalizacja w jednej transakcji. Dla odpowiedzi niedopasowanej: odczyt `lesson_verdicts` w tej samej transakcji (`parent_decision` nadrzędny); trafienie → finalizacja. Brak werdyktu i dostępny model: inkrement `learning_sessions.context.graderCalls`, wstawienie próby `processing`, commit; wywołanie modelu POZA transakcją; finalizacja CAS `processing → completed` przez `INSERT … ON CONFLICT (item_revision_id, normalized_answer, prompt_version) DO NOTHING`. Retry tej samej odpowiedzi podczas `processing` zwraca 202 bez wywołania modelu i bez inkrementu; licznik nie jest cofany przy błędzie/timeoucie/odrzuconym wyniku. Awaria procesu → leniwa finalizacja po 60 s jako „nieocenione". Walidacja werdyktu (`validateVerdict`): kategoria z listy reguły lub `other`, `correct` bez kategorii i fragmentów, każdy fragment dokładnym podciągiem odpowiedzi (po NFC); naruszenie → odrzucenie.

### 19.5. Konfiguracja modelu oceniającego (`UMIEM_GRADER_*`, proces web)

Model działa WYŁĄCZNIE w procesie web (worker go nie potrzebuje) i tylko dla odpowiedzi tekstowych nierozstrzygniętych deterministycznie. Adapter `providers/openai-compatible/grader.ts`: `POST {baseUrl}/chat/completions`, `temperature: 0`, `response_format: json_object`, `AbortSignal.timeout`.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `UMIEM_GRADER_BASE_URL` | brak = model wyłączony | `https://` wymagane poza NODE_ENV test/development |
| `UMIEM_GRADER_API_KEY` | — | tylko w adapterze; nigdy w logach, DTO, promptach |
| `UMIEM_GRADER_MODEL` | — | tani model wystarcza (ocena jednej reguły) |
| `UMIEM_GRADER_TIMEOUT_MS` | 8000 | przerwanie = „nieocenione" |
| `UMIEM_GRADER_MAX_CALLS_PER_SESSION` | 20 | księgowane w `learning_sessions.context.graderCalls` |

Trzy pierwsze zmienne razem albo żadna (częściowa konfiguracja = błąd startu). Brak konfiguracji to stan poprawny: niedopasowana odpowiedź → „nieocenione", a generowanie puli preferuje typy zamknięte i luki. Pełny katalog i uzasadnienia: `docs/provider-config.md` i `.env.example`.

### 19.6. Nowe tabele, kolumny i triggery (migracja 0007)

- `decks.kind` CHECK `in ('vocabulary','lesson')`; `learning_items.kind` CHECK `in ('vocabulary','lesson_exercise')` + trigger zgodności z `decks.kind`.
- `deck_versions.lesson_context jsonb` (subjectId, topicId, topicVersion, objectiveIds, poolSize, examples, material, instruction); trigger: wymagane dla `lesson`, zabronione dla słówek, niezmienne po publikacji.
- `attempts_modality_allowed` + `'sequence'`; `session_tasks_completed_only_exposure` → `exercise_type in ('exposure','lesson_card')`; `assignments_test_goals` + `'lesson'` z triggerem wzajemnego wykluczenia celów słówek/lekcji.
- `generation_runs.kind` rozszerzone do `('deck','lesson')` — osobny kształt przebiegu dla puli lekcji, bez przeciążania ścieżki słówek.
- `lesson_verdicts` — wspólny cache werdyktów modelu: `(item_revision_id, normalized_answer, prompt_version)` unikalny, `parent_decision` nadrzędny, bez kolumn dziecka (przeżywa usunięcie profilu jako wspólny materiał).
- `child_objective_progress` — projekcja per (child, subject, objective): status (słownik `child_skill_progress`: unseen/practicing/needs_confirmation/needs_reconfirmation/mastered), streak, next_review_at, last_independent_at, projection_version; aktualizowana w transakcji finalizacji, odbudowywana z `assessments` (`skill = 'objective'`).

`item_revisions.payload` dla `lesson_exercise` to `payload_version = 2`; `item_revision_skills` ma jeden wiersz `skill = 'objective'`; `assessments.details` nosi `{ objectiveId, verdict, errorCategory?, verdictId?, typoToken?, fragments? }` i mapuje się na istniejące `dbOutcome` (`unevaluated → unassessed`), bez zmiany CHECK `assessments_outcome_allowed`.

### 19.7. Ograniczenia (zgodne z SPEC §29a.7)

- **Audio odpowiedzi kanonicznej w gramatyce — wyłączone (2026-10-14).** Lekcja Present Simple nie tworzy zasobów TTS, nie wymaga audio do publikacji i nie pokazuje głośnika dziecku. Serwer odrzuca odsłuch starych zadań gramatycznych i ukrywa ich wcześniej zapisane `audioAssetId` przy wznowieniu; pending TTS używane wyłącznie przez gramatykę jest wygaszane. Przedmioty, które jawnie ustawiają `ttsForAnswers`, nadal mogą używać istniejącego potoku.
- **Opanowanie bez modelu.** Niezależne sprawdzenie reguły może używać produktywnych typów deterministycznych (zwł. `lesson_gap`), więc opanowanie jest osiągalne bez modelu oceniającego, o ile pula zawiera dość różnych takich ćwiczeń; model jest wymagany tylko dla odpowiedzi niedopasowanych (głównie tłumaczenie). Hybrydowa ocena jest opcjonalna.

### 19.8. Usuwanie lekcji z listy rodzica (2026-10-13)

„Usuń z listy” oznacza archiwizację konkretnego zestawu-lekcji istniejącym `POST /api/v1/parent/decks/:deckId/archive` (204), po potwierdzeniu tytułu i informacji o zachowaniu historii. Lista rodzica domyślnie ukrywa archiwalne lekcje; „Pokaż archiwalne” odsłania je do podglądu. Lista słówek zachowuje dotychczasowe zachowanie. Ćwiczenia, opublikowane wersje, przypisania i historia dziecka zostają w bazie; serwer blokuje start nowej sesji zarchiwizowanego zestawu. Katalog tematów (np. Present Simple) pozostaje dostępny do tworzenia kolejnych lekcji. Przywracanie i zmiana obsługi już trwających sesji są poza zakresem.

Nie zmienia się publiczny kontrakt API ani schemat bazy. API → MCP → skill bez zmian: raport `learning-overview` i skill Hermesa nadal wykluczają lekcje.

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

`PATCH /api/v1/parent/children/{id}` przyjmuje co najmniej jedno z pól `displayName` (trim, 1–80), `avatarKey` (1–40) i `recordingMode` (`hold | toggle`); nieznane pola odrzuca. Wymaga sesji rodzica i kontroli Origin/CSRF. Zwraca 200 z `ChildDto`, 400 dla błędnych danych/UUID, 401/403 dla braku uprawnień i 404 dla nieistniejącego profilu. `updateChild(services, childId, input: ChildPatch): Promise<ChildDto>` wykonuje pojedynczy UPDATE tylko dostarczonych pól; zachowuje UUID, rok urodzenia, datę utworzenia, politykę i historię. Dwie edycje różnych pól nie nadpisują się; dla tego samego pola obowiązuje ostatni zapis w bazie. `recording_mode` ma domyślną wartość `hold` i ograniczenie CHECK; migracja 0005 nie zmienia istniejącej historii. Kid UI otrzymuje tryb przez `KidProfileDto` i nie zapisuje go lokalnie. Szczegóły edycji: `superpowers/specs/2026-10-09-child-profile-edit-design.md`; decyzja o trybie: `superpowers/specs/2026-10-11-parent-recording-mode-setting-design.md`.

## 20. Obrazkowe zestawy słownictwa i profil nieczytający (2026-10-14)

Rodzic zapisuje `child_profiles.can_read`; API zwraca `canRead` w profilu i modyfikuje wyłącznie pole dostarczone w PATCH. `SessionDto` przypina `canRead` i `vocabularyFormat` przy starcie, aby zmiana profilu nie przepisywała aktywnej pracy. `standard` pozostaje wartością domyślną. `picture` jest dozwolone tylko dla zestawów vocabulary i jest walidowane przy generowaniu, zapisie szkicu oraz publikacji.

Publiczne prompty picture używają `MeaningVisual` (`image`, `color`, `number`) i polskich etykiet wyborów; nie zawierają angielskiej odpowiedzi w promptach przypominania. Gotowy `UiAudioCatalogDto` dostarcza krótkie polskie instrukcje. Kid UI serializuje ich odtwarzanie i anuluje kolejkę przy stop/nawigacji/nagrywaniu. Wzorcowe audio i hint słowa przechodzą przez `authorizeDisclosure`; słuchanie zadania i nagrania stałe zachowują właściwe reguły ekspozycji.

`picture_listening` może zawierać 2–4 różne opcje. Kid UI pokazuje je w dwóch kolumnach bez widocznych podpisów; `labelPl` pozostaje nazwą przycisku dla technologii asystującej. Opcje liczbowe w tych kafelkach pokazują cyfrę, podczas gdy pozostałe wizualizacje liczb nadal używają ilustracji. Powiększenie i bardzo niski viewport wracają do naturalnego przepływu z przewijaniem. Zmiana dotyczy wyłącznie promptu Kid: `learning-overview` i skill Hermesa nie konsumują tych promptów i pozostają bez zmian. Układ przetestowano w przeglądarce; nie wykonano odbioru na fizycznym Galaxy S25.

Raport rodzica nadal liczy wszystkie rewizje i pięć umiejętności. Nota wyjaśnia, że reading/spelling mogły nie być ćwiczone i zachowuje stare wyniki. Standardowy zestaw przypisywany profilowi `canRead=false` jest oznaczony ostrzeżeniem; decyzję o przypisaniu podejmuje rodzic. Nie zmieniamy kontraktu `learning-overview`, mianownika, filtracji lekcji ani prywatności raportu. Skill Hermesa zaznacza, że nie wie, kto korzysta z ustawienia nieczytania i że brak wyniku nie dowodzi zaległości.

Kolejność udostępnienia: migracja `can_read` i `vocabulary_format`, worker obsługujący generowanie/media, gotowy katalog UI audio, następnie web/Kid UI. Przed wystawieniem nowych zadań należy upewnić się, że nie odbierze ich starszy worker; starsi klienci picture dostają `picture_client_update_required`, bez cichego powrotu do tekstowych zadań.

### Okładka zestawu słownictwa (2026-10-15)

`decks.cover_asset_id` wskazuje opcjonalny, gotowy zasób `media_assets.kind = deck_cover`. Jest to wspólne metadane zestawu, niezależne od `deck_versions`, przypisań, aktywnej sesji i postępu. Parent API wymaga sesji rodzica i kontroli Origin/CSRF; przyjmuje PNG/JPEG/WebP do 5 MB, sprawdza sygnaturę bajtów i zapisuje do prywatnego `MediaStore` niezmiennie. Kid DTO udostępnia jedynie nieprzejrzyste ID. Karta preferuje okładkę, zachowując `coverVisual` jako fallback; usunięcie okładki jest idempotentne.

Generowanie propozycji okładki jest osobną akcją rodzica (`POST /decks/:id/cover/generate`) z tymi samymi zabezpieczeniami. Web udostępnia opcjonalny skonfigurowany `ImageProvider`, bez składania LLM/TTS workera. Serwer wybiera edytowalną wersję, w przeciwnym razie opublikowaną, buduje prompt z tytułu i najwyżej ośmiu par słówek oraz zwraca zwalidowane bajty bez utrwalenia assetu. UI przechowuje podgląd tymczasowo; akceptacja ponownie przesyła go przez istniejący endpoint uploadu.

## 21. Rozliczanie aktywnej pracy do nagród (2026-10-16)

Pomiar nagrodowy jest osobny od raportowego `learning-overview`. Kid API `POST /api/v1/kid/tasks/{taskId}/activity` przyjmuje `sessionId`, `taskId`, `streamId`, rosnące `sequence`, jeden z sygnałów `interaction | heartbeat | playback_start | playback_end | pause | takeover` i opcjonalny powód pauzy. Przed playbackiem klient pobiera jednorazową autoryzację przez `POST /api/v1/kid/tasks/{taskId}/activity/playback-authorization`; serwer wiąże ją z aktywnym strumieniem, profilem, sesją i zadaniem, a sygnały początku/końca muszą ją przedstawić. UI emituje start dopiero na `onplaying`. Klient nie może przekazać czasu, sekund ani punktów. Serwer zapisuje czas przyjęcia, wersję polityki, ograniczone sygnały, zamknięte przedziały i powód pauzy; retry tego samego numeru sekwencji zwraca poprzednią odpowiedź. Jedno częściowe ograniczenie unikalne pozwala na jeden aktywny strumień na dziecko; `takeover` zamyka poprzedni i jawnie rozpoczyna nowy.

Migracja `0012_reward_activity.sql` dodaje `reward_activity_streams`, `reward_activity_playback_authorizations`, `reward_activity_pauses`, `reward_activity_segments` i `reward_activity_settlements`, z FK kaskadowymi do profilu, sesji i zadania. Autoryzacja playbacku jest jednorazowa, krótko ważna, przypięta do dokładnego zasobu oraz ograniczona serwerową długością pliku; długość MP3 jest parsowana z nagłówków klatek. Przeglądarkowe `onplaying` jest jednak zdarzeniem klienta, więc serwer nie może dowieść, że głośnik faktycznie odtworzył dźwięk ani że dziecko go słyszało. Nie utrwala się historii pojedynczych kliknięć ani heartbeatów. Finalizacja ocenionej odpowiedzi albo `complete-presentation` przypina nieprzypisane przedziały do unikalnego rozliczenia w tej samej transakcji. `skip`, sesja bez kroku i samo zamknięcie sesji nie rozliczają oczekującej pracy. Techniczne oczekiwanie nie dostaje sygnałów; klient wstrzymuje pomiar przy tle, blur, offline i oczekiwaniu, a wznowienie wymaga interakcji. Heartbeat nie odświeża czasu ostatniej interakcji; audio jest mierzone wyłącznie między sygnałami start/end playbacku.

`GET /api/v1/parent/reward-activity/{childId}` przechodzi przez wspólne `requireParentSession` i zwraca ograniczone sumy sesji oraz powody pauz. Dane nie zawierają odpowiedzi, klawiszy, ruchów myszy ani audio. Nie dodano punktów, salda, dziennego celu ani sterowania Xbox. API → MCP → skill: zmiana jest wyłącznie w nowym endpointcie rodzicielskim, nie zmienia kontraktu `learning-overview`, jego czasu estymowanego, JSON Schema ani skilla Hermesa.

Review kontraktu nagród: odpowiedzi lekcji (deterministyczne, z cache i oceniane przez grader) rozliczają lub odrzucają aktywność w tej samej transakcji co zwykła odpowiedź; błędna odpowiedź pozostawiająca zadanie wydane rozpoczyna nowy strumień. Retry sygnału ponawia identyczny payload i sekwencję, a klient ogranicza żądania aktywności do 2 s, nie blokując na nich bez końca odpowiedzi. Edycja pola tekstowego i układanie odpowiedzi wysyłają ograniczony częstotliwościowo, beztreściowy sygnał interakcji. Aktywny autoryzowany playback nie podlega progowi bezczynności 60 s, ale nadal kończy się na limicie zasobu i 30-sekundowej granicy potwierdzenia.

Operacje zadania/odpowiedzi i prośby Xbox blokują najpierw dziecko `KEY SHARE`, a potem advisory lock rozliczenia; start sesji bierze `NO KEY UPDATE` i nie tworzy cyklu oczekiwania. Projekcje `child_reward_projection`, `deck_reward_projection` i `reward_day_projection` są aktualizowane atomowo po nowym settlement; odczyt profili, zestawów i decyzja Xbox nie skanują całego ledgera ani segmentów. Migracja `0016_reward_projections_and_retire_daily_round.sql` odtwarza projekcje z rozliczeń i segmentów, nie dopisując historycznych punktów, a istniejące aktywne rundy kończy bez rozliczenia oczekującej pracy. Przy wdrożeniu tej migracji należy najpierw wstrzymać stare procesy web/worker zapisujące dane, uruchomić migrację/backfill, a następnie uruchomić zgodne wersje web/worker. Otwarte karty rodzica i PWA mogą nadal używać starego kontraktu odpowiedzi z usuniętym polem; wymagają odświeżenia klienta po wdrożeniu. Runda dnia została wycofana; historyczny tryb `daily_round` pozostaje w danych i DTO raportu sesji.

Parent Work Card przy braku `date` wyznacza bieżący dzień według `family_settings.timezone`; jawna data pozostaje filtrowana względem migawki strefy sesji. Karta uwzględnia zadania wydane w danym dniu także w sesjach rozpoczętych wcześniej, pokazuje wyniki mieszane według rzeczywistych wartości ocen i odejmuje od budżetu wyłącznie zadania, które go zużywają. Usunięto z niej osobne pole raportu rundy. API → MCP → skill: Kid DTO i Parent Work Card zmieniły się, lecz `learning-overview` nadal nie obejmuje nagród ani lekcji; jego JSON Schema, walidator i skill Hermesa nie wymagają zmian.

### Punkty, dorobek zestawów i cel dnia (2026-10-16)

Migracja `0013_reward_points.sql` rozszerza rozliczenie o stabilny `deck_id`, utrwalone sekundy, przydzielone punkty, resztę milisekund do kolejnego punktu i migawkę strefy sesji. Przyjęty settlement blokuje transakcyjnie licznik dziecka przez advisory lock; każda pełna minuta daje punkt zestawowi, który domknął próg. Istniejące rozliczenia pozostają z zerową nagrodą — migracja nie nalicza punktów wstecz. `GET /api/v1/kid/profiles` zwraca dorobek, dostępne punkty, gotowe pełne pakiety dnia i dzisiejszy postęp; `GET /api/v1/kid/decks` podaje punkty stabilnego zestawu, a podsumowanie sesji faktyczny przyrost. Cel dnia sumuje wyłącznie rozliczone przedziały, dzieli je na lokalne daty w strefie zapisanej w sesji i uwzględnia DST. Nie ma tu wymiany ani rezerwacji punktów. Kid API nie zmienia narzędzi MCP: `learning-overview`, jego estymowany czas, JSON Schema i skill Hermesa pozostają bez zmian.
