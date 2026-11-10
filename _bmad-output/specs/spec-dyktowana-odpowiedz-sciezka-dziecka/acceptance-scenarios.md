# Scenariusze akceptacji

Przypadki do wykonania podczas implementacji na fikcyjnych danych, nie wyniki testów. Każde story sprawdza wiersze przywołane w swoim opisie.

| ID | CAP | Sytuacja | Oczekiwane zachowanie |
| --- | --- | --- | --- |
| AC-01 | CAP-1 | Zestaw kalibracyjny po zmianie | Co najmniej 8 przypadków mówionych: wypełniacze, restart zdania, autokorekta faktu, przekręcona nazwa własna lub data, dygresja nie na temat, poprawna odpowiedź w dwóch–trzech zdaniach; każdy z oczekiwaną wiedzą i precyzją |
| AC-02 | CAP-1 | Przebieg skryptu oceny gradera | Raport podaje osobno dla przypadków pisanych i mówionych: trafność wiedzy, trafność precyzji, liczbę werdyktów odrzuconych przez walidację; bramka zestawu liczy tylko przypadki pisane |
| AC-03 | CAP-1 | Przebieg na prawdziwym modelu | Uruchomiony tylko po zgodzie właściciela; jedno wywołanie na przypadek; model, wersja promptu i data zapisane przy wyniku |
| AC-04 | CAP-2 | Podyktowane „stolicą jest Kraków, nie, Warszawa” przy poprawnej Warszawie | Wiedza `correct`; autokorekta nie trafia do błędnych stwierdzeń |
| AC-05 | CAP-2 | Poprawna podyktowana odpowiedź z „yyy”, „no i”, „znaczy” | Precyzja `concise`; wypełniacze nie są fragmentami zbędnymi i nie wywołują skracania |
| AC-06 | CAP-2 | Poprawna, niepoprawiona podyktowana odpowiedź w dwóch zdaniach bez dygresji | Model nie dostaje wymogu jednego zdania; precyzja `concise` |
| AC-07 | CAP-2 | Ta sama treść wpisana z klawiatury | Zachowanie jak przed zmianą, w tym forma jednego zdania |
| AC-08 | CAP-2 | Przypadki pisane zestawu po zmianie promptu | Trafność wiedzy nie niższa niż w pomiarze ze story 1 |
| AC-09 | CAP-2 | Ta sama odpowiedź oceniona przed i po zmianie promptu | Nowa wersja promptu: stary wpis cache nie jest użyty |
| AC-10 | CAP-2 | Żądanie do modelu oceniającego | Zawiera najwyżej znacznik „mowa/klawiatura”; bez imienia, wieku, identyfikatorów i nagrania |
| AC-11 | CAP-3 | Werdykt `correct` z jednym fragmentem zbędnym, którego nie ma dosłownie w odpowiedzi | Ocena `correct`; fragment pominięty; brak „Nie udało się ocenić” |
| AC-12 | CAP-3 | Werdykt z pięcioma fragmentami w jednej liście albo fragmentami nachodzącymi między kategoriami | Ocena wiedzy zachowana; wadliwe fragmenty pominięte |
| AC-13 | CAP-3 | Werdykt łamiący reguły wiedzy (identyfikator spoza listy, `correct` z brakami, niepełna partycja elementów) | Nadal nieoceniony, bez kary |
| AC-14 | CAP-3/5 | Poprawna rozwlekła odpowiedź, wszystkie fragmenty pominięte jako wadliwe | „Świetnie!” bez kroku skracania |
| AC-15 | CAP-4 | „Nie udało się ocenić”, dziecko wybiera ponowienie | Pole zawiera poprzedni tekst; sposób wprowadzenia (mowa/klawiatura) zachowany |
| AC-16 | CAP-4 | Zwykła błędna odpowiedź z prawem do ponowienia w innych ćwiczeniach | Pole czyści się jak dotąd |
| AC-17 | CAP-5 | Poprawna odpowiedź, precyzja `verbose`, brak fragmentów, naruszona tylko forma zdania | Brak zadania skracania |
| AC-18 | CAP-5 | Trafienie w cache werdyktu przy innej interpunkcji, fragmentów nie da się odnaleźć w tekście | Brak zadania skracania |
| AC-19 | CAP-5 | Poprawna odpowiedź z co najmniej jednym odnalezionym fragmentem zbędnym lub nie na temat | Zadanie skracania z zaznaczeniem, jak dotąd |
| AC-20 | CAP-6 | Poprawka gubi element trafiony w oryginale | Feedback pokazuje „Twoja odpowiedź” i krótszą wersję; komunikat nie każe porównywać z czymś niewidocznym; próba niesamodzielna, bez wpływu na serię |
| AC-21 | CAP-6 | Feedback z AC-20 | Zawiera wyłącznie tekst dziecka; bez wzorca, elementów wymaganych i notatki modelu |
| AC-22 | CAP-6 | Feedback z AC-20 na telefonie i tablecie przy najdłuższej odpowiedzi (600 znaków) | Brak przepełnienia, przycisk dalej widoczny, cele ≥ 48 px |
| AC-23 | CAP-7 | Zadanie z dyktowaniem, mikrofon gotowy | Etykieta „Powiedz odpowiedź” |
| AC-24 | CAP-7 | Zadanie z dyktowaniem przed zgodą na mikrofon i w trakcie nagrania | Żaden tekst nie zawiera „przytrzymaj” ani „słowo”; w trakcie nagrania widać, jak skończyć |
| AC-25 | CAP-7 | Ćwiczenie słówek z nagrywaniem | Teksty bez zmian |
| AC-26 | CAP-8 | Pole pierwszej odpowiedzi ma tekst, drugie dyktowanie się udaje | Nowy tekst dopisany po istniejącym, rozdzielony spacją |
| AC-27 | CAP-8 | Dyktowanie w kroku skracania | Tekst zastąpiony, jak dotąd |
| AC-28 | CAP-8 | Odpowiedź złożona z dwóch dyktowań, wysłana bez ręcznej zmiany | Serwer traktuje ją spójnie z regułą „niepoprawiona dyktowana”; brak wymogu jednego zdania |
| AC-29 | CAP-9 | Utrata fokusu okna, ukrycie karty lub brak sieci w trakcie nagrania | Krótki komunikat, że nagranie przerwano i można powiedzieć jeszcze raz; licznik nieudanych dyktowań bez zmian; mikrofon zwolniony |
| AC-30 | CAP-10 | „Sprawdź” przy odpowiedzi otwartej, model odpowiada po kilku sekundach | Do pojawienia się feedbacku widoczny stan oczekiwania; tekst nie mówi o nagraniu przy odpowiedzi pisanej |
| AC-31 | CAP-10 | Przekroczony czas oceny | Stan oczekiwania znika, dziecko widzi „Nie udało się ocenić” i tekst zostaje w polu (AC-15) |

Odbiór rodzinny: jedna sesja na prawdziwym tablecie z głosem dziecka, ze zwróceniem uwagi na czas oczekiwania, długi tekst przy klawiaturze ekranowej i powiadomienia przerywające nagranie. Bez tego nie deklarować gotowości na urządzeniu.
