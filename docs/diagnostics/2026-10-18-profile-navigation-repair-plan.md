# Plan naprawy przejścia profil → lista zestawów

Data: 2026-10-18. Status: plan do implementacji; żaden etap nie jest wykonany.
Gałąź lokalna: `feature/profile-navigation-diagnosis`.
Bazowy kod diagnozy: `5356529150a92bd782c6118ab52b49e4fcd905ae`.

Diagnoza i pomiary: [2026-10-18-profile-navigation-latency.md](./2026-10-18-profile-navigation-latency.md).

## 1. Cel i zakres

Usunąć wielosekundowe oczekiwanie na listę zestawów, zachowując prawdziwe
liczniki, rekomendacje, kwalifikację samodzielnych odpowiedzi i przypięte wersje
sesji. Koszt zwykłego odczytu listy ma zależeć od widocznego materiału,
a nie od liczby wszystkich historycznych prób dziecka.

Zakres obejmuje pięć ustaleń:

| Ustalenie | Rozwiązanie | Etapy |
| --- | --- | --- |
| Powtarzane skany zdarzeń audio | Zbiorczy odczyt dla potrzebnych zadań i właściwy indeks | A1 |
| Setki alternatyw OR i uruchamianie JIT | Dokładna relacja żądanych zakresów, stabilny kształt SQL | A2 |
| Odtwarzanie historii przy otwieraniu listy | Wersjonowane projekcje aktualizowane przy zapisie | B1–B4 |
| Pełny snapshot planera używany przez listę | Osobny, wąski odczyt listy; wspólne reguły domenowe | B4 |
| Sekwencyjne odczyty lekcji i materializacja kartkówki | Grupowanie odczytów i rozdzielenie wyboru od materializacji | C1–C2 |

Poza zakresem: nowe funkcje UI, zmiana kryteriów nauki, punktów lub limitów,
Redis, mikroserwis, asynchroniczna niespójność po zapisie, automatyczne wdrożenie.
Nie maskować opóźnienia cache'em HTTP ani zmianą `recommended` na stałą wartość.

## 2. Wykonawca, nadzór i sposób pracy

- Implementację prowadzi subagent **Luna**. W obecnym Codex: `gpt-6-luna`,
  reasoning `medium`, z jawnym wyborem modelu i `fork_turns="none"`.
  Przy zmianie klienta ustalić rzeczywiście dostępny wariant Luna; nie podmieniać
  go bez informacji dla właściciela na inny model.
- Agent główny przekazuje kontekst, plan, zasady AGENTS.md i zakres jednego
  etapu. Sam odczytuje diff, sprawdza dowody testów i akceptuje etap.
- Luna nie zatwierdza własnego rozwiązania jako końcowego review. Agent główny
  odpowiada za końcową ocenę implementacji. Ewentualny dodatkowy reviewer:
  najmocniejszy dostępny model spoza rodziny GPT Astra, zgodnie z preferencją
  właściciela. Nie delegować implementacji kolejnych etapów bez nadzoru.
- Etapy realizować sekwencyjnie w tym worktree. Nie uruchamiać kilku agentów
  edytujących wspólne pliki. Nie tworzyć dodatkowego chatu użytkownika.
- Dla istotnych reguł i danych: rzeczywisty RED → minimalny GREEN → refaktor.
  Raport etapu zawiera nazwę testu, przyczynę RED, komendę, wynik GREEN,
  pliki, migracje i pozostałe ograniczenia. Nie zastępować RED historycznym logiem.
- Nadzorca rozstrzyga rutynowe decyzje wykonawcze. Rozbieżność w znaczeniu
  danych lub kontrakcie wymaga jawnego opisania przed zależną implementacją.
- Planowanie nie uruchamia implementacji. Przy późniejszym rozpoczęciu użyć
  obowiązującego workflow implementacyjnego i odpowiednich skilli repozytorium.
- Właściciel zlecił push gałęzi roboczej i utworzenie wysokiej jakości PR z
  zielonymi checks. Merge i zmiany produkcyjne wymagają osobnego polecenia.

