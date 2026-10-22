---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
plan: 01
subsystem: session-activity
tags: [async, session, rewards, tdd]
requires: []
provides: [asynchronous-session-activity-review]
affects: [kid-api, session-summary, reward-ledger]
tech_stack:
  added: []
  patterns: [accept-then-settle, durable-review-marker, fire-and-forget-with-recovery]
key_files:
  created: []
  modified:
    - packages/server/src/modules/session-activity.ts
    - packages/server/src/modules/sessions.ts
    - tests/integration/session-activity.test.ts
decisions:
  - "endSession trwałe akceptuje raport i zwraca already_started, a istniejący mechanizm finalizacji kończy ocenę w tle."
  - "Niespodziewane odrzucenie pracy w tle nie wycieka jako unhandled rejection; trwały znacznik jest rozstrzygany istniejącym odczytem po deadline."
metrics:
  duration: "~30 min"
  completed: "2026-10-21"
status: complete
actuals:
  tokens: 5451
  tasks: 1
  commits: 2
plan_head_before: 485bc82c2fb4109ba3548df85c65eb28f2ca819d
plan_head_after: 73721991b5c1693e2a3651423add483e93a3b52a
---

# Phase 01 Plan 01: Asynchroniczne zakończenie sesji Summary

`endSession` po przyjęciu raportu zwraca podsumowanie z `already_started`, podczas gdy pojedyncza ocena providera i atomowe naliczenie punktów kończą się poza odpowiedzią HTTP.

## Commits

| Commit | Description |
| --- | --- |
| ecaf01c | RED: test kontrolowanego, nierozwiązanego providera |
| 7372199 | GREEN: rozdzielenie akceptacji raportu od finalizacji oceny |

## What Changed

- Wydzielono trwałą akceptację raportu z fingerprintem i znacznikiem rozpoczęcia oraz etap finalizacji istniejącego wyniku.
- Dodano `beginSessionActivityReview()`, który uruchamia jedno rozliczenie w tle i natychmiast zwraca publiczny status oczekiwania.
- Zachowano istniejący fingerprint, blokady, deadline, `review_interrupted` i atomową transakcję ledgeru punktów.
- Rozszerzono integracyjne regresje o nierozwiązanego providera, wynik po odczycie oraz transport Kid API.

## TDD Gate Compliance

- **RED:** `ecaf01c`; walidator `tdd-red-evidence` potwierdził celowy błąd asercji: `endSession` oczekiwał na nierozwiązanego providera.
- **GREEN:** `7372199`; ten sam test kończy się powodzeniem po rozdzieleniu akceptacji od finalizacji.
- **REFACTOR:** niepotrzebny.

## Verification

- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/session-activity.test.ts --reporter=tap-flat` — 23/23 passed.
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/modules/session-activity.test.ts packages/server/src/modules/sessions.test.ts` — 34/34 passed.
- `corepack pnpm typecheck` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correct verification layer] Użyto testu integracyjnego PostgreSQL zamiast wyłącznie unit testów.**
- **Found during:** RED.
- **Issue:** Reguła pojedynczej oceny, blokady sesji, trwały fingerprint i atomowy ledger punktów zależą od prawdziwej transakcji PostgreSQL; istniejące wskazane pliki unit testów testują wyłącznie czystą logikę.
- **Fix:** Rozszerzono `tests/integration/session-activity.test.ts`, zachowując także planowany szybki zestaw unit.
- **Files modified:** `tests/integration/session-activity.test.ts`.
- **Commit:** `ecaf01c`, `7372199`.

## MCP Boundary

Zmiana dotyczy wyłącznie wewnętrznego zakończenia sesji i nie rozszerza `learning-overview`, MCP ani skilla Hermesa o punkty lub szczegóły oceny. Nie wymaga aktualizacji MCP/skilla na tym etapie.

## Self-Check: PASSED

- Zmodyfikowane pliki istnieją, a oba commity są osiągalne z `feature/async-session-completion`.
- Zakres planu ma dwa zmierzone commity od `485bc82` do `7372199`.
