# Status mikrofonu i niebieski feedback

## Zakres i akceptacja

Właściciel zaakceptował w rozmowie 2026-10-11 małą ikonę mikrofonu w prawym górnym rogu sesji, wyjaśnienie po dotknięciu i niebieskie tło feedbacku ponownej próby. Dostępność mikrofonu jest sygnalizowana również kształtem, a brak nagrywania nie blokuje nauki. Wskaźnik nie uruchamia nagrywania ani prośby o uprawnienie.

Ścieżka bounded: zatwierdzony projekt w czacie, bez osobnej specyfikacji i planu implementacji. Nie jest to wykonanie całego wcześniejszego planu redesignu; `executing-plans` nie dotyczy tego zadania. Wykonanie inline; delegacja wyłącznie wymaganego niezależnego review.

Baza: `dfe905b` (origin/main, redesign #42). Worktree: `kid-microphone-status`, gałąź `feature/kid-microphone-status`. Główny checkout i jego pliki pozostają osobno.

## Checklista

- [x] using-superpowers i brainstorming; projekt zaakceptowany („Podoba mi się”).
- [x] using-git-worktrees: nowy zarządzany worktree z aktualnego origin/main.
- [x] Dokumenty projektu i bieżący UI sprawdzone; bez zmiany DTO, API, bazy i reguł nauki.
- [x] Zależności: pnpm 10.34.6, frozen lockfile. Bazowe test:unit: 54 pliki, 481 testów, exit 0.
- [x] TDD: RED 6/6 testów wskaźnika dla odmowy, braku zgody, wyłączonego nagrywania, kartkówki, awarii i gotowego mikrofonu.
- [x] Implementacja, GREEN 6/6. Cała suite: 55 plików, 487 testów. Typecheck exit 0.
- [x] Pierwsze E2E: 7/7 (jasny/ciemny motyw, klawiatura/touch informacji, kontrast feedbacku >=4.5, prawdziwy PostgreSQL i dalsza pisemna nauka po odmowie). Screenshoty obejrzane. Pierwszy build exit 0.
- [x] verification-before-completion: końcowe test:unit 487/487, typecheck, build i git diff --check exit 0. Cały kid-ui-layout: 45/45 po poprawce review, plus wcześniej realna regresja odmowy mikrofonu z PostgreSQL.
- [x] requesting-code-review: cały diff od dfe905b, dedykowany reviewer gpt-6.1-sol high; raport w docs/superpowers/reviews/2026-10-11-kid-microphone-status.md.
- [x] Obsługa uwag: Important potwierdzony RED->GREEN i zweryfikowany przez reviewera. Po aktualizacji starego E2E target 1/1, osobny niezależny review całego zakresu; Critical/Important/Minor otwarte: 0.
- [x] finishing-a-development-branch: commit 568cb66, push gałęzi, PR #43 do main i przypięcie PR do zadania. https://github.com/lookassh/knowli/pull/43 . Scala właściciel przez squash; worktree zachowany.
- [ ] CI po korekcie starego E2E: oczekuje na commit/push zmiany `speech-recording-ux.spec.ts`; lokalny target 1/1.

## Decyzje

Przed przygotowaniem mikrofonu wskaźnik jest neutralny i nie obiecuje dostępności. Gotowy mikrofon jest niebieski; odmowa/awaria czerwona i przekreślona. Wyłączone nagrywanie oraz pisemna kartkówka są neutralne. Kolory informacji i feedbacku retry korzystają z istniejącego niebieskiego tokena soft; zielone/czerwone oznaczenia odpowiedzi zostają zgodne z wynikiem. Bursztynowa legenda fragmentów wymowy pozostaje czytelna i nie zmienia znaczenia.

Wcześniejsza hipoteza o automatycznym przyciemnianiu przeglądarki została skorygowana: aktualny redesign ma własne jasne i ciemne tokeny.

## TDD i review: ustalenia

Pierwszy test renderu omyłkowo umieszczony w kid-ui nie miał dostępu do react-dom/server. Zgodnie z istniejącymi testami SSR przeniesiony do apps/web/src/kid; bez dodawania zależności. Ten błąd importu nie był liczony jako dowód RED. Następny run pokazał 6 oczekiwanych assertion failures braku wskaźnika, a implementacja dała GREEN.

Niezależny reviewer gpt-6.1-sol (high, najnowszy dostępny model bez rodziny Astra) zgłosił Important: setMicrophone(false) ustawia micDenied=true, więc celowe wyłączenie musi mieć pierwszeństwo przed flagą odmowy. Potwierdzono w controllerze i testem RED: 1 fail/5 pass. Poprawiono kolejność stanów, GREEN 6/6. Dodano sprawdzenie pełnego przejścia deck toggle -> sesja. Końcowy raport review jest zapisany; po poprawce cała suite unit i layout oraz typecheck/build przechodzą.

## Weryfikacja po pierwszym PR check

PR #43 check `tests` przeszedł. Pełny E2E: 127/128, jedyny błąd był w starej asercji widoczności banera, nie w aplikacji. Główny kod UI nie zmienił się w tej korekcie. `tests/e2e/speech-recording-ux.spec.ts` sprawdza teraz hidden -> kliknięcie statusu -> visible -> zamknięcie i pozostawienie aktywnej ścieżki pisemnej. Lokalnie: target Playwright 1/1, cała suite unit 487/487, `git diff --check` exit 0. Osobny niezależny read-only review poprawki i całego zakresu bez otwartych uwag znajduje się w addendum raportu review.

## Końcowe sprawdzenia i ograniczenia

Polecenia: npx --yes pnpm@10.34.6 test:unit; typecheck; build; test:e2e tests/e2e/kid-ui-layout.spec.ts; wybrana regresja tests/e2e/kid-flow.spec.ts; git diff --check. E2E miały własny UMIEM_TEST_RUN_ID=mic-status-1011 i port 24711. Wykonano pomiar i obejrzano screenshoty obu motywów z syntetycznymi danymi. Reviewer dodatkowo zmierzył nagłówek 360x640 przy tekście 100%/200%.

Cały run PR #43 uruchomił 128 testów E2E: 127 przeszło, 1 nie, bo test `speech-recording-ux.spec.ts` oczekiwał starego widocznego banera po odmowie mikrofonu. Log dowodził, że locator znalazł nowy tekst wewnątrz zamkniętego `<details>`. Przyczyna: test nie wykonywał nowego, zamierzonego kroku dotknięcia ikony. Produkcyjny stan odmowy oraz dalsza ścieżka pisemna działają; lokalny target po korekcie oczekuje dostępnej nazwy ikony, sprawdza ukryty komunikat, otwiera i zamyka szczegół, a potem sprawdza pisemne ćwiczenie. Po niezależnym review testu poprawka trafi do PR i ponowię CI.

Nie zmieniano kodu produkcyjnego w odpowiedzi na failed CI, tylko przestarzałe oczekiwanie testu E2E. Fizyczny Galaxy S25/PWA/systemowa klawiatura i rzeczywiste providery mowy nie były sprawdzane. Nowy worktree pozostaje do iteracji PR; niezwiązanych worktree nie sprzątano.