## 3. Niezmienniki architektoniczne

1. Historia prób, ocen, wydanych zadań i zapieczętowanych ekspozycji jest źródłem
   prawdy. Projekcje można usunąć i odbudować; nie wolno przepisywać historii.
2. Ocena, kwalifikacja dowodów i projekcja używają tych samych funkcji domenowych.
   Nowy odczyt listy nie implementuje drugiego algorytmu opanowania.
3. Wersja polityki i wersja algorytmu projekcji są osobnymi identyfikatorami.
   `projectionVersion="proj-2"` nie zastępuje `policyId`.
4. Stara sesja aktualizuje stan swojej polityki i swoich `skill_version`.
   Nie może nadpisać projekcji innej polityki ani awansować nowej umiejętności.
5. Fakty historyczne są materializowane, natomiast decyzje zależne od czasu
   (`recommended`, nadejście powtórki, upływ przerwy po ujawnieniu) wylicza się
   przy odczycie ze spójnego zestawu faktów i jednego `now`.
6. Zmiana faktu i jego projekcji jest atomowa w istniejącej transakcji.
   Przestrzegać istniejącej kolejności blokad; nie dodawać blokady całej rodziny.
7. Wydanie ujawniającej treści utrwala zdarzenia, ekspozycje i projekcje przed
   odpowiedzią HTTP. ACK klienta nie jest źródłem prawdy. `received_at` nadal
   zamraża kwalifikację próby przed przetwarzaniem mowy.
8. GET listy nie wykonuje INSERT/UPDATE/DELETE, rebuild ani materializacji zadań.
   Brak wiersza dla nowego materiału oznacza stan początkowy; brak wymaganej
   odbudowy historycznych danych nie może być interpretowany jako brak nauki.
9. Serwer decyduje o rekomendacji i dostępności kartkówki. Kid UI nie odtwarza
   domeny i nie otrzymuje odpowiedzi, historii ani technicznych score'ów.
10. Odczyt listy korzysta z jednej spójnej migawki bazy. Przy wielu SELECT-ach
    użyć krótkiej transakcji READ ONLY / REPEATABLE READ; dopasować API Drizzle
    do istniejącego stacka. Nie wywoływać w niej providerów i nie blokować sesji.

## 4. Docelowy podział odpowiedzialności

```text
ocena / wydanie zadania / zapieczętowanie ekspozycji
  → istniejąca transakcja domenowa
  → wspólny projektor → wersjonowany stan postępu i fakty pracy

GET listy zestawów
  → metadane widocznego materiału + stan postępu + fakty pracy
  → wspólne deriveSkillWork / hasScheduledWork + now + możliwości dziecka
  → dotychczasowy KidDeckDto[]

historia
  → audyt / jawny rebuild / weryfikacja zgodności / potrzebne odczyty planera
```

Nazwy nowych funkcji/modułów są propozycjami; Luna może dopasować je do kodu.
Wymagane granice: czytnik listy, czytnik historii, projektor faktów i czyste reguły.
Nie tworzyć ogólnego frameworka projekcji ani repozytorium dla każdej tabeli.

### 4.1. Stan postępu i fakty pracy

Docelowo rozszerzyć istniejący model projekcji, zamiast utrzymywać dwie
niezależnie liczone kopie statusu:

- `child_skill_progress`: jawna polityka w zakresie rekordu
  `(child_id, skill_version_id, policy_id)`; `projection_version` opisuje algorytm.
  Dostosować wszystkie odczyty, zapisy, konflikty UPSERT, odbudowę i raporty.
  Status, seria i termin nadal wynikają z jednego wspólnego projektora.
- Fakty dotyczące wprowadzenia umiejętności i kwalifikujących ocen:
  zakres dziecko + wersja umiejętności + polityka. Przechowywać tylko pola
  wymagane przez `deriveSkillWork` i rekomendację, np. pierwsze wydanie danego
  etapu i istnienie kwalifikującej oceny. Można umieścić je w tej projekcji lub
  w jednej współpracującej tabeli, jeśli różny cykl zapisu to uzasadnia.
