# Przygotowanie projektu i planu UX mowy — checklista

Data: 2026-10-10. Zakres tego zadania: **dokumentacja do przeglądu, bez implementacji**.

## Kontekst i artefakty

- Baza: `b7f5f09c2144b1a484e2b58cd713513d0a63da83`, main; gałąź dokumentacji `docs/speech-recording-ux-plan`.
- Projekt: `docs/superpowers/specs/2026-10-10-speech-recording-ux-design.md`.
- Plan: `docs/superpowers/plans/2026-10-10-speech-recording-ux.md`.
- Istniejące niezwiązane pliki `.zcodeignore` i `mock-summary-screenshot.png` pozostają poza zmianami/stagingiem.

## Workflow

- [x] using-superpowers/brainstorming: przeczytane aktualne instrukcje, analiza istniejącego przepływu i statusów; kierunek UX zaakceptowany przez właściciela w rozmowie.
- [x] Klasyfikacja architectural: rozszerzenie publicznego feedbacku, odsłuch klient–serwer i port mediów; nie nazywać tego wyłącznie kosmetyką ekranu.
- [x] writing-plans: mapa plików, siedem zadań, interfejsy, testy RED→GREEN, kryteria i tryb inline.
- [x] Projekt i plan razem na wyraźną prośbę właściciela. Dostosowanie kolejności brainstorming: zapisany projekt nie jest jeszcze zaakceptowany; plan przygotowany do wspólnego przeglądu, nie do wykonania. Implementacja czeka na zatwierdzenie obu artefaktów.
- [x] Sprawdzono izolację i istniejące worktree. Dokumenty powstają na osobnej gałęzi bieżącego checkoutu, bez tworzenia nowego worktree i bez instalacji zależności; zakres dokumentacyjny nie wymaga baseline aplikacji ani RED. Przyszłe wykonanie ma obowiązkowy setup using-git-worktrees/executing-plans.
- [x] Self-review pokrycia projektu, spójności typów i plików, linków oraz `git diff --check`: trzy dokumenty, 24 istniejące ścieżki kodu/testów i link do projektu PASS. Poprawiono pierwotnie błędną mapę numerów R01–R07 przed niezależnym review.
- [x] requesting-code-review: dedykowany niezależny recenzent dokumentacji, `gpt-6.1-sol` / `xhigh`, bez GPT Astra; dwie rundy, końcowo gotowa do PR, 0 Critical/Important. Ostatnia Minor redakcyjna poprawiona i zweryfikowana własnym przeglądem; raport zachowuje tę różnicę.
- [x] verification-before-completion: końcowa kontrola czterech dokumentów, lokalnych linków, 24 istniejących ścieżek, braku TODO/TBD i zakresu wyłącznie Markdown; git diff --check PASS. Nie wykonano testów aplikacji dla dokumentacji.
- [x] finishing-a-development-branch: commit dokumentacji `6f3f11f`, push gałęzi do origin i [PR #36 do main](https://github.com/lookassh/knowli/pull/36), dołączony do wątku. Bez scalania; scala właściciel przez squash. Zamiast testów produktu kontrola treści/linków/diff zgodnie z wyjątkiem AGENTS.md. Checkout nie jest worktree; gałąź pozostaje do review.
- [ ] Zatwierdzenie zapisanej specyfikacji i planu przez właściciela — **jeszcze nie udzielone**.
- [ ] Implementacja — **nie rozpoczęta**, osobny dziennik `2026-10-10-speech-recording-ux-implementation.md` przy wykonaniu.

## Weryfikacja i review

Testy aplikacji z wcześniejszej analizy (31 wybranych testów) nie są dowodem wdrożenia tego projektu. Ten zakres zmienia wyłącznie pliki Markdown.

- Pierwsza próba recenzenta zakończyła się limitem usługi, bez raportu; nie zaliczono jej jako review. Po poleceniu właściciela „Kontynuuj” ten sam dedykowany recenzent ponowił przegląd.
- Runda 1: niezależny `gpt-6.1-sol`/`xhigh`, cały niezacommitowany diff projektu/planu/checklisty kontra kod bazowy. Critical: 0; Important: 4; Minor: 1. Werdykt „po poprawkach”.
- receiving-code-review: wszystkie 4 Important oraz Minor zweryfikowano w aktualnym kodzie/typach i przyjęto. Uzupełniono unieważnianie fetch/blob odtwarzacza, pełne ekspozycje wariantów i heardText, ok+null STT, dopuszczenie Mispronunciation przy wiarygodnych fonemach oraz neutralny null feedback. Brak zmian aplikacji/RED — poprawki dotyczą planowanych zadań i testów.
- Runda 2: wszystkie Important zamknięte; dodatkowy guard anulowanego odsłuchu względem audio_played i drobna mapa plików/RED preferencji także doprecyzowane. Werdykt niezależny: dokumentacja gotowa do PR; bez nierozwiązanych uwag po redakcyjnym self-review.
- Raport i działania: `docs/superpowers/reviews/2026-10-10-speech-recording-ux-plan.md`. Dostarczono PR #36; zatwierdzenie dokumentów i implementacja nadal nie rozpoczęte. Końcowy wpis integracji jest tylko zapisem wyniku operacji Git/GitHub po review, bez zmiany projektu i planu.
