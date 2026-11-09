# Zaliczanie aktywności do nagród

## Granice wiarygodności

To osobny od raportu MCP wskaźnik aktywności powiązanej z pracą, nie dowód uwagi, uczciwości ani tożsamości. Dziecko może zgadywać, odczekać, korzystać z pomocy lub oddać urządzenie rodzeństwu; przegląd rodzica jest częścią rozwiązania. Nie obiecujemy wykrywania wszystkich tych sytuacji.

## Odcinek pracy

Naliczanie jest możliwe tylko w widocznym, aktywnym ekranie wydanego zadania, podczas czytania, słuchania, wpisywania lub odpowiadania. Start zadania otwiera ograniczone okno zapoznania się; rzeczywista interakcja nauki może je podtrzymać. Sam ruch kursora, heartbeat, replay lub otwarcie zestawu nie dowodzi wykonania kroku.

Tło, utrata fokusu, pauza, bezczynność, offline, nawigacja i podsumowanie zatrzymują potencjalny odcinek. Oczekiwanie na sieć, STT lub grader nie nalicza czasu; powrót do gotowego zadania może wznowić pracę. Nie rozliczamy luki sieciowej wstecz według dowolnego czasu klienta.

Potencjalny czas rozliczamy przy rzeczywistym kroku przyjętym przez serwer:

| Zakończenie kroku | Skutek |
| --- | --- |
| Odpowiedź poprawna lub błędna | Rozlicz aktywne odcinki, bez mnożnika wyniku |
| Jawne „Nie pamiętam” | Udział; ta sama zasada czasu, bez automatycznej kary |
| Jawne ukończenie prezentacji | Rozlicz aktywny czas, bez fikcyjnego attempt/assessment |
| Sam „Pomiń” lub porzucenie | Nie rozliczaj niepotwierdzonego czasu tego kroku; wcześniejsze rozliczenia pozostają |
| Wyłącznie cisza, niepewne STT lub błąd providera | Brak nowego potwierdzenia pracy na tej podstawie; jawny stan techniczny rodzicowi, bez błędu wiedzy |

Kilka prób jednego zadania może rozliczyć różne rzeczywiście wykonane odcinki, lecz żadnej sekundy dwukrotnie. Nie trzeba mieć poprawnej odpowiedzi lub końcowego assessment, aby rozliczyć wcześniej przyjętą pracę. Błąd techniczny po zapisanym kroku nie cofa czasu.

Wolna odpowiedź nie jest oszustwem. Po progu bezczynności licznik może się zatrzymać; komunikat musi to wyjaśniać. Wolne czytanie, odsłuch i nauka bez mikrofonu są warunkiem odbioru parametrów.

## Założenia startowe do odbioru story 1

Sygnał klienta co 15 s, granica utraty potwierdzanej łączności 30 s, bezczynność po 60 s od interakcji (A1). Sygnał obecności nie odnawia sam bezczynności. Po zaniknięciu sygnału nie rozliczamy odcinka poza ostatnio potwierdzoną granicę; tolerancja nie dopisuje 30 s pracy.

To propozycja techniczna do planu story 1, nie potwierdzony naukowo próg. Plan musi określić gesty i odtwarzanie podtrzymujące okno oraz pokazać przykłady minut z pauzą. Uzgodniona wersja obowiązuje całą sesję; zmiana po odbiorze wymaga aktualizacji kontraktu przed implementacją, bez ukrytego dostrajania.

## Serwer i współbieżność

- Serwer sprawdza sesję, dziecko, zadanie, stan kroku i rosnący identyfikator odcinka; nie przyjmuje zaufanej kwoty punktów ani nieograniczonego elapsed klienta.
- Czas jest ograniczony rzeczywistym czasem serwera i potwierdzonymi odcinkami; cofnięcie zegara klienta lub seria heartbeatów nie tworzy dowolnych minut.
- Jedno dziecko ma jeden aktywny strumień pomiaru. Przejęcie na drugim urządzeniu jest jawne i nie podwaja odcinków; obecne blokady nauki pozostają.
- Przejęcie nowym strumieniem nie dopisuje niezamkniętego ogona poprzedniego strumienia. Może to odjąć do 15 s przy zmianie urządzenia, ale nie zaliczy czasu w tle, gdy sygnał pauzy nie dotarł.
- Rozliczenie jest atomowe i idempotentne. Ponowienie, spóźniony pakiet, reload i odczyt podsumowania nie przyznają czasu ponownie.
- Do audytu wystarczają przedziały, powody wyłączenia i odwołania do kroków; bez surowych klawiszy, ruchów myszy i audio dziecka.
