---
title: 'Powiąż asercję E2E przykładu lekcji z celem karty'
type: 'bugfix'
created: '2026-10-15'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Test E2E zakłada, że pierwsza karta dziecka dotyczy celu, którego przykład rodzic edytował. Scheduler może pokazać wcześniej kartę innego celu, a jego przykłady z fake providera są prawidłowo inne, więc test zgłasza fałszywą regresję.

**Approach:** Powiąż weryfikację tekstu przykładu z celem konkretnej karty i potwierdź, że zatwierdzony przykład celu jest widoczny w publikacji oraz na odpowiedniej karcie dziecka.

</frozen-after-approval>

## Implementation Notes

- Run `38748025747` failed because the first lesson card belonged to `affirmative_base`, while the test compared it with the edited example for `third_person_s`. The published example was correctly stored under `third_person_s`.
- `tests/e2e/lesson-real-flow.spec.ts` now waits for default objective checkboxes to finish loading, verifies selected objectives in draft and publication, and compares the first child card to the examples for its exact objective.
- Verification: the focused E2E passed, then the full `lesson-real-flow.spec.ts` passed (2/2); `tsc --noEmit -p tsconfig.json` and `git diff --check` passed.

## Review Triage Log

- `patch` — Upewnij się, że ID celu pierwszej karty nie jest null ani nie pasuje do pustych przykładów; asercja wymaga teraz dokładnie `OBJECTIVE_ID`.
- `patch` — Uzupełnij nowy artefakt o wprowadzone zmiany i weryfikację; notatki dodano, status ustawiono na `done`.
