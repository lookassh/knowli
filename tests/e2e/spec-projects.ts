/**
 * Partycja speców E2E na dwa projekty Playwright.
 *
 * `mocked` — spec nie dotyka prawdziwego backendu: całe API jest za�lepione
 * w przeglądarce (`installKidUiFixture` albo route dla `/api/v1/parent`),
 * więc testy są bezstanowe i mogą biec równolegle na wielu workerach.
 *
 * `real` — spec korzysta z prawdziwej bazy/workera świata E2E (API rodzica,
 * seedowanie przez `worldPool`, generacja przez workera). Świat jest jeden na
 * przebieg, a dane narastają między testami, więc projekt biegnie szeregowo
 * na jednym workerze; równoległość daje dopiero sharding całych światów
 * (`pnpm test:e2e:shards` lokalnie, matrix w CI).
 *
 * Nowy spec trzeba dopisać do jednej z list — pilnuje tego
 * `spec-projects.test.ts`. Spec mieszany (część testów mockowana, część
 * realna) należy do `real`.
 */
export const MOCKED_SPECS: readonly string[] = [
  "kid-activity-lifecycle.spec.ts",
  "kid-answer-contrast.spec.ts",
  "kid-decks-layout.spec.ts",
  "kid-feedback-dock.spec.ts",
  "kid-feedback-layout.spec.ts",
  "kid-flow-screens.spec.ts",
  "kid-layout-stability.spec.ts",
  "kid-mantine-responsive.spec.ts",
  "kid-mantine-theme.spec.ts",
  "kid-ui-layout.spec.ts",
  "lesson-kid.spec.ts",
  "parent-work-card.spec.ts",
  "picture-choice-layout.spec.ts",
  "picture-recognition-layout.spec.ts",
  "picture-recognition.spec.ts",
  "picture-vocabulary.spec.ts",
  "progress-panel.spec.ts",
];

export const REAL_SPECS: readonly string[] = [
  "deck-cover-image.spec.ts",
  "generation-request-retry.spec.ts",
  "kid-flow.spec.ts",
  "learning-algorithm.spec.ts",
  "learning-mcp-http.spec.ts",
  "learning-overview-api.spec.ts",
  "lesson-archive.spec.ts",
  "lesson-mock-test.spec.ts",
  "lesson-parent-supervision.spec.ts",
  "lesson-parent.spec.ts",
  "lesson-real-flow.spec.ts",
  "manual-deck-flow.spec.ts",
  "mock-test-parent.spec.ts",
  "mock-test.spec.ts",
  "navigation.spec.ts",
  "parent-edit-protection.spec.ts",
  "parent-flow.spec.ts",
  "privacy.spec.ts",
  "speech-recording-ux.spec.ts",
  "spelling-diff-feedback.spec.ts",
  "test-preparation.spec.ts",
];
