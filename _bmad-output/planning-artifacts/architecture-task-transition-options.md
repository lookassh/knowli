# Przejścia zadań — ocena architekta BMAD

Data: 2026-10-17. Autor roli: Winston, bmad-agent-architect.
Status: właściciel wybrał wariant A — dostosowanie dopiero kolejnej sesji. Kod nadal realizuje dotychczasowy model.
Baza analizy: 66a07173350ba59b504d6d74f934473154f2b063.

## Ocena wcześniejszego rozwiązania

Scalenie odczytów SQL i natychmiastowa reakcja UI są uzasadnionymi poprawkami. Rozbudowa protokołu batchowania aktywności przed ustaleniem docelowego modelu sesji byłaby przedwczesna. Dotychczasowy spec-task-transition-solution.md pozostaje kandydatem, a nie zaakceptowaną architekturą.

W zwykłej nauce `sessions.ts:planNextTask` przy każdym nowym zadaniu odczytuje materiał, media, projekcje i historię. `learning-snapshot.ts` ponownie pobiera część tych danych. Domena `scheduler.ts:selectTask` jest już czystą funkcją: granica pozwalająca oddzielić przygotowanie od decyzji istnieje. Koszt zebrania wejścia nie musi być powtarzany w całości przy każdym kliknięciu.

Nie zmierzono jeszcze wdrożonego środowiska. Liczba zapytań wskazuje kosztowną strukturę, ale nie dowodzi, że pełna przebudowa będzie tańsza od celowanej optymalizacji.

## Pomysł: wybrać wszystkie pytania na początku

To poprawny model dla sesji ze stałą kolejnością. Aplikacja już zapisuje prywatny `mockTestPlan` przy starcie kartkówki (`modules/mock-tests.ts`), a `issueMockTestTask` wydaje jego sloty pojedynczo. Ten wzorzec warto wykorzystać koncepcyjnie; planer kartkówki sam zawiera odczyty per element, więc nie należy kopiować go bez pomiaru kosztu startu.

Planowanie jest odrębne od wydania. Przygotowany na serwerze prompt nie tworzy ekspozycji. Dopiero wydanie pojedynczego kroku zapisuje ekspozycję i pozwala zwrócić jego treść klientowi. Wysłanie całej sesji do przeglądarki z góry naruszałoby obecne gwarancje ujawniania.

Sztywny plan zwykłej nauki zmieniłby zachowanie opisane w SPEC: wsparcie po dwóch błędach/„Nie pamiętam”, poprawka po wsparciu, wprowadzanie etapu po sukcesie, dobór łatwiejszego zadania, reakcja na wyłączenie mikrofonu oraz kwalifikacja sprawdzenia po upływie czasu. Nie da się przewidzieć tych wyników na początku. Można je odłożyć do następnej sesji, ale to decyzja produktowa.

Przygotowanie wszystkich możliwych gałęzi byłoby bardziej złożone od obecnego selektora. Statyczna pula ćwiczeń z dynamicznym wyborem jest osobnym, prostszym wariantem.

## Warianty

| Wariant | Koszt w trakcie sesji | Reakcja na wyniki | Koszt zmiany |
| --- | --- | --- | --- |
| A. Stały plan od początku | Pobranie i wydanie slotu; nadal zapis odpowiedzi, ekspozycji i nagród | Dopiero następna sesja; ewentualne wsparcie wymaga osobnej reguły | Umiarkowany kod, istotna zmiana produktu |
| B. Przygotowana sesja, dynamiczny wybór | Odczyt zwartego stanu, lekki wybór, walidacja aktualności i zapis | Zachowana | Nowa projekcja stanu i jej odtwarzanie |
| C. Obecny model po optymalizacji SQL | Nadal składanie wejścia, mniejszą liczbą zapytań | Zachowana | Najmniejszy |

## Rekomendowany kierunek do sprawdzenia: B

