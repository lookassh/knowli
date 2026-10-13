# Dokończenie poprawek PR #51

> REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

Goal: dokończyć autoryzowane przez właściciela naprawy dziesięciu uwag review, zachowując pracę Kiro.
Spec: `.kiro/specs/grammar-module/requirements.md`, `design.md`, `tasks.md`; raport review i audyt w `C:/Users/looka/.codex/worktrees/review-pr-51/`. Task 4 czeka na zatwierdzenie osobnego uzupełnienia kontraktu.
Architecture: obecny monolit, snapshot wewnętrznego kontekstu sesji, walidacja surowego rekordu przed semantyką, istniejący przepływ rodzica i dziecka.
Execution: bieżący agent inline, końcowy niezależny recenzent.

## Constraints i Review Focus

- Nie zmieniać historii ocen ani opublikowanej treści; nie włączać lekcji do raportu Hermesa.
- Nie ujawniać sekretów ani kluczy odpowiedzi w DTO. Nie scalać PR.
- Zamrożone statusy muszą chronić limit nowych celów, wznowienia sesji i kontynuowane cele; bieżąca projekcja pozostaje potrzebna do należnych sprawdzeń.
- Odrzucenie pojedynczego rekordu nie może odrzucić prawidłowej reszty puli.
- Testy wyścigów używają bariery, nie zakładanej szybkości bazy.
- Test wspólny musi przejść przez rzeczywiste use-case'y generacji, edycji i publikacji; DB fixture nie zastępuje kontraktu.

### Task 1: Snapshot schedulera i regresje

- [ ] RED: nowe/znane cele, jedno/dwa productive, limit nowych mimo aktualizacji projekcji; unit scheduler i integracyjny przepływ kart/notice/guided.
- [ ] GREEN: `LessonSessionContext.initialObjectiveProgress` zapisany przy starcie; `LessonScheduleInput.initialProgress` używany wyłącznie dla startu/nowości celu; fallback starych sesji z historii etapów. Pliki scheduler.ts/test.ts, lesson-sessions.ts, lesson-sessions.test.ts.
- [ ] Skorygować niewalidowany podstawowy fixture short_answer po potwierdzeniu jego luki testem kształtu; wszystkie unit + integracje lekcji GREEN.
- [ ] Commit i dziennik dowodów.

### Task 2: Walidacja transformów i surowych rekordów

- [ ] RED: brak/puste statement oraz acceptedAnswers/focus z null; integracja prawidłowy rekord + malformed.
- [ ] GREEN: pool-validation.ts wymaga statement; lesson-drafts.ts waliduje cały dereferencjonowany kształt rekordu przed konwersją.
- [ ] Unit i lesson-generation GREEN; commit i dziennik.

### Task 3: Dowody napraw i rzeczywiste przepływy

- [ ] Ustabilizować wyścig P1-5 bariery fake gradera, sprawdzić P1-3 bez modelu i przez fazę 2.
- [ ] RED→GREEN przepływu generacja→edycja tytułu→publikacja→sesja oraz dont_remember→wsparcie, bez fixture API.
- [ ] Zachować lokalną implementację P2-9, wykonać E2E oraz integracje. Commit i dziennik.

### Task 4: Karty rodzica (po zatwierdzeniu specyfikacji i planu kontraktu)

- [ ] Zatwierdzenie specyfikacji `../specs/2026-10-13-lesson-card-preview-review-fix.md`, następnie planu rozszerzenia DTO.
- [ ] RED: kontrakt katalogu zawiera wyłącznie title/body kart; E2E podglądu przed/po zmianie przykładu.
- [ ] GREEN: addytywne cards w katalogu, UI używa katalogu i lokalnych przykładów. Dokumentacja API→MCP→skill bez zmiany raportu.
- [ ] Testy i commit.

### Task 5: Weryfikacja, review i aktualizacja PR

- [ ] Unit, integration, E2E, typecheck, build, MCP oraz diff --check; zapis wyników.
- [ ] requesting-code-review, dedykowany gpt-6.1-sol xhigh (najmocniejszy dostępny poza Astra), cały zakres merge-base..HEAD z diffem lokalnym.
- [ ] receiving-code-review: blokujące uwagi RED→GREEN; verification-before-completion.
- [ ] finishing-a-development-branch: push feature/grammar-module i aktualizacja istniejącego PR #51; bez scalenia.
