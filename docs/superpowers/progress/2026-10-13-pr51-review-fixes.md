# SDD ledger — plan: docs/superpowers/plans/2026-10-13-pr51-review-fixes.md

Start: HEAD 8dc6d76; PR HEAD a590f7e; siedem plików zmian Kiro zachowanych. Właściciel polecił dokończyć poprawki po przedstawieniu audytu.

Workflow: using-superpowers, receiving-code-review, systematic-debugging, test-driven-development, writing-plans, executing-plans, using-git-worktrees, verification-before-completion. Kontynuacja istniejących wymagań i planu `.kiro/specs/grammar-module`, nie nowy feature. Nowy kontrakt kart ma osobną bramkę.

Adaptacja Windows: skrypty bash workspace/task-start/task-done/review-package odtwarzamy w PowerShell: ten trwały dziennik, plan z checklistą, per-task BASE/brief/checks/logi oraz osobny pakiet review. Logi w C:/Users/looka/.codex/worktrees/review-pr-51/fix-logs/. Nie usuwamy trwałych dowodów po review.

Ruling: kontynuujemy istniejącą gałąź feature/grammar-module w checkoutcie Kiro — przenoszenie częściowo niezacommitowanego zadania do nowego checkoutu ryzykowałoby utratę związku z istniejącym PR; brak zmian na main i brak równoległych wykonawców. Baseline audytu ma 2 FAIL unit i 14 FAIL integration, właśnie te regresje są zakresem napraw.

Pre-flight: Task 1 dostarcza snapshot etapów dla Task 3 realnych przepływów; Task 2 broni rekordów generacji i statement dla Task 3 publikacji; Task 4 dostarcza tylko bezpieczny katalog rodzica, bez Kid/MCP zmian. Testy fixture aktualizujemy dopiero po dowodzie błędu, nie aby ukryć scheduler.

Task 1: in_progress, BASE 8dc6d76; brief w planie; RED z audytu trzeba powtórzyć w tym zadaniu wraz z testem limitu nowych.
Task 1: complete — RED 4/38 scheduler (task1-red.log), fixture RED odrzucony short_answer (task1-fixture-red.log); GREEN scheduler 38/38, integracje sesji/prób/kształtu 40/40. Snapshot initialObjectiveProgress w kontekście sesji, initialProgress w domenie; bieżący postęp nadal steruje due/mastered. Fallback starych sesji bierze pierwsze kroki wprowadzenia, nie dowolny wpis historii.
Ruling: podstawowy fixture zmieniony na lesson_choice z opcjami po ID — short_answer nie jest dozwolony dla third_person_s, co wykazał validator; nie rozszerzamy katalogu przedmiotu dla potrzeb testu.
Task 2: complete — RED 5 testów unit i 2 integracyjne; GREEN unit 957/957 oraz lesson-generation 14/14. Transform wymaga niepustego statement, guard sprawdza acceptedAnswers/focus i pola tekstowe, poprawne rekordy zapisane, błędne policzone.
Task 3: in_progress; BASE po commitach Task 1/2; pierwotne P1-3/4/5 PASS w task1-final-integration.log. Plan kart czeka na osobne zatwierdzenie.
Task 3: wzmacnianie dowodów — P1-3 bez modelu i awaria fazy 2 po przerwie PASS; P1-5 z jawną barierą gradera PASS; dont_remember prowadzi do rzeczywistej karty wsparcia i guided. Nowy przepływ generacja→edycja→publikacja wykrył wadliwy fake provider: choice bez stem i transform z prompt zamiast statement. Potwierdzone RED w task3-fake-red.log i task3-fake-transform-red.log, minimalne poprawki fake.ts. Błędne żądanie przypisania w nowym teście skorygowane do {testDate:null}, odpowiedź 204.
Task 4: specyfikacja i plan zatwierdzone przez właściciela; executing-plans inline kontynuowane. RED katalogu bez cards (task3-cards-red.log) i brak podglądu E2E (task4-ui-red.log). GREEN kontraktu oraz E2E podglądu/edycji 2/2, typecheck PASS. Karty renderowane tak jak renderCard: body bez znacznika + osobna lista przyciętych niepustych przykładów.
Ruling: dopisano trzy jawne reguły LF w .gitattributes — test MCP wykazał niezgodność hashy wyłącznie przez CRLF checkoutu Windows; po przywróceniu LF manifest pasuje bez zmiany schematu/skilla/hashy. MCP 8/8 PASS oraz export schema --check PASS. Nie zmieniono kontraktu raportu.
Task 5: in_progress — unit 957/957 PASS; build PASS; pierwszy pełny integration 325 PASS / 1 FAIL w nowym teście (brak testDate); po naprawie żądania test wykazał brak stem w fake, też naprawiony. Trwa ponowny pełny integration i pełny E2E. Logi C:/Users/looka/.codex/worktrees/review-pr-51/fix-logs/.
