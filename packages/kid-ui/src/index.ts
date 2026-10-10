export { KidApp } from "./KidApp";
export { createKidApiClient, isNetworkError, KidApiError, type KidClientOptions } from "./api/client";
export type { KidApi } from "./api/KidApi";
export { BrowserRecorder, BrowserAudioPlayer, createBrowserMedia, MAX_RECORDING_MS } from "./media/browser";
export type { AudioPlayer, PlatformMedia, RecordedAudio, SpeechRecorder } from "./media/platform";
export {
  createBrowserPreferences,
  createMemoryPreferences,
  MIC_DENIED_KEY,
  type LocalPreferences,
} from "./storage";
export {
  LearningSessionController,
  type KidScreen,
  type LearningScreen,
  type LearningSessionDeps,
} from "./session/session-controller";
export { useLearningSession } from "./session/useLearningSession";
export { Visual } from "./visuals/Visual";
export {
  computeMockTestScore,
  MOCK_TEST_SOLUTION_ICONS,
  mockTestResultBadgeClass,
  mockTestResultBadgeLabel,
  mockTestSolutionDetail,
  mockTestWordStatus,
  type MockTestResultView,
  type MockTestScore,
  type MockTestSolutionDetail,
  type MockTestWordStatus,
} from "./screens/mock-test-score";
