/**
 * Kosze czasowe testów integracyjnych (tests/integration).
 *
 * Pliki integracyjne biegną sekwencyjnie na jednym wspólnym kontenerze
 * Postgresa (`fileParallelism: false` w vitest.integration.config.ts —
 * każdy plik czyści tabele w beforeEach, więc równoległe pliki kasowałyby
 * sobie nawzajem dane). Równoległość daje dopiero podział na kosze
 * o zbliżonej sumie czasów plików, odpalane jako osobne procesy/joby
 * z własnym kontenerem (global-setup działa per proces) — ten sam wzorzec,
 * co REAL_BUCKETS dla E2E (tests/e2e/spec-projects.ts).
 *
 * Kosze są ułożone zachłannie (LPT) wg czasów plików (`endTime - startTime`
 * z `--reporter=json`) z pełnego lokalnego przebiegu 2026-10-26:
 * suma plików ~226 s, kosze po ~75 s. Podłogę wyznacza
 * `learning-algorithm.test.ts` (~40 s sam). Gdy czasy plików mocno urosną,
 * przelicz pomiar i ułóż kosze od nowa. Wybór kosza daje
 * `UMIEM_INTEGRATION_BUCKET` (1..N) w vitest.integration.config.ts;
 * bez niego biegnie cały zestaw.
 *
 * Nowy plik integracyjny trzeba dopisać do jednego z koszy (preferuj
 * najlżejszy) — kompletności podziału i zgodności z matrixem CI pilnuje
 * `tests/integration-buckets.test.ts` (suite jednostkowa).
 */
export const INTEGRATION_BUCKETS: readonly (readonly string[])[] = [
  [
    "tests/integration/attempts.test.ts",
    "tests/integration/auth-profiles.test.ts",
    "tests/integration/db-history-indexes.test.ts",
    "tests/integration/deck-cover.test.ts",
    "tests/integration/feedback-audio.test.ts",
    "tests/integration/generation.test.ts",
    "tests/integration/grammar-without-tts.test.ts",
    "tests/integration/history-policy-scope.test.ts",
    "tests/integration/learning-algorithm.test.ts",
    "tests/integration/lesson-attempts.test.ts",
    "tests/integration/lesson-audio.test.ts",
    "tests/integration/lesson-deck-overview.test.ts",
    "tests/integration/lesson-mock-tests.test.ts",
    "tests/integration/lesson-sessions.test.ts",
    "tests/integration/manual-decks-api.test.ts",
    "tests/integration/manual-decks.test.ts",
    "tests/integration/parent-work-card.test.ts",
    "tests/integration/reporting.test.ts",
  ],
  [
    "tests/integration/assignments-api.test.ts",
    "tests/integration/database-teardown.test.ts",
    "tests/integration/history.test.ts",
    "tests/integration/learning-overview-concurrency.test.ts",
    "tests/integration/lesson-grader.test.ts",
    "tests/integration/lesson-isolation.test.ts",
    "tests/integration/lesson-parent-api.test.ts",
    "tests/integration/lesson-parent-supervision.test.ts",
    "tests/integration/media.test.ts",
    "tests/integration/mock-test-reporting.test.ts",
    "tests/integration/parent-work-card-regressions.test.ts",
    "tests/integration/profile-navigation-benchmark.test.ts",
    "tests/integration/projection-facts.test.ts",
    "tests/integration/session-activity.test.ts",
    "tests/integration/sessions.test.ts",
    "tests/integration/speech.test.ts",
    "tests/integration/ui-audio.test.ts",
  ],
  [
    "tests/integration/deck-learning-overview.test.ts",
    "tests/integration/decks-management.test.ts",
    "tests/integration/integration-tokens.test.ts",
    "tests/integration/learning-mcp.test.ts",
    "tests/integration/learning-overview.test.ts",
    "tests/integration/lesson-generation.test.ts",
    "tests/integration/lesson-schema.test.ts",
    "tests/integration/lesson-shape.test.ts",
    "tests/integration/mock-test-report-access.test.ts",
    "tests/integration/mock-test-settings.test.ts",
    "tests/integration/mock-tests.test.ts",
    "tests/integration/picture-vocabulary.test.ts",
    "tests/integration/progress-rebuild.test.ts",
    "tests/integration/pronunciation-settings.test.ts",
    "tests/integration/recording-mode-migration.test.ts",
    "tests/integration/revisions.test.ts",
    "tests/integration/session-activity-migration.test.ts",
    "tests/integration/training-session-plan.test.ts",
  ],
];

export const INTEGRATION_SPECS: readonly string[] = INTEGRATION_BUCKETS.flat();
