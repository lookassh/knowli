# Poprawki czterech testów E2E — 2026-10-10

Zakres bounded: wyłącznie istniejące testy; bez zmiany aplikacji, API, danych ani algorytmu. Właściciel zlecił naprawę po przedstawieniu diagnozy i kierunku korekt w tym czacie. Wykonanie inline, bez delegacji i bez osobnego planu implementacji dla ścieżki bounded.

- [x] `using-superpowers`, `systematic-debugging`: diagnoza z poprzedniego etapu, odczyt logów i PostgreSQL.
- [x] `brainstorming`: ograniczony zakres i kierunek korekt; polecenie „napraw tto” po diagnozie jest zgodą na naprawę tych czterech ustaleń.
- [x] `using-git-worktrees`: istniejący worktree 6472, detached HEAD, bez submodule i bez zmian użytkownika. Instalacja zależności zbędna: wcześniejszy pełny przebieg je wykorzystał.
- [x] RED: `pnpm test:e2e --timeout 60000 --trace retain-on-failure` na bazie `906371e` — 53 PASS / 4 FAIL. Potwierdzone przyczyny: brak nagrywania w zadaniu nowej sesji; stary `/learn`; niepoprawne polecenia tworzenia/publikacji zestawu; odpowiedź obrazu przechwycona jako audio.
- [x] `test-driven-development`: istniejące scenariusze stanowią regresje, bez testów tekstu źródłowego ani produkcyjnych zmian. Zachować asercje: zatrzymanie strumienia i nagrywanie w kolejnej sesji, tekstowe letter_completion, nawigację z opublikowanym zestawem, odtwarzanie właściwego audio.
- [x] Minimalne korekty czterech scenariuszy, bez osłabiania asercji: istniejący `driveUntil` prowadzi do zadania z nagrywaniem; aktualny `/`; poprawne DTO i oczekiwanie na TTS przed publikacją; dokładny asset ID odtwarzanego audio.
- [x] Celowane GREEN oraz pełny zestaw E2E: 4/4 i 57/57, exit 0.
- [x] Typecheck aktualnego kodu i `git diff --check`: exit 0.
- [x] `requesting-code-review`: osobny self-review całego diffu — brak zgody na delegację; wynik poniżej.
- [x] `verification-before-completion` i `finishing-a-development-branch`: odczytane wyniki końcowe, potwierdzony istniejący worktree i detached HEAD. Integracji nie zlecono; pozostawiono niezacommitowane zmiany oraz worktree. Menu integracji pominięto, ponieważ zakres polecenia kończy się na naprawie i weryfikacji; nie wykonano merge/push/PR/deploy ani cleanup worktree.

Review Focus: testy nadal wykrywają brak cleanup nagrywania, blokowanie nagrywania w nowej sesji, niepoprawny przepływ letter_completion, utratę przypisanego zestawu oraz uszkodzone/niepoprawne audio. Fixture korzystają z prawdziwego API i istniejących fake providerów, bez zmieniania historii ocen ani zegara produkcji.

Dowody RED z poprzedniego etapu zapisano w `test-results/popup-suite.log` i śladach Playwright. Przed nowymi przebiegami zachować kopię, ponieważ Playwright czyści `test-results`.

## Wyniki w trakcie pracy

- Celowane E2E czterech scenariuszy: 4/4 PASS, 1,6 min, exit 0; nagrywanie w drugiej sesji przeszło rzeczywisty scheduler i UI.
- `pnpm typecheck`: exit 0. Po tym przebiegu poprawiono tylko literal statusu nowego setupu na 201 (istniejący rodzic daje 409), zgodnie z endpointem; końcowa weryfikacja obejmie aktualny plik.
- Nie dodano testów implementujących testy. RED to rzeczywiście nieudane istniejące scenariusze; GREEN zachowuje ich wymagania produktu.
- Log RED zachowano poza czyszczonym katalogiem Playwright w lokalnym archiwum diagnostycznym. Log celowanego GREEN również zachowano przed pełnym przebiegiem.

## Review całego zakresu

Tryb: **self-review — brak zgody na delegację**. To dostosowanie workflow repozytorium, nie niezależny przegląd.