- Ostatnia istotna ekspozycja: zakres `(child_id, target_key)`, niezależny od
  polityki i rewizji. Aktualizacja przez maksimum czasu zapieczętowanych
  ekspozycji; obejmuje ujawnienie jako dystraktor, feedback i odsłuch z cache.
  Uwzględniać słowo kanoniczne i zatwierdzone warianty według obecnych reguł.
- Nie materializować `recommended`, `eligibleNow` ani globalnych sum opanowania
  zestawu. Obliczać je ze stanu dotyczącego właściwych wersji materiału.

Przed migracją nadzorca zatwierdza mapę wszystkich konsumentów projekcji.
Jeśli istniejący kontrakt wymaga zachowania projekcji „ostatniej wiarygodnej
polityki” w konkretnym raporcie, wyrazić to jako jawny wybór rekordu, a nie
niejawny fallback między politykami. Nie zmieniać semantyki raportów przy okazji.

## 5. Etapy implementacji i bramki nadzoru

### P0 — utrwalenie kontraktu i pomiaru

Zadania:

- Sprawdzić aktualny HEAD, `origin/main`, merge-base, status i lokalne instrukcje.
  Istniejących plików diagnozy nie nadpisywać. Nie resetować worktree.
- Sprawdzić `node_modules` i `.env`; brak `.env` uzupełnić przez
  `node scripts/setup-worktree.cjs --skip-install`. Instalować wyłącznie przy
  braku zależności, zgodnie z AGENTS.md.
- Przeczytać odpowiednie fragmenty SPEC, architektury §6.2/§9/§12/§19,
  folder-structure, implementacji R01–R07 i autorytatywnego schematu TS.
- Sporządzić mapę: pole `KidDeckDto` → źródło → polityka → zależność od czasu.
  Objąć zestaw aktywny, przypiętą starą wersję, archiwizację i profil nieczytający.
- Dodać powtarzalny benchmark na fikcyjnych danych, bez sekretów i danych dzieci.
  Rejestrować medianę/p95, liczbę zapytań, wiersze, plan, czas SQL i przypadek
  użycia; nie wypisywać bind parameters, promptów ani odpowiedzi.
- Zachować dotychczasowy odczyt jako testową referencję na czas przełączenia.
  Nie tworzyć produkcyjnego przełącznika utrzymywanego bezterminowo.

Wyjście: mapa zależności i baseline; nadzorca akceptuje zakres kolejnego etapu.

### A1 — zbiorczy odczyt dowodów audio

Pliki: `modules/skill-history.ts`, `db/schema.ts`, nowa migracja Drizzle,
`tests/integration/history.test.ts` i testy kwalifikacji dowodów.

- Najpierw testy granic czasu, izolacji, wielu audio i zdarzeń niezapieczętowanych.
- Zastąpić skorelowane EXISTS zbiorczym odczytem najwcześniejszego audio dla
  potrzebnych zadań. Jeden wynik na zadanie; bez mnożenia ocen przez JOIN.
- Jawnie zachować `occurred_at <= received_at` oraz `sealed=true`.
- Dodać indeks częściowy `(task_id, occurred_at)` dla zapieczętowanych
  `audio_issued`, jeśli plan potwierdzi jego użyteczność dla tego odczytu.
  Schemat TS i migracja muszą być zgodne; nie edytować ręcznie dawnych migracji.
- Użyć identycznego czytnika dla finalizacji ocen, odbudowy i pozostałych odbiorców.

Bramka A1: zgodność kompletnych historii + plan bez powtarzanego pełnego skanu
zdarzeń; nadzorca sprawdza SQL i migrację. Brak potrzeby globalnej zmiany JIT.

### A2 — relacja żądanych zakresów zamiast OR

- Przekazać deduplikowane dokładne trójki przez parametryzowane `VALUES` albo
  typowany `UNNEST`; wybrać wariant o stabilnym kształcie SQL w benchmarku.
- Nie interpolować wartości, nie tworzyć iloczynu osobnych list IN i nie polegać
  wyłącznie na filtrowaniu wyniku w JavaScript.
