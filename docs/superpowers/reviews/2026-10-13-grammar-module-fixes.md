# PR #51 — niezależny review całego fix pass

**Kod: gotowy, Critical 0 / Important 0. Ready to merge: warunkowo, po ukończeniu aktualnego pełnego E2E i końcowej weryfikacji gałęzi.** Pozostaje jeden jawnie odłożony Minor.

Baza napraw: `05ea1380e1889bc203d2c98a1010ad07d5bd791a`. Końcowy HEAD: `d25ffc2ed96af36768a457482330168a1e9b75ac`. Zakres: wszystkie 23 pliki całego fix pass, łącznie z późniejszymi poprawkami wyścigów pre-claim i rollback recovery. Ocena całego feature'u obejmuje także wcześniejszy niezależny review `8b01cada..05ea138`, udokumentowany w `docs/superpowers/reviews/2026-10-13-grammar-module-final.md`; nie powtarzano czytania niezmienionych 180 plików.

Recenzent: dedykowany `gpt-6.1-sol`, effort `xhigh`, bez Astra. Workflow: bieżący `superpowers:requesting-code-review` i jego `code-reviewer.md`. Implementację prowadził root inline. Przegląd był read-only względem checkoutu, indeksu, HEAD i gałęzi, bez subagentów i publikacji komentarzy. Jedyny zapis recenzenta to ten raport poza repozytorium.

## Mocne strony

- Walidacja rekordów korzysta ze wspólnego kontraktu kształtu i limitów, a domena dopowiada wymagane bodźce każdego typu. Publikacja i edycja sprawdzają teraz całą pulę, nie tylko liczbę ćwiczeń.
- Edytor zachowuje pytanie krótkiej odpowiedzi i zdania z przecinkami w zatwierdzonych wariantach. Rodzic może także uzupełnić odrzucone/brakujące przykłady, widząc podgląd karty.
- Recovery kartkówki utrwala neutralne zakończenie próby bez feedbacku i bez ponownej odpowiedzi. Konflikt nowego POST po reloadzie nie cofa już cleanup.
- Generacja ma fencing przy claimie, zapisie materiału i terminalnych aktualizacjach. Retry oraz commit stosują zgodną kolejność blokad wersja→run.
- Testy współbieżności używają jawnych barier, w tym po rzeczywistym SELECT z PostgreSQL i przed claimem. Nowe testy wykazały rzeczywiste RED, a nie tylko pozornie zielone happy paths.

## Critical / Important

Brak pozostających uwag w dostarczonym fix pass na `d25ffc2`. W trakcie tego przeglądu znaleziono dwie dodatkowe luki w pośrednim HEAD `b6e0457`; obie zostały reprodukowane, naprawione inline i objęte tym końcowym sprawdzeniem:

1. **R9 pre-claim:** stary SELECT mógł przejąć nową generację po retry i pozostawić ją w running. Claim lekcji przekazuje teraz snapshot `expectedEditNumber` do warunku CAS, więc stary odczyt nie przejmie runu nowej generacji.
2. **R5 rollback recovery:** nowy clientAttemptId po >60 s kończył stale próbę, a następnie rzucał konflikt w tej samej transakcji, cofając cleanup. Wstęp próby zwraca teraz wynik conflict, a wyjątek HTTP jest rzucany dopiero po zakończeniu transakcji.

## Adresowanie R1–R9

