# Przygotowanie do sprawdzianu i niezawodność panelu rodzica

Data: 2026-10-09. Stan bazowy: `fc7fd9a`.
Ścieżka Superpowers: architectural — zmiana współpracy klient–serwer
i danych kontekstu sesji. Właściciel zaakceptował rekomendacje i ich
kolejność. Dokument jest projektem do przeglądu, nie zatwierdzonym planem
implementacji ani dowodem wykonania zmian.

## 1. Cel i podział pracy

Pierwszy pakiet domyka trzy zaakceptowane usprawnienia:

1. Termin sprawdzianu wpływa na dobór ćwiczeń.
2. Rodzic nie traci poprawek przy opuszczeniu edytora lub konflikcie zapisu.
3. Niepewny wynik zlecenia generacji można ponowić bez tworzenia drugiego zestawu.

Następny pakiet obejmie wklejanie list słówek do ręcznego szkicu.
Widok „Co dziś?” i automatyczne odświeżanie raportu wymagają kolejnych
projektów; nie wchodzą do pierwszego pakietu. Nie rozszerzamy zakresu
o OCR, offline, autosave, powiadomienia ani nowe reguły opanowania.

Rozważone podejścia:

- **Rekomendowane:** wykorzystać obecny scheduler, jawny zapis szkicu
  i istniejący klucz idempotencji generacji. Mały zakres i dotychczasowe
  kontrakty HTTP; potrzebne testy integracji oraz błędów transportu.
- Osobny tryb próbnego sprawdzianu: wymaga nowego kontraktu sesji
  i osobnego uzgodnienia zachowania dziecka. Odłożony.
- Autosave i trwała lokalna kolejka operacji: zwiększają zakres synchronizacji,
  konfliktów oraz lokalnego przechowywania materiału. Odłożone.

## 2. Potwierdzony stan kodu

- `assignments.testDate` jest odczytywane przez raporty i listę zestawów dziecka,
  ale `ScheduleInput` i wywołanie `selectTask` nie zawierają terminu.
- Scheduler najpierw chroni należne sprawdzenia Recall/pisowni, potem
  obsługuje wsparcie, wprowadza etapy i nowy materiał. Rozpoznawanie ma
  dodatkową ścieżkę utrwalania. Pisemne Recall już ocenia też pisownię.
- `DeckEditor` posiada stan dirty i optimistic locking. Przycisk powrotu
  bezpośrednio opuszcza widok. Odpowiedź conflict zeruje dirty i ładuje
  dane, przez co lokalny formularz może zostać zastąpiony.
- `ParentApp` przełącza zakładki przez odmontowanie ich zawartości.
- `DecksPanel.generate` tworzy UUID przy każdym kliknięciu; backend
  deduplikuje runy według tego klucza. Ręczne tworzenie szkicu już zachowuje
  polecenie przy niepewnym wyniku i oddziela sukces tworzenia od odświeżenia listy.
- Zmiany użyją istniejących tabel Drizzle. `docs/schema.sql` pozostaje
  historycznym projektem, nie drugą rozwijaną definicją bazy.

## 3. Termin sprawdzianu

### Kontekst i czas

Nowa sesja przypina `testDate` z przypisania razem ze strefą rodziny
w prywatnym JSON kontekstu. Zmiana daty przez rodzica obowiązuje od nowej
sesji; wznowienie zachowuje poprzednią wartość. Wydane zadanie pozostaje
niezmienne. Kid API nie otrzymuje parametrów schedulera ani kryteriów oceny.

Data nie ma godziny. Przyjmujemy początek dnia sprawdzianu w strefie rodziny
jako punkt odniesienia okna 48 godzin; cały dzień sprawdzianu pozostaje
objęty priorytetem. Daty wcześniejsze od dzisiejszej daty rodziny, brak daty
i termin dalej niż 48 godzin nie aktywują priorytetu. Obliczenia uwzględniają
zmianę czasu; nie dodajemy sztywno 24 godzin do lokalnych dni.

