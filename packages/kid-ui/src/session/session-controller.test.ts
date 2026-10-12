import { describe, expect, it, vi } from "vitest";
import { KidApiError } from "../api/client";
import type {
  AttemptDto,
  DisclosureDto,
  FeedbackDto,
  KidDeckDto,
  KidProfileDto,
  LessonMockTestSummaryDto,
  PresentationCompletionDto,
  SessionDto,
  SessionSummaryDto,
  TaskDto,
} from "@learning/contracts";
import type { KidApi } from "../api/KidApi";
import type { AudioPlayer, PlatformMedia, RecorderOptions, SpeechRecorder } from "../media/platform";
import { createMemoryPreferences, MIC_DENIED_KEY, type LocalPreferences } from "../storage";
import { LearningSessionController } from "./session-controller";

/**
 * Testy jednostkowe sterownika przepływu (RF5 i kontrakt e2e zadania 9):
 * logika bez Reacta, na pełnych fake-ach API i mediów.
 */

const PROFILE_A: KidProfileDto = { childId: "11111111-1111-1111-1111-111111111111", displayName: "Ola", avatarKey: "fox", recordingMode: "hold" };
const PROFILE_B: KidProfileDto = { childId: "22222222-2222-2222-2222-222222222222", displayName: "Ewa", avatarKey: "bear", recordingMode: "toggle" };

function sessionDto(childId: string, sessionId: string, microphoneEnabled: boolean): SessionDto {
  return {
    mode: "training",
    sessionId,
    childId,
    deckId: "33333333-3333-3333-3333-333333333333",
    deckVersionId: "44444444-4444-4444-4444-444444444444",
    policyId: "learning-v1",
    microphoneEnabled,
    state: "active",
    taskBudget: 12,
    tasksIssued: 0,
    assessedTasksIssued: 0,
    startedAt: "2026-10-07T16:00:00.000Z",
    resumed: false,
  };
}

function taskDto(taskId: string, prompt: TaskDto["prompt"], remaining = 5): TaskDto {
  return {
    taskId,
    sessionId: "55555555-5555-5555-5555-555555555555",
    ordinal: 0,
    exerciseType: prompt.kind,
    direction: null,
    state: "issued",
    prompt,
    remainingAssessed: remaining,
  };
}

function attemptDto(overrides: Partial<AttemptDto> = {}): AttemptDto {
  return {
    attemptId: "66666666-6666-6666-6666-666666666666",
    taskId: "77777777-7777-7777-7777-777777777777",
    state: "completed",
    modality: "text",
    feedback: { kind: "great" },
    taskState: "completed",
    stepId: "step",
    receivedAt: "2026-10-07T16:00:01.000Z",
    completedAt: "2026-10-07T16:00:01.000Z",
    ...overrides,
  };
}

function makeRecorder(opts: { failStartWith?: unknown; startGate?: Promise<void> } = {}): SpeechRecorder & {
  cancelled: number;
  stopped: number;
  started: number;
  fail(): void;
  setFailureHandler(callback?: () => void): void;
  hitLimit(): void;
  setLimitHandler(callback?: () => void): void;
} {
  const state = { cancelled: 0, stopped: 0, started: 0 };
  let onError: (() => void) | undefined;
  let onLimit: (() => void) | undefined;
  return {
    fail() { onError?.(); },
    setFailureHandler(callback) { onError = callback; },
    hitLimit() { onLimit?.(); },
    setLimitHandler(callback) { onLimit = callback; },
    get cancelled() {
      return state.cancelled;
    },
    get stopped() {
      return state.stopped;
    },
    get started() {
      return state.started;
    },
    get active() {
      return false;
    },
    async start() {
      state.started += 1;
      await opts.startGate;
      if (opts.failStartWith !== undefined) {
        throw opts.failStartWith;
      }
    },
    async stop() {
      state.stopped += 1;
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" };
    },
    cancel() {
      state.cancelled += 1;
    },
  };
}

function makeMedia(recorder: ReturnType<typeof makeRecorder>, playGate?: Promise<void>, onStopPlayback?: () => void): PlatformMedia & { playUrls: string[]; stops: number } {
  const media = {
    playUrls: [] as string[],
    stops: 0,
    async prepareMicrophone() {},
    createRecorder: (options?: RecorderOptions) => {
      recorder.setFailureHandler(options?.onError);
      recorder.setLimitHandler(options?.onLimitReached);
      return recorder;
    },
    player: {
      async play(url: string) {
        media.playUrls.push(url);
        await playGate;
      },
      stop() {
        media.stops += 1;
        if (media.playUrls.length > 0) onStopPlayback?.();
      },
    } satisfies AudioPlayer,
  };
  return media;
}

interface ApiState {
  submitError?: unknown;
  profiles: KidProfileDto[];
  decks: KidDeckDto[];
  tasks: TaskDto[];
  attempts: AttemptDto[];
  disclosures: { taskId: string; kind: string }[];
  presentations: string[];
  endedSessions: string[];
  startedSessions: { childId: string; microphoneEnabled: boolean }[];
  submissions: { taskId: string; clientAttemptId: string; modality: string }[];
  speechSubmissions: { taskId: string; clientAttemptId: string }[];
  observations: string[];
  /** Gdy ustawione, submitAnswer rzuca TypeError (brak sieci). */
  networkDown: boolean;
  disclosureGate?: Promise<void>;
  endSessionGate?: Promise<void>;
  disclosureError?: unknown;
  feedbackAudioGate?: Promise<void>;
  feedbackAudioError?: unknown;
  feedbackAudioAssetId?: string;
  feedbackAudioCalls: string[];
  lessonMockSummary?: LessonMockTestSummaryDto;
}

