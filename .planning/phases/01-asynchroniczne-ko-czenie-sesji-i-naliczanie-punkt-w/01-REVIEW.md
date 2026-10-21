---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
reviewed: 2026-10-21T14:46:14Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - apps/web/src/kid/kid-router.test.ts
  - apps/web/src/kid/kid-router.ts
  - packages/kid-ui/src/api/KidApi.ts
  - packages/kid-ui/src/api/client.test.ts
  - packages/kid-ui/src/api/client.ts
  - packages/kid-ui/src/screens/SessionActivityResultView.tsx
  - packages/kid-ui/src/screens/reward-summary.test.tsx
  - packages/kid-ui/src/session/activity-draft-store.test.ts
  - packages/kid-ui/src/session/activity-draft-store.ts
  - packages/kid-ui/src/session/activity-report.test.ts
  - packages/kid-ui/src/session/session-controller.test.ts
  - packages/kid-ui/src/session/session-controller.ts
  - packages/server/src/modules/session-activity.ts
  - packages/server/src/modules/sessions.ts
  - tests/e2e/helpers/kid-ui-fixture.ts
  - tests/e2e/kid-activity-lifecycle.spec.ts
  - tests/integration/session-activity.test.ts
  - vitest.unit.config.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-10-21T14:46:14Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Sprawdzono pełny przepływ asynchronicznego naliczania punktów: trwałe przyjęcie raportu, kończenie oceny w tle, endpoint statusu, polling oraz zapis lokalnego znacznika. Implementacja zachowuje publiczny kształt DTO i nie blokuje podsumowania sesji, ale nowy endpoint umożliwia odczyt wyniku dowolnej sesji znającemu jej UUID. Potwierdza to otwarte zagrożenie T-01-03 z planu fazy.

## Narrative Findings (AI reviewer)

Poniższy błąd został niezależnie zweryfikowany w bieżącym kodzie wraz z przepływem wywołania z klienta Kid UI.

## Critical Issues

### CR-01: Brak autoryzacji właściciela przy odczycie wyniku aktywności (T-01-03)

**File:** `apps/web/src/kid/kid-router.ts:97-106`

**Issue:** Endpoint `GET /api/v1/kid/sessions/:id/activity-result` waliduje tylko format UUID i zwraca trwały wynik każdej istniejącej sesji. Nie sprawdza powiązania sesji z aktualnie wybranym dzieckiem, uwierzytelnioną sesją ani jednorazowym poświadczeniem wydanym przy rozpoczęciu sesji. Osoba z UUID cudzej sesji może poznać stan oceny i liczbę punktów; nie spełnia to modelu zagrożeń fazy dla danych dziecka. Komentarz routera w liniach 61-65 deklaruje zaufane Kid API bez autoryzacji, co pozostaje sprzeczne z T-01-03 i wymaga jawnej decyzji właściciela.

**Fix:** Wprowadzić mechanizm wiążący odczyt z właścicielem sesji, np. nieprzewidywalny jednorazowy token sesji zwracany tylko przy jej utworzeniu i wymagany przez endpoint statusu, a następnie sprawdzić go razem z `sessionId` po stronie serwera. Dodać test, w którym poświadczenie sesji dziecka A nie może odczytać wyniku sesji dziecka B. Jeżeli produkt świadomie pozostaje w zaufanym modelu Kid API, należy przed wysyłką zmienić i zatwierdzić model zagrożeń jako świadomie zaakceptowane ryzyko, zamiast pozostawiać sprzeczny wymóg bezpieczeństwa.

---

_Reviewed: 2026-10-21T14:46:14Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
