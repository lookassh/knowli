---
title: 'Benchmark izolowany profil → lista zestawów'
type: 'chore'
created: '2026-10-18'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '5356529150a92bd782c6118ab52b49e4fcd905ae'
context:
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/AGENTS.md'
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/docs/diagnostics/2026-10-18-profile-navigation-repair-plan.md'
---

<frozen-after-approval reason="Implementacja i pomiar zlecone przez właściciela">

## Intent

GPT Luna medium przygotowuje powtarzalny benchmark na fikcyjnych danych,
nie łącząc się z prod. Tylko testowa infrastruktura benchmarku, bez zmian domeny,
schema/migracji/package.json i plików innych agentów. Cel: empiryczne porównanie
starego zapytania historii z nowym oraz czasu listy przy stałym materiale i 10× historii.

## Boundaries & Constraints

Wolno utworzyć `tests/fixtures/profile-navigation-world.ts`,
`tests/integration/profile-navigation-benchmark.test.ts` i ewentualnie mały
test-only moduł referencyjnego zapytania. Referencję odtworzyć z git show
5356529150a92bd782c6118ab52b49e4fcd905ae:packages/server/src/modules/skill-history.ts.
Nie importować vitest inject z samodzielnego skryptu. Benchmark może być opt-in
przez UMIEM_NAV_BENCHMARK=1, w zwykłym CI nie ma timing assertions ani ciężkiego seed.
Połączenia używają wyłącznie bazy z testowego global-setup. Global-setup izolować
przez UMIEM_TEST_RUN_ID=nav-benchmark, nie usuwać cudzych kontenerów.
Bez commit/push/zmian prod. Nie wypisywać SQL z parametrami, odpowiedzi lub sekretów.

## Tasks & Acceptance

- [ ] Fixture: dwoje dzieci, 10 zestawów słówek × 50 rewizji, 10000 ocen i 50000 zdarzeń; dodatkowo ta sama widoczna treść z historią 10×. Można budować zbiorczym SQL, respektując FK/immutable triggery (processing→assessment→completed i draft→publish).
- [ ] Stary SQL referencyjny odtwarza OR i correlated EXISTS; wyniki historii porównywać z nowym po normalizacji kolejności ocen w tej samej próbie.
- [ ] Minimum 5 warmup/30 próbek dla nowego czytnika i finalnego listKidDecks; stary najwolniejszy SQL mierzyć co najmniej 3 razy, jeżeli 30 zajęłoby nieproporcjonalnie długo, i jawnie nie deklarować jego p95 z tak małej próbki.
- [ ] Raport JSON: kod, PG, JIT, wielkości danych, cold, median/p95/max, liczba zapytań; nearest-rank p95.
- [ ] Po B rebuild/projekcje potrzebne do listy uruchomi nadzorca; przygotuj fixture rozszerzalny. Najpierw dostarcz seed i porównanie readerów, nie czekaj na B.
- [ ] Dodaj znaczący test helperów deterministycznej statystyki/parametrów, jeśli helper istnieje; RED/GREEN nie może być fałszywie zadeklarowany dla samego ręcznego pomiaru.
- [ ] Wyniki i dokładne komendy zapisz do `docs/diagnostics/profile-navigation-benchmark-results.md` (bez wymyślonych wyników), w razie długiego seed raportuj postęp.

Given opt-in nie ustawiono, when zwykłe CI uruchamia integrację, then ciężki benchmark nie spowalnia suite.
Given fixture, when uruchamiany benchmark, then potwierdza wielkości danych i zgodność wyników starego/nowego czytnika.
Given 10× historia i te same zestawy, when finalny odczyt używa projekcji, then mierzymy skalowanie zgodnie z AC16 planu.

</frozen-after-approval>

## Implementation Notes

## Verification

Najpierw przygotuj pliki, uruchom małą próbkę fixture/readerów i poinformuj nadzorcę.
Pełny 10000/100000 benchmark uruchom po uzgodnieniu obciążenia z nadzorcą.
