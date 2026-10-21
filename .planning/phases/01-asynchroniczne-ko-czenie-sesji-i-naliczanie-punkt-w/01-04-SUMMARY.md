---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
plan: 04
subsystem: kid-ui-feedback
tags: [async, e2e, rewards, accessibility]
requires: [durable-client-activity-polling]
provides: [nonblocking-reward-feedback, reward-lifecycle-regression]
affects: [kid-ui, e2e-fixtures]
tech_stack:
  added: []
  patterns: [polite-status-announcement, durable-status-e2e-fixture]
key_files:
  created: []
  modified:
    - packages/kid-ui/src/screens/SessionActivityResultView.tsx
    - packages/kid-ui/src/screens/reward-summary.test.tsx
    - tests/e2e/kid-activity-lifecycle.spec.ts
    - tests/e2e/helpers/kid-ui-fixture.ts
decisions:
  - "Stan naliczania pozostaje krótkim komunikatem w miejscu punktów i jest ogłaszany przez role=status bez blokowania akcji podsumowania."
  - "Po zaakceptowaniu raportu regresja E2E oczekuje wyłącznie GET activity-result; utracony ACK przed akceptacją zachowuje wcześniejsze ponowienie identycznego POST."
metrics:
  duration: "~25 min"
  completed: "2026-10-21"
status: complete
actuals:
  tokens: 2291
  tasks: 2
  commits: 2
plan_head_before: 8db0481c311a978aff22e56da31017afe60bf2f0
plan_head_after: c42e7042f34c43f20bb78e104f605abd61a70db5
---

# Phase 01 Plan 04: Komunikacja wyniku i regresja cyklu Summary

Podsumowanie sesji pozostaje dostępne podczas naliczania punktów, a regresja E2E potwierdza przejście od pending do trwałego wyniku bez ponownego raportu.

## Commits

| Commit | Description |
| --- | --- |
| df9ad4f | Semantyczny, nieblokujący komunikat statusu punktów |
| c42e704 | Regresja E2E trwałego statusu i utraconego ACK |
| 68d8796 | Poprawka typu w teście przywraca pełny typecheck |

## What Changed

- `SessionActivityResultView` ogłasza zmianę statusu przez `role="status"` i `aria-live="polite"`, pozostawiając krótki polski komunikat pending, wynik punktowy albo istniejący komunikat błędu.
- Test widoku potwierdza, że akcje podsumowania nie są wyłączane podczas pending.
- Fixture E2E obsługuje trwały `GET /activity-result` oddzielnie od `POST /end`.
- Regresja E2E sprawdza natychmiastowe podsumowanie, dwa odczyty GET prowadzące do wyniku, jeden przesłany raport oraz reload po zaakceptowanym pending bez kolejnego POST.

## TDD Gate Compliance

- **Task 2:** nowy test E2E przeszedł od razu, ponieważ pełne zachowanie asynchroniczne zostało wdrożone i pokryte przez plany 01-01–01-03. Nie utworzono sztucznego RED ani fałszywego dowodu bramki.
- **Regression fix:** pełny przebieg E2E początkowo ujawnił brak `GET activity-result` w fixture starego testu utraconego ACK. Rozszerzenie fixture i adaptacja oczekiwania do reguły GET po akceptacji dały zielony przebieg 5/5.

## Verification

- `corepack pnpm playwright test tests/e2e/kid-activity-lifecycle.spec.ts` — 5/5 passed.
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/reward-summary.test.tsx packages/kid-ui/src/session/activity-draft-store.test.ts packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/api/client.test.ts apps/web/src/kid/kid-router.test.ts packages/server/src/modules/session-activity.test.ts` — 126/126 passed.
- `corepack pnpm typecheck` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - E2E fixture] Dodano odpowiedź GET statusu do istniejącego fixture.**
- **Found during:** pełny przebieg E2E.
- **Issue:** Starszy scenariusz utraconego ACK nie znał nowego odczytu statusu i kończył się błędem fixture po zaakceptowaniu raportu.
- **Fix:** Fixture kolejkuje odpowiedzi trwałego statusu; regresja rozdziela POST przed akceptacją od GET po akceptacji.
- **Files modified:** `tests/e2e/helpers/kid-ui-fixture.ts`, `tests/e2e/kid-activity-lifecycle.spec.ts`.
- **Commit:** `c42e704`.

## API -> MCP -> Skill Boundary

- Kid endpoint `GET /api/v1/kid/sessions/:sessionId/activity-result` pozostaje wyłącznie kontraktem Kid UI.
- Inspekcja `packages/contracts/src/learning-overview.ts`, adapterów `apps/web/src/integrations/` i wygenerowanego konsumenta nie wykazała eksportu statusu nagrody, punktów ani parametrów endpointu.
- `integrations/umiem-mcp/skills/umiem-learning/SKILL.md` nadal wyłącza lekcje z `learning-overview`; nie zmieniły się nazwa narzędzia, parametry, wartości domyślne, autoryzacja ani semantyka danych Hermesa.
- Ponieważ kontrakt MCP nie zmienił się, nie regenerowano schematu MCP ani nie wykonywano aktualizacji skilla.

## Self-Check: PASSED

- Wszystkie zmodyfikowane pliki istnieją, bez znanych stubów.
- Commity `df9ad4f` i `c42e704` są osiągalne z `feature/async-session-completion`.
- Zmierzony zakres planu obejmuje dwa commity od `8db0481` do `c42e704`.