Starsza sesja bez pola `testDate` zachowuje dotychczasowy dobór zadań.
Nie rekonstruujemy jej terminu z później zmienionego przypisania.
Przekazanie kontekstu schedulera jest wewnętrznym kontraktem serwera;
nie wymaga migracji kolumn ani nowego endpointu.

### Dobór zadań

- Rezerwacje należnych niezależnych sprawdzeń, obsługa wsparcia po błędach
  i wymagany odstęp po wsparciu zachowują pierwszeństwo.
- W oknie sprawdzianu znane elementy z nieopanowaną pisownią lub Recall
  otrzymują ćwiczenie pisemne przed wprowadzaniem nowych słów i ćwiczeniem
  wymowy. Znany element wymaga wcześniejszej prezentacji oraz sukcesu
  rozpoznawania; nie odpytujemy z nieznanej treści.
- Korzystamy z istniejącego zadania pisemnego Recall, które może dostarczyć
  osobnych ocen treści i pisowni. Nie tworzymy nowego typu ćwiczenia.
- Element już sprawdzony lub pominięty w sesji nie jest wydawany ponownie
  jako niezależne sprawdzenie. Ćwiczenie przygotowujące nie może omijać
  rezerwacji, odstępów ani tworzyć pętli jednego słowa.
- Dodatkowe ćwiczenie przygotowujące danego elementu pojawia się najwyżej
  raz w sesji. Po dwóch takich ocenianych zadaniach wybieramy łatwiejsze
  rozpoznawanie, jeśli jest bezpieczny kandydat. Należne niezależne
  sprawdzenie i wymagane wsparcie nadal mają pierwszeństwo.
- Kolejność kandydatów jest deterministyczna: wymagające ponownego
  potwierdzenia, następnie nieopanowana pisownia, następnie Recall;
  rozstrzygnięcie remisu według pozycji w zestawie.
- Powód decyzji zapisujemy w prywatnym kontekście zadania.
  Nie nazywamy ćwiczenia samodzielnym sukcesem bez spełnienia kwalifikacji.

Reguły 300 sekund, potwierdzenia po przerwie, wariantów odpowiedzi,
budżetu 12 zadań i obietnicy „Jeszcze 3” pozostają obowiązujące.
Bez terminu wybór zadań zachowuje obecne zachowanie.

## 4. Ochrona edycji

### Opuszczanie widoku

Zmiana tytułu, pól kart, wizualizacji, dodanie i usunięcie karty powodują
stan niezapisanej edycji. Powrót do listy, przełączenie zakładki i wylogowanie
przechodzą przez wspólną kontrolę tego stanu w panelu rodzica.
Dialog daje wybór „Zostań” albo „Opuść bez zapisu”. Potwierdzenie opuszczenia
nie zapisuje ani nie publikuje treści. Podczas zapisu przejścia są zablokowane.

Przeładowanie i zamknięcie karty korzystają z `beforeunload`, aktywnego
wyłącznie przy niezapisanej edycji. Przeglądarka może ograniczać ten dialog;
nie obiecujemy odzyskania po awarii procesu lub zamknięciu aplikacji mobilnej.
Nie zapisujemy szkicu w localStorage i nie dodajemy autosave.

### Konflikt i błąd zapisu

409 zachowuje formularz i jego bazową wersję. Aktualna wersja serwerowa
jest pobierana osobno; polling nie zastępuje lokalnych zmian.
Rodzic widzi komunikat konfliktu i porównanie lokalnej oraz aktualnej wersji,
w tym kart dodanych i usuniętych. Mapowanie używa tożsamości karty,
a nie indeksu po usunięciu lub zmianie kolejności.

Nie ponawiamy pełnego PATCH z nowym numerem edycji automatycznie.
Rodzic może pozostać przy swoich poprawkach i je skopiować albo jawnie
wczytać aktualną wersję. Wczytanie wymaga potwierdzenia zastąpienia formularza;
porównanie ze starymi lokalnymi poprawkami pozostaje dostępne w pamięci
do zakończenia rozwiązywania konfliktu lub opuszczenia widoku.
Rodzic przenosi wybrane poprawki do aktualnej wersji, a potem zapisuje je
z jej `expectedEditNumber`. Kolejny konflikt znów zachowuje pracę.