| Uwaga | Końcowy wynik i dowód |
| --- | --- |
| **R1 — wadliwe prompty i limity rekordów** | **Rozwiązana.** `pool-validation.ts` używa `LessonExerciseInputSchema.safeParse` przed dereferencjami, wymaga stem choice, pytania short_answer/open_answer oraz niepustego statement error_fix/transform. Adapter generatora opisuje te same kanoniczne pola i limity. Edycja i publikacja używają pełnej walidacji. Recenzent ponowił czyste reprodukcje: brak bodźca i answer długości 121 są odrzucane. |
| **R2 — warianty z przecinkami** | **Rozwiązana.** Warianty są osobnymi wierszami w textarea i zachowują przecinki jako część zdania. Test round-trip zmiany wyłącznie tytułu zachowuje `["Yes, he does.", "Yes, she does."]`; czysta reprodukcja recenzenta potwierdziła identyczny wynik. |
| **R3 — utrata short_answer.prompt** | **Rozwiązana.** Serializacja zachowuje prompt dla short_answer; UI pokazuje pytanie z prompt z fallbackiem legacy stem, który nadal jest zachowywany. Materializacja preferuje prompt. Czysty round-trip recenzenta zachował `Does he play?`; istniejące transformy nadal zachowują statement. |
| **R4 — brak historii poprzednich sesji** | **Rozwiązana.** Zapytanie lastSeenAt ogranicza historię do tego childId i itemId przypiętej puli, obejmując wszystkie sesje tego dziecka. Test ma wcześniejszy własny kontakt oraz późniejszy kontakt innego dziecka; cudza historia nie zmienia kolejności. |
| **R5 — druga odpowiedź po stale processing** | **Rozwiązana, wraz z dodatkowym rollbackiem po reloadzie.** Aktywny slot mock_test staje się answered, feedback pozostaje null, nie powstaje ocena wiedzy; po zamknięciu nie zmienia się slot ani zapisany raport. Reread zadania następuje pod wspólną blokadą. Stan conflict jest zwracany przez transakcję, a AppError rzucany po commicie. Test >61 s z nowym POST bez wcześniejszego GET sprawdza trwałe completed/answered, konflikt drugiej odpowiedzi i wydanie następnego slotu. RED processing zamiast completed → GREEN całe lesson-attempts 28/28. |
| **R6 — neutralizacja decyzji rodzica incorrect** | **Rozwiązana.** `authoritativeIncorrect` ustawia outcome incorrect również bez kategorii; brak kategorii nie tworzy wymyślonej podpowiedzi. Flaga jest przekazywana zarówno przy odczycie cache w fazie 1, jak i przy odczycie zwycięskiego wiersza cache w fazie 2. Nie ma zapisów zmieniających wcześniejsze assessments ani wstecznej projekcji. Integracja obu kierunków decyzji rodzica sprawdza przyszły outcome i brak nowego wywołania gradera. |
| **R7 — niewalidowane examples** | **Rozwiązana.** Przyjmowane są tylko przykłady celu bieżącej partii: string, niepusty po trim, ≤120 znaków, maksymalnie trzy. Null, puste/nadmierne teksty i obce klucze nie trafiają do kontekstu. Prawidłowe ćwiczenia pozostają; test generacji potwierdza terminalny succeeded i wyłącznie prawidłowy przykład. UI wyświetla karty także bez examples i pozwala dopisać przykład. |
| **R8 — duplikaty po edycji/publikacji** | **Rozwiązana.** Obie operacje używają validatePool i zwracają błędy bez cichego usuwania ćwiczeń. Rejected zachowuje referencję do konkretnego draftu, więc indexOf wskazuje właściwy indeks; czysta reprodukcja recenzenta dla dwóch równoważnych odpowiedzi zwróciła indeks 1. Integracja sprawdza odrzucenie w PATCH oraz ponowną ochronę publikacji. |
| **R9 — osierocona generacja / spóźniony worker** | **Rozwiązana, wraz z dodatkowym pre-claim.** UI udostępnia jawne retry running, blokuje je przy dirty/busy/conflict. Retry blokuje wersję, potem run, zwiększa editNumber i expectedEditNumber oraz resetuje queued/attempts. Claim lekcji porównuje oczekiwany numer odczytanego snapshotu. Commit materiału sprawdza aktualne state, attempts i expectedEditNumber pod taką samą kolejnością blokad; wszystkie terminalne/queued zapisy CAS używają tych trzech warunków. Spóźniony sukces ani wyjątek starego wykonania nie może nadpisać nowej generacji. Testy obejmują restart z nowego połączenia po claimie, żywe stare wykonanie oraz barierę po SELECT/przed claimem. Pre-claim RED running zamiast queued → GREEN lesson-generation 19/19. |

