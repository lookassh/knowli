---
title: 'Szybkie wejście do zestawów bez rundy dnia'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['AGENTS.md', 'docs/architecture.md']
baseline: 'b997b947fc1a3a4e57b270a2030cbcedea224590'
baseline_commit: 'b997b947fc1a3a4e57b270a2030cbcedea224590'
implementation_model: 'gpt-6-luna'
implementation_reasoning: 'medium'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR #80 opóźnił wybór zestawów przez planowanie rund i odtwarzanie agregatów nagród. Właściciel usuwa rundę dnia.

**Approach:** Całkowicie usunąć funkcję rundy z UI, backendu, planera, wejściowych kontraktów API i osobnego raportu. Zachować wyłącznie minimalny odczyt historycznych danych. Czytać gotowe projekcje nagród i wyświetlać zestawy bez oczekiwania na odświeżenie profili. Doprecyzowanie właściciela zatwierdzone 2026-10-17.

## Boundaries & Constraints

**Always:** Zachować historię, punkty, zasady nauki, Xbox i izolację dzieci. Projekcje odtwarzalne z historii; zapis atomowy i idempotentny. Zachować historyczne DTO `daily_round`. Aktywne rundy zakończyć jako `ended`, bez naliczania niedokończonych kroków.

**Never:** Nie przeliczać historycznych nagród na nowo; nie zmieniać starych migracji ani ocen. Bez deploy/push/merge. Nie przenosić pełnego skanowania historii z odczytów do każdego zapisu.

## I/O & Edge-Case Matrix

