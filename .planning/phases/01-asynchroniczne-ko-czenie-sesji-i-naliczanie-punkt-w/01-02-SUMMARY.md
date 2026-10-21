---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
plan: 02
subsystem: kid-api
tags: [async, kid-api, status, tdd]
requires: [asynchronous-session-activity-review]
provides: [durable-activity-status-endpoint]
affects: [kid-ui, session-summary]
tech_stack:
  added: []
  patterns: [read-only-status-endpoint, strict-dto-validation, no-store]
key_files:
  created:
    - apps/web/src/kid/kid-router.test.ts
  modified:
    - apps/web/src/kid/kid-router.ts
    - packages/kid-ui/src/api/KidApi.ts
    - packages/kid-ui/src/api/client.ts
    - packages/kid-ui/src/api/client.test.ts
    - packages/kid-ui/src/session/session-controller.test.ts
    - vitest.unit.config.ts
decisions:
  - "Brak utrwalonego wyniku endpoint przedstawia jako publiczne already_started, bez ponawiania raportu lub oceny."
  - "Status aktywności jest prywatnym kontraktem Kid API i pozostaje poza learning-overview oraz skillem Hermesa."
  - "Właściciel potwierdził zachowanie zaufanego Kid API z architecture.md §13; brak autoryzacji dziecka przy odczycie wyniku jest zaakceptowanym ryzykiem T-01-03 dla prywatnej instancji."
metrics:
  duration: "~20 min"
  completed: "2026-10-21"
status: complete
actuals:
  tokens: 2801
  tasks: 1
  commits: 2
plan_head_before: d6ff06ef319b9dac5a69a78b41fd3007fe4ae211
plan_head_after: 871cab304d48199665ddca0ad902ec3137980eea
---

# Phase 01 Plan 02: Odczyt statusu oceny w Kid API Summary

Kid UI pobiera trwały, mały status oceny aktywności przez `GET /api/v1/kid/sessions/:sessionId/activity-result`, bez uruchamiania kolejnej oceny lub naliczenia punktów.

## Commits

| Commit | Description |
| --- | --- |
| 7a19a0a | RED: testy endpointu statusu i parsera klienta |
| 871cab3 | GREEN: endpoint, kontrakt `KidApi` i klient HTTP |

## Security Follow-up

Właściciel zaakceptował T-01-03 w zgodzie z `docs/architecture.md` §13. Odczyt nadal ogranicza się do UUID sesji i publicznego DTO bez cache; Kid API nie dodaje autoryzacji dziecka.

## What Changed

- Router Kid API waliduje UUID, odczytuje wyłącznie `readSessionActivityResult`, redukuje odpowiedź przez `SessionActivityResultDtoSchema` i zwraca `Cache-Control: no-store`.
- Brak zapisanego rekordu jest publicznie reprezentowany jako `already_started` z zerowymi punktami, dzięki czemu polling nie przesyła ponownie raportu.
- `KidApi` i jego klient HTTP mają `readSessionActivityResult(sessionId)` z walidacją wszystkich dozwolonych stanów i odrzuceniem odpowiedzi niezgodnych ze współdzielonym schematem.
- Dodano test rzeczywistego handlera oraz alias `@` do konfiguracji unit testów, aby test ładował tę samą trasę co aplikacja.

## TDD Gate Compliance

- **RED:** `7a19a0a`; `tdd-red-evidence` zwrócił `RED_EVIDENCE_OK` dla braku trasy `activity-result`.
- **GREEN:** `871cab3`; testy routera, klienta i modułu oceny są zielone.
- **REFACTOR:** niepotrzebny.

## Verification

- `corepack pnpm vitest run --config vitest.unit.config.ts apps/web/src/kid/kid-router.test.ts packages/kid-ui/src/api/client.test.ts packages/server/src/modules/session-activity.test.ts` — 36/36 passed.
- `corepack pnpm typecheck` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Test infrastructure] Dodano alias `@` do unit testów.**
- **Found during:** RED.
- **Issue:** Router używa istniejącego aliasu aplikacji, którego `vitest.unit.config.ts` nie rozwiązywał, przez co test handlera nie mógł się załadować.
- **Fix:** Zrównano alias unit testów z konfiguracją integracyjną.
- **Files modified:** `vitest.unit.config.ts`.
- **Commit:** `7a19a0a`.

**2. [Rule 1 - Test contract] Uzupełniono fake `KidApi` i istniejące mapowanie walidacji.**
- **Found during:** GREEN/typecheck.
- **Issue:** Nowa metoda interfejsu wymagała implementacji w fake kontrolera; test błędnie oczekiwał 422, podczas gdy istniejące mapowanie Zod zwraca 400.
- **Fix:** Fake zwraca publiczny stan oczekiwania, a test sprawdza obowiązujący kod 400.
- **Files modified:** `packages/kid-ui/src/session/session-controller.test.ts`, `apps/web/src/kid/kid-router.test.ts`.
- **Commit:** `871cab3`.

## MCP Boundary

Endpoint pozostaje wyłącznie w Kid API. Nie zmienia `learning-overview`, adaptera MCP ani skilla Hermesa, które celowo nie raportują punktów ani wyniku oceny aktywności.

## Self-Check: PASSED

- Wszystkie pliki z zakresu planu istnieją.
- Commity `7a19a0a` i `871cab3` są osiągalne z `feature/async-session-completion`.
- Zmierzony zakres planu obejmuje dwa commity od `d6ff06e` do `871cab3`.
