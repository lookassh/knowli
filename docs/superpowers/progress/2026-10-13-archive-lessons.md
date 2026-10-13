# Dziennik — plan: docs/superpowers/plans/2026-10-13-archive-lessons.md

## Setup i checklista

- [x] Zatwierdzony projekt i wykonanie inline; wymagane TDD RED→GREEN i końcowe review.
- [x] Skills using-superpowers, brainstorming, executing-plans, test-driven-development i using-git-worktrees przeczytane; using-git-worktrees: istniejący izolowany worktree, czysty detached HEAD 9bde36e; utworzono feature/archive-lessons.
- [x] Przejrzano SPEC, architecture, schema.sql, folder-structure, implementation-plan, rzeczywiste API, listę i edytor lekcji oraz konfigurację testów.
- [x] Task 1: RED → implementacja → GREEN, integracja, regresje i końcowe sprawdzenia.
- [x] Task 2: niezależne review → obsługa uwag → końcowa weryfikacja → przygotowanie dostarczenia przez PR.

Pre-flight: Task 1 dostarcza UI i dowody, Task 2 obejmuje cały diff; bez konfliktów interfejsów. Publiczne API/DTO/baza pozostają bez zmian. Brak wpływu na MCP i SKILL.md: archiwizacja to istniejący endpoint rodzica; raport learning-overview wyklucza lekcje.

Adaptacja: zatwierdzony plan bounded był w czacie; zapisano jego treść i checklistę dla executing-plans. Zapisany dziennik w docs zachowuje dowody po usunięciu tymczasowego workspace skilla.

## Task 1 — TDD i kontrakt