Cel i wymagania: naprawić cztery błędy wykryte w diagnozie, zachować kontrolę cleanup mikrofonu i ponownego nagrywania, tekstowe letter_completion, przejście do nauki z przypisanym opublikowanym zestawem i poprawne audio przed/po edycji. Źródła: `docs/SPEC.md`, `docs/architecture.md`, `docs/implementation-plan.md`, publiczne schematy zestawów oraz diagnoza w tym czacie.

Zakres: BASE_SHA = aktualny `origin/main` przed commitem (`86b9ca1511f35e38dfc63d34203884a3c5fce710`); branch został przestawiony na tę bazę; przegląd obejmuje **cały niezacommitowany diff** czterech plików E2E oraz checklistę, nie ostatni commit.

- Nagrywanie: prowadzenie sesji przez istniejące ćwiczenia nie podmienia schedulera; końcowa asercja nadal wymaga realnego stanu nagrywania. Zatrzymanie ścieżki na podsumowaniu nie daje fałszywego PASS — późniejsza asercja wymaga przycisku nagrania.
- Nawigacja: poprawne DTO, kontrola statusów, co najmniej jeden zatwierdzony zasób audio, publikacja z aktualnym numerem edycji i przypisanie sprawdzane przed UI. Oczekiwanie nie ma sztucznego stałego sleep.
- Audio: dokładny asset ID dla rewizji i roli; równoległy obraz nie spełnia predykatu. Status i MIME pozostają asercjami, więc niepoprawne audio nadal powoduje FAIL.
- Letter completion: zmieniony wyłącznie adres hosta; wszystkie asercje rodzaju zadania, braku mikrofonu, pisemnej odpowiedzi i ukończenia pozostały.
- Granice pakietów, prywatność i współbieżność: brak zmian produkcji, publicznych kontraktów, ocen, danych rodzinnych i providerów. Fixture używają syntetycznej bazy oraz istniejącego API.
- Podczas przeglądu wykryto i poprawiono oczekiwany status pierwszego setupu rodzica na 201; drugie wywołanie daje 409. Końcowe testy korzystają z poprawionego pliku.

Uwagi Critical/Important/Minor: brak pozostałych. Pominięte zachowania: realny mikrofon na urządzeniu dziecka i kalibracja wymowy — zadanie zmienia wyłącznie automatyczne testy z fake mediami. Build i testy domeny/integracji nie są potrzebne do potwierdzenia tych korekt: kod aplikacji i schemat bazy są bez zmian; wymagane sprawdzenia to pełne E2E i typecheck.

## Końcowe dowody

- `UMIEM_TEST_RUN_ID=e2e-fixes-full-6472`, porty 24872/34872: `pnpm test:e2e --trace retain-on-failure` → **57/57 PASS**, 4,0 min, exit 0. Domyślne timeouty repozytorium pozostały bez zmian.
- `pnpm typecheck` po ostatniej korekcie → exit 0.
- `git diff --check` → exit 0.
- PostgreSQL, web i worker przebiegu testowego posprzątane przez global teardown; kontrola portów i nazwanego kontenera nie wykazała pozostałych procesów tego przebiegu.
- Artefakty: `test-results/e2e-fixes-{target,full,typecheck}.log`. RED i początkową diagnozę zachowano poza katalogiem czyszczonym przez Playwright.
- Assessment: uzgodniona naprawa gotowa; nie ma pozostałych uwag wymagających poprawy. Ograniczenie review: przegląd własny zamiast niezależnego, zgodnie z zasadą delegacji w AGENTS.md.

## Weryfikacja przed PR na aktualnej bazie

- `origin/main` przed commitem: `86b9ca1511f35e38dfc63d34203884a3c5fce710`; branch `feature/e2e-popup-reliability` bazuje na tym commicie.
- `pnpm test:unit`: **347/347 PASS** (42 pliki).
- `pnpm test:integration`: **150/150 PASS** (15 plików).
- `pnpm test:e2e`: **57/57 PASS**, 3,8 min.
- `pnpm typecheck`: exit 0.
- `git diff --check`: exit 0.