- Zachować deterministyczną kolejność historii; jawnie rozstrzygnąć remisy
  czasu/próby/umiejętności bez zmiany kolejności dowodów danej umiejętności.
- Przetestować puste zakresy, duplikaty, kilku właścicieli i mieszane umiejętności.

Bramka A2: AC01–AC04, pierwsze porównanie wydajności. To samodzielnie
działająca poprawka głównego opóźnienia, również zanim powstaną projekcje B.

### B1 — kontrakt i migracja projekcji

- Zmapować wszystkich konsumentów `child_skill_progress`, `persistSkillProjection`,
  `writeSkillProjection`, `readLearningSnapshot`, `progress-rebuild`, odczyty
  raportów i operacje zmiany polityki profilu. Nadzorca sprawdza mapę przed DDL.
- Zapisać dokładne kolumny, klucze, FK, indeksy i wersję projektora według §4.1.
  Nie mieszać wersji polityki z wersją algorytmu; zachować kasowanie przez CASCADE.
- Przygotować migrację rozszerzającą model oraz narzędzie jawnego backfill/rebuild.
  Nie przypisywać wszystkim starym wierszom CURRENT_POLICY_ID jako substytutu
  odtworzenia rzeczywistej historii.
- Backfill odtwarza wszystkie potrzebne kombinacje polityki i umiejętności
  z historii oraz fakty wydanych zadań/ekspozycji, również gdy nie było oceny.
  Brak dowodów dla danej polityki daje jej stan początkowy.
- Rozdzielić brak danych nowego dziecka od nieukończonego backfillu poprzez
  jawny znacznik wersji/gotowości projekcji na odpowiednim zakresie.

Bramka B1: nadzorca zatwierdza migrację, plan przełączenia konsumentów,
przypadki mieszanych polityk i zachowanie raportów. Nie przełączać GET wcześniej.

### B2 — zapis i aktualizacja projekcji

- Aktualizować stan tej samej polityki podczas finalizacji oceny; retry nie
  zwiększa serii ani liczników drugi raz. Błąd projekcji cofa transakcję źródłową.
- Fakty wprowadzenia aktualizować wraz z wydaniem zadania, niezależnie od tego,
  czy później powstanie oceniona odpowiedź.
- Ekspozycje aktualizować we wspólnej ścieżce zapieczętowania, przed odpowiedzią.
  Zapieczętowanie i projekcja mają być atomowe, także dla zdarzeń bez próby.
- UPSERT faktów stosuje odpowiednie MIN/MAX/OR i nie może zgubić nowszego faktu
  przy równoległych sesjach. Sprawdzić retry transakcji i kolejność blokad.
- Początkowo dopuszczalne jest przeliczenie historii zmienionej umiejętności
  przy zapisie, jak w obecnym `persistSkillProjection`. Nie przenosić na zapis
  odtworzenia całej historii dziecka. Projektora inkrementalnego nie wymyślać
  bez osobnego dowodu równoważności.

Bramka B2: atomiczność, idempotencja i zgodność z rebuild na tych samych danych.

### B3 — odbudowa, migracja danych i polityki

- Uzupełnić istniejący rebuild o nowe zakresy/fakty, dry-run, kontrolę wersji
  i raport liczników bez prywatnych payloadów.
- Rebuild ma być powtarzalny i idempotentny. Zachować istniejący zakaz apply
  przy aktywnej sesji/przetwarzanej próbie, chyba że nadzorca zatwierdzi
  równoważny bezpieczny mechanizm. Nie usuwać zabezpieczenia dla wygody migracji.
- Porównać przyrostowy zapis i pełną odbudowę, w tym rollback, usuwanie profilu,
  zmiany polityki, stare sesje i współdzielenie skill_version między rewizjami.
- Dopiero po pełnym backfillu oznaczyć projekcję gotową. Nie uruchamiać
  naprawczego rebuild automatycznie podczas każdego GET.

Bramka B3: pełna odbudowa z usuniętych projekcji daje identyczny wynik.

### B4 — wąski, spójny odczyt listy

