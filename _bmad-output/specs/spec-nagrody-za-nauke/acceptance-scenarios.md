# Scenariusze akceptacji

To przypadki do wykonania podczas implementacji na fikcyjnych danych, nie wyniki testów. A1 wymaga odbioru story 1, A3 planu story 5. Każde story weryfikuje własny zakres, ostatnie także cały przepływ.

| ID | CAP | Sytuacja | Oczekiwane zachowanie |
| --- | --- | --- | --- |
| AC-01 | CAP-1/2 | Taki sam zaliczony czas, różna poprawność i gwiazdki | Ta sama liczba punktów; wiedza i jej oceny bez zmian |
| AC-02 | CAP-1/2 | Pomoc, błędy, Nie pamiętam, mikrofon wyłączony | Zapisane odcinki pracy liczą się bez mnożnika i bez progu wyniku |
| AC-03 | CAP-1/10 | Otwarcie, pusty przebieg, samo Koniec, skip lub cisza | Brak potwierdzonego kroku: brak nowego rozliczenia; bez błędu wiedzy |
| AC-04 | CAP-2/10 | Jawne zakończenie prezentacji z aktywnością | Rozliczone tylko aktywne odcinki; bez fikcyjnego attempt/assessment |
| AC-05 | CAP-1/5/10 | Ręczny koniec po rozliczonej pracy, w tym niepełna kartkówka | Zachowany czas/punkty, brak stałej premii i deklaracji pełnego ukończenia |
| AC-06 | CAP-5 | Retry, reload, spóźnione pakiety i wznowienie tej samej sesji | Każda sekunda i punkt rozliczone najwyżej raz |
| AC-07 | CAP-1/5 | Dwie krótkie osobne sesje | Czas sumuje się, koniec sesji nie generuje osobnej premii |
| AC-08 | CAP-3/6 | Nowa wersja, archiwizacja, przerwa, usunięcie jednego dziecka | Dorobek trwały, profile rozdzielone; kasowanie obejmuje wyłącznie dane danego dziecka |
| AC-09 | CAP-4/5 | Pauza, brak potwierdzenia zapisu i zmiana profilu | Neutralny stan, brak lokalnego fałszywego sukcesu i sumy innego dziecka |
| AC-10 | CAP-2 | Raport MCP przed i po zmianie, obecne lekcje | Kontrakt/znaczenie czasu raportowego i filtr lekcji pozostają; test klienta Streamable HTTP |
| AC-11 | CAP-3/8 | 40 zdobytych punktów i 1 pełny blok; rezerwacja 30 | Dorobek 40, dostępne 10; uprawnienie zarezerwowane, bez podwójnej wymiany |
| AC-12 | CAP-5/8 | Za mało punktów lub uprawnień; podwójne kliknięcie i dwie karty | Brak ujemnego salda, drugiej rezerwacji i obejścia samego progu saldem |
| AC-13 | CAP-8/9 | Odrzucenie przed realizacją lub potwierdzenie po dodaniu czasu | Zwrot rezerwacji albo jednokrotne wykorzystanie punktów i bloku; dorobek nie maleje |
| AC-14 | CAP-9/12 | Dwa dziecięce konta i próba odczytu/potwierdzenia bez Parent auth | Właściwe konto/dzień; nieautoryzowany odczyt lub zapis odrzucony |
| AC-15 | CAP-5/9 | Niepewność po ręcznym dodaniu czasu i ponowienie komendy | Bez automatycznego nowego nadania lub zwrotu w ciemno; wynik rozstrzyga rodzic |
| AC-17 | CAP-4/8/10 | Kilka sesji w dniu: 1799 sekund, potem 1800 | Próg dopiero przy 1800; zaokrąglony tekst nie odblokowuje pakietu |
| AC-18 | CAP-5/10 | Dwa urządzenia pracują równolegle i przejmują pomiar | Jeden aktywny strumień dziecka, bez nakładających się zaliczeń |
| AC-19 | CAP-10 | Tło/fokus, bezczynność, sam heartbeat/replay, powrót do zadania | Pauza i wznowienie zgodnie z A1 zaakceptowanym w story 1; brak naliczania samą obecnością |
| AC-20 | CAP-5/10 | Zegar klienta cofnięty, fałszywe elapsed, offline i oczekiwanie na provider | Brak dowolnych minut, naliczania technicznego czekania i wstecznego dopisywania luki |
| AC-21 | CAP-1/3 | 30 sekund w A i 30 w B; reszty między sesjami/dniami | Łącznie 1 punkt w B przy opisanym porządku rozliczeń; suma zestawów równa profilowi, brak zaokrąglania per sesja |
| AC-22 | CAP-8/10 | Północ/DST, 20 min wczoraj i 10 dziś, zmiana strefy | Odcinki dzielone lokalnie, różne dni nie tworzą bloku; historia nie przeliczana |
| AC-23 | CAP-2/11 | Runda, błędy/niepamięć, ponowny odczyt i obietnica końca | Bez progu poprawności, powielenia rundy i dodatkowych zadań po końcu; normalne reguły samodzielności |
| AC-24 | CAP-11 | Mniej niż 3 bezpieczne zadania lub brak dostępnej rundy | Krótsza runda albo jawny brak, bez sztucznego materiału, kary i blokowania rodzica |
| AC-25 | CAP-12 | Rodzic przegląda dzień z pominięciami, nieocenionymi i szybkimi odpowiedziami | Fakty i przykłady; bez automatycznej etykiety oszustwa i odebrania punktów |
| AC-26 | CAP-8/9 | 60 lub 90 zaliczonych minut jednego dnia | Odpowiednio 2 lub 3 uprawnienia po 15 min; koszt 30 za każde, każdy blok wykorzystany raz |
| AC-27 | CAP-8/9 | Niewykorzystany pełny blok i zgłoszenie zrealizowane następnego dnia | Źródłowy blok i migawka zachowane, bez wygaśnięcia i użycia go drugi raz; A3 |
| AC-28 | CAP-2/10 | Wolne czytanie, długi odsłuch, techniczna awaria po zapisanym kroku | Przejrzyste pauzy zgodnie z odebranym A1, zachowana wcześniejsza praca; awaria nie jest błędem wiedzy |
| AC-29 | CAP-6/10/12 | Odtworzenie naliczeń i kasowanie profilu z punktami/rundą/wymianą | Sumy odtwarzalne, kaskada kompletna, bez surowych klawiszy/ruchów/audio i danych innego profilu |

AC-16 (automatyczna integracja Xbox) wycofano z bieżącego zakresu; ID nie użyto do nowego przypadku. Wszystkie kwoty powyżej to aktualne 1 pkt/min i 30 pkt/15 min, bez premii za zakończenie sesji.

Odbiór rodzinny obejmuje telefon/PWA, wolne czytanie i ścieżkę bez mikrofonu. Po wdrożeniu warto sprawdzić, czy dziecko odróżnia punkty od wiedzy i rozumie pauzę; nie deklarować pełnej ochrony przed zgadywaniem, podpowiadaniem i innym rozwiązującym na podstawie samych logów.
