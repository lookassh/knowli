/**
 * Publiczne API obszaru materials. Materiały: zestawy, rewizje, kryteria, przypisania, publikacja, generowanie i zasoby.
 * Inne obszary importują wyłącznie stąd; wewnątrz obszaru obowiązują
 * bezpośrednie importy plików. Kolejność i zakres pilnuje test granic modułów.
 */
export { MAX_DECK_COVER_BYTES, MAX_DECK_COVER_SAMPLE_ITEMS, clearDeckCover, generateDeckCover, setDeckCover } from "./deck-cover";
export { assertVocabularyDeck, mockTestKindOfSession, readDeckKind, readVersionDeckKind } from "./deck-kind";
export type { DeckKind } from "./deck-kind";
export { applyItems, archiveDeck, copyRevisionsSkillsAssets, createDraft, createDraftFromPublished, createEmptyDeck, editDraft, listDecks, publishDraft, readDeck, readDraft, removeAssignment, updateDeckSettings, upsertAssignment } from "./decks";
export { claimQueuedRun, enqueueGenerationRun, markRun } from "./generation-runs";
export { MAX_AUTOMATIC_ATTEMPTS, errorCodeOf, requireGeneration } from "./generation-runtime";
export { countForeignPendingTts, runDueGenerationWork } from "./generation-worker";
export type { WorkerLimits } from "./generation-worker";
export { enqueueDeckGeneration, executeGeneration, readGeneration, retryGeneration } from "./generation";
export { buildPayload, payloadToItem, validateItems } from "./item-payload";
export { createLessonDraftFromPublished, deckIdOfLessonVersion, editLessonDraft, lessonCatalog, publishLessonDraft, readLessonDeck } from "./lessons/lesson-api";
export { applyLessonExercises, createLesson, createSchoolLesson, executeLessonGeneration, regenerateObjective, splitStages } from "./lessons/lesson-drafts";
export { acceptVerdictAsVariant, decideLessonVerdict, lessonObjectiveProgress, listLessonVerdicts } from "./lessons/lesson-supervision";
export { executeMediaAsset } from "./media-generation";
export { omitRevisionAsset, readReadyMedia, readReadyMediaStream, reconcileDraftAssets, regenerateRevisionAsset, toDisplayIllustration, ILLUSTRATION_DISPLAY_MAX_PX, type ReadyMediaStream } from "./media-reconciliation";
export { prepareUiAudio, readUiAudio } from "./ui-audio";