- Wprowadzić np. `readDeckLearningOverview`, który pobiera wyłącznie dane listy.
  Nie dodawać zestawu flag do wielozadaniowego `readLearningSnapshot`.
- Usunąć replay historii, historyczne prompty, analizę pomyłek i niepotrzebne
  kierunki czytania z normalnej ścieżki GET. Nie usuwać ich z planera sesji.
- Lista i planer korzystają z tych samych funkcji `deriveSkillWork`,
  `hasScheduledWork` oraz reguł możliwości dziecka i wersji materiału.
- Jeden zegar `now` i jedna spójna migawka DB na odpowiedź. Aktywna sesja
  zachowuje przypiętą wersję; lista respektuje dotychczasowy kontrakt wznowienia.
- Przenieść `ensureLearningPolicy` z GET do kontrolowanego bootstrapu/migracji.
  Brak wymaganej konfiguracji jest błędem gotowości, nie sygnałem do ukrytego
  INSERT z odczytu. Zachować poprawne uruchamianie nowej instalacji.
- Nie serwować nieaktualnej projekcji jako poprawnego postępu. Niegotową
  projekcję wykryć przed uruchomieniem nowej wersji; zachowanie awaryjne musi
  używać istniejącego formatu błędu i zostać opisane w operacjach.
- Różnice względem starego fallbacku do innej polityki klasyfikować jawnie:
  poprawa błędu domenowego wymaga osobnego testu i uzasadnienia nadzorcy,
  a nie automatycznego nadpisania oczekiwań testów zgodności.

Bramka B4: AC05–AC11 i porównanie wszystkich pól DTO na macierzy scenariuszy.

### C1 — rozdzielenie planu kartkówki od materializacji

Pliki: `modules/lessons/lesson-mock-tests.ts`, `lesson-sessions.ts`,
czysty `domain/lessons/mock-test-plan.ts` i testy kartkówek lekcji.

- Wydzielić czysty wybór bezpiecznych pozycji z gotowego snapshotu wejściowego.
- Dostępność na liście wywołuje tę samą selekcję i sprawdza niepusty wynik;
  nie buduje promptów, kluczy odpowiedzi, losowych UUID ani zasobów audio.
- Start kartkówki ponownie odczytuje aktualny stan pod istniejącą blokadą,
  wybiera pozycje i dopiero materializuje niezmienny plan.
- Dostępność na liście jest informacją w chwili odczytu, nie rezerwacją.
  Zmiana ekspozycji do chwili startu może prawidłowo zmienić wynik.

Bramka C1: przy tym samym snapshotcie dostępność i plan startowy są zgodne;
konkurencyjne ujawnienie nie omija ponownej walidacji.

### C2 — zbiorczy odczyt lekcji

- Dla wszystkich widocznych lekcji załadować metadane/konteksty wersji, pulę
  wymaganych danych ćwiczeń, postęp celów per przedmiot i ekspozycje targetów
  grupami. Reużyć dane między licznikami, rekomendacją i selekcją kartkówki.
- Czytnik listy nie ładuje audio odpowiedzi i całego materiału do materializacji,
  jeśli wystarczą objectiveId, exerciseType, targetKey i identyfikatory pozycji.
- Zachować moduły przedmiotów, walidację i rejestr. Brak wiedzy o angielskim
  czy konkretnym temacie w ogólnym silniku/odczycie listy.
- Liczba odczytów nie może rosnąć liniowo od liczby lekcji przy tym samym
  zbiorze przedmiotów. Samo opakowanie starej pętli w Promise.all nie wystarcza.

Bramka C2: AC12–AC13, testy izolacji lekcji i pomiar 1/10/30 lekcji.

### V — końcowa weryfikacja i review nadzorcy

- Nadzorca samodzielnie czyta finalny diff i migracje, porównuje AC z dowodami,
  analizuje plany wykonania i ponawia kluczowe testy. Sprawdza szczególnie
  semantykę polityk, kolejność blokad i komplet ścieżek zapisu ekspozycji.
