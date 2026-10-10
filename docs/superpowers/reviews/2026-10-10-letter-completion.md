# Niezależny przegląd: uzupełnianie liter

Data: 2026-10-10. Recenzent: `letter_completion_review`, osobny agent uruchomiony po wyraźnej zgodzie właściciela. Tryb read-only, bez delegowania dalej i bez zmian plików, indeksu ani HEAD.

## Zakres i wymagania

BASE_SHA i HEAD_SHA: `906371e979d2426084dcfee78f7773199c9afe96`. Feature jest niezacommitowany: review obejmuje cały diff roboczy oraz nowe `LetterCompletionView.tsx` i dziennik postępu, a nie pusty zakres commitów.

Podstawa: projekt bounded zatwierdzony w czacie; `docs/SPEC.md` §12.7, §12.8, §18; `docs/architecture.md` §9.3 i uzupełnienia z 2026-10-10. Dziennik: `docs/superpowers/progress/2026-10-10-letter-completion.md`. Bez osobnej specyfikacji/planu implementacji zgodnie ze ścieżką bounded.

Wymagane zachowanie: łatwiejsza poprawka po trudnościach z pisownią, osobne pola luk, stałe znaki fragmentu, automatyczny fokus, poprawianie wpisu po zwykłym feedbacku, komplet luk przed wysłaniem. Kid UI składa pełną odpowiedź dla istniejącego API; wynik ocenia wyłącznie serwer, jako wspomagany. Review Focus: wpis i reset `taskId`, retencja zwykłej poprawki, znaki vs builder, busy/offline, dostępność, granice pakietów, prywatność, ekspozycje, współbieżność i awarie.

## Uwagi i ich obsługa

Wykonawca w ponownym self-review znalazł Important / P2: cel `42` jest akceptowany przez kontrakt i maskowany jako `_2`, lecz filtr liter odrzucał `4`. Prawdziwa próbka Chromium oraz nowy E2E potwierdziły problem. Po potwierdzonym RED filtr zmieniono na sprawdzanie pojedynczego znaku. E2E GREEN obejmuje pełną poprawną odpowiedź `42` w PostgreSQL. Niezależny recenzent zweryfikował aktualny kod i uznał tę uwagę za rozwiązaną.

**Wynik niezależnego review: brak otwartych P1/P2/P3 w zatwierdzonym zakresie.** Składanie odpowiedzi i blokady formularza działają; nie dodano DTO, importów serwerowych, ekspozycji ani ścieżek ocen. Zmiana może być integrowana po decyzji właściciela.

## Dowody

Wykonawca po poprawce uruchomił: `pnpm test:unit` 341/341, `pnpm test:e2e tests/e2e/learning-algorithm.spec.ts` 4/4, `pnpm typecheck` exit 0, `pnpm build` exit 0. Trzy wybrane regresje `kid-flow.spec.ts` (recall, odmowa mikrofonu, awaria sieci) przeszły przed poprawką filtra. Pełny zestaw E2E i integracyjny nie był uruchamiany.

Recenzent wykonał własną izolowaną diagnostykę prawdziwego `LearnScreen` i komponentów w React + Chromium: esbuild w pamięci (`write:false`), bundle wstawiony przez Playwright `page.setContent()` i `addScriptTag()`, skrypt na stdin Node, bez plików/serwera w repo. Potwierdził:

- wpis `x,d,y` wysyła `Mxnday`;
- busy wyłącza wszystkie pola;
- zwykły feedback retry zachowuje `x,d,y`;
- poprawienie pierwszej luki wysyła `Monday`;
- nowy `taskId` zeruje wszystkie luki.

Własny `git diff --check` recenzenta: exit 0. Recenzent nie powtarzał pełnego E2E, integracji ani build, aby nie kolidować z przebiegami wykonawcy.

## Jawnie odłożone poza zakres

1. Istniejąca obsługa offline/error w `LearnScreen` odmontowuje ćwiczenie i kasuje lokalny, niewysłany wpis. Recenzent potwierdził reset `x,d,y` po offline dla tego samego `taskId`. Bazowy WrittenView zachowywał się tak samo. Kontroler zachowuje wysłany payload i `clientAttemptId` przez `#resume`, więc transport retry nie duplikuje prób ani nie wymaga ponownego wpisania wysłanej odpowiedzi. Utrata dotyczy niewysłanego wpisu oraz edycji po błędnym wyniku odzyskanym przez transport retry. Wykonawca jawnie zaakceptował odłożenie ogólnej retencji offline; zatwierdzony zakres obejmuje zwykłe ponowne podejście po feedbacku, które działa.
2. Fizyczna klawiatura telefonu/tabletu nie była dostępna. Diagnostyka i E2E używają Chromium; responsywne zrzuty nie zastępują próby na urządzeniu.

Nie pozostały uwagi Critical ani Important do rozwiązania w zakresie tej funkcji. Na etapie review nie było zgody na merge/push/PR. Później właściciel zlecił utworzenie PR do `main`; zapis wykonania znajduje się w dzienniku postępu. Worktree pozostaje zachowany.
