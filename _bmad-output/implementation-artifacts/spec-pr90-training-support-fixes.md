---
title: 'PR 90: zachowanie trudności między treningami'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
route: 'oneshot'
review_loop_iteration: 2
baseline_commit: '5356529150a92bd782c6118ab52b49e4fcd905ae'
---

<frozen-after-approval reason="polecenie właściciela: przygotuj plan, popraw i utwórz PR">

## Intent

Naprawić dwie uwagi z review PR 90: zachować rzeczywiste trudności po nieudanym ćwiczeniu po wsparciu oraz po publikacji nowej rewizji niezmienionego materiału. Zachować limit jednego cyklu wsparcia na sesję, niezmienność planu i izolację wersji umiejętności. Pominięcie lub awaria nie rozliczają trudności, rzeczywisty poprawny wynik odpowiedniej umiejętności może ją rozliczyć. Nie zmieniać API, DTO, ocen historycznych, nagród ani schematu bazy. Zakończyć testami, niezależnym review i PR.

</frozen-after-approval>

## Implementation Notes

Plan:
1. Dodać regresje domenowe i integracyjne: nieudane/pominięte retry, błąd po wykorzystaniu wsparcia, poprawne retry, ponowna publikacja, nowe kryteria i częściowo zachowane umiejętności. Zobaczyć RED przed zmianami produkcyjnymi.
2. W `domain/support-cycle.ts` oddzielić nierozliczoną trudność z historii od limitu cyklu w bieżącej sesji. Włączyć odtwarzanie między sesjami jawnie dla nowego planera, zachowując zachowanie sesji legacy.
3. W `modules/sessions.ts` odczytać historyczne zadania przez zgodne `item_revision_skills.skill_version_id`, odwzorować je na aktualną rewizję i ograniczyć wyniki do zachowanych umiejętności. Nie przenosić `dont_remember` bez pasujących ocen ani sukcesu niezgodnej umiejętności. Zachować kolejność ordinali przy równych czasach zadań.
4. Zaktualizować opis reguł w `docs/architecture.md`; brak zmiany kontraktu API/MCP/skilla uzasadnić w PR. Uruchomić pełne unit/integration/e2e, typecheck i build. Jeden niezależny reviewer GPT-6.1 Sol medium naraz zgodnie z wykonaniem specyfikacji PR 90; poprawki także RED–GREEN.
5. Commit, push gałęzi `fix/training-support-history`, PR do main. Bez merge i wdrożenia.

Nie ma brakujących decyzji właściciela ani migracji. Zależności i `.env` istnieją; instalacja niepotrzebna. Aktualny `origin/main` jest zgodny z bazą.

Dowody:
- RED domeny: `corepack pnpm test:unit packages/server/src/domain/support-cycle.test.ts` — 7 nowych porażek: historyczne retry/dalsze trudności nie wracały jako needed.
- RED integracji: `corepack pnpm test:integration tests/integration/training-session-plan.test.ts` — 3 nowe porażki: dont_remember po retry, skip po retry, publikacja bez zmiany kryteriów.
- GREEN tych regresji po zmianie reguł i czytania historii: 13/13 testów domeny i 13/13 integracyjnych przed dodatkowym przypadkiem częściowej zmiany kryteriów.
- Dodatkowa integracja częściowego zachowania pisowni po zmianie polskiego znaczenia: PASS. Fixture rezerwuje tylko jeden cel, aby pozostawić materiał do wymaganej przerwy przed poprawką.
- Pełne unit: 136 plików, 1292 testy PASS. Typecheck PASS. Pełne integracyjne i E2E w toku.
- Odtwarzanie nowej historii jest włączone jawnie tylko przy budowie nowych planów; ścieżka aktywnych sesji legacy zachowuje dotychczasowy protokół cyklu.
- Nie zmieniono schematu, API, DTO, MCP ani instrukcji skilla; wpływ dotyczy prywatnego doboru wsparcia nowej sesji. Plan zapisanej sesji pozostaje niezmienny, nie ma migracji ani koniecznej aktualizacji konsumenta MCP.
- Pełne integracyjne PostgreSQL: 47 plików, 450 testów PASS. Pełne E2E: 198/198 PASS (8,2 min), w tym standardowy klient Streamable HTTP MCP przez prawdziwy endpoint Next.js. `git diff --check` PASS.
- Build PASS. Niezależne review całego diffu (GPT-6.1 Sol medium) zgłosiło jedną trafną uwagę: w zadaniu osiągającym próg błędów pisowni poprawny Recall nie był rozliczany. Regresja domenowa rzeczywiście RED (needed zamiast none po późniejszej poprawnej pisowni), po korekcie GREEN 14/14. Rozliczenie poprawnych umiejętności następuje również po dodaniu trudności z pozostałych wyników tej samej próby. Pełne sprawdzenia powtórzone przed kolejnym review.
- Końcowe powtórzenie po uwadze review: unit 136 plików / 1293 testy PASS; integracyjne 47 plików / 450 testów PASS; E2E 198 testów PASS (8,2 min); typecheck PASS; diff check PASS.
- Drugie review zgłosiło trafną uwagę dotyczącą poprawnej oceny zapisanej w zadaniu później pominiętym lub pozostawionym issued. Dwa nowe przypadki rzeczywiście RED, usunięto warunek uzależniający rozliczenie oceny od stanu całego zadania. Dane prób nadal pochodzą wyłącznie z zakończonych ocen, a sloty planu bez prób nie tworzą sukcesu. Pełne unit po tej korekcie: 136 plików / 1295 testów PASS. Dla tej jednowarunkowej zmiany powtarzamy integracje sesji/oceniania/algorytmu/planów i E2E pisowni oraz typecheck/build; pełne 450 integracyjnych i 198 E2E wykonano dwukrotnie przed ostatnią korektą.
- Wynik sprawdzeń ostatniej korekty: integracje 4 pliki / 80 testów PASS, E2E pisowni 4/4 PASS, typecheck i build PASS, diff check PASS. Końcowe review całego zakresu w toku.
- Końcowe niezależne review całego diffu (świeży GPT-6.1 Sol medium) zakończone bez potwierdzonych błędów. Poprzednie dwie trafne uwagi zamknięto przez RED–GREEN i ponowne sprawdzenia. Brak uwag odroczonych. Po tym review zmieniono wyłącznie status i dziennik niniejszego planu.