function makeApi(state: ApiState): KidApi {
  return {
    async listProfiles() {
      if (state.networkDown) throw new TypeError("fetch failed");
      return state.profiles;
    },
    async listDecks() {
      return state.decks;
    },
    async startSession(input) {
      state.startedSessions.push({ childId: input.childId, microphoneEnabled: input.microphoneEnabled });
      return { ...sessionDto(input.childId, "55555555-5555-5555-5555-555555555555", input.microphoneEnabled), mode: input.mode ?? "training" };
    },
    async nextTask() {
      return state.tasks.shift() ?? null;
    },
    async submitAnswer(input) {
      if (state.submitError) throw state.submitError;
      if (state.networkDown) throw new TypeError("fetch failed");
      state.submissions.push({ taskId: input.taskId, clientAttemptId: input.clientAttemptId, modality: input.modality });
      return state.attempts.length > 0 ? (state.attempts.shift()!) : attemptDto({ taskId: input.taskId, modality: input.modality });
    },
    async submitSpeech(taskId, clientAttemptId) {
      state.speechSubmissions.push({ taskId, clientAttemptId });
      return state.attempts.length > 0 ? (state.attempts.shift()!) : attemptDto({ taskId, modality: "audio" });
    },
    async readAttempt(attemptId) {
      return state.attempts.length > 0 ? (state.attempts.shift()!) : attemptDto({ attemptId });
    },
    async authorizeDisclosure(taskId, kind): Promise<DisclosureDto> {
      state.disclosures.push({ taskId, kind });
      if (state.disclosureError !== undefined) throw state.disclosureError;
      await state.disclosureGate;
      return { taskId, stepId: "d1", kind, reveal: kind === "hint" ? { target: "Thursday" } : null };
    },
    async authorizeFeedbackAudio(attemptId) {
      state.feedbackAudioCalls.push(attemptId);
      await state.feedbackAudioGate;
      if (state.feedbackAudioError !== undefined) throw state.feedbackAudioError;
      return { attemptId, taskId: "77777777-7777-7777-7777-777777777777", stepId: "f-audio", audioAssetId: state.feedbackAudioAssetId ?? "reference-audio" };
    },
    async completePresentation(taskId): Promise<PresentationCompletionDto> {
      state.presentations.push(taskId);
      return { taskId, state: "completed", completedAt: "2026-10-07T16:00:02.000Z" };
    },
    async recordObservation(input) {
      state.observations.push(input.kind);
      return undefined;
    },
    async endSession(sessionId): Promise<SessionSummaryDto> {
      await state.endSessionGate;
      state.endedSessions.push(sessionId);
      return { sessionId, state: "completed", tasksIssued: 3, assessedTasksIssued: 2, endedAt: "2026-10-07T16:05:00.000Z",
        independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [] };
    },
    async readMockTestSummary(sessionId) {
      if (state.networkDown) throw new TypeError("fetch failed");
      return { sessionId, deckId: DECK.deckId, state: "completed", complete: true, taskBudget: 2, answeredCount: 2, solutions: [] };
    },
    async readLessonMockTestSummary(sessionId) {
      if (state.networkDown) throw new TypeError("fetch failed");
      return state.lessonMockSummary ?? { sessionId, deckId: LESSON_DECK.deckId, state: "completed", complete: true, taskBudget: 2, answeredCount: 2, solutions: [] };
    },
    mediaUrl(assetId) {
      return `https://media.test/${assetId}`;
    },
  };
}

const DECK: KidDeckDto = {
  mockTestAvailable: true,
  activeSession: null,
  deckId: "33333333-3333-3333-3333-333333333333",
  title: "Dni tygodnia",
  itemCount: 7,
  independentlyRecalledCount: 0,
  testDate: null,
  recommended: true,
};

const LESSON_DECK: KidDeckDto = {
  mockTestAvailable: true,
  activeSession: null,
  deckId: "66666666-6666-6666-6666-666666666666",
  title: "Czas Present Simple",
  itemCount: 0,
  independentlyRecalledCount: 0,
  testDate: null,
  recommended: true,
  kind: "lesson",
  subjectTitle: "Angielski",
};

function makeHarness(
  state: ApiState,
  options: { failStartWith?: unknown; startGate?: Promise<void>; initialChildId?: string; playGate?: Promise<void>; onStopPlayback?: () => void; storage?: LocalPreferences } = {},
) {
  const recorder = makeRecorder(options);
  const media = makeMedia(recorder, options.playGate, options.onStopPlayback);
  const storage = options.storage ?? createMemoryPreferences();
  const controller = new LearningSessionController({
    api: makeApi(state),
    media,
    storage,
    ...(options.initialChildId === undefined ? {} : { initialChildId: options.initialChildId }),
    pollIntervalMs: 1,
  });
  return { controller, recorder, media, storage, state };
}

async function startAtTask(state: ApiState, task: TaskDto, recorderOpts?: { failStartWith?: unknown; startGate?: Promise<void>; playGate?: Promise<void>; onStopPlayback?: () => void; storage?: LocalPreferences }) {
  state.tasks = [task];
  const harness = makeHarness(state, recorderOpts);
  await harness.controller.start();
  await harness.controller.selectProfile(state.profiles[0]!.childId);
  await harness.controller.startLearning(DECK.deckId);
  return harness;
}

