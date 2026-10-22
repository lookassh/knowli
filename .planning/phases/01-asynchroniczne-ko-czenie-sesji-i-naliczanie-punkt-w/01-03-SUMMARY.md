---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
plan: 03
subsystem: kid-ui-session-controller
tags: [async, polling, rewards, tdd]
requires: [asynchronous-session-activity-review, durable-activity-status-endpoint]
provides: [durable-client-activity-polling]
affects: [kid-ui, profiles, session-summary]
tech_stack:
  added: []
  patterns: [minimal-pending-marker, controller-owned-polling, owner-bound-profile-refresh]
key_files:
  created: []
  modified:
    - packages/kid-ui/src/session/activity-draft-store.ts
    - packages/kid-ui/src/session/activity-draft-store.test.ts
    - packages/kid-ui/src/session/activity-report.test.ts
    - packages/kid-ui/src/session/session-controller.ts
    - packages/kid-ui/src/session/session-controller.test.ts
decisions:
  - "Po zaakceptowaniu raportu lokalny rekord przechowuje wyłącznie wersję, sessionId, childId i czas zapisu."
  - "Polling należy do kontrolera, działa poza widokiem i używa wyłącznie GET readSessionActivityResult."
  - "Wynik terminalny odświeża profile względem childId przypiętego do sesji, a widok aktualizuje tylko zgodne bieżące podsumowanie."
metrics:
  duration: "~30 min"
  completed: "2026-10-21"
status: complete
actuals:
  tokens: 6377
  tasks: 1
  commits: 2
plan_head_before: cf9d71b454d92f307790f58cc0bcc1cbfaabc6f0
plan_head_after: 48f763696be624620121cb702a5079b8fa00b8ef
---

# Phase 01 Plan 03: Trwałe odpytywanie wyniku przez kontroler sesji Summary

Kontroler Kid UI pokazuje podsumowanie od razu, a następnie odczytuje trwały wynik oceny w tle także po zmianie widoku, profilu lub odświeżeniu aplikacji.

## Commits

| Commit | Description |
| --- | --- |
| f13e5e2 | RED: testy minimalnego pending i pollingu kontrolera |
| 48f7636 | GREEN: trwały znacznik i polling statusu przez GET |

## What Changed

- Magazyn aktywności rozróżnia roboczy raport do wysłania od wersjonowanego minimalnego rekordu oczekującego wyniku.
- Po potwierdzeniu raportu kontroler usuwa jego payload, zapamiętuje `sessionId` i `childId`, a podsumowanie sesji treningowej staje się dostępne bez oczekiwania na odświeżenie profili.
- Polling ma najwyżej jeden timer na sesję, ponawia wyłącznie `readSessionActivityResult` po stanie oczekiwania lub chwilowym błędzie sieci i kończy pracę po wyniku terminalnym albo `teardown()`.
- Wynik terminalny odświeża profile z właścicielem zapisanym w znaczniku; aktualizuje widoczny ekran tylko wtedy, gdy nadal pokazuje tę samą sesję i dziecko.
- Nowa instancja kontrolera odnajduje trwałe rekordy pending i wznawia wyłącznie GET statusu, bez ponownego `endSession` i bez raportu aktywności.

## TDD Gate Compliance

- **RED:** `f13e5e2`; `tdd-red-evidence` zwrócił `RED_EVIDENCE_OK` dla braku `savePendingResult`.
- **GREEN:** `48f7636`; testy kontrolowanego zegara potwierdzają wynik po zmianie profilu, błędzie sieci i reloadzie.
- **REFACTOR:** niepotrzebny.

## Verification

- `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/activity-draft-store.test.ts packages/kid-ui/src/session/session-controller.test.ts` — 86/86 passed.
- `corepack pnpm typecheck` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test contract] Zaktualizowano istniejące testy odczytu magazynu.**
- **Found during:** GREEN/typecheck.
- **Issue:** `load()` może zwrócić minimalny rekord pending bez `state`; trzy starsze testy zakładały, że każdy rekord ma roboczy stan raportu.
- **Fix:** Testy jawnie rozróżniają rekord roboczy przez obecność `state`.
- **Files modified:** `packages/kid-ui/src/session/activity-report.test.ts`, `packages/kid-ui/src/session/session-controller.test.ts`.
- **Commit:** `48f7636`.

## MCP Boundary

Zmiana jest lokalnym przebiegiem Kid UI. Nie rozszerza `learning-overview`, MCP ani skilla Hermesa o punkty, ocenę aktywności lub stan pollingu.

## Self-Check: PASSED

- Wszystkie zmodyfikowane pliki istnieją, bez znanych stubów.
- Commity `f13e5e2` i `48f7636` są osiągalne z `feature/async-session-completion`.
- Zmierzony zakres planu obejmuje dwa commity od `cf9d71b` do `48f7636`.
