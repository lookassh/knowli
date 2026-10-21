---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
plan: 05
subsystem: kid-ui-session-controller
tags: [async, polling, quiz, tdd]
requires: [durable-client-activity-polling, nonblocking-reward-feedback]
provides: [immediate-quiz-summaries, owner-bound-quiz-activity-results]
affects: [kid-ui, session-summary, mock-test-summary]
tech-stack:
  added: []
  patterns: [nonblocking-summary-details, owner-bound-terminal-result]
key-files:
  created: []
  modified:
    - packages/kid-ui/src/session/session-controller.ts
    - packages/kid-ui/src/session/session-controller.test.ts
decisions:
  - "Podsumowanie obu quizów jest emitowane z danymi końca sesji, a GET szczegółów uzupełnia je bez blokowania widoku."
  - "Wynik pollingu jest wyświetlany wyłącznie dla quizu zgodnego z zapisanym sessionId i childId."
metrics:
  duration: "~6 min"
  completed: "2026-10-21"
  status: complete
actuals:
  tokens: 3961
  tasks: 2
  commits: 1
plan_head_before: 9d4c02d7a85167a0577e13d67336fb565390d99b
plan_head_after: d65099c
requirements-completed: [ASYNC-01, ASYNC-02]
coverage:
  - id: D1
    description: "Kartkówki słówek i lekcji pokazują podsumowanie pending przed odczytem szczegółów."
    requirement: ASYNC-01
    verification:
      - kind: unit
        ref: "packages/kid-ui/src/session/session-controller.test.ts#pending quiz summaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "Wynik evaluated/error aktualizuje quiz właściciela sesji, a saldo odświeża właściwy profil."
    requirement: ASYNC-02
    verification:
      - kind: unit
        ref: "packages/kid-ui/src/session/session-controller.test.ts#quiz activity polling and profile ownership"
        status: pass
    human_judgment: false
---

# Phase 01 Plan 05: Podsumowania kartkówek Summary

Oba rodzaje kartkówek pokazują pending bez oczekiwania na GET szczegółów, a późniejszy wynik oceny pozostaje związany z sesją i dzieckiem, które ją zakończyło.

## Accomplishments

- Kontroler emituje natychmiastowe podsumowanie słówkowe lub lekcyjne z danymi dostępnymi po `endSession`; GET uzupełnia rozwiązania niezależnie.
- Błąd dodatkowego GET nie cofa ekranu ani komunikatu pending.
- Polling przekazuje `evaluated` i `error` do zgodnego widoku quizu; zmiana profilu ukrywa wynik na ekranie innego dziecka, a odświeżenie profili zachowuje saldo właściciela sesji.
- Zwykłe podsumowanie zachowuje przypisanie wyniku w dotychczasowym formacie.

## Verification

- Task 1 RED: oba testy pending otrzymały `learning` zamiast właściwego quiz summary.
- Task 1 GREEN: `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/session-controller.test.ts` — 86/86 passed.
- Task 2 RED: testy obu quizów otrzymały `already_started` zamiast terminalnego wyniku. Osobny test właściciela, po przywróceniu starego getter-a, potwierdził wyświetlenie pending profilu A na ekranie profilu B.
- Final GREEN: ten sam celowany test — 92/92 passed.
- `corepack pnpm exec tsc --noEmit -p packages/kid-ui/tsconfig.json` — passed.

## Commits

| Hash | Zmiana |
|------|--------|
| d65099c | fix(01): unblock quiz summaries and route async results |

## Deviations from Plan

None — plan wykonany zgodnie z zakresem. Nie zmieniono Kid API, reguł punktacji ani przyjętej decyzji T-01-03.

## MCP Boundary

Zmiana dotyczy lokalnego stanu i prezentacji w Kid UI. Nie zmienia endpointów, DTO publicznego API ani raportu MCP/skill Hermesa.

## Self-Check: PASSED

- Zmodyfikowane pliki kontrolera i testu istnieją.
- Test celowany i typecheck Kid UI przeszły.
- Commit kodu `d65099c` jest zapisany na gałęzi `feature/async-session-completion`; nie wykonano push ani merge.