- Baseline: pnpm 10.34.6, install --frozen-lockfile; unit 96 plików, 966/966 PASS.
- Pierwszy run E2E nie był RED funkcji: setup błędnie zakładał propagację tytułu szkicu na listę przed publikacją. Po prześledzeniu patchLessonDraft i publishLessonDraft test tworzy i publikuje lekcję przez rzeczywiste API. Fixtures integracji wymagały ensureLearningPolicy(db) i sortowania assessments po attempt_id, skill (brak kolumny id). Poprawiono wyłącznie testy.
- RED: red2-e2e.log — 4 nowe scenariusze nie przechodzą na brakującym przycisku „Usuń z listy: Present Simple …”; 1 test zachowania słówek przechodzi. Wynik 4 FAIL / 1 PASS, przed pierwszą zmianą produktu.
- Implementacja: przycisk dla aktywnych lekcji, modal z tytułem i informacją o historii, anulowanie/Escape/fokus, blokada ponownego żądania, domyślne ukrycie archiwalnych lekcji, checkbox archiwum. Potwierdzony sukces zapisywany lokalnie przed odświeżeniem; awaria odświeżenia wyświetla osobny komunikat sukcesu z ograniczeniem. 401 wraca do logowania.
- Doprecyzowanie zakresu testu kontraktu: Kid API już odrzuca start zarchiwizowanego zestawu, ale jego lista nadal zwraca istniejące przypisania. Nie zmieniamy semantyki publicznego Kid API w tym zadaniu. Zabezpieczamy zgodnie z zaakceptowanym planem blokadę nowej sesji training/mock_test oraz niezmienność historii; usunięto nadmiarowe oczekiwanie dotyczące listy Kid API. Ryzyko: istniejący kafelek dziecka może pozostać widoczny, choć nie pozwala rozpocząć nowej sesji.
- GREEN: nowe E2E 5/5 PASS (1,7 min), pełna integracja PostgreSQL 36 plików i 343/343 PASS (166 s), unit 966/966 PASS, typecheck PASS, build PASS. Obejmuje błąd sieci i ponowienie, zablokowanie duplikatu, Escape/anulowanie i powrót fokusu, sukces pomimo awarii odświeżenia oraz prawdziwe wylogowanie/401.
- Kontrola wizualna zrzutu 390 px: checkbox dziedziczył szerokość zwykłego inputa; ograniczono jego rozmiar do 20 px, etykieta zachowuje pole dotykowe min. 44 px. Test E2E sprawdza brak poziomego przewijania przy 390 i 1440 px. Powtórzenie nowych testów wraz z regresją rodzica trwa.
- Regresja rodzica: 30/31 PASS, istniejący test konfliktu dwóch okien FAIL. Systematic-debugging: trace.network wykazał zapis bazowy expectedEditNumber=1 → 200, lokalny =2 → 200, zdalny =2 → -1 (przerwane żądanie). Test zamykał drugie okno zaraz po lokalnym pojawieniu się tekstu w inpucie, przed odpowiedzią PATCH; nie utworzył konfliktu. Poprawiono setup: helper i drugie okno czekają na odpowiedź PATCH 200, lokalna edycja zaczyna się przed zdalną (polling nie przestawia bazy), stale PATCH musi zwrócić 409. Kod produktu dla konfliktów bez zmian. To stabilizacja wymaganej regresji, nie rozszerzenie feature'u.
- Przed końcowym review odświeżono origin/main: nowa baza c77a04e (PR #53, konfiguracja generatora). Własne zmiany zabezpieczono w dedykowanym stashu, gałąź zaktualizowano do main i odtworzono stash bez konfliktów. Unit na nowej bazie: 97 plików, 974/974 PASS. Pełna integracja i powtórzenie 31 E2E rodzica uruchomione na nowej bazie.

## Task 2 — końcowe review

Adaptacja kolejności: po zamknięciu zmian kodu niezależny read-only review obejmuje cały niezacommitowany stan na bazie c77a04e, równolegle do ostatnich sprawdzeń. Nie wykonujemy commita ani PR przed odczytaniem finalnych wyników i rozwiązaniem uwag blokujących. Pakiet roboczy: .superpowers/sdd/2026-10-13-archive-lessons/review-working.diff + jawna lista nowych plików; po commicie powstanie standardowy review-package ze skryptu skilla. Recenzent gpt-6.1-sol, xhigh (najmocniejszy dostępny spoza GPT Astra); review jest jedyną delegowaną częścią, implementacja inline.

- Końcowe sprawdzenia na nowej bazie przed poprawkami review: unit974/974, integration343/343, parent E2E31/31 PASS, typecheck PASS. Test konfliktu po naprawie setupu dostał wymagany PATCH409 i PASS.
- Niezależne review: Critical0, Important3/P2, Minor0, With fixes. Raport: ../reviews/2026-10-13-archive-lessons.md. Receiving-code-review: potwierdzono surowy TypeError w errorMessage, brak wrap i warunek powrotu fokusu tylko do istniejącego triggera. Właściciel zatwierdził polski UI/obsługę błędu i modal; wszystkie trzy dotyczą nowego kodu i zostały przyjęte do jednej poprawki inline z RED→GREEN.
- Final: Ruling: archiwalny kafelek w Kid API — pozostawiono istniejącą semantykę zgodnie z zaakceptowanym zakresem listy rodzica; koszt: dziecko może nadal widzieć kafelek odrzucający start sesji.
- Final: Ruling: trwająca sesja i równoczesny start — pozostawiono istniejące blokady i zachowanie serwera, wyłączone z planu; koszt: archiwizacja nie kończy rozpoczętej sesji i nie dodaje nowej gwarancji atomowości start vs archive.
- Final: Ruling: przywracanie i edycja archiwalnych szkiców — bez rozszerzania istniejących możliwości, poza planem; koszt: brak przywracania i dotychczasowe ograniczenia edycji archiwum.
- Review RED: review-red.log — 3/3 FAIL z oczekiwanych powodów: szerokość opisu przekracza clientWidth, filtr nie ma fokusu po sukcesie, alert „Failed to fetch” zamiast polskiego tekstu. Przed poprawkami kodu produktu.
- Poprawki inline: lokalizowany fallback dla błędu transportu (ApiCallError nadal zachowuje komunikat API), overflowWrap:anywhere dla opisu potwierdzenia, powrót fokusu do checkboxa archiwum po usunięciu triggera. Zachowano anulowanie i powrót do istniejącego triggera.
- Final: fixed 3 uwagi P2 — wszystkie odtworzone jako RED 3/3, następnie pełny E2E archiwizacji GREEN 6/6 (1,8 min), w tym fallback fokusu, opis z legalnym tytułem 200 znaków przy 390 px i dokładny polski alert po awarii transportu. Unit 974/974 i typecheck ponownie PASS po poprawkach. Integracja 343/343 oraz regresja rodzica 31/31 PASS na tej samej bazie; poprawki review nie zmieniają serwera ani pozostałych ekranów. Nie uruchamiano drugiego review — pojedyncza poprawka uwag zweryfikowana TDD, zgodnie z executing-plans.

## Końcowa weryfikacja i dostarczenie

- `pnpm test:unit`: 97 plików, 974/974 PASS; powtórzony przez task-done dla dowodu ukończenia.
- `pnpm test:integration`: pełna integracja, 36 plików, 343/343 PASS na c77a04e.
- `pnpm test:e2e tests/e2e/lesson-archive.spec.ts tests/e2e/lesson-parent.spec.ts tests/e2e/manual-deck-flow.spec.ts tests/e2e/parent-edit-protection.spec.ts`: 31/31 PASS. Po poprawkach review cały plik archiwizacji: 6/6 PASS, w tym trzy wcześniej czerwone regresje.
- `pnpm typecheck`, końcowy `pnpm build` po wszystkich poprawkach na c77a04e, `git diff --check`: PASS.
- Nie uruchamiano lokalnie całego zestawu E2E; wykonano pełną integrację i unit oraz adekwatne E2E rodzica. Fizyczne urządzenie pozostaje niezweryfikowane; 390/1440 px to automatyczny test przeglądarki i wizualna inspekcja zrzutu.
- API → MCP → skill: bez zmian kontraktów i migracji; użyto istniejącej archiwizacji rodzica. Lekcje nadal wyłączone z raportu Hermesa, konsument MCP nie wymaga aktualizacji.
- Finishing-a-development-branch: opcja push + PR do main jest już autoryzowana przez AGENTS.md, więc bez ponownego pytania o wybór. Właściciel scala przez squash; worktree i gałąź pozostają na czas przeglądu PR. Nie scalano ani nie wdrażano.
- Standardowy review-package powstaje po commicie całej zmiany. Surowe logi skilla będą zachowane w ignorowanym `test-results/archive-lessons-verification/` przed usunięciem wyłącznie workspace tego planu.