- Znalezione błędy wracają do Luny jako małe zadania z testem regresji.
- Zaktualizować właściwe sekcje architektury, instrukcję operacyjną migracji
  i końcowy raport. Usunąć testową referencję starego kodu po zachowaniu testów
  opartych na wymaganiach; nie utrzymywać dwóch produkcyjnych implementacji.
- Raport końcowy wskazuje każde AC: PASS / FAIL / NIEWERYFIKOWANE i dowód.
  Nie oznaczać całości jako ukończonej, jeśli brakuje wymaganej weryfikacji.

## 6. Kryteria akceptacji (AC)

| ID | Kryterium | Dowód |
| --- | --- | --- |
| AC01 | Zoptymalizowany czytnik zwraca tę samą historię, kwalifikację i kolejność dowodów danej umiejętności, łącznie z remisami czasu i różnymi politykami | Test integracyjny PostgreSQL, porównanie pól i multizbioru |
| AC02 | Audio dokładnie w received_at wspiera odpowiedź; późniejsze lub niezapieczętowane nie wspiera; wiele audio nie powiela ocen | Testy graniczne historii i projektora |
| AC03 | Puste i powtórzone zakresy są poprawne; brak przecieku między dokładnymi trójkami dziecko/skillVersion/skill | Testy zakresów z co najmniej dwoma dziećmi |
| AC04 | Brak skorelowanego pełnego skanu learning_events na każdą ocenę i brak setek OR w konstrukcji czytnika; rozwiązanie działa z domyślnie włączonym JIT | EXPLAIN ANALYZE BUFFERS, przegląd SQL |
| AC05 | Pełny rebuild i stan aktualizowany podczas nauki są identyczne dla postępu i faktów pracy; drugi rebuild nie wprowadza zmian | Integracja + dry-run |
| AC06 | Stan jest izolowany per polityka i skill_version; stara sesja nie nadpisuje nowej polityki; raporty zachowują uzgodniony wybór polityki | Test zmiany polityki w trakcie starej sesji i raportów |
| AC07 | Awaria zapisu projekcji cofa źródłowy zapis; retry nie podwaja efektu; dwa klienty nie gubią MIN/MAX/serii | Fault injection, transakcje, test współbieżności |
| AC08 | Ujawnienia, retry i odsłuch z cache aktualizują fakty przed odpowiedzią; ACK/reload nie usuwają wpływu; kwalifikacja pozostaje zamrożona w received_at | R01, R04, R05 i testy historii |
| AC09 | Zwykły GET listy po backfillu nie czyta surowej historii prób/ocen/ekspozycji ani historycznych promptów, nie odtwarza postępu i nie zapisuje do DB | Instrumentacja zapytań, wykonanie przez połączenie read-only |
| AC10 | recommended i należne terminy zmieniają się prawidłowo po upływie czasu bez nowej próby; stan nieczytającego i mikrofonu zachowuje możliwości | Zegar kontrolowany, próg czasu ±1 ms |
| AC11 | DTO, kolejność, liczniki i wznowienie są zgodne dla macierzy scenariuszy; lista przedstawia jeden spójny stan podczas równoległego zapisu | Integracja snapshotu + porównanie DTO |
| AC12 | Dostępność kartkówki i start korzystają z tej samej selekcji; lista nie materializuje promptów/UUID; start ponownie waliduje pod blokadą | Testy planera i konkurencyjnej ekspozycji |
| AC13 | Dla 1/10/30 lekcji jednego przedmiotu liczba SELECT-ów części lekcyjnej pozostaje stała, poza udokumentowanym dzieleniem dużych parametrów na paczki | Instrumentacja odczytu, identyczne wyniki |
| AC14 | Usunięcie profilu usuwa nowe projekcje, zachowuje wspólne materiały; immutable historia, R03 i granice lesson/vocabulary pozostają poprawne | Testy CASCADE/triggerów/izolacji |
| AC15 | Migracja i backfill przechodzą na pustej bazie oraz bazie z mieszaną historią; gotowość wymaga właściwej wersji projekcji; przerwanie nie oznacza gotowości | Test migracji, restart/backfill i readiness |
| AC16 | Spełnione budżety wydajności z §7, a czas zapisu ocen/ujawnień nie pogarsza się ponad ustalony budżet | Powtarzalny benchmark i raport przed/po |
| AC17 | Publiczne DTO i API pozostają kompatybilne; wpływ API → MCP → skill jest opisany, a istniejący filtr lekcji w learning-overview zachowany | Testy kontraktów/raportów, uzasadnienie zakresu MCP |
| AC18 | Odpowiednie testy, typecheck i build przechodzą; nadzorca zakończył review bez otwartych błędów naruszających AC | Raport końcowy i lista uruchomionych komend |

