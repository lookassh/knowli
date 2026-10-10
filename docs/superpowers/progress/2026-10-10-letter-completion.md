# Uzupełnianie liter — checklista wykonania

Zakres bounded zatwierdzony w czacie 2026-10-10: osobne pola w lukach istniejącego `letter_completion`, wyłącznie poprawka po trudnościach z pisownią. Dziecko wpisuje brakujące litery, klient składa pełne słowo dla obecnego API. Widoczne litery pozostają wsparciem. Zatwierdzono automatyczne przejście do następnej luki, możliwość poprawienia każdej litery i blokadę sprawdzenia niekompletnej odpowiedzi.

- [x] `using-superpowers` i `brainstorming`: kontekst, klasyfikacja bounded, ustalenie momentu ćwiczenia, projekt w czacie, zatwierdzenie właściciela.
- [x] `using-git-worktrees`: istniejący linked worktree `8efc/knowli`, detached HEAD, bez nadrzędnego submodułu; początkowo brak zmian.
- [x] Setup: `pnpm install --frozen-lockfile`; bazowe `pnpm test:unit`: 42 pliki, 341 testów, exit 0.
- [x] TDD: test zachowania w przeglądarce i potwierdzone RED.
- [x] Minimalna implementacja, testy składania odpowiedzi i potwierdzone GREEN.
- [x] Regresje: pełne unit, adekwatne E2E, typecheck i build.
- [x] `requesting-code-review`: osobny self-review całego diffu — brak zgody na delegację.
- [x] `verification-before-completion`: aktualne dowody i kontrola checklisty.
- [x] `finishing-a-development-branch`: weryfikacja i wykrycie istniejącego worktree z detached HEAD; wybór integracji przedstawiony właścicielowi. Worktree i niezacommitowane zmiany zachowane do decyzji; brak autoryzacji merge/push/PR.

Ścieżka bounded zgodnie z `brainstorming` nie wymaga dokumentu specyfikacji ani planu implementacji. `writing-plans`/`executing-plans` nie dotyczą tego zakresu: wykonujemy zatwierdzony projekt w czacie, bez istniejącego planu. Nie delegujemy pracy.

## Dowody i odstępstwa

Test przeglądarkowy sprawdzi prawdziwy ekran i API przy syntetycznym materiale oraz fake-providerach. Wyłapie pozostawienie pola pełnego słowa, wysłanie samych luk zamiast pełnej odpowiedzi, przedwczesne wysłanie niekompletnej odpowiedzi i utratę możliwości poprawienia litery.

- Pierwszy przebieg E2E zatrzymał się na starym `/learn` (404), przed oceną nowego zachowania. `systematic-debugging`: odczyt logu HTTP, porównanie istniejących tras i działających testów wskazały `/kids/[childId]/learn`. Skorygowano wyłącznie adres w modyfikowanym teście. Ten przebieg nie jest dowodem RED funkcji.
- RED po poprawieniu wejścia: `pnpm test:e2e tests/e2e/learning-algorithm.spec.ts`, `UMIEM_TEST_RUN_ID=8efc-letters`, `UMIEM_E2E_PORT=24861`. Trzy scenariusze (`Monday`, `New York!`, `A`) nie przeszły, ponieważ ekran miał 0 pól luk zamiast odpowiednio 3, 3, 1. Exit 1, przed implementacją widoku.
- GREEN tej samej komendy po implementacji: 3/3, exit 0. Sprawdzono niekompletny wpis i usunięcie litery, auto-fokus, błędną próbę, poprawienie pierwszej luki z zachowaniem pozostałych, pełne odpowiedzi w PostgreSQL i `independent=false` wszystkich ocen. Spacje, interpunkcja i jednoliterowe słowo są objęte scenariuszami. Mikrofon włączony w sesji nie pojawia się w ćwiczeniu.
- `pnpm test:unit`: 42 pliki, 341/341, exit 0 po implementacji.
- `pnpm typecheck`: cały workspace, exit 0 po implementacji.
- `pnpm build`: produkcyjny Next.js build, exit 0.
- QA wizualne: odczytane zrzuty `Monday` przy szerokości 390 i `New York!` przy 768; wszystkie scenariusze dodatkowo sprawdzają brak przewijania poziomego przy obu szerokościach. Pola 48×60 px, litery i przyciski widoczne. Test w desktopowym Chromium nie potwierdza zachowania fizycznej klawiatury telefonu/tabletu.
- Runner E2E zgłasza istniejące ostrzeżenia `NO_COLOR`/`FORCE_COLOR` i Next dev cross-origin; nie wpływają na wynik testów. Świat testowy używa własnego identyfikatora, bazy i fake-providerów; nie dotyka danych rodziny.
- Wybrane regresje: `pnpm test:e2e tests/e2e/kid-flow.spec.ts --grep 'recall z należnego|odmowa mikrofonu|błąd sieci'`, `UMIEM_TEST_RUN_ID=8efc-letters-regression`, `UMIEM_E2E_PORT=24861`: 3/3, exit 0. Obejmują pełną odpowiedź pisemną, „Nie pamiętam”, pominięcie, przejście bez mikrofonu i brak fałszywego sukcesu po awarii sieci. Łącznie wykonano 6 scenariuszy E2E w dwóch przebiegach GREEN.
- Końcowy `git diff --check` i odczyt Git/workflow służą kontroli zakresu po zakończeniu testów. Wszystkie zmiany produktu były objęte odczytanymi wynikami testów, typecheck i build; później uzupełniono wyłącznie niniejszy dziennik.

