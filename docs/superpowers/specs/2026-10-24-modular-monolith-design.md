# Knowli — stopniowe uporządkowanie kodu według funkcji produktu

Data: 2026-10-24. Podstawa rozpoznania: commit `99308d3`.
Status: kierunek wybrany przez właściciela; dokument do akceptacji przed planowaniem.

## Cel i uzgodnienia

Głównym celem jest ładnie zorganizowany, czytelny kod: łatwe odnalezienie funkcji,
zrozumienie jej odpowiedzialności i bezpieczna zmiana przez człowieka lub agenta.
Łatwiejsze testowanie oraz mniejszy koszt przyszłej wymiany infrastruktury są
korzyściami pomocniczymi, a nie powodem do dodawania abstrakcji z wyprzedzeniem.

Właściciel wybrał stopniowe porządkowanie obszarami produktu. Zachowujemy Next.js,
React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.
Obecna praca obejmuje projekt podziału. Plan i implementacja są kolejnymi krokami;
ten dokument nie upoważnia do implementacji, push, PR ani merge.

## Rozważone podejścia

| Podejście | Korzyść | Koszt i ograniczenie |
| --- | --- | --- |
| Podział według funkcji produktu — wybrany | Kod powiązanych operacji ma jednego właściciela; małe API ogranicza znajomość wnętrza innych obszarów | Trzeba ustalić odpowiedzialności i stopniowo poprawiać importy |
| Porządkowanie samych warstw `domain/modules/providers` | Mniej przenosin, prostsze rozbijanie dużych plików | Jedna funkcja pozostaje rozproszona między warstwami, a własność jest mniej widoczna |

Nie przyjmujemy obowiązkowego zestawu klas, repozytoriów i folderów dla każdej
funkcji. Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.

## Co istnieje dzisiaj

Poniższe obserwacje pochodzą z kodu, nie tylko z dokumentacji:

| Obszar | Konkretne źródła | Ocena |
| --- | --- | --- |
| Reguły nauki | `packages/server/src/domain/{evaluate,independence,progress,scheduler,support-cycle}.ts` | Duża część reguł już działa na jawnych danych, bez Drizzle i transportu |
| Przedmioty | `domain/lessons/{types,registry,architecture.test}.ts`, `domain/lessons/subjects/` | `SubjectModule` i rejestr są właściwą granicą; test chroni silnik domenowy przed importowaniem implementacji przedmiotów |
| Sesje | `modules/sessions.ts` — 1523 linie w badanym commicie | Jeden plik zawiera odczyty, planowanie, materializację i zapis; `materializeTask` korzysta z `Math.random` i `randomUUID` |
| Próby i postęp | `modules/{attempts,events,attempt-shared,skill-history,skill-projections}.ts` | Istnieją wspólne blokady i zapis ekspozycji; część decyzji, np. `nextTaskState`, pozostaje obok SQL |
| Lekcje | `modules/lessons/{lesson-sessions,lesson-attempts,lesson-api,lesson-drafts}.ts` | Reguły przedmiotu są wydzielone, ale koordynacja sesji, oceny i zapisu jest duża |
| Materiały i media | `modules/{decks,version-ops,generation,media-reconciliation}.ts` | Wspólne operacje wersji i uzgadnianie zasobów są użyteczne; `generation.ts` i `lessons/lesson-drafts.ts` importują się wzajemnie |
| Profile i dostęp | `modules/{profiles,auth,integration-tokens}.ts` | Podstawowe odpowiedzialności istnieją; `profiles.ts` obejmuje też zapytania o oceny wymowy i ustawienia polityki nauki |
| Raporty | `modules/{reporting,published-progress,learning-overview,parent-work-card}.ts` | Są modele odczytu oraz wspólne reguły; `reporting.ts` importuje limit czasu z dużego `sessions.ts` |
| Transport | `apps/web/src/orpc/{parent-router,kid-router}.ts` | Routery korzystają z przypadków użycia, lecz także same wybierają obsługę kartkówki po rodzaju zestawu/sesji |
| Integracje | `apps/web/src/integrations/{learning-overview-orpc,learning-mcp-route,learning-mcp-server}.ts` | HTTP i MCP korzystają z tego samego `getLearningOverview` i schematów kontraktów |
| Publiczna powierzchnia serwera | `packages/server/src/index.ts` | Jeden eksport zbiorczy udostępnia operacje biznesowe, ale też schemat bazy i pomocniki infrastruktury |

