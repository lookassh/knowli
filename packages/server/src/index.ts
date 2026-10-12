export * from "./config";
export { createProductionSubjectRegistry } from "./domain/lessons/subjects";
export { createSubjectRegistry, type SubjectRegistry } from "./domain/lessons/registry";
export { englishGrammarSubject } from "./domain/lessons/subjects/english-grammar/module";
export { historyLikeSubject } from "./domain/lessons/testing/history-like-subject";
export { validatePool, findDuplicateAnswers, poolCoverage } from "./domain/lessons/pool-validation";
export { DEFAULT_LESSON_POLICY, defaultPoolSize } from "./domain/lessons/lesson-policy";
export type {
  SubjectModule,
  LessonTopic,
  LearningObjective,
  LessonExerciseDraft,
  LessonExerciseType,
  LessonStage,
} from "./domain/lessons/types";
export * from "./errors";
export { createDatabase, migrateDatabase, type Database } from "./db/client";
export { waitUntilDatabaseReady, type DatabaseReadinessOptions } from "./db/ready";
export * as schema from "./db/schema";
export { issueIntegrationToken, listIntegrationTokens, requireLearningReadToken, revokeIntegrationToken } from "./modules/integration-tokens";
export type { IntegrationPrincipal, IntegrationTokenMetadata } from "./modules/integration-tokens";
export { getLearningOverview } from "./modules/learning-overview";
export {
  isParentSetupRequired,
  setupParent,
  loginParent,
  requireParent,
  logoutParent,
  SESSION_TTL_MS,
} from "./modules/auth";
export { listChildren, createChild, updateChild, deleteChild, getPronunciationSettings, updatePronunciationBands } from "./modules/profiles";
export {
  createEmptyDeck,
  createDraft,
  createDraftFromPublished,
  copyRevisionsSkillsAssets,
  editDraft,
  publishDraft,
  readDraft,
  readDeck,
  listDecks,
  upsertAssignment,
  archiveDeck,
  applyItems,
} from "./modules/decks";
export {
  enqueueDeckGeneration,
  executeGeneration,
  executeMediaAsset,
  retryGeneration,
  readGeneration,
  runDueGenerationWork,
  enqueueGenerationRun,
  claimQueuedRun,
  markRun,
  errorCodeOf,
  requireGeneration,
  MAX_AUTOMATIC_ATTEMPTS,
  type WorkerLimits,
} from "./modules/generation";
export {
  createLesson,
  executeLessonGeneration,
  regenerateObjective,
  applyLessonExercises,
  splitStages,
} from "./modules/lessons/lesson-drafts";
export {
  lessonCatalog,
  readLessonDeck,
  editLessonDraft,
  publishLessonDraft,
  createLessonDraftFromPublished,
  deckIdOfLessonVersion,
} from "./modules/lessons/lesson-api";
export {
  reconcileDraftAssets,
  regenerateRevisionAsset,
  omitRevisionAsset,
  readReadyMedia,
} from "./modules/media-reconciliation";
export {
  buildPayload,
  payloadToItem,
  validateItems,
} from "./modules/item-payload";
export { classifyRevisionImpact, buildSkillCriteria } from "./domain/revision-impact";
export { computeTargetKey, normalizeTargetText } from "./domain/target-key";
export { chooseReadingDirection, hasScheduledWork, selectTask } from "./domain/scheduler";
export type {
  DeckWorkloadItem,
  ScheduleCandidate,
  ScheduleInput,
  SchedulePeer,
  SkillSnapshot,
  TaskPlan,
  ScheduleReason,
  PlannedOption,
} from "./domain/scheduler";
export {
  ttsFingerprint,
  imageFingerprint,
  illustrationPrompt,
} from "./domain/media-fingerprint";
export {
  SKILLS,
  VOCABULARY_SKILLS,
  isSkill,
  isVocabularySkill,
  type Skill,
  type VocabularySkill,
  type ExerciseType,
  type PronunciationDetails,
} from "./domain/types";
export { LEARNING_V1_POLICY } from "./policies/learning-v1";
export { ensureLearningPolicy, loadPolicy, CURRENT_POLICY_ID, PolicyConfigSchema } from "./policies/registry";
export {
  startSession,
  nextTask,
  endSession,
  completePresentation,
  RESUME_WINDOW_MS,
  SESSION_TIME_LIMIT_MS,
  DEFAULT_TASK_BUDGET,
} from "./modules/sessions";
export { recordEvent, authorizeDisclosure, contextOf } from "./modules/events";
export type { SessionContextShape } from "./modules/events";
export { getMockTestReport, listMockTests, readMockTestSummary } from "./modules/mock-tests";
export {
  submitAttempt,
  readAttempt,
  finalizeAttempt,
  ATTEMPT_PROCESSING_TIMEOUT_MS,
} from "./modules/attempts";
export { listKidProfiles, listKidDecks } from "./modules/kid";
export { getProgress } from "./modules/reporting";
export { readSkillHistory, readSkillHistories, skillHistoryKey } from "./modules/skill-history";
export { persistSkillProjection } from "./modules/skill-projections";
export { rebuildProgress, type RebuildProgressOptions, type RebuildProgressReport } from "./modules/progress-rebuild";
export { evaluateWritten, evaluateChoice, evaluateNonAnswer, assessedSkills } from "./domain/evaluate";
export { chooseFeedback } from "./domain/feedback";
export { projectProgress } from "./domain/progress";
export type {
  LlmProvider,
  LlmGenerateDeckInput,
  LlmGeneratedItem,
  LessonPoolInput,
  LlmLessonObjectiveInput,
  LlmLessonTransformInput,
  LlmPromptProfileInput,
  LlmLessonStageCounts,
  TtsProvider,
  TtsSynthesizeInput,
  ImageProvider,
  ImageGenerateInput,
  AudioInput,
  TranscriptionResult,
  PronunciationResult,
  SpeechEvidence,
  SttProvider,
  PronunciationProvider,
} from "./ports/ai";
export type { MediaStore, StoredBlob } from "./ports/media";
export { createLocalMediaStore } from "./providers/media/local";
export { createOpenAiLlmProvider } from "./providers/openai/llm";
export { createOpenAiTtsProvider } from "./providers/openai/tts";
export { createOpenAiImageProvider } from "./providers/images/openai";
export { createAzureSttProvider } from "./providers/azure/stt";
export { createAzurePronunciationProvider } from "./providers/azure/pronunciation";
export {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MULTIPART_OVERHEAD_BYTES,
  normalizeAudioInput,
} from "./providers/audio/normalize";
export {
  analyzeSpeech,
  assessSpeechEvidence,
  submitSpeechAttempt,
  MIN_STT_CONFIDENCE,
  SPEECH_ANALYSIS_TIMEOUT_MS,
  type SpeechAttemptInput,
} from "./modules/speech";
export { authorizeFeedbackAudio } from "./modules/feedback-audio";
export {
  deterministicBytes,
  fakeGenerationDeps,
  fakeMediaSettings,
  fakeSpeechDeps,
  DEFAULT_FAKE_DECK_ITEMS,
  FakeImageProvider,
  FakeLlmProvider,
  FakePronunciationProvider,
  FakeSttProvider,
  FakeTtsProvider,
  type LlmBehavior,
  type LlmLessonBehavior,
} from "./providers/fake";
export { createGenerationDepsFromEnv } from "./providers/generation-env";