## Osobny self-review całego zakresu

Tryb: **self-review — brak zgody na delegację**. Dostosowanie do AGENTS.md; przegląd nie jest niezależny.

Cel/wymagania: zatwierdzony projekt w czacie oraz SPEC §12.7, §12.8, §18; architecture §9.3 i opis `letter_completion`. Dokument specyfikacji ani plan implementacji nie są wymagane w ścieżce bounded. Pełny zakres: baza `906371e979d2426084dcfee78f7773199c9afe96`, HEAD ten sam, **cały diff niezacommitowanych zmian oraz nowe pliki**, nie ostatni commit.

Review Focus: uzupełnianie samych luk, składanie odpowiedzi, retencja wpisu podczas ponownego podejścia i reset na nowym `taskId`, dostępność dotykowa i etykiety, blokada niekompletnego/busy formularza, granice pakietów, prywatność, kwalifikacja ze wsparciem i zachowanie istniejącego cyklu serwera.

Przeczytano osobno nowy komponent, dispatcher, modyfikację WrittenView, komunikaty, CSS, test E2E i dokumentację, a także istniejący cykl wsparcia, zapis ekspozycji przed HTTP i kwalifikację prób. Wpisy pól są jedyną edytowalną treścią; stałe znaki trafiają do odpowiedzi w pierwotnej kolejności. `key=taskId` izoluje stan kolejnych zadań, ta sama instancja pozostaje podczas retry. Wszystkie hooki występują przed warunkowym return. Klient nie ma klucza ani oceny poprawności, nie importuje serwera ani Next. Dotychczasowa blokada sesji, zapis ekspozycji, oceny i limit wsparcia pozostają autorytatywne. Wynik E2E potwierdza brak niezależnych ocen.

Critical: brak. Important: brak. Minor: brak uwag do odłożenia. Ograniczenie dowodów: klawiatura rzeczywistego telefonu/tabletu nie była dostępna; nie wykonano niezależnego review ani pełnego zestawu E2E/integracyjnego. Nie zmieniano polityki, schedulera ani bazy, dlatego osobny przebieg wszystkich testów integracyjnych nie jest wymagany do tej zmiany UI. Regresje istniejącego ekranu pisemnego, odmowy mikrofonu i awarii sieci sprawdzane są osobnym, wybranym przebiegiem E2E.

## Ponowne review na polecenie właściciela

Właściciel wywołał `requesting-code-review`. Ponownie odczytano aktualny cały diff i nowe pliki; baza i HEAD nadal `906371e979d2426084dcfee78f7773199c9afe96`. Zgodnie z AGENTS.md zapytano o wyraźną zgodę na delegację niezależnego recenzenta. Do odpowiedzi wykonywany jest własny przegląd; zgody nie zakładamy.

