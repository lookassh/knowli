export * from "./config";
export * from "./errors";
export { createDatabase, migrateDatabase, type Database } from "./db/client";
export * as schema from "./db/schema";
export {
  isParentSetupRequired,
  setupParent,
  loginParent,
  requireParent,
  logoutParent,
  SESSION_TTL_MS,
} from "./modules/auth";
export { listChildren, createChild, deleteChild } from "./modules/profiles";
export {
  createDraft,
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
  MAX_AUTOMATIC_ATTEMPTS,
  type WorkerLimits,
} from "./modules/generation";
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
export {
  ttsFingerprint,
  imageFingerprint,
  illustrationPrompt,
} from "./domain/media-fingerprint";
export { SKILLS, isSkill, type Skill } from "./domain/types";
export type {
  LlmProvider,
  LlmGenerateDeckInput,
  LlmGeneratedItem,
  TtsProvider,
  TtsSynthesizeInput,
  ImageProvider,
  ImageGenerateInput,
} from "./ports/ai";
export type { MediaStore, StoredBlob } from "./ports/media";
export { createLocalMediaStore } from "./providers/media/local";
export { createOpenAiLlmProvider } from "./providers/openai/llm";
export { createOpenAiTtsProvider } from "./providers/openai/tts";
export { createOpenAiImageProvider } from "./providers/images/openai";
export {
  deterministicBytes,
  fakeGenerationDeps,
  fakeMediaSettings,
  DEFAULT_FAKE_DECK_ITEMS,
  FakeImageProvider,
  FakeLlmProvider,
  FakeTtsProvider,
  type LlmBehavior,
} from "./providers/fake";
export { createGenerationDepsFromEnv } from "./providers/generation-env";
