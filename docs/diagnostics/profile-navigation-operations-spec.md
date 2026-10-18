---
title: 'Dokumentacja projekcji i operacje wdrożenia'
status: 'in-progress'
context:
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/AGENTS.md'
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/docs/diagnostics/2026-10-18-profile-navigation-repair-plan.md'
---

## Przydział

GPT Luna medium aktualizuje WYŁĄCZNIE docs/architecture.md (odpowiednie krótkie
sekcje projekcji/listy) oraz docs/operations/progress-rebuild.md. Żadnych zmian
kodu/schema/migracji/testów i żadnych wywołań prod. Bez commit/push.
Przeczytać bieżący kod, nie wnioskować ze starszych raportów. Współdzielone
zmiany B są autoryzowane i w toku, nie trzeba o nie pytać właściciela.

Docelowy model B jest ustalony: child_skill_progress PK child/skillVersion/policy,
proj-3 jako osobna wersja algorytmu; firstIssuedAt/hasQualifyingAssessment;
child_target_exposures firstExposureAt MIN i lastExposureAt MAX; readiness
child_profiles.learning_projection_version (legacy NULL, nowy child proj-3).
Migracja0019 zachowuje dawną tabelę jako jawnie zamodelowany backup
child_skill_progress_legacy, bez runtime odczytów. Rebuild odtwarza wszystkie
policy scopes i fakty z historii, po pełnym sukcesie czyści legacy rows danego
dziecka i atomowo ustawia readiness. Pusta tabela legacy może być usunięta
późniejszą migracją; nie implementować tego teraz.

W dokumentacji zachować jasny podział:
- lista/sesja stosują wybraną/przypiętą politykę bez fallbacku między politykami;
- raport rodzica jawnie wybiera ostatnią wiarygodną ocenę jak dotychczas;
- lastExposure do terminów, firstExposure do ever-seen as of now;
- GET nie zapisuje ensurePolicy/rebuild ani nie odtwarza historii;
- jedna spójna migawka i wspólne czyste reguły, osobny lekki odczyt listy.

Runbook ma opisać sprawdzalne polecenia istniejącego CLI, osobno dry-run/apply,
blokadę aktywnych/processing, weryfikację gotowości i rollback. Przed B wymagane
okno utrzymaniowe: backup, zatrzymanie starych writerów, migracja/backfill,
walidacja, zgodne web+worker. Nie kończyć samowolnie sesji. Wyjaśnić, że sam
powrót starego obrazu po zmianie PK nie jest rollbackiem; trzeba zgodną kopię DB.
Nie wkładać haseł, UUID dzieci, hostów lub faktycznie wykonanych komend prod.
Nie deklarować wdrożenia/benchmarków bez dowodów. Połącz notę API→MCP→skill:
wewnętrzne optymalizacje bez zmiany DTO, learning-overview nadal wyklucza lekcje;
raporty trzeba przetestować po policy-scoped zmianie.

## Weryfikacja

Sprawdzić nazwy CLI/flag z kodem i linki, git diff --check. Nie uruchamiać
testów monorepo dla samych docs. Jeśli implementacja B jest jeszcze niekompletna,
oznacz dokument jako planowane wdrożenie do zatwierdzenia nadzorcy i przekaż
konkretne miejsca do ponownego sprawdzenia po B. Raport zwięzły.
