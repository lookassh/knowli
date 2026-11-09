---
title: 'Ukrycie komunikatu pauzy pomiaru w Kid UI'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-zaliczanie-aktywnego-czasu-nauki.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Komunikat „Pomiar czasu jest wstrzymany. Wróć do zadania, aby wznowić.” pojawia się często i jest mało zrozumiały dla dzieci.

**Approach:** Nigdy nie wyświetlaj tego komunikatu w interfejsie dziecka. Zachowaj wewnętrzne wstrzymywanie i wznawianie pomiaru aktywności.

</frozen-after-approval>

## Implementation Notes

Usunięto prezentację komunikatu oraz nieużywany tekst i styl. Zachowano `activityPaused` w kontrolerze do wznawiania liczenia po interakcji; test E2E scenariuszy tła, utraty fokusu i bezczynności potwierdza teraz brak banera. Bez zmian API ani reguł naliczania.
