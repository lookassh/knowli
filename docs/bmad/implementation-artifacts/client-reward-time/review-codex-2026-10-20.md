# Niezależny review implementacji client-reward-time

Raport historyczny dla commitu78c7575. Ustalenia zostały następnie poprawione; [plan poprawek i końcowy wynik review](../spec-client-reward-time-review-fixes.md#odbiór-końcowy--główny-agent) opisuje aktualny stan roboczy.

Data: 2026-10-20. Przedmiot: `12963bf192d1bc19a571cef0b22e894ecae9586b..78c7575b5c30d257dd2239236303f23cef982d14`, gałąź `impl/client-reward-time`. Review nie obejmuje późniejszych zmian na main i nie potwierdza gotowości do scalenia z jego aktualnym stanem.

## Werdykt

Zmiana ma sensowny fundament, ale wymaga poprawek przed scaleniem. Usunięcie starego systemu nagród jest rzeczywiste. Nowy pomiar ma jednak błędy pozwalające zwykłym zachowaniem zawyżać czas, a adapter danych LLM gubi część odpowiedzi i treści lekcji. Raport „zaimplementowane w całości” jest zbyt mocny.

Nie zalecam przepisywania całości ani kolejnego frameworka. Najlepszy następny krok to poprawienie poniższych usterek, uproszczenie kilku istniejących miejsc i testy konkretnych regresji.

Review: cztery niezależne perspektywy (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor), następnie samodzielna weryfikacja i triage. Wymuszona przez prompt liczba kandydatów nie oznacza liczby zaakceptowanych problemów.

## Ustalenia wymagające poprawek

Ścieżki i numery linii odnoszą się do commitu `78c7575`, przed dopisaniem dokumentacji review. P1 oznacza błąd kluczowego działania, P2 istotną poprawkę w tym zadaniu. Wszystkie poniższe pozycje są `patch`; review nie wprowadza zmian aplikacji.

### F01 — P1: blur zalicza wcześniejszą bezczynność

`packages/kid-ui/src/session/activity-report.ts:283–287`.

`pause()` domyka aktywność przez `#closeActiveAt(nowOffset, false)`. Limit 60 s jest stosowany przy zamrożeniu lub nowej interakcji, ale pomijany przy przejściu do tła/blur/offline. Dziecko może zostawić pytanie na pięć minut, przełączyć kartę i wrócić do odpowiedzi. Raport zawiera pięć minut aktywności i nie pokazuje tej bezczynności jako idle.

Reprodukcja na kontrolowanym zegarze: `taskShown → +300000 ms → pause('blur') → freeze` daje `activeMs=300000`, a schemat przyjmuje raport; oczekiwane maksimum bez odsłuchu/interakcji to 60000 ms. Nie dowodzi to automatycznie przyznania pięciu punktów przez rzeczywisty model, ale kod dostarcza mu błędny pomiar.

Poprawka: jedno domykanie czasu z uwzględnieniem idle i rzeczywistego odsłuchu dla wszystkich zakończeń przedziału. Nie dodawać kolejnego niezależnego licznika.

### F02 — P1: niepełny kontekst i zgubione odpowiedzi w wejściu LLM

`packages/server/src/modules/session-activity.ts:162–165, 194–196, 247–257`.

Lekcje zapisują podstawową odpowiedź w `answerKey.answer`, a snapshot odczytuje `target`, dodatkowe `acceptedAnswers` i opcję. Przy pustych dodatkowych wariantach znana odpowiedź wzorcowa znika. `lesson_order` przechowuje elementy w `prompt.items`/`key.itemValues`, a nowy resolver szuka wyłącznie `prompt.options`: faktyczna ułożona odpowiedź trafia do LLM jako `null`. Karty lekcji mają tylko tytuł, bez body/examples; `lesson_notice` nie przekazuje zdań z segmentami.

To narusza główną przesłankę tego rozwiązania: model ma oceniać pracę na podstawie rzeczywistych zadań i odpowiedzi. Format jest poprawny technicznie, lecz dane są semantycznie niepełne.

Poprawka i uproszczenie: mały, typowany formatter promptu/odpowiedzi. Oprzeć go na istniejących kształtach kluczy, z których korzysta m.in. `modules/lessons/lesson-mock-tests.ts:507–525`, i współdzielić czystą konwersję tam, gdzie znaczenie jest identyczne. Zachować osobną kontrolę prywatności payloadu LLM. Testy tabelaryczne dla wszystkich typów ćwiczeń, z asercją treści, nie tylko nazw pól.

### F03 — P2: zachowany raport zakończonej sesji nie ma drogi dostarczenia po ponownym otwarciu

`packages/kid-ui/src/session/session-controller.ts:311–319, 617–634`; `activity-draft-store.ts:12–16`.

Zamrożony payload istnieje wyłącznie w pamięci kontrolera. Magazyn zachowuje stan roboczy, odczytywany dopiero przy rozpoczęciu sesji o znanym ID. Jeżeli serwer zakończy sesję, a karta zostanie zamknięta przed potwierdzeniem całej operacji, po powrocie sesja nie jest aktywna i aplikacja nie odnajduje jej kopii do dostarczenia/pobrania wyniku. To istotna różnica wobec obsługi retry w tej samej instancji, która działa.

Naruszenie design §4/§8 i B04/C02. Szczególnie ważne, gdy proces przerwie się pomiędzy zamknięciem wiedzy a przyjęciem raportu. Przy już przyjętym raporcie wynik może zostać poprawnie zapisany na serwerze, ale FE nadal nie odzyskuje tego przebiegu.

Poprawka: w istniejącym magazynie zachować dokładny finalny payload i możliwość odnalezienia go po restarcie. Ponowne dostarczenie identycznego raportu ma być wyłącznie retry transportowym, bez ponownej oceny LLM i bez osobnej kolejki serwerowej.

### F04 — P2: kompakcja nie respektuje limitów jednego zadania

`packages/kid-ui/src/session/activity-report.ts:359–363`; `packages/contracts/src/reward-activity.ts:83–88`.

Reporter sprawdza 4096 wpisów i rozmiar bajtowy, podczas gdy kontrakt ogranicza także pojedyncze tablice: 256 okien edycji, 128 odsłuchów i 128 pauz. Poniżej limitu globalnego kompakcja nie rusza.

Reprodukcja: 257 edycji co 5 s w jednym zadaniu daje 257 okien, `compacted=false` i błąd schematu. Podobna granica dotyczy 129 odsłuchów. To długi lub nietypowy przebieg, ale możliwy bez podmiany żądań. Zamrożony raport jest stale odrzucany przy retry, blokując zakończenie przez ten endpoint.

Poprawka: jeden predykat wszystkich limitów, używany przez kolejne kroki kompakcji. Testować również dane poniżej globalnego limitu, przekraczające limit jednego zadania.

### F05 — P2: limit długości odsłuchu jest niepodłączony i nie ogranicza całej aktywności

`packages/kid-ui/src/session/session-controller.ts:256–264`; `activity-report.ts:253–279`.

Produkcja przekazuje zawsze `durationMs:null`, więc wymaganie A09 nie jest spełnione. Ponadto samo podanie długości nie naprawia reguły: `#finishPlayback` przycina wpis playback, ale otwarty przedział aktywności pozostaje, a `playbackEnded` ustawia ostatnią aktywność na późny czas zdarzenia.

Reprodukcja komponentu: start odsłuchu z długością 2000 ms, zdarzenie końca po 300000 ms, freeze — playback ma 2000 ms, lecz `activeMs=300000`. To dowód zachowania reportera, nie test opóźnionego zdarzenia na fizycznym urządzeniu.

Poprawka: rzeczywisty początek/koniec i długość z adaptera odtwarzacza powinny sterować jedną regułą pomiaru. Usunąć pozorną obsługę limitu, która ogranicza tylko dodatkowy opis, a nie naliczany czas. Nie wymaga to powrotu autoryzacji nagrodowej audio.

### F06 — P2: odsłuchy poprawnej odpowiedzi po próbie nie trafiają do pomiaru

`packages/kid-ui/src/session/session-controller.ts:869, 897`.

Feedback audio i odsłuch poprawnej opcji wywołują bezpośrednio `player.play`, omijając `#playCountedAudio`. Po wysłaniu odpowiedzi reporter jest w `technical_wait`, więc faktyczna praca z odsłuchem może pozostać niezaliczona, a LLM nie widzi odsłuchów.

Poprawka: użyć istniejącej wspólnej ścieżki pomiarowej przy obu odtworzeniach. Odsłuch instrukcji interfejsu może nadal mieć inną semantykę.

### F07 — P2: wznowione processing liczy techniczne oczekiwanie

`packages/kid-ui/src/session/session-controller.ts:598–602`.

Przy zadaniu z `pendingAttemptId` kontroler uruchamia pomiar i polling bez `pause('technical_wait')`. Przy nowej przeglądarce bez draftu czas oczekiwania na ocenę jest traktowany jako aktywność, do progu idle.

Poprawka: zachować przypisanie bieżącego zadania, ale natychmiast wstrzymać pomiar przed pollingiem. Test nowej instancji kontrolera z trwającą oceną.

### F08 — P2: spóźniona odpowiedź poprzedniej sesji zanieczyszcza nowy raport

`packages/kid-ui/src/session/session-controller.ts:793–800`.

`#applyAttempt` dopisuje attemptId przed sprawdzeniem epoch. Zwykły zbieg retry wywołanego powrotem online i pierwotnego żądania pozwala jednemu zakończyć się później. Gdy dziecko zdąży rozpocząć nową sesję, stara próba trafia do jej reportera. Serwer słusznie odrzuci potem obce ID, co uniemożliwi rozliczenie nowej pracy.

Reprodukcja na publicznych metodach kontrolera z fake API: pierwsze submit opóźnione, retry zwraca wynik, koniec sesji A, start B, odpowiedź pierwszego submit. Raport B zawiera `submittedAttempts:['attemptA']`.

Poprawka: istniejący guard epoch/learning zastosować przed jakąkolwiek mutacją, także gałęzią processing. Nie potrzeba dodatkowej abstrakcji współbieżności.

### F09 — P2: zwykły odczyt nie rozstrzyga oceny przerwanej restartem

`packages/server/src/modules/session-activity.ts:530–535`; `modules/parent-work-card.ts:74–85`.

Rozstrzygnięcie przekroczonego deadline istnieje w ponownym przyjęciu raportu. Sam odczyt wyniku i endSession bez payloadu zwracają brak wyniku, a Karta pracy mapuje go na `not_delivered`. Po przerwaniu procesu między transakcjami raport był dostarczony, lecz rodzic może stale widzieć brak dostarczenia zamiast błędu `review_interrupted`. Design §8 przewiduje rozstrzygnięcie przez istniejący odczyt po deadline.

Poprawka: współdzielić małą obsługę przeterminowanego znacznika między dotychczasowymi ścieżkami. Bez retry LLM, kolejki i monitoringu.

### F10 — P2: brak informacji rodzica o usłudze otrzymującej odpowiedzi

`apps/web/src/parent/WorkCardPanel.tsx:40–69, 157`.

Nowy mechanizm wysyła odpowiedzi także ze słownictwa, ale nie ma odpowiadającej mu informacji w panelu. Istniejąca nota w `parent/lessons/LessonSupervisionPanel.tsx:131–134` mówi o ocenie odpowiedzi otwartych lekcji; nie wyjaśnia nowego zakresu wysyłki. Naruszenie design §10.

Poprawka: krótka informacja o skonfigurowanej usłudze i zakresie danych, bez sekretów ani rozbudowanej konfiguracji.

### F11 — P2: rodzic nie może sprawdzić kontekstu decyzji modelu

`packages/server/src/modules/parent-work-card.ts:85–99`; `packages/contracts/src/parent-work-card.ts:21–34`; `apps/web/src/parent/WorkCardPanel.tsx:58–64`.

Z siedmiodniowego snapshotu API wystawia wyłącznie numery i powody wykluczeń. Kroki niżej pokazują odpowiedzi, ale nie treść pytania i aktywność użyte do oceny. Rodzic nie może zweryfikować np. „odpowiedź niepowiązana z pytaniem”. Design §10 przewiduje rozwinięcie zadań/odpowiedzi i obserwacji modelu.

Poprawka: jeden ograniczony widok szczegółów oparty na już zapisanym raporcie, za istniejącą autoryzacją i kontrolą retencji. Nie tworzyć nowego panelu historii nagród ani odtwarzać szczegółów po ich wygaśnięciu.

### F12 — P2: trwałe reason może przepisywać odpowiedzi dziecka

`packages/server/src/providers/openai-compatible/session-activity.ts:43`; `modules/session-activity.ts:450, 507`.

Dowolny poprawny schematycznie komentarz modelu trafia do trwałego `activityReview.reason`. Prompt nie zawiera wymagania design §6, aby krótkie trwałe uzasadnienie nie przepisywało odpowiedzi. Wynik np. `Dziecko wielokrotnie wpisało „...treść odpowiedzi...”` pozostanie po usunięciu JSONB szczegółów.

Poprawka: rozdzielić ogólne trwałe wyjaśnienie od szczegółowego komentarza i jasno określić kontrakt promptu. Sam test z fake modelem ani instrukcja dla LLM nie stanowią twardej gwarancji niecytowania. Dokładnych wypowiedzi nie należy kopiować do trwałego podsumowania.

## Dwie istotne luki testowe

- **G01 — P2:** brak testu rzeczywistego reloadu z magazynem przeglądarkowym i nowym kontrolerem. Obecny test resume ręcznie przekazuje stan helperowi; E2E lifecycle obejmuje wyłącznie edycję/koniec i blur. Usunięcie `load(sessionId)` z kontrolera nie jest przez te testy wykrywane. Uzupełnić test wznowienia aktywnej sesji oraz F03. Dowody: `activity-report.test.ts:125–138`, `session-controller.test.ts:1319–1353`, cały `tests/e2e/kid-activity-lifecycle.spec.ts`.
- **G02 — P2:** test migracji nie seeduje prób i ocen, mimo wymagania D04 porównania zachowanej historii. Sprawdza punkty i istnienie `independentSuccesses`, nie jego dokładną zawartość. Dodać rzeczywistą próbę/ocenę i porównanie przed/po, wyłączając wyłącznie świadomie usuwane `summary.reward`. Dowód: `tests/integration/session-activity-migration.test.ts:124–137`. Nie stwierdzam, że aktualna migracja usuwa próby lub oceny — brakuje wymaganego dowodu regresyjnego.

## Ocena prostoty i jakości

**Co jest dobre:** usunięto dziesięć tabel; nie dodano tabel nagród ani ledgera. LLM jest za wąskim portem, poza transakcją. Kod liczy punkty i resztę, a nie model. Zapis wyniku i punktów jest atomowy. Historyczny dorobek jest przenoszony z kontrolą per dziecko. Oddzielono ocenę aktywności od wyników wiedzy i kontraktu MCP. Te elementy warto zachować.

**Co rzeczywiście budzi zastrzeżenia:** reguły reportera są rozproszone między pause, freeze, resume i playback; istnieją różne ścieżki odtwarzania; konwersja odpowiedzi została napisana kolejny raz z luźnymi rzutowaniami zamiast wykorzystania poprawnej wiedzy już obecnej w kodzie. Efektem są konkretne F01/F02/F05/F06, a nie jedynie subiektywne uwagi o stylu.

**Rozmiar:** cały diff to 85 plików, +4212/−3719. Sam kod w `packages/*/src` i `apps/*/src`, po wyłączeniu testów, to +2198/−1697, czyli **+501 linii**. Liczba tabel spadła, lecz kod aplikacji nie został netto odchudzony. Sam ten bilans nie dowodzi niskiej jakości — zmiana przenosi pomiar do FE i dodaje ocenę LLM. Nie należy jednak opisywać jej jako dużego zmniejszenia kodu.

Najbardziej opłacalne uproszczenia przy naprawie:

1. Jedno obliczanie/domknięcie przedziału pracy; lifecycle tylko wskazuje powód przerwy.
2. Jedna ścieżka mierzonego odtwarzania materiału.
3. Typowana konwersja zadań i odpowiedzi, z ponownym wykorzystaniem istniejących czystych helperów.
4. Jeden predykat limitów zamiast częściowych kontroli na kolejnych szczeblach kompakcji. Sama wielostopniowa kompakcja wynika z zatwierdzonego planu, więc nie przypisuję jej arbitralnie modelowi GLM.
5. Usunąć martwy `reportByTaskId` w `session-activity.ts:215`; sprawdzić potrzebę zapisywania `processingExcluded` i metadanych, których żaden konsument nie używa. To porządkowanie, nie powód do nowej warstwy abstrakcji.

Nie usuwać zabezpieczenia jednokrotności, reszty punktowej ani atomowego naliczenia tylko po to, by zmniejszyć liczbę linii. Nie dokładać enterprise zabezpieczeń przed dzieckiem piszącym własnego klienta — to poza ustalonym zakresem.

## Wykonane sprawdzenia i granice

- Odczyt diffu, kontraktów, powiązanych wywołań, zatwierdzonych dokumentów i testów; niezależne cztery perspektywy review.
- Celowane Vitest: **108/108**, cztery pliki: reporter, kontroler sesji, kontrakt aktywności, adapter LLM. Przejście ich nie obala powyższych reprodukcji.
- Osobne wykonywalne reprodukcje F01, F04, F05 i F08 na kontrolowanym zegarze/fake API. Skrypty robocze: `%TEMP%/knowli-review-repro.ts`, `%TEMP%/knowli-review-race.ts`.
- Brak zmian kodu aplikacji, uruchomienia prawdziwego LLM, migracji produkcyjnej, push lub merge. Dopisano wyłącznie dokumentację review.
- Pełnych suite'ów ZCode nie uruchamiałem ponownie; jego wyniki pozostają raportem ZCode. Nie wykonywałem nowego pełnego E2E/integracji ani testów na fizycznym urządzeniu.
- Ręczne scenariusze na docelowym modelu nadal są warunkiem odbioru promptu. Fake reviewer nie dowodzi, że model rozpoznaje pozorowanie nauki.
- API → MCP → skill: przeglądany nowy mechanizm nie zastępuje `learning-overview`; filtr vocabulary i osobny estimated time pozostają w istniejącej integracji. Nie jest to ponowny test klienta MCP ani potwierdzenie instalacji u Hermesa.

## Triage wszystkich kandydatów reviewerów

Każdy kandydat otrzymał werdykt przed grupowaniem. `high` odpowiada P1, `medium` P2. Zgłoszenia dotyczące tego samego błędu pozostają widoczne jako osobne wiersze, ale mają wspólny numer F/G.

| Źródło i kandydat | Werdykt | Dowód / wynik |
|---|---|---|
| blind 1: idle przy blur | high | Reprodukcja 300 s; F01. |
| blind 2: limity per task | medium | Reprodukcja 257 okien; F04. |
| blind 3: feedback audio | medium | Bezpośredni player.play omija reporter; F06. |
| blind 4: pendingAttempt | medium | taskShown bez technical_wait przed pollingiem; F07. |
| blind 5: odzyskanie finalnego raportu | medium | Brak trwałego payloadu/odnajdywania zamkniętej sesji; F03. |
| blind 6: canonical answer | high | Klucz lekcji ma answer, snapshot go pomija; F02. |
| blind 7a: sequence | high | items/itemValues nie są odczytywane; F02. |
| blind 7b: odpowiedź wyboru segmentu zawsze null | false | Zapis próby lesson_notice zawiera optionText z segmentValues; answerTextOf odczytuje optionText. Nie dotyczy to brakującej treści pytania. |
| blind 8: karty/notice bez materiału | medium | body/examples/segments pominięte; F02. |
| blind 9: przerwany review na odczycie | medium | readSessionActivityResult czyta wyłącznie gotowy wynik; F09. |
| blind 10: request.text przed limitem | low, rejected | Buforowanie całego body jest faktem, ale wykazany scenariusz to własne nadmiarowe żądanie bez Content-Length. Nie wynika ze zwykłego klienta, a streamingowy parser rozszerza zakres ochrony poza tę rodzinną zmianę. Nie dodawać go w ramach tego review. |
| edge 1: idle przy blur | high | F01. |
| edge 2: limity per task | medium | F04. |
| edge 3: pendingAttempt | medium | F07. |
| edge 4a: canonical/sequence | high | F02. |
| edge 4b: odpowiedź lesson_notice null | false | Jak blind 7b: istnieje optionText. |
| edge 5: stale epoch | medium | Wykonywalna reprodukcja zanieczyszczenia raportu B próbą A; F08. |
| verification: brak testu reload | medium | Test helpera nie przechodzi przez magazyn/kontroler; G01. |
| verification: brak porównania historii migracji | medium | Seed bez prób/ocen i niepełna asercja summary; G02. |
| verification other 1: canonical answer | high | F02. |
| verification other 2: sequence | high | F02. |
| acceptance 1: informacja o usłudze | medium | Nota lekcyjna nie pokrywa nowego zakresu wysyłki; F10. |
| acceptance 2: rozwinięcie kontekstu | medium | DTO/UI udostępnia wyłącznie wykluczenia i uproszczone odpowiedzi; F11. |
| acceptance 3: trwałe cytaty w reason | medium | Prompt nie zakazuje, schema przyjmuje, cleanup nie usuwa; F12. |
| parent: limit audio | medium | null w produkcji i reprodukcja samego reportera; F05. |

### Odrzucone

- `false`: blind 7b i edge 4b — odpowiedź lesson_notice jest zapisana w optionText; nie ginie w opisywany sposób.
- `low`: blind 10 — rzeczywista uwaga o buforowaniu, ale wykazany scenariusz wykracza poza zwykłe zachowanie klienta i uzgodniony zakres; nie uzasadnia komplikowania tej zmiany.
- Nie zgłoszono jako defektu braku weryfikacji spreparowanych czasów klienta; taki model zagrożeń został świadomie wyłączony z planu.

## Zalecana kolejność

Najpierw F01/F02 i spójny pomiar audio F05–F07, następnie dostarczanie/retry F03/F04/F08/F09, na końcu kompletność panelu i retencji F10–F12. G01/G02 oraz testy znalezionych regresji powinny towarzyszyć odpowiednim poprawkom. Dopiero potem ręczna ocena fikcyjnych przebiegów na docelowym LLM i decyzja o scaleniu. Żadna z tych poprawek nie została wykonana w ramach review.