Znaleziono **Important / P2**: filtr `^\p{L}$` w `LetterCompletionView.tsx` odrzuca cyfrę ujawnioną jako luka przez istniejący builder. `VocabularyItemInputSchema` dopuszcza cel `42`, a `buildLetterFragment("42")` zwraca `_2`. Odtworzono problem w prawdziwym widoku Chromium z syntetycznym Kid API: wpis `4` pozostaje pusty i „Sprawdź” jest zablokowane. Skrypt diagnostyczny znajduje się poza repozytorium w `C:/Users/looka/.codex/tmp/knowli-8efc-review-probe.cjs`; serwer diagnostyczny port 24862 zatrzymano po weryfikacji jego PID i command line.

`receiving-code-review`: uwaga przyjęta po porównaniu kontraktu, buildera i zachowania przeglądarki. Potrzebna minimalna poprawka filtra pojedynczego znaku; nie zmienia API, schedulera ani oceny serwerowej. Nowy scenariusz `42` dodano do istniejących E2E przed poprawką kodu.

- [x] RED regresji `42`.
- [x] Minimalna poprawka i GREEN.
- [x] Regresje, typecheck/build i końcowy przegląd poprawki.
- [x] Wynik niezależnego recenzenta po wyraźnej zgodzie właściciela.

RED: `pnpm test:e2e tests/e2e/learning-algorithm.spec.ts --grep '42'` z własnym `UMIEM_TEST_RUN_ID=8efc-letters-review`, port 24861, exit 1. Wpis `4` zamiast poprzedniego `x` był odrzucany i serwer ponownie oceniał błędne `x2`; test oczekujący poprawnego wyniku odtworzył problem.

Poprawka: filtr sprawdza jeden znak, zamiast narzucać klasę liter. Odpowiedź wciąż ocenia serwer, a każdy stały znak fragmentu pozostaje nieedytowalny. GREEN: cały `learning-algorithm.spec.ts`, 4/4, exit 0, łącznie z odpowiedziami `x2` i `42` utrwalonymi w PostgreSQL oraz wszystkimi ocenami wspomaganymi. Po poprawce ponownie `pnpm test:unit` 341/341, `pnpm typecheck` exit 0, `pnpm build` exit 0 i `git diff --check` bez błędów.

Właściciel odpowiedział „Tak, niezależny recenzent”. Po tej zgodzie uruchomiono jednego recenzenta `letter_completion_review`, z pustym kontekstem początkowym i opisem całego diffu, zatwierdzonych wymagań, testów oraz przyjętej poprawki. Recenzent pracuje read-only; kod nie jest zmieniany podczas jego przeglądu.

Niezależny recenzent zakończył review całego zakresu: **brak otwartych P1/P2/P3**, poprawka `42` uznana za rozwiązaną. Własna diagnostyka React + Chromium potwierdziła pełną odpowiedź, busy, retencję zwykłego feedback retry, poprawienie jednej luki i reset nowego `taskId`. Zweryfikowano też istniejące ograniczenie offline: znika niewysłany lokalny wpis, ale kontroler zachowuje wysłany payload i `clientAttemptId`, więc transport retry nie duplikuje próby. Wykonawca zaakceptował jawne odłożenie ogólnej retencji offline poza zatwierdzonym zakresem. Pełny raport i rozdzielenie dowodów wykonawcy/recenzenta: `docs/superpowers/reviews/2026-10-10-letter-completion.md`.

## Przygotowanie PR do main

Właściciel wywołał `finishing-a-development-branch` i polecił „utworz PR do main”. Jest to zgoda na commit, push i utworzenie PR; nie na scalenie. Utworzono lokalną gałąź `feature/fill-missing-letters` w istniejącym worktree.

Po `git fetch origin main` docelowy `origin/main` wskazywał `86b9ca1511f35e38dfc63d34203884a3c5fce710` (poprawka odzyskiwania mikrofonu). Jej osiem plików nie pokrywa się z plikami tej funkcji. Gałąź zaktualizowano przez fast-forward z main, zachowując niezacommitowany feature; lokalnego main nie modyfikowano. Diff feature'u pozostaje taki sam jak przy niezależnym review.