Nie wszystkie zależności od `@learning/contracts` są problemem. Import wspólnego
typu wartości nie oznacza zależności od transportu. Przy wydzielaniu reguły trzeba
jednak sprawdzić, czy używa ona pojęć domenowych, czy całego DTO/payloadu klienta.

## Proponowane moduły i własność

To pięć odpowiedzialności logicznych w istniejącym `@learning/server`, bez nowych
pakietów. Przykłady API oznaczają istniejące operacje lub wąskie fasady; nie są
poleceniem zmiany nazw endpointów ani masowego dodawania nowych funkcji.

| Moduł | Własność danych i reguł | Małe publiczne API | Dozwolone zależności |
| --- | --- | --- | --- |
| Materiały (`materials`) | Zestawy, elementy, rewizje, kryteria umiejętności, przypisania, publikacja, generowanie, zasoby i ich powiązania | Tworzenie/edycja/publikacja szkicu, przypisanie zestawu, zlecenie i wykonanie generacji, odczyt przypiętej treści | Przedmioty, publiczny odczyt profili; porty providerów, mediów i infrastruktura we własnej warstwie wykonawczej |
| Nauka (`learning`) | Polityki nauki, sesje, zadania, próby, oceny, ekspozycje, projekcje, kartkówki i rozliczenie aktywności | `startSession`, `nextTask`, `submitAttempt`, operacje mowy/ujawnień, `completePresentation`, `endSession`, odczyt wyniku | Odczyty materiałów i profili, przedmioty; porty oceny, mowy i infrastruktura we własnej warstwie wykonawczej |
| Przedmioty (`subjects`) | `SubjectModule`, katalogi tematów i celów, normalizatory, kategorie błędów, walidatory i profile promptów | Rejestr oraz odczyt przedmiotu/wersji tematu | Własne typy i bezpieczne typy wartości; bez odwołań do przypadków użycia, bazy i transportu |
| Rodzina i dostęp (`family`) | Tożsamość i preferencje profili, uwierzytelnianie rodzica, sesje dostępu, tokeny integracyjne, usuwanie profilu | CRUD profili, weryfikacja rodzica/principal, wydanie i unieważnienie tokenu | Własna infrastruktura; bez zależności od przypadków użycia nauki lub materiałów |
| Raportowanie (`reporting`) | Modele odczytu i składanie raportów, bez własności źródłowych ocen i postępu | Raport postępu, aktywność, karta pracy, `getLearningOverview` | Publiczne odczyty i reguły nauki/materiałów, odczyt profili i weryfikacja dostępu; własne adaptery zapytań |

Zależności biznesowe biegną od raportowania do obszarów źródłowych, od nauki do
materiałów/przedmiotów/profili oraz od materiałów do przedmiotów/profili. Moduły
źródłowe nie importują raportowania. Przedmioty nie importują silnika wykonawczego.

Przynależność danych jest semantyczna, nie równoznaczna z własnością całej tabeli.
Przykładowo pole polityki nauki i rozliczenie punktów zapisane w profilu należą do
nauki, choć tożsamość profilu należy do rodziny. Istniejący zapis tych pól pozostaje
w wymaganej transakcji; nie przenosimy kolumn ani nie dokładamy wywołań CRUD profilu.
Analogicznie raportowanie może czytać tabele źródłowe, ale nie modyfikować ocen.

## Organizacja kodu i publiczne granice

- Docelowe grupowanie przypadków użycia: `packages/server/src/modules/materials/`,
  `learning/`, `family/` i `reporting/`, z wąskim `index.ts` dla każdego obszaru.
- Granicą przedmiotów pozostaje istniejące `domain/lessons/subjects/` oraz
  `SubjectModule` i rejestr. Nie tworzymy drugiej implementacji ani nowego
  frameworka pluginów dla uzyskania symetrycznych katalogów.
- Wewnątrz obszaru pliki odpowiadają operacjom produktu, np. wydanie zadania,
  przyjęcie odpowiedzi lub publikacja szkicu. Samo przekroczenie liczby linii
  nie jest powodem do arbitralnego podziału.
- Istniejące czyste funkcje w `domain/` można zachować. Nie przenosimy ich hurtowo
  wyłącznie dla układu katalogów. Nowe wydzielenie otrzymuje konkretne znaczenie
  i jedno źródło prawdy; pomocnik dotyczący tylko jednego obszaru nie trafia do
  ogólnego `utils` ani `shared`.