Jeśli druga przeglądarka opublikowała szkic, lokalna edycja pozostaje
dostępna do skopiowania, lecz zapis starego szkicu jest zablokowany;
rodzic korzysta z istniejącego tworzenia nowej wersji.
Błąd pobrania aktualnej wersji nie usuwa danych; można ponowić odczyt.
Zwykły błąd sieciowy również nie czyści formularza.

Zapis działa na migawce wysłanego formularza. Pola i operacje kart są
zablokowane na czas oczekiwania, żeby sukces nie oznaczał zapisania później
wpisanych, niewysłanych wartości. Dirty jest czyszczone po potwierdzonym
zapisie; błąd odświeżenia po sukcesie ma osobny komunikat.

## 5. Bezpieczne zlecanie generacji

Klient tworzy jedną migawkę polecenia z UUID, promptem i tytułem.
Blokada w ref zapobiega równoległym kliknięciom przed renderem.
Po niepewnym wyniku zachowuje dokładnie tę migawkę i klucz w pamięci
komponentu. Przycisk „Ponów tworzenie” wysyła ten sam payload.
Pola są zablokowane do rozstrzygnięcia wyniku; UI pokazuje polski komunikat
o możliwości przyjęcia poprzedniego zlecenia.

Definitywne odrzucenie walidacji lub autoryzacji nie zachowuje operacji
do ponowienia jako przyjętej. Błąd sieci, 5xx i nieczytelna odpowiedź
pozostawiają wynik niepewny. Brak sesji kieruje do logowania.
Po poprawnej odpowiedzi identyfikatory utworzonego zestawu/runu oznaczają
sukces, niezależnie od odświeżenia listy. Otwieramy istniejący edytor;
problem odświeżenia listy nie uruchamia nowej generacji.

Po potwierdzonym sukcesie nowe świadome tworzenie otrzymuje nowy UUID.
Retry nie uruchamia drugiej logicznej generacji. Nie rozszerzamy tej
gwarancji na przeładowanie całej strony, które usuwa pamięć komponentu;
po reloadzie rodzic najpierw sprawdza listę zestawów.

Kontrakt HTTP generacji pozostaje bez zmian. Nie dodajemy nowego endpointu,
trwałej kolejki przeglądarki ani automatycznego ponawiania kosztownych operacji.
Dotychczasowe retry nieudanego runu w edytorze pozostaje osobną operacją.

## 6. Pliki i weryfikacja

Przewidywane granice zmian:

- `packages/server/src/modules/{sessions,events}.ts` — kontekst terminu sesji.
- `packages/server/src/domain/scheduler.ts` oraz mały moduł obliczeń terminu.
- `apps/web/src/parent/{ParentApp,DeckEditor,DecksPanel}.tsx` oraz małe
  moduły stanu edycji/polecenia w tym samym katalogu.
- `packages/contracts/src/messages.ts` — wszystkie nowe komunikaty.
- `tests/integration/sessions.test.ts`, testy domeny schedulera i czasu,
  testy E2E rodzica oraz ręcznej edycji.
- SPEC, architecture, folder-structure i implementation-plan — aktualizacja
  wyłącznie uzgodnionych kontraktów i zakresu wykonanych zmian.

Kryteria akceptacji:

1. Zestaw z nowymi słowami i znanym słowem o słabej pisowni: w oknie
   sprawdzianu ćwiczenie pisemne poprzedza nowe słowo; bez terminu działa
   obecna kolejność. Testy granic 48 godzin, dzisiejszej/przeszłej daty,
   DST, strefy rodziny i sesji starszego formatu.
2. Zmiana terminu w drugiej przeglądarce nie zmienia kontekstu rozpoczętej
   sesji, ale zmienia nową. Retry `next` zwraca wydane niezmienne zadanie.