Aktualna weryfikacja przed commitem/PR: `pnpm test:unit` 347/347, wybrane E2E `learning-algorithm.spec.ts` 4/4 z `UMIEM_TEST_RUN_ID=8efc-letters-pr`, exit 0. Początkowy równoległy typecheck kolidował z czyszczeniem/regeneracją `.next/types` przez serwer Next dev podczas E2E (TS6053 wskazujące wyłącznie pliki generowane). Diagnozę potwierdził odczyt include w tsconfig i zmieniającego się katalogu `.next/types`; build i ponowny typecheck wykonujemy sekwencyjnie po zakończeniu E2E.

Wybrany workflow końcowy: jeden commit feature'u, zwykły push nowej gałęzi i PR do `main`. Worktree pozostaje do obsługi PR. Przyszłe scalenie wymaga osobnego polecenia i Squash and merge zgodnie z AGENTS.md.

Sekwencyjne `pnpm build` i `pnpm typecheck` na aktualnej bazie zakończyły się exit 0. Końcowa kontrola obejmuje diff feature'u względem `origin/main`, cały zakres stage, spójność dokumentacji oraz `git diff --check`. Wprowadzone od zakończenia niezależnego review zmiany dotyczą wyłącznie zapisu decyzji publikacji i aktualnej weryfikacji w dokumentacji.

## Aktualizacja PR po nowym main

Utworzono PR #5, gałąź `feature/fill-missing-letters`, commit feature'u `05bb81e8db19477402fe44229f352b1850eafbcb`. Przy wcześniejszym końcowym odczycie GitHub zgłaszał `mergeable=true` względem main `c67a60e`.

Po zgłoszeniu właściciela sprawdzono ponownie API i `git fetch`: main przesunął się do `65cc96a` (PR #4 stabilizujący E2E). `git merge-tree --write-tree HEAD origin/main` potwierdził jeden konflikt w `tests/e2e/learning-algorithm.spec.ts`: nowy main poprawia stare `/learn` na `/`, podczas gdy feature już używa istniejącej trasy `/kids/${child.id}/learn`. Przyczyną nie jest konflikt kodu aplikacji.

Rozwiązanie przy aktualizacji gałęzi PR: zachowanie trasy konkretnego profilu z feature'u oraz wszystkich pozostałych zmian main. To ta sama trasa sprawdzona wcześniej w czterech scenariuszach. Zwykła aktualizacja historii gałęzi PR bez force-push; main pozostaje docelową gałęzią i nie jest scalany przez agenta.

- [x] Reprodukcja i diagnoza konfliktu.
- [x] Minimalne rozwiązanie jednego hunku.
- [x] Unit i adekwatne E2E po uwzględnieniu main.
- [x] Niezależne review rozwiązania konfliktu.

Weryfikacja po aktualizacji: `pnpm test:unit` 347/347 i siedem wybranych E2E (cztery warianty uzupełniania liter oraz recall, odmowa mikrofonu, awaria sieci) 7/7, exit 0. Przebieg E2E używał własnego `UMIEM_TEST_RUN_ID=8efc-letters-conflict`, port 24861. Niezależny recenzent `letter_completion_review` sprawdził cały wynik względem nowego main i aktualizację względem poprzedniego HEAD: brak otwartych uwag, wszystkie pozostałe zmiany main zachowane, kod produktu niezmieniony, brak niezałatwionych wpisów konfliktu w indeksie, `git diff --cached --check` przechodzi.

Publikacja aktualizacji odbywa się przez commit synchronizacji i zwykły push; końcowy stan PR i SHA weryfikowany jest bezpośrednio w GitHub oraz przez `git ls-remote`, zamiast opierać się na poprzednim statusie PR.

Ponowny `pnpm typecheck` po zakończeniu E2E: exit 0. Build nie był powtarzany w tej synchronizacji: `git diff HEAD -- packages apps` potwierdził brak zmian w kodzie produktu względem już zweryfikowanego produkcyjnego buildu; nowe main zmieniło wyłącznie instrukcje, dokumentację i testy E2E.