- Wewnątrz modułu można używać importów względnych. Inny moduł korzysta z jego
  jawnych eksportów zamiast importować pliki wykonawcze i modele ORM.
- Raporty mogą mieć dedykowane zapytania łączące tabele kilku obszarów. Odczyt
  pozostaje adapterem raportowania z ustaloną semantyką i migawką; nie wymuszamy
  łańcucha małych zapytań tylko dla formalnej zgodności z podziałem.
- `packages/server/src/index.ts` zachowuje istniejące eksporty potrzebne klientom.
  Przejściowe pliki zgodności mogą tylko przekazywać eksporty, bez kopii logiki.
  Nowy kod web/worker nie korzysta z wewnętrznych pomocników, jeśli istnieje
  właściwa operacja produktu.
- Nie tworzymy pustej hierarchii wszystkich modułów na początku. Grupowanie
  następuje przy kompletnym porządkowaniu danego fragmentu. Tymczasowy stary
  import jest jawnie nazwanym długiem, a nie ukrytą drugą ścieżką wykonania.

## Reguły i infrastruktura

Reguła otrzymuje jawne dane i zwraca decyzję. Przypadek użycia odczytuje stan,
weryfikuje uprawnienia i warunki, wywołuje regułę oraz zapisuje skutki. Kontroler
HTTP/oRPC/MCP mapuje żądanie i odpowiedź, bez własnej alternatywnej reguły.

Drizzle pozostaje we fragmentach wykonawczych i adapterach. Nie trzeba od razu
opakowywać każdego zapytania interfejsem. Port odczytu/zapisu jest uzasadniony,
gdy wyraża konkretną operację lub usuwa istotne sprzężenie, a nie odwzorowuje ORM.
`Services` i istniejący `Tx` mogą pozostać w koordynacji infrastruktury. Czyste
reguły nie przyjmują ich ani rekordów `$inferSelect`.

Czas, identyfikatory i losowość przekazujemy jawnie przy wydzielaniu zależnej
od nich decyzji. Nie zmieniamy rozkładu losowania, momentu zapisu, formatu danych
ani liczby wywołań providerów przy okazji porządkowania.

Nowy przedmiot, np. historia, rozszerza `SubjectModule` i rejestr w ramach już
obsługiwanych ćwiczeń. Nowa mechanika ćwiczenia wymaga jawnego rozwoju kontraktów,
silnika, edytora, widoków i testów. To dwa różne rodzaje zmiany.

## Granice transakcji i gwarancje

Podział katalogów nie zmienia istniejących commitów, kolejności blokad ani faz
wywołań zewnętrznych. Nie tworzymy event busa ani eventual consistency.

| Operacja | Gwarancja do zachowania |
| --- | --- |
| Start/wydanie zadania | Przypięcie wersji materiału i polityki, blokady oraz atomowy zapis zadania, faktów i zapieczętowanej ekspozycji przed ujawnieniem |
| Przyjęcie/finalizacja próby | Idempotencja i zamrożenie kontekstu przy `received_at`; oceny, stan próby/zadania, wymagane projekcje i feedback pozostają we wspólnej transakcji danej fazy |
| Mowa i ocena modelem | Istniejące fazy rezerwacji, zewnętrznego wywołania i finalizacji zostają zachowane; nie obejmujemy sieci nową długą transakcją |
| Edycja/publikacja materiału | Wspólna blokada wersji, zapis rewizji/kryteriów, uzgodnienie fingerprintów oraz zlecenia brakujących zasobów; opublikowane dane pozostają niezmienne |
| Finalizacja mediów | Dotychczasowe lease i warunki podpięcia wyniku; gotowy blob i zasób pozostają niezmienne |
| Rozliczenie aktywności | Dotychczasowe blokady profilu/sesji, jednokrotność oceny i atomowy zapis rozliczenia; model nie oblicza punktów |
| Usunięcie profilu | Obecna kontrolowana kaskada danych dziecka, bez usuwania wspólnego materiału i bez nowego asynchronicznego sprzątania |
| Raport | Dotychczasowa spójność migawki i semantyka odczytu, bez naprawiania historii przez GET |

Pomocnik współpracujący w istniejącej transakcji otrzymuje ten sam kontekst
wykonania i nie otwiera własnego niezależnego commitu. Wydzielenie przenośnego
portu transakcyjnego pozostaje decyzją późniejszego, konkretnego zadania.