3. Rezerwacje i dystraktory nadal chronią niezależne sprawdzenia; pisownia
   oraz Recall są osobne. Pominięcie, nieocenione i tryb bez mikrofonu
   zachowują znaczenie. Budżet końca sesji nie rośnie.
4. Niezapisane poprawki nie znikają po anulowaniu powrotu, zmiany zakładki,
   wylogowania lub przeładowania. Potwierdzone opuszczenie je odrzuca.
5. Dwie przeglądarki zmieniają ten sam szkic: druga otrzymuje konflikt,
   zachowuje swoje dane i widzi aktualną wersję. Ponowny konflikt oraz
   publikacja w drugim oknie nie prowadzą do cichego nadpisania.
6. Serwer przyjmuje generację, odpowiedź ginie: ponowienie wysyła identyczny
   payload i otwiera ten sam zestaw; w PostgreSQL jest jeden deck/run.
   Szybkie podwójne kliknięcie oraz błąd odświeżenia listy nie tworzą drugiego.
7. Widoki błędu, konfliktu i dialogi są używalne na telefonie, tablecie
   i desktopie oraz z klawiatury. Etykiety są po polsku.

Plan implementacji musi wskazać testy nowego zachowania uruchamiane jako
RED przed kodem, a potem GREEN. Integracja używa docelowego PostgreSQL;
E2E fake-providerów i izolowanych zasobów, żeby nie kolidować z innymi
worktree. Regresje bezpośrednio związane ze zmianą:
R01 (ujawnienia, reload, dwóch klientów), R04 (idempotentne zakończenie
prezentacji), R05 (ochrona należnych sprawdzeń) oraz R06 (edycja podczas
przygotowania mediów). Istniejące testy R02 (niezmienność mediów),
R03 (niezmienność historii i kasowanie profilu) oraz R07 (warianty mowy)
pozostają w pełnych przebiegach regresji, bez rozszerzania modułu mowy.

Końcowe sprawdzenia: `pnpm test:unit`, `pnpm test:integration`,
`pnpm test:e2e`, `pnpm typecheck`, `pnpm build`; wizualna ocena widoków
na szerokościach telefonu, tabletu i desktopu. Nie wysyłamy danych dzieci
do providerów na potrzeby testów. Żywej oceny mowy nie zmieniamy.

## 7. Checklista workflow

- [x] Rozpoznanie kodu, dokumentacji, stanu Git i aktualnych skryptów.
- [x] Zidentyfikowanie celu oraz klasyfikacja architectural.
- [x] Właściciel zaakceptował rekomendacje i kolejność prac.
- [x] Rozważenie alternatyw i przygotowanie konkretnego projektu.
- [x] Zapis specyfikacji z kontraktami oraz kryteriami akceptacji.
- [x] Samodzielny przegląd specyfikacji: zakres, kontrakty, granice czasu,
      zgodność mapowania regresji i brak nierozstrzygniętych placeholderów.
- [ ] Właściciel przegląda i zatwierdza pisemną specyfikację.
- [ ] Writing-plans: szczegółowy plan z plikami, RED, sprawdzeniami i zależnościami.
- [ ] Właściciel przegląda plan i wybiera metodę wykonania; bez zgody
      na delegację wykonanie bezpośrednie przez executing-plans.
- [ ] Executing-plans: małe kroki i aktualizowana checklista wykonania.
- [ ] TDD: zapisane dowody RED, następnie implementacja i GREEN.
- [ ] Przegląd zmian i verification-before-completion: świeże wyniki sprawdzeń.
- [ ] Raport zmian, dowodów oraz ograniczeń; audyt checklisty workflow.
- [ ] Przy zleconej integracji: finishing-a-development-branch,
      weryfikacja po integracji i sprzątnięcie worktree.

Companion wizualny nie był potrzebny do rozstrzygnięcia kontraktów.
Nie delegowano pracy. Kod produktu nie został zmieniony.