describe("LearningSessionController", () => {
  it("autoryzuje wzorzec z bieżącego wyniku przed odtworzeniem", async () => {
    const state = baseState();
    const task = taskDto("77777777-7777-7777-7777-777777777777", { kind: "recall", prompt: "czwartek" });
    state.attempts = [attemptDto({ taskId: task.taskId, attemptId: "66666666-6666-6666-6666-666666666666", modality: "audio", feedback: { kind: "almost", referenceAudioAvailable: true } })];
    const harness = await startAtTask(state, task);
    await harness.controller.answerText("Thursday");
    await harness.controller.playFeedbackAudio();
    expect(state.feedbackAudioCalls).toEqual(["66666666-6666-6666-6666-666666666666"]);
    expect(harness.media.playUrls).toEqual(["https://media.test/reference-audio"]);
  });

  it("nie odtwarza autoryzacji, która wróciła już po zmianie karty", async () => {
    const state = baseState();
    const first = taskDto("77777777-7777-7777-7777-777777777777", { kind: "recall", prompt: "czwartek" });
    const second = taskDto("88888888-8888-8888-8888-888888888888", { kind: "recall", prompt: "wtorek" });
    state.tasks = [first, second];
    state.attempts = [attemptDto({ taskId: first.taskId, attemptId: "66666666-6666-6666-6666-666666666666", modality: "audio", feedback: { kind: "almost", referenceAudioAvailable: true } })];
    let release!: () => void;
    state.feedbackAudioGate = new Promise<void>((resolve) => { release = resolve; });
    const harness = await startAtTask(state, first);
    await harness.controller.answerText("Thursday");
    const pending = harness.controller.playFeedbackAudio();
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.tasks = [second];
    await harness.controller.continueLearning();
    release();
    await pending;
    expect(harness.controller.getScreen()).toMatchObject({ task: { taskId: second.taskId }, feedback: null });
    expect(harness.media.playUrls).toEqual([]);
  });

  it("zatrzymuje aktywne odtwarzanie natychmiast po przejściu z retry", async () => {
    const state = baseState();
    const task = taskDto("77777777-7777-7777-7777-777777777777", { kind: "recall", prompt: "czwartek" });
    state.attempts = [attemptDto({ taskId: task.taskId, modality: "audio", taskState: "issued", feedback: { kind: "almost", referenceAudioAvailable: true } })];
    let release!: () => void;
    const playGate = new Promise<void>((resolve) => { release = resolve; });
    const harness = await startAtTask(state, task, { playGate });
    await harness.controller.answerText("Thursday");
    const playing = harness.controller.playFeedbackAudio();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stopsBeforeRetry = harness.media.stops;
    const continuing = harness.controller.continueLearning();
    expect(harness.media.stops).toBeGreaterThan(stopsBeforeRetry);
    await continuing;
    release();
    await playing;
  });

  it("zatrzymuje odsłuch zanim serwer zakończy sesję", async () => {
    const state = baseState();
    const task = taskDto("77777777-7777-7777-7777-777777777777", { kind: "listening", options: [], audioAssetId: "question-audio" });
    let releasePlay!: () => void;
    const playGate = new Promise<void>((resolve) => { releasePlay = resolve; });
    const harness = await startAtTask(state, task, { playGate });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let releaseEnd!: () => void;
    state.endSessionGate = new Promise<void>((resolve) => { releaseEnd = resolve; });
    const stopsBeforeEnd = harness.media.stops;
    const ending = harness.controller.endNow();
    expect(harness.media.stops).toBeGreaterThan(stopsBeforeEnd);
    releaseEnd();
    releasePlay();
    await ending;
  });

  it("anuluje mikrofon przed oczekiwaniem na zakończenie sesji i nie wysyła próby po limicie", async () => {
    const state = baseState();
    const task = taskDto("speech", { kind: "speech", text: "apple", visualType: "none", imageAssetId: null, audioAssetId: null });
    const harness = await startAtTask(state, task);
    await harness.controller.prepareMicrophone();
    await harness.controller.startRecording();
    let releaseEnd!: () => void;
    state.endSessionGate = new Promise<void>((resolve) => { releaseEnd = resolve; });
    const ending = harness.controller.endNow();
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", busy: true });
    harness.recorder.hitLimit();
    releaseEnd();
    await ending;
    expect(state.speechSubmissions).toHaveLength(0);
  });

  it("unieważnia spóźniony start mikrofonu, gdy dziecko kończy sesję", async () => {
    const state = baseState();
    const task = taskDto("speech", { kind: "speech", text: "apple", visualType: "none", imageAssetId: null, audioAssetId: null });
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const harness = await startAtTask(state, task, { startGate });
    await harness.controller.prepareMicrophone();
    const starting = harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "starting" });

    let releaseEnd!: () => void;
    state.endSessionGate = new Promise<void>((resolve) => { releaseEnd = resolve; });
    const ending = harness.controller.endNow();
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", busy: true });
    releaseStart();
    await starting;
    harness.recorder.hitLimit();
    releaseEnd();
    await ending;
    expect(state.speechSubmissions).toHaveLength(0);
  });

  it("nie uruchamia opóźnionego audio zadania po anulowaniu nagrania", async () => {
    const state = baseState();
    let release!: () => void;
    state.disclosureGate = new Promise<void>((resolve) => { release = resolve; });
    const task = taskDto("77777777-7777-7777-7777-777777777777", { kind: "speech", text: "Thursday", visualType: "none", imageAssetId: null, audioAssetId: "task-audio" });
    const harness = await startAtTask(state, task);
    await harness.controller.prepareMicrophone();
    const pendingAudio = harness.controller.playTaskAudio();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const starting = harness.controller.startRecording();
    harness.controller.cancelRecording();
    await starting;
    release();
    await pendingAudio;
    expect(harness.media.playUrls).toEqual([]);
  });

  it("asynchroniczna awaria rejestratora wraca do idle bez wysyłania próby", async () => {
    const task = taskDto("speech", { kind: "speech", text: "apple", visualType: "none", imageAssetId: null, audioAssetId: null });
    const harness = await startAtTask(baseState(), task);
    await harness.controller.prepareMicrophone();
    await harness.controller.startRecording();
    harness.recorder.fail();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", recording: false, recordingNotice: expect.any(String) });
    expect(harness.state.speechSubmissions).toHaveLength(0);
  });

  it("starts mock test only after confirming server budget and advances without correctness feedback", async () => {
    const state = baseState();
    const first = taskDto("mock-1", { kind: "recall", prompt: "poniedziałek" }), second = { ...taskDto("mock-2", { kind: "recall", prompt: "wtorek" }), ordinal: 1 };
    state.tasks = [first, second];
    state.attempts = [attemptDto({ taskId: first.taskId, feedback: null, taskState: "answered" })];
    const { controller } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId); controller.setMicrophone(false);
    await controller.startMockTest(DECK.deckId);
    expect(controller.getScreen()).toMatchObject({ kind: "mockTestReady", session: { mode: "mock_test", taskBudget: 12 } });
    await controller.beginMockTest();
    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: first.taskId } });
    await controller.answerText("wrong");
    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: second.taskId }, feedback: null, processing: false });
    await controller.endNow();
    expect(controller.getScreen()).toMatchObject({ kind: "mockTestSummary", summary: { answeredCount: 2 } });
  });

  it("mock offline retry keeps identity and does not pretend to complete an answer", async () => {
    const state = baseState(); state.tasks = [taskDto("mock-1", { kind: "recall", prompt: "poniedziałek" })];
    const { controller } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId); await controller.startMockTest(DECK.deckId); await controller.beginMockTest();
    state.networkDown = true;
    await controller.answerText("Monday");
    expect(controller.getScreen()).toMatchObject({ kind: "learning", offline: true, feedback: null });
    state.networkDown = false; state.attempts = [attemptDto({ feedback: null, taskState: "answered" })];
    await controller.retry();
    expect(controller.getScreen()).toMatchObject({ kind: "mockTestSummary" });
  });
  it("mock notRemember submits difficulty without opening a hint", async () => {
    const state = baseState(); state.tasks = [taskDto("mock-1", { kind: "recall", prompt: "poniedziałek" }), taskDto("mock-2", { kind: "recall", prompt: "wtorek" })];
    state.attempts = [attemptDto({ feedback: null, taskState: "answered" })];
    const { controller } = makeHarness(state); await controller.start(); await controller.selectProfile(PROFILE_A.childId);
    await controller.startMockTest(DECK.deckId); await controller.beginMockTest(); await controller.notRemember();
    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: "mock-2" }, reveal: null });
  });
  it("conflicting answer from another browser refreshes the task instead of resending stale knowledge", async () => {
    const state = baseState(); state.tasks = [taskDto("mock-1", { kind: "recall", prompt: "poniedziałek" }), taskDto("mock-2", { kind: "recall", prompt: "wtorek" })];
    const { controller } = makeHarness(state); await controller.start(); await controller.selectProfile(PROFILE_A.childId);
    await controller.startMockTest(DECK.deckId); await controller.beginMockTest();
    state.submitError = new KidApiError("conflict", false);
    await controller.answerText("Monday"); await controller.retry();
    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: "mock-2" }, error: null, feedback: null });
  });
  it("does not play audio after authorization resolves for a task that has already advanced", async () => {
    const optionId = "88888888-8888-8888-8888-888888888888";
    const first = taskDto("mock-1", { kind: "listening", options: [{ id: optionId, text: "poniedziałek" }], audioAssetId: "old-audio" });
    const second = taskDto("mock-2", { kind: "recall", prompt: "wtorek" });
    const state = baseState(); state.tasks = [first, second];
    state.attempts = [attemptDto({ taskId: first.taskId, modality: "choice", feedback: null, taskState: "answered" })];
    let release!: () => void;
    state.disclosureGate = new Promise<void>(resolve => { release = resolve; });
    const { controller, media } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId);
    await controller.startMockTest(DECK.deckId); await controller.beginMockTest();
    expect(state.disclosures).toContainEqual({ taskId: first.taskId, kind: "audio" });

    await controller.answerChoice(optionId);
    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: second.taskId } });
    release();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(media.playUrls).not.toContain("https://media.test/old-audio");
  });
  it("does not acknowledge listening audio when playback is stopped for microphone recording", async () => {
    const listening = taskDto("t1", { kind: "listening", options: [], audioAssetId: "asset-1" });
    const state = baseState();
    let releasePlayback!: () => void;
    const playGate = new Promise<void>(resolve => { releasePlayback = resolve; });
    const harness = await startAtTask(state, listening, { playGate, onStopPlayback: releasePlayback });

    const stopsBeforePreparation = harness.media.stops;
    await harness.controller.prepareMicrophone();
    expect(harness.media.stops).toBe(stopsBeforePreparation + 1);
    await harness.controller.startRecording();
    await Promise.resolve();

    expect(state.observations).not.toContain("audio_played");
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    harness.controller.cancelRecording();
  });
  it("shows offline state when mock audio disclosure authorization fails and retries playback", async () => {
    const state = baseState();
    state.tasks = [taskDto("mock-1", { kind: "listening", options: [{ id: "option-1", text: "poniedziałek" }], audioAssetId: "audio-1" })];
    state.disclosureError = new TypeError("fetch failed");
    const { controller, media } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId);
    await controller.startMockTest(DECK.deckId); await controller.beginMockTest();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(controller.getScreen()).toMatchObject({ kind: "learning", offline: true, error: null, busy: false });
    expect(media.playUrls).toEqual([]);
    await controller.answerChoice("option-1");
    expect(state.submissions).toEqual([]);

    state.disclosureError = undefined;
    await controller.retry();
    expect(media.playUrls).toEqual(["https://media.test/audio-1"]);
    expect(controller.getScreen()).toMatchObject({ kind: "learning", offline: false });
  });
  it("refreshes a closed mock listening slot after disclosure authorization conflicts", async () => {
    const state = baseState();
    state.tasks = [
      taskDto("mock-1", { kind: "listening", options: [], audioAssetId: "audio-1" }),
      taskDto("mock-2", { kind: "recall", prompt: "wtorek" }),
    ];
    state.disclosureError = new KidApiError("conflict", false);
    const { controller } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId);
    await controller.startMockTest(DECK.deckId); await controller.beginMockTest();
    await new Promise(resolve => setTimeout(resolve, 0));
    const failedScreen = controller.getScreen();
    expect(failedScreen).toMatchObject({ kind: "learning", task: { taskId: "mock-1" } });
    expect(failedScreen.kind === "learning" && failedScreen.error).toBeTruthy();

    state.disclosureError = undefined;
    await controller.retry();
    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: "mock-2" }, error: null });
  });
  it("refreshes the task when a transport retry discovers that the mock slot already closed", async () => {
    const state = baseState(); state.tasks = [taskDto("mock-1", { kind: "recall", prompt: "poniedziałek" }), taskDto("mock-2", { kind: "recall", prompt: "wtorek" })];
    const { controller } = makeHarness(state); await controller.start(); await controller.selectProfile(PROFILE_A.childId);
    await controller.startMockTest(DECK.deckId); await controller.beginMockTest();
    state.networkDown = true;
    await controller.answerText("Monday");
    expect(controller.getScreen()).toMatchObject({ kind: "learning", offline: true, task: { taskId: "mock-1" } });

    state.networkDown = false; state.submitError = new KidApiError("conflict", false);
    await expect(controller.retry()).resolves.toBeUndefined();

    expect(controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: "mock-2" }, offline: false, error: null });
  });
  it("mediaUrl deleguje do klienta API — wspólne źródło URL obrazka i audio", () => {
    const harness = makeHarness(baseState());
    expect(harness.controller.mediaUrl("asset-1")).toBe("https://media.test/asset-1");
  });

  it("kartkówka lekcji kończy się omówieniem per cel (lessonMockTestSummary), nie słówkowym", async () => {
    const state = baseState();
    state.decks = [DECK, LESSON_DECK];
    state.tasks = [taskDto("mock-1", { kind: "recall", prompt: "I ___ (go) to school." })];
    state.attempts = [attemptDto({ taskId: "mock-1", feedback: null, taskState: "answered" })];
    state.lessonMockSummary = {
      sessionId: "55555555-5555-5555-5555-555555555555",
      deckId: LESSON_DECK.deckId,
      state: "ended",
      complete: true,
      taskBudget: 1,
      answeredCount: 1,
      solutions: [{ taskId: "mock-1", objectiveId: "obj-present-simple", titlePl: "Present Simple", exerciseType: "lesson_short_answer", prompt: "I ___ (go) to school.", childAnswer: "go", correctAnswer: "go", outcome: "correct" }],
    };
    const { controller } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId); controller.setMicrophone(false);
    await controller.startMockTest(LESSON_DECK.deckId);
    await controller.beginMockTest();
    await controller.answerText("go");
    // mimo state="ended" (znana wada 17A) kompletność bierzemy z complete=true
    expect(controller.getScreen()).toMatchObject({ kind: "lessonMockTestSummary", summary: { complete: true, deckId: LESSON_DECK.deckId, solutions: [{ objectiveId: "obj-present-simple", outcome: "correct" }] } });
  });

  it("kartkówka słówek nadal kończy się słówkowym omówieniem (bez regresji)", async () => {
    const state = baseState();
    state.tasks = [taskDto("mock-1", { kind: "recall", prompt: "poniedziałek" })];
    state.attempts = [attemptDto({ taskId: "mock-1", feedback: null, taskState: "answered" })];
    const { controller } = makeHarness(state);
    await controller.start(); await controller.selectProfile(PROFILE_A.childId); controller.setMicrophone(false);
    await controller.startMockTest(DECK.deckId);
    await controller.beginMockTest();
    await controller.answerText("Monday");
    expect(controller.getScreen()).toMatchObject({ kind: "mockTestSummary" });
  });

  it("pojedynczy profil bez initialChildId zatrzymuje się na ekranie wyboru profilu", async () => {
    const harness = makeHarness({ ...baseState(), profiles: [PROFILE_A] });
    await harness.controller.start();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "profile", profiles: [PROFILE_A] });
  });

  it("link z profilem otwiera wskazane dziecko bez ekranu wyboru", async () => {
    const harness = makeHarness(baseState(), { initialChildId: PROFILE_B.childId });

    await harness.controller.start();

    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck", childId: PROFILE_B.childId });
  });

  it("nieaktualny link z profilem pokazuje dostępne profile", async () => {
    const harness = makeHarness(
      { ...baseState(), profiles: [PROFILE_A] },
      { initialChildId: "99999999-9999-9999-9999-999999999999" },
    );

    await harness.controller.start();

    expect(harness.controller.getScreen()).toMatchObject({ kind: "profile", profiles: [PROFILE_A] });
  });

  it("dwa profile wymagają wyboru i prowadzą osobne sesje", async () => {
    const state = baseState();
    const harness = makeHarness(state);
    await harness.controller.start();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "profile" });

    await harness.controller.selectProfile(PROFILE_A.childId);
    state.tasks = [taskDto("t1", { kind: "listening", options: [], audioAssetId: "a1" })];
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.state.startedSessions[0]).toMatchObject({ childId: PROFILE_A.childId });

    await harness.controller.switchProfile();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "profile" });
    await harness.controller.selectProfile(PROFILE_B.childId);
    state.tasks = [taskDto("t2", { kind: "recall", prompt: "czwartek" })];
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.state.startedSessions[1]).toMatchObject({ childId: PROFILE_B.childId, microphoneEnabled: true });
  });

  it("exposure zamyka prezentację bez próby; koniec zadań kończy sesję", async () => {
    const exposure = taskDto("t1", { kind: "exposure", source: "czwartek", target: "Thursday", example: null, audioAssetId: null, exampleAudioAssetId: null, imageAssetId: null, visualType: "none" });
    const state = baseState();
    const harness = await startAtTask(state, exposure);
    // brak audioAssetId → bez autoodtwarzania i bez próby
    await harness.controller.completePresentation();
    expect(state.presentations).toEqual(["t1"]);
    expect(state.submissions).toHaveLength(0);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "summary" });
    expect(state.endedSessions).toHaveLength(1);
  });

  it("awaria sieci nie dopisuje sukcesu; retry używa tego samego clientAttemptId", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall);
    state.networkDown = true;
    await harness.controller.answerText("Thursday");
    const screen = harness.controller.getScreen();
    expect(screen).toMatchObject({ kind: "learning", offline: true, feedback: null });
    expect(state.submissions).toHaveLength(0);

    state.networkDown = false;
    await harness.controller.retry();
    expect(state.submissions).toHaveLength(1);
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      offline: false,
      feedback: { dto: { kind: "great" }, retry: false },
    });
  });

  it("odmowa mikrofonu przełącza na tryb bez nagrywania i jest zapamiętywana", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall, {
      failStartWith: new DOMException("Permission dismissed", "NotAllowedError"),
    });
    await harness.controller.prepareMicrophone();

    await harness.controller.startRecording();
    let screen = harness.controller.getScreen();
    expect(screen).toMatchObject({ kind: "learning", micDenied: true, recording: false });
    expect(harness.storage.read(MIC_DENIED_KEY)).toBe("1");

    // sesja dalej działa pisemnie
    await harness.controller.answerText("Thursday");
    expect(state.submissions[0]).toMatchObject({ modality: "text" });

    // kolejna sesja startuje bez mikrofonu
    await harness.controller.endNow();
    state.tasks = [recall];
    await harness.controller.learnAgain();
    await harness.controller.startLearning(DECK.deckId);
    expect(state.startedSessions.at(-1)).toMatchObject({ microphoneEnabled: false });
    screen = harness.controller.getScreen();
    expect(screen).toMatchObject({ kind: "learning" });
  });

  it("awaria mikrofonu inna niż odmowa wyłącza nagrywanie tylko do końca sesji", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall, {
      failStartWith: new DOMException("Requested device not found", "NotFoundError"),
    });
    await harness.controller.prepareMicrophone();

    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      micDenied: false,
      recording: false,
    });
    expect(harness.storage.read(MIC_DENIED_KEY)).toBeNull();

    // sesja dalej działa pisemnie, a kolejna może ponownie poprosić o mikrofon
    await harness.controller.answerText("Thursday");
    await harness.controller.endNow();
    state.tasks = [recall];
    await harness.controller.learnAgain();
    await harness.controller.startLearning(DECK.deckId);
    expect(state.startedSessions.at(-1)).toMatchObject({ microphoneEnabled: true });
  });

  it("włączenie mikrofonu na ekranie zestawów czyści zapamiętaną odmowę", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall, {
      failStartWith: new DOMException("Permission dismissed", "NotAllowedError"),
    });
    await harness.controller.prepareMicrophone();

    await harness.controller.startRecording();
    expect(harness.storage.read(MIC_DENIED_KEY)).toBe("1");

    await harness.controller.answerText("Thursday");
    await harness.controller.endNow();
    state.tasks = [recall];
    await harness.controller.learnAgain();
    let screen = harness.controller.getScreen();
    expect(screen).toMatchObject({ kind: "deck", microphone: false, micDenied: true });

    harness.controller.setMicrophone(true);
    screen = harness.controller.getScreen();
    expect(screen).toMatchObject({ kind: "deck", microphone: true, micDenied: false });
    expect(harness.storage.read(MIC_DENIED_KEY)).toBeNull();

    await harness.controller.startLearning(DECK.deckId);
    expect(state.startedSessions.at(-1)).toMatchObject({ microphoneEnabled: true });
  });

  it("ręczne wyłączenie mikrofonu na ekranie zestawów jest zapamiętywane", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall);
    await harness.controller.answerText("Thursday");
    await harness.controller.endNow();

    await harness.controller.learnAgain();
    harness.controller.setMicrophone(false);
    expect(harness.storage.read(MIC_DENIED_KEY)).toBe("1");
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "deck",
      microphone: false,
      micDenied: true,
    });

    state.tasks = [recall];
    await harness.controller.startLearning(DECK.deckId);
    expect(state.startedSessions.at(-1)).toMatchObject({ microphoneEnabled: false });
  });

  it("opuszczenie widoku anuluje nagrywanie i zatrzymuje odtwarzanie", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const harness = await startAtTask(baseState(), recall);
    await harness.controller.prepareMicrophone();

    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recording: true });
    harness.controller.teardown();
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.media.stops).toBeGreaterThanOrEqual(1);
    expect(harness.controller.getScreen()).toMatchObject({ recording: false });
  });

  it("odpowiedź ustna przechodzi przez polling aż do wyniku", async () => {
    vi.useFakeTimers();
    try {
      const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
      const state = baseState();
      state.attempts = [
        attemptDto({ state: "processing", feedback: null, taskState: "issued", modality: "audio", attemptId: "proc-1" }),
        attemptDto({ modality: "audio", feedback: { kind: "not_assessed" }, taskState: "issued" }),
      ];
      const harness = await startAtTask(state, recall);
      await harness.controller.prepareMicrophone();

      await harness.controller.startRecording();
      await vi.advanceTimersByTimeAsync(301);
      await harness.controller.stopRecording();
      expect(state.speechSubmissions).toHaveLength(1);
      const screen = harness.controller.getScreen() as { kind: string; feedback?: unknown };
      expect(screen.kind).toBe("learning");
      expect(screen).toMatchObject({ feedback: { dto: { kind: "not_assessed" } } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("release przed 300 ms nie wysyła odpowiedzi i pokazuje neutralną wskazówkę", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const harness = await startAtTask(baseState(), recall);
    await harness.controller.prepareMicrophone();
    expect(harness.controller.getScreen()).toMatchObject({ microphoneReady: true, recordingPhase: "idle" });
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording", recording: true });
    await harness.controller.stopRecording();
    expect(harness.state.speechSubmissions).toHaveLength(0);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", recordingNotice: expect.any(String) });
    expect(harness.recorder.cancelled).toBe(1);
  });

  it("anuluje intent startu, gdy rejestrator odpowie po puszczeniu", async () => {
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const harness = await startAtTask(baseState(), recall, { startGate });
    await harness.controller.prepareMicrophone();
    const starting = harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "starting" });
    harness.controller.cancelRecording();
    releaseStart();
    await starting;
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.state.speechSubmissions).toHaveLength(0);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", recording: false });
  });

  it("po 300 ms stop wysyła dokładnie jedną odpowiedź ustną", async () => {
    vi.useFakeTimers();
    try {
      const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
      const harness = await startAtTask(baseState(), recall);
      await harness.controller.prepareMicrophone();

    await harness.controller.startRecording();
      await vi.advanceTimersByTimeAsync(300);
      await harness.controller.stopRecording();
      expect(harness.state.speechSubmissions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses each selected profile mode and ignores the legacy local preference", async () => {
    const staleStorage = createMemoryPreferences({ "umiem.recordingMode": "toggle" });
    const state = baseState();
    state.tasks = [taskDto("hold", { kind: "speech", text: "apple", visualType: "none", imageAssetId: null, audioAssetId: null })];
    const harness = makeHarness(state, { initialChildId: PROFILE_A.childId, storage: staleStorage });

    await harness.controller.start();
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", session: { childId: PROFILE_A.childId }, recordingMode: "hold" });

    await harness.controller.backToDecks();
    await harness.controller.selectProfile(PROFILE_B.childId);
    state.tasks = [taskDto("toggle", { kind: "speech", text: "apple", visualType: "none", imageAssetId: null, audioAssetId: null })];
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", session: { childId: PROFILE_B.childId }, recordingMode: "toggle" });
    expect(staleStorage.read("umiem.recordingMode")).toBe("toggle");
  });

  it("„Nie pamiętam” ujawnia słowo po zgody serwera i wysyła trudność", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall);
    await harness.controller.notRemember();
    expect(state.disclosures).toEqual([{ taskId: "t1", kind: "hint" }]);
    expect(harness.controller.getScreen()).toMatchObject({ reveal: { target: "Thursday" } });
    await harness.controller.confirmReveal();
    expect(state.submissions[0]).toMatchObject({ modality: "dont_remember" });
    expect(harness.controller.getScreen()).toMatchObject({ feedback: { dto: { kind: "great" } } });
  });

  it("pytanie słuchowe odtwarza się samo po wyświetleniu (SPEC §12.2)", async () => {
    const listening = taskDto("t1", { kind: "listening", options: [], audioAssetId: "asset-q" });
    const listenHarness = await startAtTask(baseState(), listening);
    expect(listenHarness.media.playUrls).toEqual(["https://media.test/asset-q"]);

    // zadanie tekstowe nie ma audio — nic nie gra samo z siebie
    const reading = taskDto("t2", { kind: "reading", text: "Thursday", options: [] });
    const readHarness = await startAtTask(baseState(), reading);
    expect(readHarness.media.playUrls).toEqual([]);
  });

  it("przycisk przykładu odtwarza audio zdania bez zgody serwera (SPEC §22)", async () => {
    const exposure = taskDto("t1", {
      kind: "exposure",
      source: "czereśnia",
      target: "cherry",
      example: "Cherries are perfect for making pie.",
      audioAssetId: "asset-word",
      exampleAudioAssetId: "asset-example",
      imageAssetId: null,
      visualType: "none",
    });
    const harness = await startAtTask(baseState(), exposure);
    await harness.controller.playExampleAudio();
    // prezentacja sama odtwarza słowo; przycisk dokładuje zdanie przykładowe
    expect(harness.media.playUrls).toEqual(["https://media.test/asset-word", "https://media.test/asset-example"]);
    expect(harness.state.disclosures).toHaveLength(0);
  });

  it("wzorzec w recall wymaga zgody serwera; pytanie słuchowe nie", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const recallHarness = await startAtTask(baseState(), recall);
    await recallHarness.controller.playTaskAudio();
    // recall nie ma audioAssetId w prompcie — brak odtworzenia i zgody
    expect(recallHarness.state.disclosures).toHaveLength(0);

    const listening = taskDto("t2", { kind: "listening", options: [], audioAssetId: "asset-1" });
    const listenHarness = await startAtTask(baseState(), listening);
    // pytanie słuchowe odtwarza się już samo po wyświetleniu (SPEC §12.2)
    expect(listenHarness.media.playUrls).toEqual(["https://media.test/asset-1"]);
    await listenHarness.controller.playTaskAudio();
    expect(listenHarness.state.disclosures).toHaveLength(0);

    const speech = taskDto("t3", { kind: "speech", text: "Thursday", audioAssetId: "asset-2", imageAssetId: null, visualType: "none" });
    const speechHarness = await startAtTask(baseState(), speech);
    await speechHarness.controller.playTaskAudio();
    expect(speechHarness.state.disclosures).toEqual([{ taskId: "t3", kind: "audio" }]);
    expect(speechHarness.media.playUrls).toEqual(["https://media.test/asset-2"]);
  });

  it("feedback wyboru pamięta wybraną opcję także przez awarię sieci i retry", async () => {
    const chosen = "88888888-8888-8888-8888-888888888888";
    const listening = taskDto("t1", {
      kind: "listening",
      options: [{ id: chosen, text: "czwartek" }],
      audioAssetId: "99999999-9999-9999-9999-999999999999",
    });
    const state = baseState();
    const harness = await startAtTask(state, listening);

    state.networkDown = true;
    await harness.controller.answerChoice(chosen);
    expect(harness.controller.getScreen()).toMatchObject({ offline: true, feedback: null });

    state.networkDown = false;
    state.attempts = [attemptDto({
      modality: "choice",
      feedback: { kind: "incorrect", correctText: "czwartek" },
      taskState: "issued",
    })];
    await harness.controller.retry();
    expect(harness.controller.getScreen()).toMatchObject({
      feedback: { dto: { kind: "incorrect" }, retry: true, chosenOptionId: chosen },
    });

    // druga próba zaczyna bez podświetlenia; poprawny wybór znów je zapamiętuje
    await harness.controller.continueLearning();
    expect(harness.controller.getScreen()).toMatchObject({ feedback: null });
    state.attempts = [attemptDto({ modality: "choice", feedback: { kind: "great" }, taskState: "completed" })];
    await harness.controller.answerChoice(chosen);
    expect(harness.controller.getScreen()).toMatchObject({
      feedback: { dto: { kind: "great" }, retry: false, chosenOptionId: chosen },
    });
  });

  it("feedback próby innej niż wybór nie niesie wybranej opcji", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const harness = await startAtTask(baseState(), recall);
    await harness.controller.answerText("Thursday");
    const screen = harness.controller.getScreen() as {
      feedback: { dto: FeedbackDto | null; retry: boolean; chosenOptionId?: string } | null;
    };
    expect(screen.feedback?.dto).toMatchObject({ kind: "great" });
    expect(screen.feedback?.chosenOptionId).toBeUndefined();
  });

  it("próba wymowy w nowej sesji nie dziedziczy wybranej opcji po awarii", async () => {
    const chosen = "88888888-8888-8888-8888-888888888888";
    const listening = taskDto("t1", {
      kind: "listening",
      options: [{ id: chosen, text: "czwartek" }],
      audioAssetId: "99999999-9999-9999-9999-999999999999",
    });
    const state = baseState();
    const harness = await startAtTask(state, listening);

    // wybór rozbija się o brak sieci; „Koniec" domyka sesję z wiszącym wyborem
    state.networkDown = true;
    await harness.controller.answerChoice(chosen);
    expect(harness.controller.getScreen()).toMatchObject({ offline: true });
    state.networkDown = false;
    await harness.controller.endNow();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "summary" });

    // nowa sesja zaczyna od odpowiedzi ustnej — feedback wymowy pełny,
    // bez dziedziczenia chosenOptionId (pasek wyboru nie zjada heardText)
    state.tasks = [taskDto("t2", { kind: "recall", prompt: "czwartek" })];
    state.attempts = [attemptDto({ modality: "audio", feedback: { kind: "not_assessed" }, taskState: "issued" })];
    await harness.controller.learnAgain();
    await harness.controller.startLearning(DECK.deckId);
    await harness.controller.prepareMicrophone();
    vi.useFakeTimers();
    try {
      await harness.controller.startRecording();
      await vi.advanceTimersByTimeAsync(301);
      await harness.controller.stopRecording();
      const screen = harness.controller.getScreen() as {
        feedback: { dto: FeedbackDto | null; chosenOptionId?: string } | null;
      };
      expect(screen.feedback?.dto).toMatchObject({ kind: "not_assessed" });
      expect(screen.feedback?.chosenOptionId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("druga próba po błędzie zostaje na zadaniu, a koniec nie dokładuje zadań", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    state.attempts = [attemptDto({ feedback: { kind: "incorrect", correctText: "Thursday" }, taskState: "issued" })];
    const harness = await startAtTask(state, recall);
    await harness.controller.answerText("Tusday");
    expect(harness.controller.getScreen()).toMatchObject({ feedback: { retry: true } });
    await harness.controller.continueLearning();
    const afterRetry = harness.controller.getScreen();
    expect(afterRetry).toMatchObject({ kind: "learning", feedback: null, task: { taskId: "t1" } });

    // koniec: endSession raz, bez kolejnych zadań
    state.tasks = [];
    state.attempts = [];
    await harness.controller.answerText("Thursday");
    await harness.controller.continueLearning();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "summary" });
    expect(state.endedSessions).toHaveLength(1);
  });
});

function baseState(): ApiState {
  return {
    profiles: [PROFILE_A, PROFILE_B],
    decks: [DECK],
    tasks: [],
    attempts: [],
    disclosures: [],
    presentations: [],
    endedSessions: [],
    startedSessions: [],
    submissions: [],
    speechSubmissions: [],
    observations: [],
    feedbackAudioCalls: [],
    networkDown: false,
  };
}