Macierz AC11: nowy materiał; profil bez zestawów; czytający/nieczytający;
mikrofon włączony/wyłączony; aktywna zwykła sesja/kartkówka; archiwizacja;
aktywna stara wersja po publikacji nowej; wiele rewizji z tym samym skill_version;
nowe kryteria z nowym skill_version; słówka/lekcje/mieszane; brak ocen;
tylko ekspozycje; nieoceniona próba; historia kilku polityk; utrata odpowiedzi HTTP.

## 7. Budżety i pomiar wydajności

Warunki pomiaru należy zapisać przed A1: maszyna, wersja PostgreSQL, liczba
połączeń, wielkość fixture, wersja kodu, JIT, warm/cold, liczba próbek.
Budżety poniżej są AC planowanej poprawki, nie już potwierdzonym wynikiem.

- Profil bazowy fixture: 10 zestawów, 500 rewizji, 10000 ocen i 50000 zdarzeń,
  co najmniej dwoje dzieci; oddzielnie 1/10/30 lekcji. Dane w pełni fikcyjne.
- Próbka skalowania: te same widoczne zestawy i fakty, 10× więcej historycznych
  ocen/zdarzeń. Nie zwiększać jednocześnie widocznego materiału.
- Minimum 5 rozgrzewek i 30 kolejnych pomiarów bez równoległego benchmarku.
  Raportować medianę, p95 (metoda nearest-rank), maksimum i cold run osobno.
- Po A: zapytanie historii p95 ≤250 ms dla fixture bazowego; wynik i plan
  muszą być poprawne również dla większej historii. Nie wymagać konkretnego
  typu JOIN/indeksu, jeśli inny plan spełnia koszt i semantykę.
- Po B/C: `listKidDecks` p95 ≤500 ms dla fixture bazowego i z 10× historią;
  mediana przy 10× historii nie może przekroczyć 1,5× baseline po poprawce.
  Odczyt ma używać projekcji, a nie tylko mieścić replay w tym budżecie.
- Część lekcyjna spełnia AC13; koszt danych może rosnąć z materiałem, ale
  nie wykonuje stałego zestawu zapytań osobno dla każdej lekcji.
- Mediana/p95 zapisu ocen i zapieczętowania ekspozycji: brak regresji p95
  większej niż max(20%, 25 ms) względem A na identycznych danych i maszynie.
  Większy koszt wymaga analizy nadzorcy, a nie przeniesienia projekcji do GET.
- Testy semantyki i liczby odczytów są deterministyczne. Budżety czasu są
  osobnym benchmarkiem na opisanym środowisku; nie dodawać kruchego progu
  500 ms do każdego uruchomienia integracji na dowolnym runnerze CI.
- Po autoryzowanym wdrożeniu: minimum 20 sekwencyjnych GET-ów na profil,
  p95 ≤1 s na tej samej trasie sieciowej co baseline. Jeśli sieć uniemożliwia
  ocenę, podać osobno czasy serwera i sieci; AC produkcyjne pozostaje
  NIEWERYFIKOWANE. Nie utożsamiać benchmarku wewnątrz kontenera z HTTP/UI.

## 8. Testy i polecenia

Na początku sprawdzić aktualne definicje w package.json. Przykłady dla obecnego kodu:

