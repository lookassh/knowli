---
title: 'Profil → zestawy: P0 i A1, zbiorcze dowody audio'
type: 'bugfix'
created: '2026-10-18'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '5356529150a92bd782c6118ab52b49e4fcd905ae'
review_loop_iteration: 0
context:
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/AGENTS.md'
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/docs/diagnostics/2026-10-18-profile-navigation-repair-plan.md'
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/docs/diagnostics/2026-10-18-profile-navigation-latency.md'
---

<frozen-after-approval reason="Zakres zaakceptowany przez właściciela w zleceniu orkiestracji 2026-10-18">

## Intent

Pierwszy krok pełnego planu: usunąć skorelowane skany audio w czytniku historii,
zachowując identyczną kwalifikację dowodów. Agent implementacyjny: GPT Luna medium.
Właściciel zlecił pełną realizację planu, RED–GREEN, nadzór, code review i PR z zielonym CI.
Ten przydział obejmuje tylko P0/A1. Nie implementować B/C ani punktu A2.

## Boundaries & Constraints

Zachować historię, polityki, regułę sealed i occurred_at <= received_at,
izolację dziecka i wszystkie publiczne kontrakty. Operacje zbiorcze ograniczyć
do zadań wybranych dla żądanych zakresów. Nie agregować całej tabeli dla każdej
pojedynczej próby. Indeks częściowy task_id/occurred_at rozważyć i zweryfikować
planem; przy dodaniu aktualizować schemat TS i nową migrację wraz z journal.
Bez globalnego wyłączania JIT, zmian produkcji, push, commit lub resetu.
Nie nadpisywać plików pozostałych agentów. Node_modules i .env istnieją.
Zacząć od znaczącego RED (poprawność granic lub regresja wykonania odczytu),
potem GREEN. Nie udawać, że istniejący zielony test jest dowodem RED.

## I/O & Edge-Case Matrix

| Scenariusz | Wejście | Oczekiwany wynik | Błąd |
| --- | --- | --- | --- |
| Granica czasu | sealed audio przed/w received_at/po nim | wspierające tylko pierwsze dwa | bez zmiany historii |
| Pieczęć | wcześniejsze unsealed audio | nie wspiera | brak wyjątku |
| Wiele audio | kilka odtworzeń jednego zadania | jedna ocena, poprawna kwalifikacja | brak powielenia |
| Izolacja | audio innego zadania/dziecka | nie wspiera bieżącej próby | brak przecieku |
| Zakres pusty | brak żądanych historii | pusta mapa | brak zbędnego SQL |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/skill-history.ts`: readSkillHistories/readSkillHistory, EXISTS audio, kwalifikacja i mapy historii.
- `packages/server/src/domain/projection-evidence.ts`: wspólna kwalifikacja dowodów; nie zmieniać reguł.
- `packages/server/src/db/schema.ts`, `packages/server/drizzle`: autorytatywny schemat i migracje.
- `tests/integration/history.test.ts`: odczyt historii i snapshotów, fixture i fake zegar.
- `tests/integration/helpers.ts`: izolowany PostgreSQL; żaden test nie łączy się z prod.
- `package.json`, `vitest.integration.config.ts`: używać istniejących komend.

## Tasks & Acceptance

- [ ] Zarejestrować stan startowy i mapę wejście/wyjście czytnika; celowany baseline.
- [ ] Dodać i zaobserwować znaczący RED dla zbiorczego odczytu/kwalifikacji.
- [ ] Zaimplementować zbiorczy odczyt audio ograniczony do potrzebnych zadań.
- [ ] Dodać uzasadniony indeks/migrację i sprawdzić plan wykonania na fikcyjnych danych.
- [ ] Uruchomić testy macierzy i istniejące history/projection; zanotować komendy i wyniki.
- [ ] Zapisać RED/GREEN i ryzyka w `docs/diagnostics/profile-navigation-progress.md`.

Given wiele ocen, when czytamy historie, then nie ma pełnego skanu zdarzeń osobno dla każdej oceny.
Given przypadki z macierzy, when czytnik kwalifikuje historię, then wynik spełnia wskazane reguły.
Given dotychczasowe scenariusze historii, when uruchamiamy testy, then nie ma regresji semantyki.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

Celowane unit i PostgreSQL integration/history; typecheck zmienionego pakietu.
Nowy benchmark P0 można dostarczyć w następnym małym przydziale, jeśli fixture
wymaga osobnej pracy. Nie blokować A1 na infrastrukturze benchmarku; nie deklarować
AC wydajności bez pomiaru. Raport końcowy ma wskazać rzeczywiście wykonany RED/GREEN.
