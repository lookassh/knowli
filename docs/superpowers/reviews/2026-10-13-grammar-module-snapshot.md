# PR #51 — niezależny review R10: spójny odczyt lekcji

**Kod gotowy. Critical 0 / Important 0.** R10 jest rozwiązane na HEAD `443aae9dbef562341bb04b37e56f9b03c3557a3f`. Aktualne pełne integration/E2E/build pozostają osobną bramką weryfikacji.

Zakres: cały nowy diff `d25ffc2..443aae9` (3 pliki), w kontekście wcześniejszego whole-feature review i końcowego review R1–R9. Nie powtarzano ogólnego audytu niezmienionych 180 plików. Recenzent: dedykowany `gpt-6.1-sol xhigh`, bez Astra, workflow `requesting-code-review`. Review read-only; bez zmian checkoutu, indeksu, HEAD, subagentów i publikacji komentarzy.

## Wynik

- [lesson-api.ts:278](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-api.ts:278) otwiera jedną transakcję PostgreSQL `repeatable read / read only`. Migawka obejmuje cały widok: deck, stan wersji, ćwiczenia, powiązania i stany mediów, generation run i przypisania.
- Prywatny `readLessonDeckSnapshot` przekazuje ten sam Executor do `readLessonDraftDto`, `latestLessonRun` i `lessonAssignments`. Sprawdzono ich implementacje: używają przekazanego db, wykonują tylko SELECT i nie wracają do globalnego `services.db`. Nie ma zagnieżdżonych transakcji ani zapisów w ścieżce projekcji. Jedyna dodatkowa informacja z services to stabilna konfiguracja gradera.
- Commit workera nie jest blokowany przez blokadę wiersza czytelnika. Czytelnik może zwrócić wcześniejszy stan queued z pustym szkicem; następny polling zobaczy nowy succeeded wraz z ćwiczeniami. Nie może połączyć obu stanów w jednym DTO. Publiczne pola, parametry, autoryzacja i kontrakt API/MCP pozostają bez zmian.
- [lesson-parent-api.test.ts:251](C:/Users/looka/IdeaProjects/knowli/tests/integration/lesson-parent-api.test.ts:251) odtwarza rzeczywisty wyścig w PostgreSQL: zatrzymuje dostarczenie wyniku SELECT item_revisions, wykonuje i zatwierdza generację przez osobne połączenie, następnie zwalnia czytelnika. Hook obsługuje zarówno callback, jak i Promise klienta pg, zachowując wynik rzeczywistego zapytania. Nie podmienia danych wyniku i nie opiera kolejności na sleep.
- Test wymaga spójnego starego widoku queued/empty, a po zakończeniu pierwszego odczytu wymaga świeżego succeeded/nonempty. Odczytane logi potwierdzają RED: succeeded zamiast queued; następnie GREEN całe parent API 15/15. To dowód czułości testu na pierwotny błąd.

## Sprawdzenia

Odczytano `read-snapshot-red.log`, `read-snapshot-green.log` (15/15 PASS), `read-snapshot-unit.log` (965/965 PASS) i `read-snapshot-parent-e2e.log` (7/7 PASS). Typecheck sześciu konfiguracji PASS zgłosił koordynator; nie uruchamiałem go ponownie. Recenzent wykonał `git diff --check d25ffc2..443aae9`: PASS.

Nie deklaruję PASS aktualnych pełnych integration338, E2E148 ani build na podstawie starszych logów. W chwili review oczekiwane jest ich uruchomienie/ukończenie przez koordynatora.

## Minor

Brak nowych uwag. Wcześniej jawnie odłożony licznik kart w assessedTasksIssued pozostaje ograniczeniem metadanych z poprzedniego review; R10 nie zmienia tej ścieżki.

## Declined to judge / ograniczenia

- Aktualne pełne integration/E2E/build: wyniki nie były jeszcze dostępne w tym review.
- Wdrożenie, fizyczny Galaxy S25, realny provider i konsument Hermesa: poza zakresem tej poprawki; dotychczasowe ograniczenia pozostają.
- Nie wykonywano ponownego audytu całego niezmienionego feature'u; wcześniejsze niezależne raporty zachowują zastosowanie.

**Ready to merge? Kod R10: Yes. Końcowa integracja całego feature'u wymaga aktualnych pełnych sprawdzeń.** Nie znaleziono blockerów ani potrzeby dodatkowych zmian wynikających z tego review.

Na początku i końcu checkout pozostaje na `443aae9`; obecny nieśledzony `docs/superpowers/reviews/2026-10-13-grammar-module-fixes.md` należy do pracy koordynatora i nie został zmodyfikowany przez recenzenta. Jedyny zapis recenzenta: ten raport poza repozytorium.
