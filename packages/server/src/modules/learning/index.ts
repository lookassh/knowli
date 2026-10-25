/**
 * Publiczne API obszaru learning. Nauka: sesje, zadania, próby, oceny, ekspozycje, projekcje, kartkówki i rozliczenie aktywności.
 * Inne obszary importują wyłącznie stąd; wewnątrz obszaru obowiązują
 * bezpośrednie importy plików. Kolejność i zakres pilnuje test granic modułów.
 */
export { ATTEMPT_PROCESSING_TIMEOUT_MS, finalizeAttempt, readAttempt, submitAttempt } from "./attempts";
export { authorizeDisclosure, contextOf, recordEvent } from "./events";
export type { SessionContextShape } from "./events";
export { authorizeFeedbackAudio } from "./feedback-audio";
export { getPronunciationSettings, updatePronunciationBands } from "./learning-settings";
export { readLessonDeckOverviews } from "./lessons/lesson-deck-overview";
export { getLessonMockTestReport, isLessonMockPlan, listLessonMockTests, readLessonMockTestSummary } from "./lessons/lesson-mock-tests";
export { lessonContextOf } from "./lessons/lesson-sessions";
export { getMockTestReportForSession, listMockTestReportsForDeck, readMockTestSummaryForSession } from "./mock-test-reports";
export { getMockTestReport, listMockTests, readMockTestSummary } from "./mock-tests";
export { rebuildProgress } from "./progress-rebuild";
export type { RebuildProgressOptions, RebuildProgressReport } from "./progress-rebuild";
export { SESSION_ACTIVITY_RETENTION_MS, SESSION_ACTIVITY_REVIEW_DEADLINE_MS, activityDetailsAvailable, cleanupExpiredActivityReports, readSessionActivityResult, resolveInterruptedSessionActivity, reviewSessionActivity } from "./session-activity";
export type { SessionActivityErrorCode, StoredReport } from "./session-activity";
export { DEFAULT_TASK_BUDGET, completePresentation, disableSessionMicrophone, endSession, nextTask, startSession } from "./sessions";
export { readSkillHistories, readSkillHistory, skillHistoryKey } from "./skill-history";
export type { HistoryScope } from "./skill-history";
export { SKILL_PROJECTION_VERSION, persistSkillProjection } from "./skill-projections";
export { MIN_STT_CONFIDENCE, SPEECH_ANALYSIS_TIMEOUT_MS, analyzeSpeech, assessSpeechEvidence, submitSpeechAttempt } from "./speech";
export type { SpeechAttemptInput } from "./speech";