```powershell
# Celowane uruchomienia w cyklu RED/GREEN:
corepack pnpm test:unit packages/server/src/domain/projection-evidence.test.ts
corepack pnpm test:integration tests/integration/history.test.ts tests/integration/progress-rebuild.test.ts

# Bramka końcowa po zmianach schematu i projekcji:
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm build

# Celowane E2E; rozszerzyć, gdy diff dotknie kolejnych przepływów:
corepack pnpm test:e2e tests/e2e/kid-flow.spec.ts tests/e2e/progress-panel.spec.ts tests/e2e/lesson-kid.spec.ts tests/e2e/lesson-mock-test.spec.ts
git diff --check
```

Rozszerzyć istniejące testy historii/rebuild i dodać wydzielone testy odczytu
listy/projekcji, gdy poprawia to czytelność. Sprawdzić także `reporting.test.ts`,
`lesson-isolation.test.ts`, `lesson-sessions.test.ts`, `lesson-mock-tests.test.ts`
oraz testy sesji i mock-testów słówek. Pełna integracja jest uzasadniona zakresem
schematu; nie uruchamiać jej jako baseline przed pierwszym małym etapem.

R01/R03/R04/R05 są bezpośrednio objęte. R07 sprawdzić w regresji ścieżki ocen
mowy, ponieważ korzysta ze wspólnej projekcji. R02/R06 dotyczą niezmienionych
mediów — nie deklarować nowych testów urządzenia/providerów bez ich wykonania.

## 9. API, MCP, dokumentacja i wdrożenie

- Zamierzony wynik: bez zmiany publicznych endpointów, DTO i znaczenia pól.
  Wewnętrzna optymalizacja sama nie wymaga regeneracji schematu MCP.
- Po B sprawdzić wszystkie raporty korzystające ze zmienionej projekcji, w tym
  learning-overview. Jeśli diff zmienia semantykę, błędy lub kontrakty,
  zaktualizować adapter, schemat, testy i skill zgodnie z AGENTS.md.
- Lekcje nadal nie wchodzą do raportu Hermesa. Zmiana projekcji nie zmienia tego filtra.
- Przed produkcją przygotować runbook. A można wydać samodzielnie; B wymaga
  zgodnej wersji web/worker oraz migracji i pełnego backfillu przed obsługą GET.
- Preferować kontrolowane okno utrzymaniowe dla B: zatrzymać stare procesy
  zapisujące, sprawdzić aktywne/przetwarzane sesje, wykonać zabezpieczony backup,
  migrację, backfill i walidację, uruchomić zgodne procesy, wykonać smoke test.
  Nie kończyć samowolnie aktywnych sesji, żeby obejść warunek rebuild.
- Rollback B wymaga kompatybilnego snapshotu bazy lub jawnego zachowania starego
  modelu w migracji rozszerzającej. Nie obiecywać, że sam powrót starego obrazu
  działa po zmianie klucza projekcji. Runbook ma podać konkretną procedurę.
- Luna wykonuje lokalne testy migracji; nie stosuje migracji na produkcji.
  Nadzorca oddziela „implementacja zweryfikowana lokalnie” od „wdrożone i zmierzone”.

## 10. Checklist przekazania do Luny

- [ ] P0: mapa kontraktu, baseline, stan repozytorium.
- [ ] A1: zbiorcze dowody audio, migracja indeksu, testy i plan.
- [ ] A2: dokładne zakresy, porównanie wyników, benchmark i review nadzorcy.
- [ ] B1: kontrakt polityk/projekcji, mapa konsumentów, migracja i backfill.
- [ ] B2: komplet ścieżek aktualizacji, retry, rollback i dwa klienty.
- [ ] B3: zgodna, idempotentna odbudowa i gotowość.
- [ ] B4: wąski read-only snapshot listy, zgodne DTO i raporty.
- [ ] C1: wspólny wybór kartkówki bez materializacji w GET.
- [ ] C2: grupowy odczyt lekcji i pomiar skalowania.
- [ ] V: pełna weryfikacja, review, dokumentacja i macierz dowodów AC.

Pierwsze zadanie dla subagenta po rozpoczęciu implementacji: **wyłącznie P0 i A1**.
Po jego raporcie agent główny przeprowadza bramkę i przekazuje następny zakres.
