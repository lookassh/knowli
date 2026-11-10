/**
 * Publiczne API pakietu dla procesów produkcyjnych (web, worker, deploy).
 * Trafia tu tylko to, co te procesy importują; pilnuje tego
 * `public-barrel.architecture.test.ts`. Testy spoza pakietu biorą dodatkowe
 * nazwy (fake'i, wnętrza) z `@learning/server/testing`.
 */
export {
  type Services,
  createServices,
  graderFromEnv,
  isLessonAgentAvailable,
  lessonAgentPublicFromEnv,
  lessonExecutionFromEnv,
  lessonSpeechFromEnv,
  mediaSettingsFromEnv,
  speechFromEnv,
  systemClock,
} from "./config";
export { computeCalculationAnswer, renderCalculationPrompt } from "./domain/lessons/calculation";
export { withConfigDefaults } from "./config-defaults";
export { type UsageRecorder } from "./ports/usage";
export { createDrizzleUsageRecorder } from "./providers/usage/drizzle-recorder";
export { pricesFromEnv } from "./providers/usage/prices-env";
export { createProductionSubjectRegistry } from "./domain/lessons/subjects";
export { createDatabase, migrateDatabase } from "./db/client";
export {
  authenticateIntegrationToken,
  INTEGRATION_SCOPES,
  isIntegrationScope,
  issueIntegrationToken,
  LESSONS_WRITE_SCOPE,
  listIntegrationTokens,
  revokeIntegrationToken,
} from "./modules/family";
export { type IntegrationPrincipal, type IntegrationScope } from "./modules/family";
export { getLearningOverview } from "./modules/reporting";
export { readSessionActivityResult, cleanupExpiredActivityReports } from "./modules/learning";
export { readParentWorkCard, readParentCosts } from "./modules/reporting";
export {
  isParentSetupRequired,
  setupParentWithToken,
  loginParent,
  requireParent,
  logoutParent,
  SESSION_TTL_MS,
} from "./modules/family";
export { listChildren, createChild, updateChild, deleteChild } from "./modules/family";
export { getPronunciationSettings, updatePronunciationBands } from "./modules/learning";
export {
  createEmptyDeck,
  createDraftFromPublished,
  editDraft,
  publishDraft,
  readDraft,
  readDeck,
  listDecks,
  upsertAssignment,
  removeAssignment,
  archiveDeck,
  updateDeckSettings,
} from "./modules/materials";
export { enqueueDeckGeneration, retryGeneration, readGeneration } from "./modules/materials";
export { reportOrphanMediaBlobs, summarizeOrphanMediaReport } from "./modules/materials";
export { countForeignPendingTts, runDueGenerationWork } from "./modules/materials";
export {
  createLesson,
  createLessonFromMaterial,
  createSchoolLesson,
  regenerateObjective,
  regenerateLessonStory,
} from "./modules/materials";
export {
  createAuthoredLesson,
  getAuthoredLesson,
  appendAuthoredLesson,
  lessonAuthoringCatalog,
  replaceAuthoredLesson,
  validateAuthoredLesson,
} from "./modules/materials";
export {
  lessonCatalog,
  readLessonDeck,
  editLessonDraft,
  publishLessonDraft,
  createLessonDraftFromPublished,
  deckIdOfLessonVersion,
  regenerateLessonPromptAudio,
  regenerateLessonCardAudio,
  regenerateLessonStoryAudio,
} from "./modules/materials";
export {
  lessonObjectiveProgress,
  listLessonVerdicts,
  decideLessonVerdict,
  acceptVerdictAsVariant,
} from "./modules/materials";
export { regenerateRevisionAsset, omitRevisionAsset, readReadyMediaStream } from "./modules/materials";
export { prepareUiAudio, readUiAudio, regenerateUiAudio } from "./modules/materials";
export {
  createSourceMaterial,
  updateSourceMaterial,
  deleteSourceMaterial,
  listSourceMaterials,
  getSourceMaterial,
} from "./modules/materials";
export {
  startSession,
  disableSessionMicrophone,
  nextTask,
  endSession,
  completePresentation,
} from "./modules/learning";
export { recordEvent, authorizeDisclosure } from "./modules/learning";
export {
  getMockTestReportForSession,
  listMockTestReportsForDeck,
  readMockTestSummaryForSession,
} from "./modules/learning";
export { submitAttempt, readAttempt } from "./modules/learning";
export { listKidProfiles, listKidDecks } from "./modules/reporting";
export { getProgress } from "./modules/reporting";
export { rebuildProgress } from "./modules/learning";
export { createLocalMediaStore } from "./providers/media/local";
export { setDeckCover, clearDeckCover, generateDeckCover, MAX_DECK_COVER_BYTES } from "./modules/materials";
export { sessionActivityFromEnv } from "./config";
export { MAX_AUDIO_BYTES, MULTIPART_OVERHEAD_BYTES } from "./providers/audio/normalize";
export { submitSpeechAttempt, dictateLessonAnswer } from "./modules/learning";
export { authorizeFeedbackAudio } from "./modules/learning";
export {
  fakeSpeechDeps,
  fakeLessonSpeechDeps,
  fakeGraderDeps,
  fakeSessionActivityDeps,
  FakeAnswerGrader,
  FakeSessionActivityReviewer,
} from "./providers/fake";
export {
  createGenerationDepsFromEnv,
  generationPublicServiceFromEnv,
  imageProviderFromEnv,
} from "./providers/generation-env";
export * from "./errors";
