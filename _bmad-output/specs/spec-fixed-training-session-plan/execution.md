# Wykonanie uzgodnione z właścicielem

## Bramka startu

Obecnie wolno przygotować dokumenty i sprawdzić ich spójność. Implementacja, RED aplikacji, migracje bazy, review kodu i commity rozpoczną się dopiero po osobnym poleceniu właściciela. Samo istnienie stories.yaml i checkpointy false nie stanowią polecenia startu.

Po tym poleceniu wykonać wszystkie cztery zadania kolejno od początku do końca. Bez ręcznych przystanków po specyfikacji albo po zadaniu. Kontynuować samodzielnie przez naprawy, testy i review. Rzeczywiste blokady lub sprzeczność z poleceniem zgłaszać; nie traktować nieudanego testu jako ukończenia.

## Pętla każdego zadania

1. Ustalić bazowy commit zadania, zakres i kryteria odbioru; zachować niezwiązane zmiany. Przed zmianą pierwszego zadania zebrać baseline czasów. Sprawdzić bieżące skrypty oraz dostępność .env i zależności zgodnie z AGENTS.md; nie wypisywać sekretów.
2. **RED:** dodać istotny test zachowania i rzeczywiście zobaczyć jego niepowodzenie z oczekiwanego powodu przed zmianą kodu. Zapisać komendę i wynik. Nie wytwarzać sztucznego RED przez uszkodzenie poprawnego kodu.
3. **GREEN:** minimalna implementacja spełniająca test. **Refactor:** uporządkowanie bez zmiany zachowania, przy zielonych testach. Dotyczy również napraw uwag z review.
4. Przed review muszą przejść pełne istniejące testy jednostkowe, integracyjne z PostgreSQL i e2e, a także typecheck i build. Po sprawdzeniu definicji skryptów bazowo: `corepack pnpm test:unit`, `corepack pnpm test:integration`, `corepack pnpm test:e2e`, `corepack pnpm typecheck`, `corepack pnpm build`. Nie odkładać pełnych testów zadań 1–3 do zadania 4. Brak infrastruktury oznacza brak dowodu, nie GREEN.
5. Uruchomić **jednego niezależnego reviewera**: model `gpt-6.1-sol`, reasoning `medium`, świeży kontekst. Tylko jeden aktywny code review naraz; bez dodatkowych równoległych reviewerów. Nie zastępować modelu bez uzgodnienia, jeśli jest niedostępny. W dostępnej delegacji: `fork_turns: "none"`, `model: "gpt-6.1-sol"`, `reasoning_effort: "medium"`.
6. Reviewer działa read-only. Dostaje specyfikację, wszystkie companions, bazowy SHA, cały niecommitowany zakres zadania, nowe pliki i dowody RED/GREEN oraz pełnych testów. Nie ogranicza się do ostatniej łatki. Sprawdza poprawność, regresje, granice modułów, dane, prywatność, migrację, współbieżność, testy i kryteria odbioru.
7. Gdy review ma trafne uwagi: poprawić je, powtórzyć testy, następnie uruchomić kolejne niezależne review **całego zadania** tym samym modelem i poziomem reasoning. Powtarzać aż review nie pozostawi nierozwiązanych trafnych uwag. Odrzucenie false positive musi mieć uzasadnienie i dowód; nie obniżać wagi realnego błędu, aby zamknąć pętlę.
8. Dopiero po wszystkich zielonych testach i czystym review utworzyć **lokalny commit danego zadania**. Wcześniej żadnych commitów roboczych, fixup ani checkpoint. Wybrać pliki zadania; nie commitować niezwiązanej pracy. Nie zmieniać kodu po czystym review bez powtórnego sprawdzenia. Zapisać SHA i dowody, następnie przejść do następnego zadania.

Zadanie odbiorcze nie wymaga fabrykowania RED dla samego tekstu dokumentacji. Każda nowa poprawka logiki lub wykryta regresja nadal wymaga rzeczywistego RED–GREEN–Refactor. Testów nie wolno osłabiać, aby ukryć błąd.

W przypadku konfliktu z domyślnym workflow BMAD dotyczącego liczby reviewerów, modelu lub ręcznych checkpointów, powyższe jawne polecenie właściciela ma pierwszeństwo. Wszystkie zmiany przed commitem pozostają lokalnie. Bez push, PR, merge i deploy.

## Zadania i dowody odbioru

| ID | Zakres | Minimalny dowód przed commitem |
| --- | --- | --- |
| 1 | Słówka: model/migracja, plan na start, wydawanie slotów, wsparcie między sesjami, zgodność starych sesji | RED→GREEN; nowe sesje standard/picture, oba canRead, nowy plan po trudnościach, retry/reload/dwie karty, ekspozycje i nagrody; pełne testy oraz czyste review |
| 2 | Lekcje na tym samym protokole stałego planu, bez logiki przedmiotu w silniku | RED→GREEN; natychmiastowa ocena, processing/cache/model, wsparcie następnej sesji i SubjectModule; pełne testy oraz czyste review |
| 3 | Natychmiastowy neutralny wybór/oczekiwanie, stabilny ekran, remaining | RED→GREEN; przejścia prezentacja/wybór/tekst/mowa/lekcja, retry/offline, mikrofon, mobile/klawiatura/zoom; pełne testy oraz czyste review |
| 4 | Odbiór przekrojowy, pomiary, dokumentacja, API→MCP→skill i rollout | Pełne regresje/e2e, wyniki czasów przed/po, zgodność dokumentów i odbiór całego zakresu; poprawki TDD, pełne testy oraz czyste review |

Pierwszy commit po domknięciu zadania 1 może objąć przygotowany pakiet specyfikacji razem z implementacją; nie tworzyć teraz osobnego commita/PR dokumentacyjnego. `_bmad-output` może być ignorowany przez Git — przed dodaniem sprawdzić regułę i w razie potrzeby jawnie dodać tylko ten pakiet, nie cały katalog wyników. Dokumentacja zmienionego kontraktu powinna towarzyszyć odpowiedniemu zadaniu; zadanie 4 domyka zgodność całości.

## Stan przygotowania

Checkpointy `spec_checkpoint: false` i `done_checkpoint: false` we wszystkich stories są decyzją właściciela. To nie status wykonania. Ukończenie wynika z dowodów testów, zamkniętego review i commita. Po zakończeniu całego zakresu raport zawiera SHA czterech commitów, wyniki testów/review/pomiarów oraz rzeczywiste ograniczenia weryfikacji.
