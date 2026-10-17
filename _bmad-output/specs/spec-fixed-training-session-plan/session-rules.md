# Reguły sesji ze stałą listą

## Planowanie i adaptacja pomiędzy sesjami

Start bierze aktualne wyniki dziecka i tworzy skończony plan prezentacji oraz pytań. Mix wynika z dostępnych umiejętności, zatwierdzonego materiału, powtórek i historycznych trudności. Plan obejmuje wybrane kroki, nie wszystkie możliwe ćwiczenia zestawu.

Dla słówek trudny cel dostaje dostępne wsparcie w postaci prezentacji i łatwiejszego rozpoznawania. W lekcji odpowiednikiem jest dostępna karta wyjaśniająca i prostsze zatwierdzone ćwiczenie celu. Nie generujemy treści podczas startu ani kliknięcia. Gdy łatwiejsze ćwiczenie nie jest wykonalne, nie tworzymy pozornego sukcesu; wykorzystujemy dostępne wsparcie i zachowujemy informację o potrzebie dalszej pracy.

Właściciel potwierdził obecne sygnały trudności modułu: np. dwa błędy w zadaniu lub „Nie pamiętam”. Sygnał musi być dostępny dla następnego planowania, a późniejszy wiarygodny wynik może go rozliczyć zgodnie z regułami modułu. Pojedyncza awaria techniczna i pominięcie nie cofają wiedzy. Wsparcie mieści się w dostępnym budżecie po ochronie należnych sprawdzeń; nie gwarantujemy opracowania wszystkich zaległości w jednej sesji.

Nie zakładamy sukcesu zaplanowanego pytania. Statystyka rozłożenia kroków nie jest projekcją wiedzy. Nowy materiał może mieć prezentację i rozpoznawanie z góry, ale sukces potrzebny do wejścia na kolejny etap musi wynikać z historii dostępnej na początku.

## Czas, rezerwacje i budżet

Plan chroni cele należnych, już kwalifikujących sprawdzeń przed ujawnieniem, również w dystraktorach i jawnym fragmencie. Wspólne Recall/pisownia pozostają wspólnym zadaniem według istniejących reguł. Wsparcie dla tego samego celu następuje po chronionym sprawdzeniu.

Krok niedostępny na początku z powodu czasu nie jest planowany jako późniejsze niezależne sprawdzenie na podstawie przewidywanego tempa pracy. Może wrócić w kolejnej sesji. Faktyczna kwalifikacja nadal następuje przy received_at: odsłuch starego feedbacku w drugiej karcie może zmienić niezależność bez zmiany listy.

Lista jest skończona również w liczbie prezentacji. Budżet ocenianych zadań pozostaje obecny; nie dokładamy zadań po błędzie ani ponad „Jeszcze N”. Wcześniejszy koniec nie jest błędną wiedzą.

## Macierz przypadków

| Zdarzenie | Zachowanie |
| --- | --- |
| Sukces albo błąd | Bieżący wynik i zapis historii; przyszła lista bez zmian |
| Ponowienie w tym samym zadaniu | Obecny limit i klasyfikacja próby; bez nowego slotu |
| „Nie pamiętam” / podpowiedź | Ujawnienie bieżącego rozwiązania zgodnie z protokołem, zapis wsparcia/trudności; bez dodatkowej prezentacji w tej sesji |
| Nowa sesja po trudnościach | Dobór poziomu wsparcia z aktualnej historii; nie kopia poprzedniej listy |
| Wznowienie | Ten sam plan i aktualne zadanie; bez ponownego losowania |
| Mikrofon niedostępny/wyłączony | Ścieżka bez mikrofonu; niewykonalne sloty pominięte bez kary i zastępstw |
| Skrócenie listy | Liczba pozostałych pytań nie rośnie; obietnica końca pozostaje prawdziwa |
| Limit czasu | Zachować kończenie między zadaniami i ochronę obiecanych ostatnich pytań |
| Utrata HTTP / dwuklik | Idempotentne wydanie/finalizacja, bez nowej próby i rozliczenia |
| Awaria startu | Brak częściowej nowej sesji/planu; możliwość ponowienia |
| Nieobsługiwana wersja planu | Jawny błąd zgodności; bez regeneracji innej listy |
| Usunięcie profilu | Usunięcie planów wraz z sesjami i historią |

## Ujawnianie i ocena

Przygotowanie prywatnego promptu nie jest wydaniem. Plan i klucze pozostają na serwerze; klient dostaje wydany krok. Wydanie, podpowiedź, replay i feedback zachowują zapis ekspozycji przed zwrotem treści. Prezentacja kończy się bez próby/oceny i bez zużycia ocenianego budżetu.

STT, wymowa, model oceniający lekcji i processing zachowują obecne zasady. Odpowiedź oceniana jest od razu, nie na końcu sesji. Zmiana planera nie przepisuje historycznych ocen i nagród.