1. Start przygotowuje prywatny materiał sesji: przypięte rewizje, dostępne ćwiczenia, media, seed losowania oraz początkowy stan uczenia. Przygotowuje pulę dla zakresu zestawu; ograniczenie jej do wybranych celów wymaga sprawdzenia zgodności priorytetów schedulera.
2. Sesja ma trwały, wersjonowany stan: wykorzystany budżet, aktywne zadanie, użycia elementów, rezerwacje, cykle wsparcia i ostatnie istotne wyniki. To projekcja odtwarzalna z historii, bez zmiany zakończonych ocen.
3. Każda komenda aktualizuje historię i stan sesji atomowo pod istniejącą blokadą. Retry nie stosuje zmiany drugi raz. Restart procesu nie gubi sesji; brak zgodnego stanu wymaga kontrolowanej odbudowy.
4. Wybranie następnego kroku używa przygotowanej puli, stanu i aktualnego zegara. Nie odtwarza całej historii przy każdym next. Moduły słówek i lekcji zachowują własne reguły selekcji.
5. Warunki mogące zmienić się poza lokalnym stanem nie są zamrażane: ostatnie ekspozycje celu, bieżąca kwalifikacja próby, aktualne projekcje po korekcie rodzica, stan zakończenia sesji i wyłączenie mikrofonu. Wymagają ograniczonych odczytów albo jawnego unieważnienia projekcji. Szczególnie odczyt starego feedbacku może utworzyć nową ekspozycję.
6. Wydanie zadania i zapis ekspozycji nadal następują dopiero przy rzeczywistym przejściu. Nie przygotowujemy publicznego next w tle podczas oglądania feedbacku.

Ten kierunek zmniejsza powtarzaną pracę i zachowuje adaptację. Jest większą zmianą niż C, dlatego nie należy deklarować go jako koniecznej naprawy bez pomiaru. Nie usuwa również sam z siebie oddzielnych żądań activity ani opóźnienia transportu.

## Kolejność decyzji

Najpierw porównać koszt obecnego next z kosztem zebrania wejścia raz i kolejnych decyzji na przygotowanym stanie, na fikcyjnej krótkiej i długiej historii. Osobno zmierzyć udział activity, blokad, zapisu nagród i sieci. Oceniać również czas startu sesji, nie tylko przenosić tam opóźnienie.

Jeżeli dominuje odtwarzanie wejścia — wybrać B i dopiero na nim zaprojektować kontrakt komendy dziecka. Jeżeli dominuje transport activity, sam plan pytań nie rozwiązuje zgłoszonego problemu; uproszczenie komend nadal wymaga decyzji. Jeżeli mała zmiana SQL daje wystarczający wynik — pozostać przy C.

Decyzja produktowa właściciela: „wystarczy dostosowanie kolejnej sesji”. Wybieramy A. Wcześniejsza rekomendacja B dotyczyła zachowania adaptacji wewnątrz sesji i jest historyczną analizą alternatywy.

## Wybrany kierunek: stały plan sesji

Przy rozpoczęciu nauki serwer jednorazowo odczytuje dotychczasowe wyniki i przygotowuje trwałą, skończoną listę kroków. Lista może zawierać prezentacje i pytania, z miksem dobranym do poziomu dziecka na początku. Nie zakłada fikcyjnych sukcesów przy planowaniu późniejszych kroków. Kolejne odpowiedzi są oceniane i zapisywane na bieżąco, lecz nie zmieniają kolejności ani trudności pozostałych kroków. Następna nowa sesja korzysta już z tych wyników.

Feedback, podpowiedź na żądanie i ponowienie odpowiedzi w tym samym zadaniu mogą zachować obecne zasady. Usuwamy dopisywanie nowych zadań wsparcia/poprawki i awansowanie do kolejnego etapu na podstawie wyników bieżącej sesji. „Nie pamiętam” nadal ujawnia rozwiązanie bieżącego pytania; potrzeba dodatkowej nauki wpływa na plan następnej sesji.

Plan jest prywatny i zapisany w bazie, niezależnie od pamięci procesu. Każdy krok staje się zadaniem dopiero podczas wydania. Ocena samodzielności nadal używa faktycznych ekspozycji i czasu przyjęcia odpowiedzi; nie jest zamrożona na starcie. Zmiana mikrofonu może pominąć niewykonalne kroki, a koniec/czas sesji może skrócić plan. Te wyjątki nie losują nowych pytań i nie zwiększają obiecanego budżetu.

Nie rozbudowujemy teraz protokołu batchowania activity. Najpierw wdrażamy i mierzymy model stałego planu; potem ustalamy, czy pozostałe koszty żądań wymagają osobnej zmiany. Projekt wykonania: `../implementation-artifacts/spec-fixed-training-session-plan.md`.

## Dowody i ograniczenia

Sprawdzono kod selektora słówek, planowanie lekcji, plan kartkówki i sekcje 9, 10 oraz 21 architecture.md oraz reguły SPEC dotyczące wsparcia i samodzielności. Brak zmian kodu i nowych testów. To ocena architektoniczna do dyskusji, nie zatwierdzony projekt migracji ani dowód skrócenia czasów wdrożenia.
