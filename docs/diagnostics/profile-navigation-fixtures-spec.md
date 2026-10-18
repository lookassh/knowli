---
title: 'Dostosowanie istniejących fixture do jawnej polityki projekcji'
status: 'in-progress'
context:
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/AGENTS.md'
---

## Przydział GPT Luna medium

Zmieniaj wyłącznie pliki z `tests/integration/`: `sessions.test.ts`,
`reporting.test.ts`, `attempts.test.ts`, `learning-overview-concurrency.test.ts`,
`picture-vocabulary.test.ts`, `pronunciation-settings.test.ts`, `speech.test.ts`,
`training-session-plan.test.ts`. Możesz przeczytać nowy schema/projektor,
ale nie zmieniaj kodu produkcyjnego, innych testów ani plików innych agentów.
Nadzorca upoważnia pracę na zamierzonych współdzielonych zmianach. Bez reset,
commit, push lub połączeń z prod. UMIEM_TEST_RUN_ID=nav-fixtures dla izolacji.

Nowy child_skill_progress ma PK (child_id,skill_version_id,policy_id),
projection_version proj-3, first_issued_at i has_qualifying_assessment.
Źródło i online writer projektu są w trakcie implementacji B. Powinieneś
naprawić tylko przestarzałe SQL fixtures, które pomijają politykę albo używają
starego ON CONFLICT. Polityka musi odpowiadać scenariuszowi (session.policy_id,
profil.policy_id lub jawnie learning-v2 jeśli to wariant badanego testu),
nie arbitralnie zawsze CURRENT_POLICY_ID. Dla ręcznie materializowanego
wiarygodnego stanu ustaw zgodne lastReviewedAt/hasQualifying/firstIssuedAt,
jeśli reguła testu tego wymaga. Nie twórz produkcyjnego default/fallback dla testów.

Agent B już zaczął mechaniczne zmiany w sessions/reporting; przejąłeś te pliki,
więc sprawdź i zachowaj poprawne zmiany. Nadzorca otrzymał ostatnie błędy: raport
ignoruje fake postęp bez credible lastReviewed, dwa testy sessions podobnie.

Najpierw zaobserwuj rzeczywiste błędy starych fixtures, potem minimalne GREEN.
Nie zmieniaj oczekiwań zachowania, żeby pasowały do nowego kodu. Jeśli błąd
wynika z logiki produkcyjnej albo niejednoznacznej semantyki, zgłoś go nadzorcy
z nazwą testu i dowodem, nie osłabiaj assertion. Rebuild/policy regression
jest własnością innego agenta; nie dotykaj tych plików.

Na końcu podaj zmienione fixture, komendy, rzeczywiście przechodzące testy
i pozostałe błędy. Nie odpalaj pełnej suite. Nadzorca przeprowadzi globalną
weryfikację po stabilizacji kodu B.
