/**
 * Wejście `@learning/server/testing`: publiczne API pakietu plus nazwy
 * potrzebne wyłącznie testom spoza pakietu (fake'i providerów, schemat bazy,
 * wybrane wnętrza). Kod produkcyjny tego pliku nie importuje.
 */
export * from "./index";
export * as schema from "./db/schema";
export {
  type Clock,
  type GenerationDeps,
  type LessonAgentDeps,
  type MediaSettings,
  lessonAgentPolicyFromEnv,
} from "./config";
export { withUsageScope, type UsageEvent, type UsageFeature } from "./ports/usage";
export { type UsagePrices } from "./providers/usage/prices-env";
export { createSubjectRegistry, type SubjectRegistry } from "./domain/lessons/registry";
export { englishGrammarSubject } from "./domain/lessons/subjects/english-grammar/module";
export { schoolSubject } from "./domain/lessons/subjects/school/module";
export { historyLikeSubject } from "./domain/lessons/testing/history-like-subject";
export { validatePool } from "./domain/lessons/pool-validation";
export { type LessonExerciseDraft } from "./domain/lessons/types";
export { waitUntilDatabaseReady } from "./db/ready";
export { requireLearningReadToken } from "./modules/family";
export { reviewSessionActivity } from "./modules/learning";
export { setupParent } from "./modules/family";
export { createDraft } from "./modules/materials";
export { executeGeneration } from "./modules/materials";
export { claimQueuedRun } from "./modules/materials";
export { executeMediaAsset } from "./modules/materials";
export { MAX_AUTOMATIC_ATTEMPTS } from "./modules/materials";
export { executeLessonGeneration } from "./modules/materials";
export { reconcileDraftAssets, readReadyMedia } from "./modules/materials";
export { computeTargetKey } from "./domain/target-key";
export { readTrainingSessionPlan } from "./domain/training-session-plan";
export { ttsFingerprint } from "./domain/media-fingerprint";
export { ensureLearningPolicy, loadPolicy, CURRENT_POLICY_ID } from "./policies/registry";
export { contextOf } from "./modules/learning";
export { getMockTestReport, listMockTests, readMockTestSummary } from "./modules/learning";
export { getLessonMockTestReport, listLessonMockTests, readLessonMockTestSummary } from "./modules/learning";
export { finalizeAttempt } from "./modules/learning";
export { readSkillHistories, skillHistoryKey } from "./modules/learning";
export { type TranscriptionResult, type SttProvider, type PronunciationProvider } from "./ports/ai";
export { type MediaStore } from "./ports/media";
export { FAKE_SLOW_MARKER } from "./providers/fake-lesson-pool";
export {
  deterministicBytes,
  fakeGenerationDeps,
  fakeMediaSettings,
  FakeDictationSttProvider,
  type FakeSessionActivityBehavior,
  FakeImageProvider,
  FakeLlmProvider,
  FakePronunciationProvider,
  FakeSttProvider,
  FakeTtsProvider,
  type LlmBehavior,
} from "./providers/fake";
