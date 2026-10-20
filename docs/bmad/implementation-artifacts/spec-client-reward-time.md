---
title: 'Raport sesji, ocena LLM i proste punkty'
type: 'refactor'
created: '2026-10-19'
updated: '2026-10-20'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

FE zbiera aktywność sesji nauki/kartkówki lokalnie i wysyła raport na koniec. Serwer zapisuje raport, dołącza zadania/odpowiedzi z bazy i wywołuje LLM. Usuwamy Xbox, historię nagród i serwerowy protokół aktywności. Zostają proste punkty.

## Boundaries & Constraints

**Zawsze:** model wskazuje zadania bez podstaw do zaliczenia pracy i uzasadnia wykluczenia. Nie wyznacza sekund ani punktów. Kod sumuje zmierzony aktywny czas pozostałych zadań i nalicza 1 pkt/60 s; reszta przechodzi między sesjami. Zachowujemy obecny dorobek dzieci. Dużo błędów nie oznacza braku pracy.

Szczegółowy JSONB zawiera aktywność, zadania, odpowiedzi i ocenę; retencja 7 dni. Trwale zostaje krótki wynik: czas całkowity, zatwierdzony, punkty i uzasadnienie. Awaria/niepoprawny wynik LLM: zachować raport i błąd, pokazać komunikat; bez punktów i automatycznych ponowień.

**Nigdy:** heartbeatów, nagrodowych autoryzacji audio, ledgera punktów, stanów/kolejki ocen. Nie zapisujemy nagrań i każdego klawisza. Model nie otrzymuje imion, identyfikatorów i sekretów. Zachowujemy historię nauki. Bez wdrożenia produkcyjnego.

## I/O & Edge-Case Matrix

| Warunek | Zachowanie |
|---|---|
| Koniec sesji | Jeden ograniczony raport: kolejność zadań, edycje, odsłuchy, bezczynność i tło. Odpowiedzi zapisują się na bieżąco. |
| Przerwanie | FE zachowuje raport do potwierdzenia zapisu; zamknięcie karty nie wymaga wywołania LLM w tle. |
| Retry transportu | Sesja identyfikuje raport; zapisany wynik zwracany ponownie. Punkty najwyżej raz, także po retencji. |
| Timeout/błędny werdykt | Raport i błąd zachowane; bez punktów. Powtórzenie żądania nie uruchamia kolejnej oceny. |
| Po 7 dniach | Szczegółowy JSONB znika; punkty, krótki wynik i historia nauki zostają. |

</frozen-after-approval>

## Dokumenty wykonawcze

Cały zakres do zatwierdzenia obejmuje tę specyfikację oraz:

1. [Projekt przepływu, danych, oceny LLM i UI](client-reward-time/design.md).
2. [Migrację i mapę zmian w kodzie](client-reward-time/migration.md).
3. [Scenariusze odbioru i kolejność implementacji](client-reward-time/acceptance.md).
4. [Instrukcja przekazania do ZCode](client-reward-time/handoff.md) i [przykłady wyników](client-reward-time/examples.json).

## Code Map

Pełne ścieżki i działania: tabela w `client-reward-time/migration.md`, sekcja 5. Wskazane dalej „pliki z mapy” odnoszą się do tej tabeli.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/kid-ui/src/session/activity-report.ts` i pliki FE z mapy — lokalny raport z podmienialnym zegarem, kopią do odbioru i limitami; usunąć sygnały nagrodowe.
- [ ] Kontrakty/router z mapy — raport końcowy, wersja formatu, walidacja i wymóg odświeżenia starego klienta.
- [ ] `packages/server/src/modules/session-activity.ts`, `ports/ai.ts`, adapter providera — zapis przed pojedynczą oceną poza transakcją; Zod wyniku i timeout. Zadania/odpowiedzi jako dane, nie instrukcje. Serwer dołącza własne zadania i odpowiedzi.
- [ ] `schema.ts` i migracja w `packages/server/drizzle/` — raport JSONB/retencja i krótki wynik sesji, licznik/reszta punktów profilu. Przenieść dorobek, usunąć 10 tabel nagrodowych i zależności. Bez migracji produkcyjnej.
- [ ] Moduły serwera z mapy — usunąć Xbox, streamy, stare rozliczenia/odbudowę nagród. Krótkie znaczniki przyjęcia/rozliczenia w sesji chronią przed równoległą oceną i ponownymi punktami; bez maszyny stanów.
- [ ] `apps/web/src/parent/WorkCardPanel.tsx`, ekrany profilu/podsumowania — wynik sesji i punkty, bez Xbox i salda do wydania.
- [ ] `apps/worker/src/tasks.ts` — czyścić wygasły JSONB/szczegóły błędu, zachować sesję/punkty.
- [ ] `docs/{SPEC,architecture}.md` i testy — nowy model, migracja i API → MCP → skill; osobny szacunek learning-overview pozostaje.

**Acceptance Criteria:**
- Given poprawny raport, when LLM wskaże wykluczone zadania, then kod oblicza czas pozostałych i punkty z resztą.
- Given zapisany wynik/błąd, when ponowimy żądanie, then nie powstaje drugie naliczenie ani automatyczna ocena.
- Given minęło 7 dni, when worker czyści dane, then szczegóły znikają, a punkty i krótki wynik zostają.
- Given istniejące punkty, when migrujemy, then dorobek pozostaje, a tabele i funkcje Xbox/pomiaru nie istnieją.

## Implementation Notes

- 2026-10-20: właściciel zatwierdził cały pakiet. Przygotowanie przekazania nie oznacza rozpoczęcia implementacji.

## Spec Change Log

- 2026-10-20: właściciel zastąpił plan per krok raportem sesji/LLM, usuwa Xbox/historię nagród. Ustalił 1 pkt/60 s, retencję 7 dni i błąd bez punktów/ponowień.
- 2026-10-20: na prośbę właściciela dodano szczegółowy projekt, migrację i scenariusze odbioru. Zatwierdzenie obejmuje cały pakiet.
- 2026-10-20: właściciel zaakceptował korektę: LLM wyklucza zadania, kod liczy czas i punkty; awarie bez monitoringu i ponowień.

## Review Triage Log

## Verification

48 scenariuszy, polecenia, RED → GREEN i niezależny review opisuje `client-reward-time/acceptance.md`.
