# Scenariusze akceptacji

Przypadki do wykonania podczas implementacji na fikcyjnych danych, nie wyniki testów. Każde story sprawdza wiersze przywołane w swoim opisie.

**Reguła decyzyjna (AC-03, AC-04–08).** Trzy przebiegi tym samym modelem i promptem. Przypadek mówiony jest „stabilnie błędny”, gdy w co najmniej 2 z 3 przebiegów: wiedza różni się od oczekiwanej, werdykt odrzuca walidacja albo model wywołuje niepotrzebne skracanie (wiedza poprawna, precyzja `verbose`/`unfocused`, co najmniej jeden fragment, a oczekiwano `concise`). Przypadek sparowany liczy się tylko wtedy, gdy jego pisany odpowiednik jest w tych przebiegach zgodny. Przypadki sporne i błędy dostawcy się nie liczą.

| ID | CAP | Sytuacja | Oczekiwane zachowanie |
| --- | --- | --- | --- |
| AC-01 | CAP-1 | Zestaw kalibracyjny po zmianie | Co najmniej 10 przypadków mówionych: wypełniacze, restart zdania, powtórzenia, autokorekta faktu, przekręcona nazwa lub termin, dygresja nie na temat, kilka zdań z pauz, częściowa i błędna z wypełniaczami; co najmniej 5 sparowanych z pisanym odpowiednikiem |
| AC-02 | CAP-1 | Przebieg skryptu oceny gradera | Raport podaje osobno dla pisanych i mówionych: trafność wiedzy, trafność precyzji, odrzucone przez walidację, błędy dostawcy, niepotrzebne skracanie; bramka zestawu liczy tylko pisane; przy odrzuceniu przypadku mówionego widać surowy werdykt |
| AC-03 | CAP-1 | Pomiar na prawdziwym modelu | Tylko po zgodzie właściciela; trzy przebiegi; przy wyniku model, wersja promptu, data i rozstrzygnięcie reguły: story 2 potrzebne, gdy ≥ 1 przypadek stabilnie błędny w wiedzy lub odrzuceniu albo ≥ 2 w skracaniu |
| AC-04 | CAP-2 | Przypadki mówione z autokorektą po zmianie promptu | Żaden nie jest stabilnie błędny w wiedzy |
| AC-05 | CAP-2 | Przypadki mówione z wypełniaczami, restartem, powtórzeniami | Żaden nie wywołuje stabilnie niepotrzebnego skracania |
| AC-06 | CAP-2 | Niepoprawiona podyktowana odpowiedź na pytanie z formą jednego zdania | Model nie dostaje wymogu jednego zdania; przypadek „kilka zdań z pauz” nie jest stabilnie błędny |
| AC-07 | CAP-2 | Ta sama treść wpisana z klawiatury albo podyktowana i poprawiona ręcznie | Żądanie i ocena jak przed zmianą, w tym forma jednego zdania |
| AC-08 | CAP-2 | Zestaw po zmianie promptu | Bramka przypadków pisanych przechodzi (twarde 100%, wiedza ≥ 90%, zero odrzuconych); przypadki mówione częściowy i błędny nadal `partial` i `incorrect` |
| AC-09 | CAP-2 | Ta sama odpowiedź oceniona przed i po zmianie promptu | Nowa wersja promptu: stary wpis cache nie jest użyty |
| AC-10 | CAP-2 | Żądanie do modelu oceniającego | Zawiera najwyżej znacznik „mowa/klawiatura”; bez imienia, wieku, identyfikatorów i nagrania |
| AC-32 | CAP-2 | Ta sama treść raz podyktowana (niepoprawiona), raz wpisana | Dwa osobne wpisy cache; żadna ścieżka nie dostaje werdyktu drugiej |
| AC-34 | CAP-2 | Zestaw po zamrożeniu nowego promptu | Dodane co najmniej 4 nowe przypadki mówione, nieużywane przy strojeniu; raportowane osobno |
| AC-11 | CAP-3 | Werdykt `correct` z jednym fragmentem zbędnym, którego nie ma dosłownie w odpowiedzi | Ocena `correct`; fragment pominięty; brak „Nie udało się ocenić” |
| AC-12 | CAP-3 | Pięć fragmentów zbędnych albo fragment zbędny nachodzący na fragment nie na temat | Ocena wiedzy zachowana; zostają najwyżej cztery pierwsze poprawne fragmenty listy, nachodzące pominięte |
| AC-13 | CAP-3 | Werdykt łamiący reguły wiedzy (identyfikator spoza listy, `correct` z brakami, niepełna partycja elementów) albo `partial`/`incorrect`, którego jedyną luką jest niedosłowne błędne stwierdzenie | Reguły wiedzy jak dotąd; błędne stwierdzenie liczy się jako luka mimo pominięcia jego tekstu; wyjątek: `incorrect`, któremu po pominięciu nie zostaje żadna widoczna luka, pozostaje nieoceniony |
| AC-14 | CAP-3/5 | Poprawna rozwlekła odpowiedź, wszystkie fragmenty pominięte jako wadliwe | „Świetnie!” bez kroku skracania (przy naruszonej formie jednego zdania dopiero po story 4) |
| AC-33 | CAP-3 | Ta sama odpowiedź wysłana drugi raz po werdykcie z pominiętym fragmentem | Trafienie w cache, bez drugiego wywołania modelu |
| AC-15 | CAP-4 | „Nie udało się ocenić”, dziecko wybiera ponowienie | Pole zawiera poprzedni tekst; sposób wprowadzenia (mowa/klawiatura) zachowany; kolejne dyktowanie zastępuje tekst |
| AC-16 | CAP-4 | Zwykła błędna odpowiedź z prawem do ponowienia w innych ćwiczeniach | Pole czyści się jak dotąd |
| AC-17 | CAP-5 | Poprawna odpowiedź, precyzja `verbose`, brak fragmentów, naruszona tylko forma zdania | Brak zadania skracania |
| AC-18 | CAP-5 | Trafienie w cache werdyktu przy innej interpunkcji, fragmentów nie da się odnaleźć w tekście | Brak zadania skracania |
| AC-19 | CAP-5 | Poprawna odpowiedź z co najmniej jednym odnalezionym fragmentem zbędnym lub nie na temat | Zadanie skracania z zaznaczeniem, jak dotąd; nadal bez oferty w ostatnich trzech zadaniach sesji |
| AC-20 | CAP-6 | Poprawka gubi element trafiony w oryginale | Feedback pokazuje „Twoja odpowiedź” i krótszą wersję; komunikat nie każe porównywać z czymś niewidocznym; próba niesamodzielna, bez wpływu na serię |
| AC-21 | CAP-6 | Feedback z AC-20 | Zawiera wyłącznie tekst dziecka; bez wzorca, elementów wymaganych i notatki modelu |
| AC-22 | CAP-6 | Feedback z AC-20 na telefonie i tablecie przy najdłuższej odpowiedzi (600 znaków) | Brak przepełnienia, przycisk dalej widoczny, cele ≥ 48 px |
| AC-23 | CAP-7 | Zadanie z dyktowaniem, mikrofon gotowy | Etykieta „Powiedz odpowiedź” |
| AC-24 | CAP-7 | Zadanie z dyktowaniem przed zgodą na mikrofon i w trakcie nagrania | Żaden tekst nie zawiera „przytrzymaj” ani „słowo”; w trakcie nagrania widać, jak skończyć |
| AC-25 | CAP-7 | Ćwiczenie słówek z nagrywaniem | Teksty bez zmian |
| AC-29 | CAP-9 | Utrata fokusu okna, ukrycie karty lub brak sieci w trakcie nagrania | Krótki komunikat, że nagranie przerwano i można powiedzieć jeszcze raz; licznik nieudanych dyktowań bez zmian; mikrofon zwolniony |
| AC-30 | CAP-10 | „Sprawdź” przy odpowiedzi otwartej, pisanej albo mówionej | Komunikat oczekiwania nie zawiera słowa „nagranie”; przy ćwiczeniu słówek tekst bez zmian |

AC-26–28 (dopisywanie przy kolejnym dyktowaniu) i AC-31 (duplikat AC-15) wycofano; ID nie użyto ponownie.

Odbiór rodzinny: jedna sesja na prawdziwym tablecie z głosem dziecka, ze zwróceniem uwagi na czas oczekiwania, długi tekst przy klawiaturze ekranowej, powiadomienia przerywające nagranie i to, czy rozpoznawanie mowy zapisuje wypełniacze. Bez tego nie deklarować gotowości na urządzeniu.
