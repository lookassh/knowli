# Niezależne review — usuwanie lekcji z listy

Recenzent: dedykowany subagent `final_review`, gpt-6.1-sol, xhigh. Baza: c77a04e; cały niezacommitowany diff, w tym nowe pliki. Przegląd read-only według requesting-code-review/code-reviewer.md. Bez własnych buildów/serwera/E2E runnera; trzy dodatkowe ustalenia zweryfikowano izolowanym Playwright DOM probe ze stylami repo.

## Wynik przeglądu przed poprawkami

Critical: brak. Important: trzy uwagi P2. Minor: brak. Ocena: **With fixes**.

1. Błąd transportu: DecksPanel przekazywał TypeError do errorMessage, więc alert pokazywał „Failed to fetch” zamiast polskiego komunikatu o ponowieniu.
2. Legalny tytuł 200 znaków bez spacji wychodził poza modal przy 390 px: clientWidth/scrollWidth dialogu 348/2096, opisu 308/2076. Brak overflow-wrap. Pomiar szerokości dokumentu po zamknięciu modala nie wykrywał problemu.
3. Po sukcesie przycisk wywołujący znikał; returnFocus.isConnected=false, a fokus pozostawał na niewidocznym przycisku confirm w zamkniętym dialogu. Potrzebny fallback do widocznej kontrolki.

Potwierdzone mocne strony: istniejący endpoint/autoryzacja, zachowanie historii i blokada nowych sesji, synchroniczna blokada wielokrotnego wysłania, poprawne rozróżnienie sukcesu archiwizacji od awarii odświeżenia. Dowody przy review: unit 974/974, integracja 343/343, regresja rodzica 31/31; RED 4 FAIL / 1 PASS przed UI, potem E2E 5/5 GREEN. Build po aktualizacji bazy pozostawał do wykonania.

## Declined to judge i rozstrzygnięcia wykonawcy

- Kid API nadal zwraca przypisanie archiwalnej lekcji, a start zwraca conflict. Ograniczenie istniejącego UX; uzgodniony zakres dotyczy listy rodzica i nie zmienia semantyki Kid API. Pozostaje jawnie odłożone.
- Trwające sesje i równoczesny start podczas archiwizacji: istniejąca logika serwera, wyłączona z zaakceptowanego planu. Bez zmiany w tym zadaniu.
- Przywracanie i zmiana możliwości edycji archiwalnych szkiców: poza uzgodnionym zakresem. Bez zmiany w tym zadaniu.

## Obsługa uwag

Wszystkie trzy P2 przyjęto po weryfikacji. Dodano regresje przed poprawkami: polski alert, szerokość opisu otwartego modala z tytułem 200 znaków i fokus na filtrze po sukcesie. RED: 3/3 FAIL z oczekiwanych powodów. Po poprawce inline: E2E archiwizacji 6/6 GREEN, unit 974/974 i typecheck PASS. Integracja 343/343 i regresja rodzica 31/31 PASS na aktualnej bazie. Szczegóły i końcowy build w dzienniku `../progress/2026-10-13-archive-lessons.md`.

Wykonawca potwierdził usunięcie wszystkich trzech uwag blokujących przez testy RED→GREEN; brak odłożonych Minor. To wynik obsługi uwag przez autora, bez drugiego niezależnego review poprawki, zgodnie z executing-plans. Zakres odłożony opisano powyżej i w dzienniku.