Zachowujemy ponadto krótkotrwałe przetwarzanie nagrań w pamięci, brak odpowiedzi
dziecka i sekretów w diagnostyce oraz oddzielenie publicznych DTO od rekordów bazy.
Kid UI pozostaje klientem jawnego Kid API i nie importuje serwera ani Next.js.

## Kandydat na pierwszy zakres implementacyjny

Rekomendacja autora do późniejszego planu: wydzielić decyzję o stanie zadania po
próbie z `modules/attempts.ts` (`nextTaskState`) do czystej, nazwanej reguły nauki.
Obejmuje to również jawne rozpoznanie gałęzi kartkówki przy jej wywołaniu; dokładną
sygnaturę i zakres wspólnej funkcji ustali plan po sprawdzeniu obu ścieżek.

Korzyść: regułę zakończenia/powtórzenia zadania można przeczytać i testować bez
ładowania modułu Drizzle. Nie jest to jeszcze wydzielenie całego modułu nauki.
Ten zakres nie obejmuje przebudowy lekcji, losowania promptów, modeli bazy,
routerów, rozliczeń aktywności ani zmiany dotychczasowych progów i zachowania.

Istniejące testy w `tests/integration/attempts.test.ts` obejmują m.in. pierwszy
i drugi błąd oraz ponowienie żądania. Plan powinien ustalić brakujące przypadki
reguły, w tym pominięcie, brak pamięci, odpowiedź nieocenioną, mieszane oceny
umiejętności, mowę i dotychczasowe zachowanie kartkówki. Ewentualną rozbieżność
z opisem produktu zgłaszamy osobno; refaktoryzacja zachowuje faktyczne zachowanie.

## Weryfikacja i wpływ na klientów

- Pierwszy zakres ma zachować publiczne kontrakty, schemat i wywołujących.
  Nie wymaga aktualizacji danych ani odbudowy projekcji.
- Regułę sprawdzają znaczące testy jednostkowe, a jej włączenie istniejące testy
  integracyjne prób na PostgreSQL. Gwarancje współbieżności wymagają testów
  dotykających blokad; zielony test funkcji nie jest ich dowodem.
- Wąska kontrola importów chroni czystą regułę przed Drizzle, `db/`, konfiguracją
  usług, providerami i transportem. Nie wprowadzamy od razu globalnej listy
  zakazów dla całego starego kodu.
- Przy przenoszeniu kolejnych fragmentów wykonujemy odpowiednie istniejące testy
  sesji, lekcji, wersjonowania, mediów, historii, raportów i integracji. Zakres
  typecheck/build oraz pozostałych kontroli ustala plan według zmienianych plików.
- Dla pierwszego zakresu API → MCP → skill pozostają bez zmian, ponieważ nie
  zmienia się operacja raportowania, jej dane, autoryzacja ani interpretacja.
  W implementacji trzeba potwierdzić ten zakres i zapisać uzasadnienie. Samo
  wydzielenie modułu nie uzasadnia regeneracji niezmienionego kontraktu.
- Przy późniejszym porządkowaniu raportów zachowujemy wspólny `getLearningOverview`,
  źródło schematów w `packages/contracts`, filtr słownictwa oraz notę o wyłączeniu
  lekcji w `integrations/umiem-mcp/skills/umiem-learning/SKILL.md`.

## Co pozostaje do planu i czego nie obiecujemy

Plan określi pliki pierwszego etapu, sygnaturę reguły, testy, kontrolę importów
i polecenia weryfikacji. Następne możliwe obszary to materializacja zadania,
koordynacja kartkówek w routerach, cykl zależności generowania i grupowanie
przypadków użycia. Nie oznacza to zgody na wykonanie ich wszystkich w jednym etapie.

Przenośne są reguły działające na zwykłych danych. Wymiana bazy nadal wymaga pracy
nad zapytaniami, Drizzle, transakcjami, blokadami, triggerami i migracjami; wymiana
hosta nad adapterami transportu, konfiguracją i uruchamianiem procesów. Układ
katalogów i `index.ts` same nie zapewniają przenośności ani izolacji.

Kryterium powodzenia: konkretny fragment ma czytelniejszą odpowiedzialność, jedno
źródło reguł i zachowane zachowanie, a jego zrozumienie wymaga mniej otaczającego
kodu. Nie oceniamy postępu liczbą nowych katalogów i interfejsów.