Wspólne sprawdzenie R5/R9 objęło kolejność blokad, moment zatwierdzenia transakcji, odczyty po wspólnej blokadzie, późny model i worker oraz wszystkie gałęzie terminalnego markCurrentRun. Nie wykryto pozostałego zapisu omijającego fencing. Zmiany nie wprowadzają nowego kontraktu MCP, nie włączają lekcji do learning-overview i nie zmieniają dawnych ocen ani opublikowanego materiału.

## Minor

Pozostaje wcześniej zgłoszony i jawnie odłożony licznik [sessions.ts:119](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/sessions.ts:119): wspólne taskCounts wyklucza exposure, lecz nie lesson_card, więc publiczne assessedTasksIssued przy wznowieniu/podsumowaniu lekcji jest zawyżone o karty. Faktyczny budżet i remainingAssessed korzystają z poprawnego lessonTaskCounts, a bieżący Kid UI nie steruje przebiegiem tym błędnym licznikiem. To ograniczenie metadanych, nie blocker tego zakresu.

Minor EOF został usunięty zarówno w lesson-supervision.ts, jak i w skopiowanym raporcie review. Recenzent wykonał `git diff --check 8b01cada..d25ffc2`: PASS.

## Sprawdzenia i stan gotowości

Odczytane świeże logi koordynatora:

- `resume-unit.log`: 965/965 PASS.
- `resume-integration.log`: 337/337 PASS, obejmuje oba ostatnie testy wyścigów.
- `resume-build.log`: build PASS.
- `review-preclaim-red.log / review-preclaim-green.log`: rzeczywisty RED oraz GREEN 19/19.
- `review-reload-red.log / review-reload-green.log`: rzeczywisty RED oraz GREEN 28/28.
- Poprzednie sprawdzenia fix pass: typecheck sześciu konfiguracji PASS, MCP 8/8 i schema --check PASS, według dziennika oraz koordynatora.

Recenzent nie powtarzał całych suite; wykonał odczyt źródeł, sprawdzenie zakresów Git, czyste reprodukcje R1/R2/R3/R8 i diff --check. Wcześniejszy pełny E2E miał 147 PASS / 1 FAIL na oczekiwaniu audio (3 pending po 120 s). Nowy test restartu zostawiał media w kolejce dla następnego testu; teraz kończy własne oczekiwanie audio. Ten zmieniony test i bieżący pełny E2E 148 wymagają aktualnego wyniku. Przyczyny oczekiwania TTS nie traktuję jako dowodu ukończonego E2E.

**Ocena kodu: Ready — nie pozostają Critical ani Important. Ocena scalenia/publikacji zakresu: wymaga ukończenia aktualnych końcowych sprawdzeń.** Po ich przejściu kod na tym HEAD nie wymaga kolejnych zmian wynikających z tego review. Aktualizacja istniejącego PR nie stanowi autoryzacji samodzielnego scalenia; squash wykonuje właściciel zgodnie z workflow repozytorium.

## Declined to judge

- Jakość pedagogiczna realnych generacji i trafność realnego modelu oceniającego: brak próby rzeczywistego providera. Oceniono kontrakty, deterministyczną ocenę, walidację i obsługę awarii.
- Fizyczny Galaxy S25, systemowa klawiatura i rzeczywisty odsłuch: brak próby urządzenia.
- Migracja istniejącej bazy produkcyjnej i backup/rollback: brak wdrożenia; lokalny PostgreSQL nie zastępuje tego dowodu.
- Zainstalowany MCP/skill Hermesa: bez zdalnej aktualizacji konsumenta; repozytoryjne filtrowanie i niezmienność schematu objęto oceną.
- Mechaniczny audyt każdego snapshotu Drizzle i każdej asercji wszystkich suite: nie wykonywano; wcześniejszy whole-feature review i ten review obejmują relewantne scenariusze oraz cały zakres zmian.
- Końcowy wynik nowego pełnego E2E148: w chwili sporządzenia raportu pozostaje w toku i nie jest deklarowany jako PASS.

Checkout na końcu odczytu jest czysty, HEAD `d25ffc2ed96af36768a457482330168a1e9b75ac`.