| Stan | Wynik |
|---|---|
| Powolne/błędne odświeżenie profili | Gotowe zestawy widoczne; ostatnie potwierdzone profile dostępne |
| Retry rozliczenia/decyzji Xbox | Brak powtórnego przyrostu lub zwrotu |
| Północ/DST/zmiana strefy | Sumy według daty i strefy przypiętej sesji |
| Stara aktywna runda | Zakończona; zwykła nauka dostępna; historia zachowana |
| Stary klient żąda rundy | Błąd walidacji; brak nowej sesji |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/kid.ts`: usunąć pętlę preflightu przed filtrowaniem zestawów; profile dziś liczą pełną historię każdego dziecka.
- `packages/server/src/modules/reward-activity.ts`: `settleRewardActivity`, `readKidRewardSnapshot`, `requestXboxPack`, `decideXboxRewardRequest`.
- `packages/server/src/modules/{sessions,attempts,events,daily-round}.ts`, `modules/lessons/`: obsługa rund w obu silnikach.
- `packages/contracts/src/{kid,parent-work-card,messages}.ts`, `packages/kid-ui/src/`, `apps/web/src/parent/WorkCardPanel.tsx`: wejścia, UI i historia.

## Tasks & Acceptance

**Execution:**

- [x] 1. Na osobnej gałęzi od baseline sprawdzić stan, skrypty i zależności. Nie instalować istniejących zależności. Zapisać porównywalny pomiar wejścia oraz zapytań na fikcyjnej historii.
- [x] 2. `packages/server/src/db/schema.ts`, nowa migracja i `drizzle/meta/`: dodać projekcje dziecka (punkty, zaliczone ms/reszta, liczba kwalifikujących i zużytych pakietów), zestawu (punkty), dnia `(childId, timezone, localDate)` (ms). FK kaskadowe do dziecka; stabilne ID zestawu. Backfill punktów z `awardedPoints`, reszty z sumy `creditedMilliseconds`; dni osobno z rozliczonych segmentów i kontekstu sesji. Pakiety sumować jako progi 1800000 ms każdego dnia; zużycie z pending/fulfilled. Nie przyznawać historycznych punktów z segmentów.
- [x] 3. `reward-activity.ts`: pod istniejącą blokadą dziecka aktualizować projekcje tylko po skutecznym INSERT settlementu. Dzielić wyłącznie nowe segmenty, aktualizować przekroczone progi dnia. Resztę czytać z projekcji. Rezerwacja Xbox zużywa pakiet/30 punktów raz; fulfilled bez drugiego obciążenia; rejected zwraca raz. Wyeliminować pełny skan segmentów także przy rezerwacji.
- [x] 4. `reward-activity.ts`, `kid.ts`: odczyty projekcji i ograniczony odczyt ostatniej/pending prośby; profile i punkty zestawów pobierać zbiorczo. Brak projekcji nowego dziecka oznacza zero. Dodać jawny tryb odbudowy dla pojedynczego dziecka pod tą samą blokadą, bez leniwego backfillu w GET.
- [x] 5. `sessions.ts`, `daily-round.ts`, kontrakty i UI z Code Map: usunąć moduł rundy, start, dostępność, preflight, gałęzie planowania/oceniania rund, przyciski, osobny panel i pole `dailyRound` raportu rodzica. Usunąć testy funkcji i zastąpić regresjami jej wycofania. Nowa migracja wygasza aktywne rundy, dezaktywuje strumienie i unieważnia autoryzacje playbacku; bez settlementu oczekujących segmentów. Minimalny odczyt historycznego trybu pozostaje. Stare bezpośrednie żądania do zadań wygaszonej rundy nie mogą uruchamiać ocen ani naliczeń. Nie usuwać historii ani starej migracji 0014.
- [x] 6. `session/session-controller.ts`: po `listDecks` od razu ustawić ekran; profile odświeżyć w tle. Zachować epoch, wybór profilu i obsługę błędów. Świeże ustawienia muszą być uwzględnione przed startem nagrywania; stara odpowiedź nie może nadpisać nowego ekranu.
- [x] 7. Testy poniżej i dokumentacja: oznaczyć spec rundy jako wycofaną, zaktualizować `docs/architecture.md`, `docs/folder-structure.md` oraz decyzję API→MCP→skill; `learning-overview` pozostaje bez nagród i lekcji.

**Acceptance Criteria:**

- Given duża historia, when otwieramy zestawy, then odczyty nagród nie skanują ledger/segmentów, a lista nie uruchamia planera rund.
- Given istniejące dane, when migrujemy/odbudowujemy projekcje, then wynik odpowiada dotychczasowym punktom, saldu, dniom i pakietom.
- Given współbieżność i retry, when rozliczamy zadania i Xbox, then stan pozostaje zgodny z historią po commit i rollback.
- Given ukończona migracja, when dziecko wybiera profil, then brak rundy i blokady przez dawną rundę; nauka i sprawdziany działają.

## Implementation Notes

- Dodano projekcje nagród dziecka, zestawu i dnia oraz jawną odbudowę projekcji dla pojedynczego dziecka. Migracja `0016` buduje je z settlementów i rozliczonych segmentów, zachowuje historyczne `awardedPoints` (w tym zero), dzieli czas według strefy sesji, a nieprawidłową strefę zastępuje `Europe/Warsaw`. Aktywne rundy kończy bez rozliczania oczekujących segmentów i unieważnia ich playback.
- Usunięto aktywną rundę z UI, kontraktów startowych, silników sesji i raportu rodzica; historyczne `daily_round` pozostaje odczytywalne. Opóźniona ocena audio/finalizacja starego trybu nie tworzy nowej oceny ani naliczenia.
- Po odpowiedzi `listDecks` ekran zestawów pojawia się przed zakończeniem `listProfiles`; odświeżenie profili jest chronione epoch i identyfikatorem dziecka. Błąd `listDecks` pokazuje ekran błędu zamiast pozostawiać loading.
- Pomiar obciążenia na syntetycznej historii 501 settlementów i 501 segmentów: odtworzony historyczny zestaw odczytów wykonał 13 zapytań i odczytał 1 002 wiersze ledgerów; obecny batch-read profili wykonał 7 zapytań i nie czytał ledgerów. To pomiar liczby zapytań/wierszy SQL, nie pełne porównanie czasu wykonania starego planera i `splitRewardIntervalByLocalDay` z nową ścieżką. Zaobserwowane lokalne czasy pojedynczej próbki nie są podstawą do deklaracji przyspieszenia; latencja produkcyjna pozostaje niezmierzona.
- Zmiana Kid API usuwa pola/operacje rundy, a raport `learning-overview` nadal świadomie nie udostępnia nagród ani lekcji; nie wymaga to zmiany MCP schema, walidatora ani `SKILL.md`.

## Spec Change Log

## Review Triage Log

- V1 medium / patch: brak dodatniej asercji progu 1800 s w zwykłym settlement; istniejące dodatnie pakiety powstają przez rebuild, więc błąd qualifiedDelta nie zostałby wykryty.
- B1 medium / patch: historyczne ekspozycje rundy nie są odliczane od remainingSteps; przywrócić wyłącznie semantykę raportowania historii.
- B2 medium / patch: Intl akceptuje `america/new_york`, lecz SQL wyszukuje strefę case-sensitive; zachować oryginalny poprawny klucz strefy i ujednolicić walidację migracji.
- B3 medium / defer: niespójny snapshot wielu odczytów przy równoległym settlement jest możliwy; identyczne okno między odczytem sum i segmentów istniało przed zmianą. Odrębny problem spójności odczytu, bez wpływu na atomowość zapisów.
- B4 medium / patch: max(requested_at) grupuje całą historię Xbox mimo wymagania ograniczonego odczytu; użyć indeksowanego LIMIT 1 per dziecko w zbiorczym zapytaniu.
- B5 medium / patch: nowe bezwarunkowe czekanie na profile przy starcie pozostawia pozornie bezczynny ekran; nie blokować nauki bez mikrofonu, dla wymaganej aktualizacji pokazać stan oczekiwania.
- B6 medium / patch: równoległe odświeżenia w tej samej epoce mogą zastosować starsze ustawienia; zabezpieczyć kolejność żądań i dodać test odwróconych odpowiedzi.
- B7 medium / patch: usunięcie strict pola Parent Work Card wymaga udokumentowanej koordynacji web/worker/migracji i odświeżenia starych klientów.
- B8 medium / patch: brak porównania projekcji po zwykłym rozliczeniu i po rebuild; dodać regresję obejmującą próg dnia i resztę.
- B9 medium / patch: audio ma osobny test, jednak migracyjny przypadek spóźnionego complete-presentation nie jest chroniony ani sprawdzony; uwaga wspólna z E1.
- B10 low / patch: pool tymczasowej bazy testowej jest zamykany tylko przy sukcesie; przenieść cleanup do finally.
- E1 high / patch: completePresentation nie sprawdza wycofanego trybu ani stanu sesji; po migracji wydana prezentacja może rozliczyć zachowany pending segment. Dodać guard i test niezmienności ocen/settlementów/projekcji.
- E2 medium / patch: ten sam zweryfikowany błąd historycznego remainingSteps co B1; wspólna poprawka.
- E3 medium / patch: ten sam zweryfikowany błąd migracyjnej walidacji stref co B2; wspólna poprawka.

## Verification

- Weryfikacja wykonana w tym worktree: `corepack pnpm typecheck` oraz `corepack pnpm build` przeszły; testy jednostkowe celowanych modułów: 147 passed, a testy kontrolera po dodaniu opóźnionego profilu: 89/89 passed.
- Test integracyjny migracji `0016` na tymczasowej bazie PostgreSQL startującej z migracji `0000`–`0015` i zasianymi historycznymi danymi potwierdził zgodność punktów (w tym historycznego zera), salda/reszty, pakietów, segmentów na granicy dnia/DST, fallbacku błędnej strefy, zachowania pending segmentu oraz wygaśnięcia rundy/playbacku. To testowa baza, nie baza użytkownika.
- Test spóźnionego wyniku audio dla historycznej rundy przeszedł. Celowane E2E ścieżki profil → zestaw → nauka przeszło 1/1.
- Ostatni celowany test projekcji i pomiaru query workload przeszedł. Ponowny pełny zestaw sześciu plików integracyjnych przeszedł 82/82; `git diff --check` nie zgłosił błędów whitespace (jedynie ostrzeżenia o normalizacji LF/CRLF). Niezależny review pozostaje po stronie głównego agenta.

- TDD celowane: opóźnione profile, stary epoch, brak rundy w UI/API; zgodność backfillu, retry, rollback, współbieżność, midnight/DST, Xbox i usunięcie dziecka.
- Migracja/backfill przy wstrzymanych zapisach starej wersji web/worker; przed późniejszym wdrożeniem opisać tę kolejność. Agent nie uruchamia migracji na bazie użytkownika.
- `corepack pnpm exec vitest run --config vitest.unit.config.ts <zmienione-testy>`.
- `corepack pnpm exec vitest run --config vitest.integration.config.ts <zmienione-testy>` na testowym PostgreSQL; migracja od poprzedniego schematu z historycznymi danymi i od pustej bazy.
- Celowane E2E: profile→zestawy→nauka oraz Xbox/karta rodzica; `corepack pnpm typecheck`, `corepack pnpm build`.
- Powtórzyć pomiar z punktu 1 na tych samych danych; podać czasy i zapytania. Bez deklaracji czasu produkcyjnego z lokalnego pomiaru.
- Główny agent odbiera diff, migrację i dowody; poprawki wracają do Luna medium. Niezależny review zgodnie z bmad-build przed zakończeniem.

### Odbiór głównego agenta po review (2026-10-17)

- Wszystkie poprawki z review wdrożone i odczytane w aktualnym diffie. E1–E3 oraz V1 zostały ponownie sprawdzone przez tych samych niezależnych reviewerów: rozwiązane. B3 pozostaje zapisanym wcześniejszym problemem spójności wielozapytaniowego odczytu; atomowość zapisów zachowana.
- `corepack pnpm test:unit`: 134 pliki, 1269/1269 PASS.
- `corepack pnpm typecheck`: PASS po poprawieniu opcjonalnego rewards w asercji testowej.
- `corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/reward-activity.test.ts tests/integration/reward-regressions.test.ts tests/integration/reward-projection-migration.test.ts tests/integration/sessions.test.ts tests/integration/lesson-sessions.test.ts tests/integration/parent-work-card.test.ts tests/integration/lesson-grader.test.ts tests/integration/lesson-mock-tests.test.ts`: 8 plików, 114/114 PASS.
- `corepack pnpm build`: PASS.
- `corepack pnpm exec playwright test tests/e2e/kid-flow-screens.spec.ts tests/e2e/parent-work-card.spec.ts tests/e2e/kid-activity-lifecycle.spec.ts`: 13/13 PASS.
- Pomiar końcowy jest strukturalnym porównaniem SQL oraz kolejności wyświetlania UI; brak pomiaru produkcyjnej latencji. Nowa ścieżka nie odczytuje segmentów/settlementów dla profili ani zestawów, a najnowsze zgłoszenie Xbox pobiera przez ograniczony LATERAL.
