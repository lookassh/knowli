import { describe, expect, it, vi } from "vitest";
import { messages } from "@learning/contracts";
import { createKidApiClient, KidApiError } from "../api/client";
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
import type { AudioPlayer, MicrophonePermission, PlatformMedia, RecorderOptions, SpeechRecorder } from "../media/platform";
import { LevelMonitorUnavailableError } from "../media/platform";
import { createMemoryPreferences, MIC_DENIED_KEY, type LocalPreferences } from "../storage";
import { createMemoryActivityDraftStore } from "./activity-draft-store";
import { LearningSessionController, messageForError } from "./session-controller";

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
    canRead: true,
    vocabularyFormat: "standard",
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
    exerciseType: prompt.kind as TaskDto["exerciseType"],
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

function makeRecorder(opts: { failStartWith?: unknown; startGate?: Promise<void>; sharedLog?: string[] } = {}): SpeechRecorder & {
  cancelled: number;
  stopped: number;
  started: number;
  fail(): void;
  setFailureHandler(callback?: () => void): void;
  hitLimit(): void;
  setLimitHandler(callback?: () => void): void;
  setLevelHandler(callback?: (level: number) => void): void;
  setMicrophoneReadyHandler(callback?: () => Promise<void> | void): void;
  pushLevel(level: number): void;
} {
  const state = { cancelled: 0, stopped: 0, started: 0 };
  let onError: (() => void) | undefined;
  let onLimit: (() => void) | undefined;
  let onLevel: ((level: number) => void) | undefined;
  let onMicrophoneReady: (() => Promise<void> | void) | undefined;
  return {
    fail() { onError?.(); },
    setFailureHandler(callback) { onError = callback; },
    hitLimit() { onLimit?.(); },
    setLimitHandler(callback) { onLimit = callback; },
    setLevelHandler(callback) { onLevel = callback; },
    setMicrophoneReadyHandler(callback) { onMicrophoneReady = callback; },
    pushLevel(level: number) { onLevel?.(level); },
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
      // awaria startu przerywa PRZED hookiem „teraz mów” i PRZED rozpoczęciem
      // przechwytywania (PR #109, P1 #2) — licznik started rośnie tylko przy
      // udanym starcie; awaria jest jednorazowa, kolejna próba działa
      if (opts.failStartWith !== undefined) {
        const failure = opts.failStartWith;
        opts.failStartWith = undefined;
        throw failure;
      }
      state.started += 1;
      await opts.startGate;
      // symetrycznie do BrowserRecorder: sygnał „teraz mów” awaitujemy PRZED
      // rozpoczęciem przechwytywania (quick 261021-lsw)
      await onMicrophoneReady?.();
      opts.sharedLog?.push("capture");
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

function makeMedia(recorder: ReturnType<typeof makeRecorder>, playGate?: Promise<void>, onStopPlayback?: () => void, failPlaybackBeforeStart = false, playbackDurationMs: number | null = null, sharedLog?: string[], microphonePermission: MicrophonePermission = "granted"): PlatformMedia & { playUrls: string[]; stops: number; beeps: string[]; lastRecorderOptions?: RecorderOptions; permissionQueries: number; setMicrophonePermission(next: MicrophonePermission): void } {
  const media = {
    playUrls: [] as string[],
    stops: 0,
    beeps: [] as string[],
    lastRecorderOptions: undefined as RecorderOptions | undefined,
    permissionQueries: 0,
    setMicrophonePermission(next: MicrophonePermission) {
      microphonePermission = next;
    },
    async prepareMicrophone() {
      sharedLog?.push("prepareMicrophone");
    },
    async getMicrophonePermission() {
      media.permissionQueries += 1;
      sharedLog?.push(`permission:${microphonePermission}`);
      return microphonePermission;
    },
    async playBeep(kind: "start" | "end") {
      media.beeps.push(kind);
      sharedLog?.push(`beep:${kind}`);
    },
    createRecorder: (options?: RecorderOptions) => {
      recorder.setFailureHandler(options?.onError);
      recorder.setLimitHandler(options?.onLimitReached);
      recorder.setLevelHandler(options?.onLevel);
      recorder.setMicrophoneReadyHandler(options?.onMicrophoneReady);
      media.lastRecorderOptions = options;
      return recorder;
    },
    player: {
      async play(url: string, onStarted?: (durationMs: number | null) => void) {
        media.playUrls.push(url);
        if (failPlaybackBeforeStart) throw new Error("autoplay blocked");
        onStarted?.(playbackDurationMs);
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
  listProfilesFailureCount?: number;
  listProfilesGate?: Promise<void>;
  decks: KidDeckDto[];
  tasks: TaskDto[];
  attempts: AttemptDto[];
  disclosures: { taskId: string; kind: string }[];
  presentations: string[];
  endedSessions: string[];
  disabledSessions: string[];
  startedSessions: { childId: string; microphoneEnabled: boolean; supportsPictureVocabulary: boolean }[];
  listDeckRequests?: { childId: string; microphoneEnabled?: boolean }[];
  listDeckResponses?: KidDeckDto[][];
  listDecksError?: unknown;
  startSessionResponse?: Partial<SessionDto>;
  submissions: { taskId: string; clientAttemptId: string; modality: string }[];
  speechSubmissions: { taskId: string; clientAttemptId: string }[];
  observations: string[];
  /** Gdy ustawione, submitAnswer rzuca TypeError (brak sieci). */
  networkDown: boolean;
  disclosureGate?: Promise<void>;
  readAttemptGate?: Promise<void>;
  endSessionGate?: Promise<void>;
  disclosureError?: unknown;
  feedbackAudioGate?: Promise<void>;
  feedbackAudioError?: unknown;
  feedbackAudioAssetId?: string;
  feedbackAudioCalls: string[];
  /** Zamrożone raporty aktywności dostarczone przy końcu sesji. */
  endReports: import("@learning/contracts").SessionActivityReport[];
  endSessionError?: unknown;
  endActivityResult?: import("@learning/contracts").SessionActivityResultDto;
  uiAudioReady?: boolean;
  uiAudioReadFailureCount?: number;
  uiAudioReadCalls?: number;
  lessonMockSummary?: LessonMockTestSummaryDto;
  disableError?: unknown;
  disableGate?: Promise<void>;
  startSessionIds?: string[];
}

function makeApi(state: ApiState): KidApi {
  return {
    async readUiAudio() {
      state.uiAudioReadCalls = (state.uiAudioReadCalls ?? 0) + 1;
      if ((state.uiAudioReadFailureCount ?? 0) > 0) {
        state.uiAudioReadFailureCount = state.uiAudioReadFailureCount! - 1;
        throw new TypeError("fetch failed");
      }
      return state.uiAudioReady ? { ready: true, assets: { recall: "asset-guidance" } } : { ready: false, assets: {} };
    },
    async listProfiles() {
      await state.listProfilesGate;
      if ((state.listProfilesFailureCount ?? 0) > 0) {
        state.listProfilesFailureCount = state.listProfilesFailureCount! - 1;
        throw new TypeError("fetch failed");
      }
      if (state.networkDown) throw new TypeError("fetch failed");
      return state.profiles;
    },
    async listDecks(childId, options) {
      state.listDeckRequests?.push({ childId, microphoneEnabled: options?.microphoneEnabled });
      if (state.listDecksError !== undefined) throw state.listDecksError;
      return state.listDeckResponses?.shift() ?? state.decks;
    },
    async startSession(input) {
      state.startedSessions.push({ childId: input.childId, microphoneEnabled: input.microphoneEnabled, supportsPictureVocabulary: input.supportsPictureVocabulary === true });
      const profile = state.profiles.find((item) => item.childId === input.childId);
      const deck = state.decks.find((item) => item.deckId === input.deckId);
      const sessionId = state.startSessionIds?.shift() ?? "55555555-5555-5555-5555-555555555555";
      return { ...sessionDto(input.childId, sessionId, input.microphoneEnabled), canRead: profile?.canRead ?? true, vocabularyFormat: deck?.vocabularyFormat ?? "standard", mode: input.mode ?? "training", ...state.startSessionResponse };
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
      await state.readAttemptGate;
      return state.attempts.length > 0 ? (state.attempts.shift()!) : attemptDto({ attemptId });
    },
    async authorizeDisclosure(taskId, kind): Promise<DisclosureDto> {
      state.disclosures.push({ taskId, kind });
      if (state.disclosureError !== undefined) throw state.disclosureError;
      await state.disclosureGate;
      return { taskId, stepId: "d1", kind, reveal: kind === "hint" ? { target: "Thursday" } : null, audioAssetId: "88888888-8888-4888-8888-888888888888" };
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
    async endSession(sessionId, activityReport): Promise<SessionSummaryDto> {
      await state.endSessionGate;
      if (state.endSessionError !== undefined) throw state.endSessionError;
      state.endedSessions.push(sessionId);
      if (activityReport !== undefined) state.endReports.push(activityReport);
      return { sessionId, state: "completed", tasksIssued: 3, assessedTasksIssued: 2, endedAt: "2026-10-07T16:05:00.000Z",
        independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
        ...(state.endActivityResult === undefined ? {} : { activity: state.endActivityResult }) };
    },
    async disableMicrophone(sessionId) {
      state.disabledSessions.push(sessionId);
      await state.disableGate;
      if (state.disableError !== undefined) throw state.disableError;
      return { ...sessionDto(PROFILE_A.childId, sessionId, false), canRead: false, vocabularyFormat: "picture" };
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
  options: { failStartWith?: unknown; startGate?: Promise<void>; initialChildId?: string; playGate?: Promise<void>; onStopPlayback?: () => void; failPlaybackBeforeStart?: boolean; playbackDurationMs?: number | null; storage?: LocalPreferences; activityClock?: import("./activity-report").ActivityClock; activityDrafts?: ReturnType<typeof createMemoryActivityDraftStore>; sharedLog?: string[]; microphonePermission?: MicrophonePermission } = {},
) {
  const recorder = makeRecorder(options);
  const media = makeMedia(recorder, options.playGate, options.onStopPlayback, options.failPlaybackBeforeStart, options.playbackDurationMs, options.sharedLog, options.microphonePermission ?? "granted");
  const storage = options.storage ?? createMemoryPreferences();
  const api = makeApi(state);
  const activityDrafts = options.activityDrafts ?? createMemoryActivityDraftStore();
  const controller = new LearningSessionController({
    api,
    media,
    storage,
    activityDrafts,
    ...(options.initialChildId === undefined ? {} : { initialChildId: options.initialChildId }),
    ...(options.activityClock === undefined ? {} : { activityClock: options.activityClock }),
    pollIntervalMs: 1,
  });
  return { controller, recorder, media, storage, state, api, activityDrafts };
}

async function startAtTask(state: ApiState, task: TaskDto, recorderOpts?: { failStartWith?: unknown; startGate?: Promise<void>; playGate?: Promise<void>; onStopPlayback?: () => void; failPlaybackBeforeStart?: boolean; playbackDurationMs?: number | null; storage?: LocalPreferences; microphone?: boolean; activityDrafts?: ReturnType<typeof createMemoryActivityDraftStore>; activityClock?: import("./activity-report").ActivityClock; sharedLog?: string[]; microphonePermission?: MicrophonePermission }) {
  state.tasks = [task];
  const harness = makeHarness(state, recorderOpts);
  await harness.controller.start();
  await harness.controller.selectProfile(state.profiles[0]!.childId);
  if (recorderOpts?.microphone !== false) harness.controller.setMicrophone(true);
  await harness.controller.startLearning(DECK.deckId);
  return harness;
}

describe("LearningSessionController", () => {
  it("starts learning without waiting for a background profile refresh when microphone is off", async () => {
    const state = baseState();
    let release!: () => void;
    const harness = makeHarness(state);
    await harness.controller.start();
    state.listProfilesGate = new Promise<void>(resolve => { release = resolve; });
    await harness.controller.selectProfile(PROFILE_A.childId);
    const starting = harness.controller.startLearning(DECK.deckId);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.startedSessions).toEqual([{ childId: PROFILE_A.childId, microphoneEnabled: false, supportsPictureVocabulary: true }]);
    release();
    await starting;
    harness.controller.teardown();
  });

  it("applies the newest same-epoch profile response and uses its recording mode", async () => {
    const state = baseState();
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await new Promise(resolve => setTimeout(resolve, 0));
    let resolveOlder!: (profiles: KidProfileDto[]) => void;
    let resolveNewer!: (profiles: KidProfileDto[]) => void;
    const older = new Promise<KidProfileDto[]>(resolve => { resolveOlder = resolve; });
    const newerProfiles = [{ ...PROFILE_A, displayName: "Ola aktualna", recordingMode: "toggle" as const }, PROFILE_B];
    const newer = new Promise<KidProfileDto[]>(resolve => { resolveNewer = resolve; });
    vi.spyOn(harness.api, "listProfiles")
      .mockImplementationOnce(() => older)
      .mockImplementationOnce(() => newer)
      .mockResolvedValue(newerProfiles);
    const olderRefresh = harness.controller.refreshProfiles();
    const newerRefresh = harness.controller.refreshProfiles();
    resolveNewer(newerProfiles);
    await newerRefresh;
    resolveOlder([PROFILE_A, PROFILE_B]);
    await olderRefresh;
    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck" });
    expect((harness.controller.getScreen() as Extract<ReturnType<typeof harness.controller.getScreen>, { kind: "deck" }>).profiles[0])
      .toMatchObject({ displayName: "Ola aktualna", recordingMode: "toggle" });
    state.tasks = [taskDto("fresh-mode", { kind: "recall", prompt: "Thursday" })];
    harness.controller.setMicrophone(true);
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", recordingMode: "toggle" });
    harness.controller.teardown();
  });

  it("keeps the last confirmed daily activity when its refresh is unavailable", async () => {
    const confirmed = { ...PROFILE_A, todayActivitySeconds: 25 * 60 };
    const state = baseState();
    state.profiles = [confirmed, PROFILE_B];
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await new Promise(resolve => setTimeout(resolve, 0));

    state.profiles = [{ ...PROFILE_A, todayActivityUnavailable: true }, PROFILE_B];
    await harness.controller.refreshProfiles();

    const screen = harness.controller.getScreen();
    expect(screen.kind).toBe("deck");
    if (screen.kind !== "deck") throw new Error("Expected deck screen");
    expect(screen.profiles[0]).toMatchObject({
      childId: PROFILE_A.childId,
      todayActivitySeconds: 25 * 60,
      todayActivityUnavailable: false,
    });
    harness.controller.teardown();
  });

  it.each(["answer", "presentation"])("locks %s while the server accepts the step", async (operation) => {
    const task = taskDto("telemetry-gate", operation === "answer" ? { kind: "recall", prompt: "czwartek" } : { kind: "exposure", source: "czwartek", target: "Thursday", audioAssetId: "audio", example: null, exampleAudioAssetId: null, imageAssetId: null, visualType: "none" });
    const harness = await startAtTask(baseState(), task);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    if (operation === "answer") {
      vi.spyOn(harness.api, "submitAnswer").mockImplementation(async (input) => { await gate; return makeApi(harness.state).submitAnswer(input); });
    } else {
      vi.spyOn(harness.api, "completePresentation").mockImplementation(async (taskId) => { await gate; return makeApi(harness.state).completePresentation(taskId); });
    }
    const act = () => operation === "answer" ? harness.controller.answerText("Thursday") : harness.controller.completePresentation();
    const first = act();
    const second = act();
    expect(harness.controller.getScreen()).toMatchObject({ busy: true, transitioning: true });
    release();
    await Promise.all([first, second]);
    expect(operation === "answer" ? harness.state.submissions : harness.state.presentations).toHaveLength(1);
    harness.controller.teardown();
  });

  it("shows neutral choice and transition state before grading responds", async () => {
    const chosen = "88888888-8888-8888-8888-888888888888";
    const task = taskDto("instant-neutral-choice", {
      kind: "listening", options: [{ id: chosen, text: "czwartek" }],
      audioAssetId: "99999999-9999-4999-8999-999999999999",
    });
    const harness = await startAtTask(baseState(), task);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(harness.api, "submitAnswer").mockImplementation(async (input) => { await gate; return makeApi(harness.state).submitAnswer(input); });

    const answer = harness.controller.answerChoice(chosen);
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning", busy: true, transitioning: true, pendingChoiceId: chosen,
    });
    expect(harness.state.submissions).toHaveLength(0);

    release();
    await answer;
    expect(harness.controller.getScreen()).toMatchObject({ transitioning: false, pendingChoiceId: null });
    harness.controller.teardown();
  });

  it("refreshes profile rewards after a session and when returning to profiles", async () => {
    const harness = await startAtTask(baseState(), taskDto("profile-refresh", { kind: "recall", prompt: "czwartek" }));
    const updated = { ...PROFILE_A, displayName: "Ola po sesji" };
    harness.state.profiles = [updated];
    await harness.controller.endNow();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "summary", profiles: [updated] });
    harness.state.profiles = [{ ...updated, displayName: "Ola po powrocie" }];
    await harness.controller.switchProfile();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "profile", profiles: [{ displayName: "Ola po powrocie" }] });
    harness.controller.teardown();
  });

  it("wybiera polskie komunikaty dla znanych przyczyn walidacji obrazkowej", () => {
    expect(messageForError(new KidApiError("validation", false, "picture_client_update_required"))).toContain("Zaktualizuj aplikację");
    expect(messageForError(new KidApiError("validation", false, "vocabulary_requires_reading"))).toContain("wymaga umiejętności czytania");
    expect(messageForError(new KidApiError("validation", false, "non_reader_mock_test_unavailable"))).toContain("Kartkówka nie jest dostępna");
    expect(messageForError(new KidApiError("validation", false, "picture_guidance_unavailable"))).toContain("Instrukcje głosowe");
    expect(messageForError(new KidApiError("validation", false, "picture_audio_unavailable"))).toContain("Nagranie jest chwilowo niedostępne");
    expect(messageForError(new KidApiError("validation", false))).toBe(messages.errors.validation);
  });
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

  it("deklaruje wsparcie zestawów obrazkowych i odtwarza słuchanie po jawnej akcji", async () => {
    const listening = taskDto("picture-listening", { kind: "picture_listening", audioAssetId: "asset-listening", options: [
      { id: "option-1", labelPl: "czerwony", visual: { kind: "color", color: "#ff0000" } },
      { id: "option-2", labelPl: "niebieski", visual: { kind: "color", color: "#0000ff" } },
    ] });
    const harness = await startAtTask(baseState(), listening);
    expect(harness.state.startedSessions[0]).toMatchObject({ supportsPictureVocabulary: true });
    expect(harness.media.playUrls).toEqual([]);
    await harness.controller.playTaskAudio();
    expect(harness.media.playUrls).toEqual(["https://media.test/asset-listening"]);
  });

  it("nie odtwarza instrukcji podczas uruchamiania ani nagrywania mikrofonu", async () => {
    const state = baseState();
    state.uiAudioReady = true;
    const speech = taskDto("picture-speech-guidance", {
      kind: "picture_speech", audioAssetId: "asset-pattern", visual: { kind: "color", color: "#ff0000" },
    });
    let release!: () => void;
    const startGate = new Promise<void>((resolve) => { release = resolve; });
    const harness = await startAtTask(state, speech, { startGate });
    harness.media.playUrls.length = 0;
    await harness.controller.prepareMicrophone();
    const recording = harness.controller.startRecording();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "starting" });
    await harness.controller.playGuidance("recall");
    expect(harness.media.playUrls).toEqual([]);
    release();
    await recording;
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    await harness.controller.playGuidance("recall");
    expect(harness.media.playUrls).toEqual([]);
    harness.controller.teardown();
  });

  it("ponawia pobranie katalogu instrukcji po błędzie i pustym katalogu", async () => {
    const state = baseState();
    state.uiAudioReadFailureCount = 1;
    const recall = taskDto("guidance-retry", { kind: "recall", prompt: "czwartek" });
    const harness = await startAtTask(state, recall);
    expect(state.uiAudioReadCalls).toBe(1);

    await expect(harness.controller.playGuidance("recall")).rejects.toThrow("UI audio unavailable");
    expect(state.uiAudioReadCalls).toBe(2);
    state.uiAudioReady = true;
    await harness.controller.playGuidance("recall");

    expect(state.uiAudioReadCalls).toBe(3);
    expect(harness.media.playUrls).toEqual(["https://media.test/asset-guidance"]);
  });

  it("odświeża niegotowy katalog instrukcji przy ponownej próbie", async () => {
    const state = baseState();
    const recall = taskDto("guidance-catalog-not-ready", { kind: "recall", prompt: "czwartek" });
    const harness = await startAtTask(state, recall);
    expect(state.uiAudioReadCalls).toBe(1);

    state.uiAudioReady = true;
    await harness.controller.playGuidance("recall");

    expect(state.uiAudioReadCalls).toBe(2);
    expect(harness.media.playUrls).toEqual(["https://media.test/asset-guidance"]);
  });

  it("udostępnia ponowienie i zakończenie, gdy odtwarzacz nie dekoduje audio zadania", async () => {
    const speech = taskDto("picture-speech-audio-error", {
      kind: "picture_speech", audioAssetId: "asset-pattern", visual: { kind: "color", color: "#ff0000" },
    });
    const harness = await startAtTask(baseState(), speech);
    harness.media.player.play = async () => { throw new Error("decode failed"); };
    await harness.controller.playTaskAudio();
    expect(harness.controller.getScreen()).toMatchObject({ taskAudioError: "failed" });
  });

  it("nie odtwarza autoryzacji, która wróciła już po zmianie karty", async () => {
    const state = baseState();
    const first = taskDto("77777777-7777-7777-7777-777777777777", { kind: "recall", prompt: "czwartek" });
    const second = taskDto("88888888-8888-8888-8888-888888888888", { kind: "recall", prompt: "wtorek" });
    state.tasks = [second];
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

  it("przenosi długość odtwarzacza do raportu aktywności", async () => {
    const state = baseState();
    const task = taskDto("duration-forwarding", { kind: "exposure", source: "kot", target: "cat", example: null, audioAssetId: "question-audio", exampleAudioAssetId: null, imageAssetId: null, visualType: "none" });
    let now = 0;
    let finishPlayback!: () => void;
    const playGate = new Promise<void>((resolve) => { finishPlayback = resolve; });
    const harness = await startAtTask(state, task, { playbackDurationMs: 2_000, playGate, activityClock: { now: () => now } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 2_000;
    finishPlayback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.controller.endNow();
    expect(state.endReports[0]?.tasks[0]?.playbacks).toEqual([
      expect.objectContaining({ assetId: "question-audio", toMs: 2_000 }),
    ]);
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
      state: "completed",
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
    // kompletność bierzemy z complete=true (stan completed po Fix round 1)
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
    expect(harness.state.startedSessions[0]).toMatchObject({ childId: PROFILE_A.childId, microphoneEnabled: false });

    await harness.controller.switchProfile();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "profile" });
    await harness.controller.selectProfile(PROFILE_B.childId);
    state.tasks = [taskDto("t2", { kind: "recall", prompt: "czwartek" })];
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.state.startedSessions[1]).toMatchObject({ childId: PROFILE_B.childId, microphoneEnabled: false });
  });

  it("domyślnie wyłącza mikrofon przed startem zestawu", async () => {
    const state = baseState();
    state.listDeckRequests = [];
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);

    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck", microphone: false });
    expect(state.listDeckRequests).toContainEqual({ childId: PROFILE_A.childId, microphoneEnabled: false });
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.state.startedSessions[0]).toMatchObject({ microphoneEnabled: false });
  });

  it("pokazuje błąd po nieudanym pobraniu zestawów zamiast pozostawiać ekran loading", async () => {
    const state = baseState();
    state.listDecksError = new TypeError("fetch failed");
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "initError" });
  });

  it("pokazuje zestawy przed zakończeniem odświeżenia profili i ignoruje jego wynik po zmianie profilu", async () => {
    const state = baseState();
    const harness = makeHarness(state);
    await harness.controller.start();
    let releaseProfiles!: () => void;
    state.listProfilesGate = new Promise<void>((resolve) => { releaseProfiles = resolve; });

    await harness.controller.selectProfile(PROFILE_A.childId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck", childId: PROFILE_A.childId });

    await harness.controller.selectProfile(PROFILE_B.childId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck", childId: PROFILE_B.childId });
    releaseProfiles();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck", childId: PROFILE_B.childId });
    harness.controller.teardown();
  });

  it("zachowuje zapamiętaną odmowę mikrofonu po wznowieniu sesji z mikrofonem włączonym po stronie serwera", async () => {
    const state = baseState();
    state.startSessionResponse = { microphoneEnabled: true, resumed: true };
    state.tasks = [taskDto("resumed-recall", { kind: "recall", prompt: "czwartek" })];
    const storage = createMemoryPreferences();
    storage.write(MIC_DENIED_KEY, "1");
    const harness = makeHarness(state, { storage });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);

    await harness.controller.startLearning(DECK.deckId);

    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      session: { microphoneEnabled: true, resumed: true },
      micDenied: true,
    });
  });

  it("wyłącza mikrofon po stronie serwera przy wznowieniu picture sesji nieczytającego profilu z zapisaną odmową", async () => {
    const state = baseState();
    state.profiles = [{ ...PROFILE_A, canRead: false }];
    state.decks = [{ ...DECK, vocabularyFormat: "picture" }];
    state.startSessionResponse = { microphoneEnabled: true, resumed: true, canRead: false, vocabularyFormat: "picture" };
    const recall = taskDto("resumed-picture-recall", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    state.tasks = [recall];
    state.disableError = new TypeError("fetch failed");
    const storage = createMemoryPreferences();
    storage.write(MIC_DENIED_KEY, "1");
    const harness = makeHarness(state, { storage });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);

    await harness.controller.startLearning(DECK.deckId);

    expect(state.startedSessions.at(-1)).toMatchObject({ microphoneEnabled: false });
    expect(state.disabledSessions).toEqual(["55555555-5555-5555-5555-555555555555"]);
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      session: { microphoneEnabled: true },
      task: null,
      micDenied: true,
      error: messages.errors.picture_microphone_disable_failed,
    });

    state.disableError = undefined;
    await harness.controller.retry();

    expect(state.disabledSessions).toEqual([
      "55555555-5555-5555-5555-555555555555",
      "55555555-5555-5555-5555-555555555555",
    ]);
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      session: { microphoneEnabled: false },
      task: { taskId: recall.taskId },
      micDenied: true,
      error: null,
    });
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

  it("spóźniona awaria submitu sesji A nie zmienia raportu ani ekranu sesji B", async () => {
    const taskA = taskDto("stale-session-a", { kind: "recall", prompt: "kot" });
    const taskB = taskDto("current-session-b", { kind: "recall", prompt: "pies" });
    const state = baseState();
    state.tasks = [taskA, taskB];
    state.startSessionIds = ["55555555-5555-5555-5555-555555555555", "77777777-7777-4777-8777-777777777777"];
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await harness.controller.startLearning(DECK.deckId);
    let failSubmit!: (error: Error) => void;
    const waiting = new Promise<void>((_resolve, reject) => { failSubmit = reject; });
    vi.spyOn(harness.api, "submitAnswer").mockImplementation(async () => { await waiting; throw new TypeError("fetch failed"); });
    const staleAnswer = harness.controller.answerText("cat");
    await harness.controller.selectProfile(PROFILE_B.childId);
    await harness.controller.startLearning(DECK.deckId);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", session: { sessionId: "77777777-7777-4777-8777-777777777777" }, task: { taskId: taskB.taskId }, offline: false });
    failSubmit(new TypeError("late network failure"));
    await staleAnswer;
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: taskB.taskId }, offline: false, feedback: null });
    expect(harness.activityDrafts.load("77777777-7777-4777-8777-777777777777")?.state.tasks.map((task) => task.taskId)).toEqual([taskB.taskId]);
    harness.controller.teardown();
  });

  it("spóźniony sukces submitu A po retry i starcie B nie trafia do raportu B", async () => {
    const taskA = taskDto("stale-success-a", { kind: "recall", prompt: "kot" });
    const taskB = taskDto("current-success-b", { kind: "recall", prompt: "pies" });
    const state = baseState();
    state.tasks = [taskA, taskB];
    state.startSessionIds = ["55555555-5555-5555-5555-555555555555", "77777777-7777-4777-8777-777777777777"];
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await harness.controller.startLearning(DECK.deckId);
    let finishSubmit!: (attempt: AttemptDto) => void;
    const waiting = new Promise<AttemptDto>((resolve) => { finishSubmit = resolve; });
    vi.spyOn(harness.api, "submitAnswer").mockImplementation(async () => waiting);
    const staleAnswer = harness.controller.answerText("cat");
    await harness.controller.selectProfile(PROFILE_B.childId);
    await harness.controller.startLearning(DECK.deckId);
    finishSubmit(attemptDto({ attemptId: "66666666-6666-4666-8666-666666666661", taskId: taskA.taskId }));
    await staleAnswer;
    await harness.controller.endNow();
    const reportB = state.endReports.find((report) => report.tasks.some((task) => task.taskId === taskB.taskId));
    expect(reportB?.tasks.find((task) => task.taskId === taskB.taskId)?.submittedAttempts).not.toContain("66666666-6666-4666-8666-666666666661");
    harness.controller.teardown();
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

  it("ignoruje spóźnioną odmowę z poprzedniej sesji po przygotowaniu mikrofonu w nowej", async () => {
    const oldVoiceTask = taskDto("old-picture-voice", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const newVoiceTask = taskDto("new-picture-voice", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const state = baseState();
    state.profiles = [{ ...PROFILE_A, canRead: false }];
    state.decks = [{ ...DECK, vocabularyFormat: "picture" }];
    state.tasks = [oldVoiceTask, newVoiceTask];
    state.startSessionIds = ["55555555-5555-5555-5555-555555555555", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
    let releaseDisable!: () => void;
    state.disableGate = new Promise<void>((resolve) => { releaseDisable = resolve; });
    const harness = await startAtTask(state, oldVoiceTask);
    harness.media.prepareMicrophone = async () => { throw new DOMException("Permission dismissed", "NotAllowedError"); };

    const oldPreparation = harness.controller.prepareMicrophone();
    await expect.poll(() => state.disabledSessions).toEqual(["55555555-5555-5555-5555-555555555555"]);
    await harness.controller.endNow();
    state.tasks = [newVoiceTask];
    await harness.controller.learnAgain();
    await harness.controller.setMicrophone(true);
    await harness.controller.startLearning(DECK.deckId);
    harness.media.prepareMicrophone = async () => undefined;
    await harness.controller.prepareMicrophone();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", microphoneReady: true, micDenied: false });

    releaseDisable();
    await oldPreparation;
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      session: { sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", microphoneEnabled: true },
      task: { taskId: newVoiceTask.taskId },
      microphoneReady: true,
      micDenied: false,
    });
  });

  it("ignoruje spóźnioną odmowę recorder.start po przygotowaniu mikrofonu w nowej sesji", async () => {
    const oldVoiceTask = taskDto("old-recorder-voice", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const newVoiceTask = taskDto("new-recorder-voice", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const state = baseState();
    state.profiles = [{ ...PROFILE_A, canRead: false }];
    state.decks = [{ ...DECK, vocabularyFormat: "picture" }];
    state.tasks = [oldVoiceTask, newVoiceTask];
    state.startSessionIds = ["55555555-5555-5555-5555-555555555555", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
    let releaseDisable!: () => void;
    state.disableGate = new Promise<void>((resolve) => { releaseDisable = resolve; });
    const harness = await startAtTask(state, oldVoiceTask, {
      failStartWith: new DOMException("Permission dismissed", "NotAllowedError"),
    });
    await harness.controller.prepareMicrophone();

    const oldStart = harness.controller.startRecording();
    await expect.poll(() => state.disabledSessions).toEqual(["55555555-5555-5555-5555-555555555555"]);
    await harness.controller.endNow();
    state.tasks = [newVoiceTask];
    await harness.controller.learnAgain();
    await harness.controller.setMicrophone(true);
    await harness.controller.startLearning(DECK.deckId);
    await harness.controller.prepareMicrophone();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", microphoneReady: true, micDenied: false });

    releaseDisable();
    await oldStart;
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      session: { sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", microphoneEnabled: true },
      task: { taskId: newVoiceTask.taskId },
      microphoneReady: true,
      micDenied: false,
    });
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
    harness.controller.setMicrophone(true);
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

    await harness.controller.setMicrophone(true);
    screen = harness.controller.getScreen();
    expect(screen).toMatchObject({ kind: "deck", microphone: true, micDenied: false });
    expect(harness.storage.read(MIC_DENIED_KEY)).toBeNull();

    await harness.controller.startLearning(DECK.deckId);
    expect(state.startedSessions.at(-1)).toMatchObject({ microphoneEnabled: true });
  });

  it("odmowa mikrofonu wyłącza go dla sesji obrazkowej i pomija zamkniętą kartę", async () => {
    const state = baseState();
    state.profiles = [{ ...PROFILE_A, canRead: false }];
    state.decks = [{ ...DECK, vocabularyFormat: "picture" }];
    const task = taskDto("picture-voice", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const next = taskDto("picture-listening", { kind: "picture_listening", audioAssetId: "audio-listening", options: [
      { id: "one", labelPl: "jeden", visual: { kind: "number", count: 1 } },
      { id: "two", labelPl: "dwa", visual: { kind: "number", count: 2 } },
    ] });
    state.tasks = [task, next];
    const harness = makeHarness(state, { failStartWith: new DOMException("Permission denied", "NotAllowedError") });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await harness.controller.startLearning(DECK.deckId);
    await harness.controller.startRecording();
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", session: { sessionId: "55555555-5555-5555-5555-555555555555", microphoneEnabled: false }, task: { taskId: next.taskId }, micDenied: true });
    expect(state.disabledSessions).toEqual(["55555555-5555-5555-5555-555555555555"]);
    expect(state.endedSessions).toHaveLength(0);
    expect(state.speechSubmissions).toHaveLength(0);
  });

  it("brak urządzenia wyłącza mikrofon w profilu bez czytania i wraca do zadań obrazkowych", async () => {
    const state = baseState();
    state.profiles = [{ ...PROFILE_A, canRead: false }];
    state.decks = [{ ...DECK, vocabularyFormat: "picture" }];
    const task = taskDto("picture-recall-no-device", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const next = taskDto("picture-listening-no-device", { kind: "picture_listening", audioAssetId: "audio-listening", options: [
      { id: "one", labelPl: "jeden", visual: { kind: "number", count: 1 } },
      { id: "two", labelPl: "dwa", visual: { kind: "number", count: 2 } },
    ] });
    state.tasks = [task, next];
    const harness = makeHarness(state, { failStartWith: new DOMException("Requested device not found", "NotFoundError") });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await harness.controller.startLearning(DECK.deckId);
    await harness.controller.prepareMicrophone();
    await harness.controller.startRecording();

    expect(state.disabledSessions).toEqual(["55555555-5555-5555-5555-555555555555"]);
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning", session: { microphoneEnabled: false }, task: { taskId: next.taskId }, micDenied: false,
    });
    expect(harness.storage.read(MIC_DENIED_KEY)).toBeNull();
    expect(state.speechSubmissions).toHaveLength(0);
  });

  it("po awarii disable-microphone pozwala ponowić zmianę i dopiero wtedy przechodzi dalej", async () => {
    const state = baseState();
    state.profiles = [{ ...PROFILE_A, canRead: false }];
    state.decks = [{ ...DECK, vocabularyFormat: "picture" }];
    const task = taskDto("picture-voice", { kind: "picture_recall", visual: { kind: "number", count: 2 } });
    const next = taskDto("picture-listening", { kind: "picture_listening", audioAssetId: "audio-listening", options: [
      { id: "one", labelPl: "jeden", visual: { kind: "number", count: 1 } },
      { id: "two", labelPl: "dwa", visual: { kind: "number", count: 2 } },
    ] });
    state.tasks = [task, next];
    state.disableError = new TypeError("fetch failed");
    const harness = makeHarness(state, { failStartWith: new DOMException("Permission denied", "NotAllowedError") });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    await harness.controller.startLearning(DECK.deckId);
    await harness.controller.startRecording();
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", task: { taskId: task.taskId }, error: messages.errors.picture_microphone_disable_failed });

    state.disableError = undefined;
    await harness.controller.retry();
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      session: { microphoneEnabled: false },
      task: { taskId: next.taskId },
      error: null,
    });
  });

  it("ręczne wyłączenie mikrofonu na ekranie zestawów jest zapamiętywane", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    const harness = await startAtTask(state, recall);
    await harness.controller.answerText("Thursday");
    await harness.controller.endNow();

    await harness.controller.learnAgain();
    await harness.controller.setMicrophone(false);
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

  it("wysyła jeden zamrożony raport aktywności przy końcu sesji i usuwa kopię roboczą", async () => {
    const state = baseState();
    const task = taskDto("report-task", { kind: "recall", prompt: "czwartek" });
    state.endActivityResult = { status: "evaluated", pointsAwarded: 3, errorCode: null };
    const harness = await startAtTask(state, task);
    await harness.controller.answerText("Thursday");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // kopia robocza istnieje w trakcie sesji...
    expect(harness.activityDrafts.load("55555555-5555-5555-5555-555555555555")).not.toBeNull();
    await harness.controller.endNow();
    const report = harness.state.endReports[0]!;
    expect(harness.state.endReports).toHaveLength(1);
    expect(report.version).toBe(1);
    expect(report.tasks.map((entry) => entry.taskId)).toContain(task.taskId);
    expect(report.tasks[0]!.submittedAttempts).toContain("66666666-6666-6666-6666-666666666666");
    // ...i znika po potwierdzonym zapisie
    expect(harness.activityDrafts.load("55555555-5555-5555-5555-555555555555")).toBeNull();
    expect(harness.controller.getActivityResult()).toMatchObject({ status: "evaluated", pointsAwarded: 3 });
    harness.controller.teardown();
  });

  it("zachowuje kopię roboczą, gdy żądanie końca sesji straci sieć", async () => {
    const state = baseState();
    const harness = await startAtTask(state, taskDto("report-keep", { kind: "recall", prompt: "czwartek" }));
    state.endSessionError = new TypeError("fetch failed");
    await harness.controller.endNow();
    // Awaria sieci ukrywa treść i pozwala ponowić — raport nie został dostarczony.
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", offline: true });
    expect(harness.state.endReports).toHaveLength(0);
    expect(harness.activityDrafts.load("55555555-5555-5555-5555-555555555555")).not.toBeNull();
    state.endSessionError = undefined;
    await harness.controller.retry();
    expect(harness.state.endReports).toHaveLength(1);
    expect(harness.activityDrafts.load("55555555-5555-5555-5555-555555555555")).toBeNull();
    harness.controller.teardown();
  });

  it("odzyskuje finalny raport przez nową instancję kontrolera po utracie odpowiedzi", async () => {
    const state = baseState();
    const drafts = createMemoryActivityDraftStore();
    const first = await startAtTask(state, taskDto("final-recovery", { kind: "recall", prompt: "czwartek" }), { activityDrafts: drafts });
    state.endSessionError = new TypeError("fetch failed");
    await first.controller.endNow();
    const saved = drafts.listForChild(PROFILE_A.childId)[0]!;
    expect(saved.finalPayload).toBeDefined();
    const exactPayload = saved.finalPayload;
    first.controller.teardown();

    state.endSessionError = undefined;
    const restored = makeHarness(state, { activityDrafts: drafts, initialChildId: PROFILE_A.childId });
    await restored.controller.start();
    expect(state.endReports).toHaveLength(1);
    expect(state.endReports[0]).toEqual(exactPayload);
    expect(drafts.load("55555555-5555-5555-5555-555555555555")).toBeNull();
    restored.controller.teardown();
  });

  it("odświeża deck po odzyskaniu ACK, zanim wznowi kartkówkę z pierwszego snapshotu", async () => {
    const state = baseState();
    const oldSessionId = "88888888-8888-4888-8888-888888888888";
    const activeDeck = { ...DECK, activeSession: { sessionId: oldSessionId, mode: "mock_test" as const } };
    const drafts = createMemoryActivityDraftStore();
    drafts.save({ sessionId: oldSessionId, childId: PROFILE_A.childId, savedAtMs: Date.now(), state: {
      version: 1, startedAtMs: 0, lastActivityAtMs: 0, lastEventAtMs: 0, activeStartMs: null, openPlayback: null,
      pendingPause: null, currentTaskId: null, compacted: false, incomplete: undefined, tasks: [],
    }, finalPayload: { version: 1, elapsedMs: 1, activeMs: 0, compacted: false, tasks: [] } });
    state.listDeckRequests = [];
    state.listDeckResponses = [[activeDeck], [DECK]];
    state.endActivityResult = { status: "evaluated", pointsAwarded: 1, errorCode: null };
    const harness = makeHarness(state, { activityDrafts: drafts });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    expect(state.listDeckRequests).toHaveLength(2);
    expect(state.startedSessions).toHaveLength(0);
    expect(drafts.load(oldSessionId)).toBeNull();
    harness.controller.teardown();
  });

  it("zachowuje draft po already_started i usuwa go dopiero po końcowym wyniku", async () => {
    const state = baseState();
    const sessionId = "88888888-8888-4888-8888-888888888888";
    const drafts = createMemoryActivityDraftStore();
    drafts.save({ sessionId, childId: PROFILE_A.childId, savedAtMs: Date.now(), state: {
      version: 1, startedAtMs: 0, lastActivityAtMs: 0, lastEventAtMs: 0, activeStartMs: null, openPlayback: null,
      pendingPause: null, currentTaskId: null, compacted: false, incomplete: undefined, tasks: [],
    }, finalPayload: { version: 1, elapsedMs: 1, activeMs: 0, compacted: false, tasks: [] } });
    state.listDeckResponses = [[DECK], [DECK], [DECK]];
    state.endActivityResult = { status: "already_started", pointsAwarded: 0, errorCode: null };
    const harness = makeHarness(state, { activityDrafts: drafts });
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    expect(drafts.load(sessionId)?.finalPayload).toBeDefined();
    state.endActivityResult = { status: "evaluated", pointsAwarded: 1, errorCode: null };
    await harness.controller.selectProfile(PROFILE_A.childId);
    expect(drafts.load(sessionId)).toBeNull();
    harness.controller.teardown();
  });

  it("nie dołącza raportu, gdy sesja zakończyła się przed pierwszym zadaniem", async () => {
    const state = baseState();
    state.tasks = [];
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(state.profiles[0]!.childId);
    await harness.controller.startLearning(DECK.deckId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.controller.getScreen()).toMatchObject({ kind: "summary" });
    expect(harness.state.endReports).toHaveLength(0);
    expect(harness.controller.getActivityResult()).toBeNull();
    harness.controller.teardown();
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

  it("po błędzie i ponowieniu podpowiedzi usuwa stan przejścia po ujawnieniu", async () => {
    const state = baseState();
    state.disclosureError = new TypeError("fetch failed");
    const harness = await startAtTask(state, taskDto("hint-retry", { kind: "recall", prompt: "czwartek" }));
    await harness.controller.notRemember();
    state.disclosureError = undefined;
    await harness.controller.retry();
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning", reveal: { target: "Thursday" }, busy: false, transitioning: false,
    });
  });

  it("ujawnia wizualizację dla obrazkowego przypomnienia i przed dźwiękiem ponownie autoryzuje ekspozycję", async () => {
    const recall = taskDto("picture-recall", { kind: "picture_recall", visual: { kind: "color", color: "#ff0000" } });
    const harness = await startAtTask(baseState(), recall);
    await harness.controller.notRemember();
    expect(harness.controller.getScreen()).toMatchObject({ reveal: { visual: { kind: "color", color: "#ff0000" }, audioAssetId: expect.any(String) } });
    await harness.controller.playRevealAudio();
    expect(harness.state.disclosures.map((d) => d.kind)).toEqual(["hint", "audio"]);
    expect(harness.media.playUrls).toEqual(["https://media.test/88888888-8888-4888-8888-888888888888"]);
  });

  it("po przeładowaniu poluje na oczekującą próbę zamiast pozwolić nagrać drugi raz", async () => {
    const pendingTask = { ...taskDto("pending-task", { kind: "picture_recall", visual: { kind: "number", count: 3 } }), pendingAttemptId: "66666666-6666-4666-8666-666666666666" };
    const state = baseState();
    state.tasks = [pendingTask];
    state.attempts = [attemptDto({ taskId: pendingTask.taskId, attemptId: pendingTask.pendingAttemptId, modality: "audio" })];
    let releaseAttempt!: () => void;
    state.readAttemptGate = new Promise<void>((resolve) => { releaseAttempt = resolve; });
    const harness = makeHarness(state);
    await harness.controller.start();
    await harness.controller.selectProfile(PROFILE_A.childId);
    const starting = harness.controller.startLearning(DECK.deckId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", processing: true, busy: true });
    expect(harness.activityDrafts.load("55555555-5555-5555-5555-555555555555")?.state.pendingPause?.kind).toBe("technical_wait");
    releaseAttempt();
    await starting;
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", feedback: { attemptId: pendingTask.pendingAttemptId }, busy: false, processing: false });
    expect(state.speechSubmissions).toHaveLength(0);
    expect(state.submissions).toHaveLength(0);
  });

  it("pytanie słuchowe odtwarza się samo po wyświetleniu (SPEC §12.2)", async () => {
    const listening = taskDto("t1", { kind: "listening", options: [], audioAssetId: "asset-q" });
    const listenHarness = await startAtTask(baseState(), listening);
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("pokazuje błąd sieci przy autoryzacji wzorca picture Recall i ponawia playback", async () => {
    const state = baseState();
    const recall = taskDto("picture-audio-offline", { kind: "picture_recall", visual: { kind: "color", color: "#ff0000" } });
    state.disclosureError = new TypeError("fetch failed");
    const harness = await startAtTask(state, recall);

    await harness.controller.playTaskAudio();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", offline: true, error: null });
    expect(harness.media.playUrls).toEqual([]);

    state.disclosureError = new KidApiError("conflict", false);
    await harness.controller.retry();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", busy: false, transitioning: false });

    state.disclosureError = undefined;
    await harness.controller.retry();
    expect(state.disclosures).toHaveLength(3);
    expect(harness.media.playUrls).toHaveLength(1);
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", offline: false, busy: false, transitioning: false });

    state.disclosureError = new TypeError("fetch failed");
    harness.controller.markOffline();
    await harness.controller.retry();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", offline: true, busy: false, transitioning: false });
    state.disclosureError = undefined;
    await harness.controller.retry();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "learning", offline: false, busy: false, transitioning: false });
  });

  it("autoryzuje odsłuch picture Recall tylko raz", async () => {
    const state = baseState();
    const recall = { ...taskDto("picture-recall-audio", { kind: "picture_recall", visual: { kind: "color", color: "#ff0000" } }), exerciseType: "recall" as const };
    const harness = await startAtTask(state, recall);

    await harness.controller.playTaskAudio();

    expect(state.disclosures).toEqual([{ taskId: recall.taskId, kind: "audio" }]);
    expect(harness.media.playUrls).toHaveLength(1);
  });

  it("odsłuch lekcji tekstowej wymaga zgody serwera PRZED odtworzeniem (wsparcie wym. 4.6)", async () => {
    const gap = taskDto("tg", { kind: "lesson_gap", instructionPl: "Uzupełnij", stemWithGap: "He ___ (go).", audioAssetId: "asset-gap" });
    const gapHarness = await startAtTask(baseState(), gap);
    // lekcja tekstowa NIE odtwarza się sama — dopiero „Posłuchaj”
    expect(gapHarness.media.playUrls).toEqual([]);
    await gapHarness.controller.playTaskAudio();
    expect(gapHarness.state.disclosures).toEqual([{ taskId: "tg", kind: "audio" }]);
    expect(gapHarness.media.playUrls).toEqual(["https://media.test/asset-gap"]);

    // Typ zamknięty bez audioAssetId: żadnego odtworzenia ani zgody.
    const choice = taskDto("tc", { kind: "lesson_choice", instructionPl: "Wybierz", stem: "He ___.", options: [{ id: "o1", text: "goes" }] });
    const choiceHarness = await startAtTask(baseState(), choice);
    await choiceHarness.controller.playTaskAudio();
    expect(choiceHarness.state.disclosures).toHaveLength(0);
    expect(choiceHarness.media.playUrls).toEqual([]);
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

describe("LearningSessionController — automatyczna próba mowy z VAD (quick 261021-lsw)", () => {
  const speechTask = () => taskDto("auto-speech", { kind: "speech", text: "apple", visualType: "none", imageAssetId: null, audioAssetId: null });

  it("auto-próba: bip startu po gotowości mikrofonu i przed rozpoczęciem przechwytywania (D-04)", async () => {
    const log: string[] = [];
    const harness = await startAtTask(baseState(), speechTask(), { sharedLog: log });
    await harness.controller.prepareMicrophone();
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    // kolejność: prepareMicrophone → playBeep("start") → marker przechwytywania
    expect(log).toEqual(["prepareMicrophone", "beep:start", "capture"]);
    harness.controller.teardown();
  });

  it("odrzucenie bipu startu nie blokuje nagrywania (bip opcjonalny, nagrywanie obowiązkowe)", async () => {
    const harness = await startAtTask(baseState(), speechTask());
    await harness.controller.prepareMicrophone();
    harness.media.playBeep = async () => {
      throw new Error("autoplay blocked");
    };
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.recorder.started).toBe(1);
    harness.controller.teardown();
  });

  it("ręczne startRecording nie przekazuje hooka i nie gra bipu startu", async () => {
    const log: string[] = [];
    const harness = await startAtTask(baseState(), speechTask(), { sharedLog: log });
    await harness.controller.prepareMicrophone();
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.media.lastRecorderOptions?.onMicrophoneReady).toBeUndefined();
    expect(harness.media.beeps).toEqual([]);
    harness.controller.cancelRecording();
  });

  it("auto-stop po mowie i ~1,2 s ciszy: jedno stopRecording, jedna próba audio, bip końca (D-03)", async () => {
    vi.useFakeTimers();
    try {
      const task = speechTask();
      const harness = await startAtTask(baseState(), task);
      await harness.controller.prepareMicrophone();
      await harness.controller.autoCaptureSpeech();
      expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
      await vi.advanceTimersByTimeAsync(300);
      let releaseSubmit!: () => void;
      const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
      vi.spyOn(harness.api, "submitSpeech").mockImplementation(async (taskId, clientAttemptId, audio) => {
        await submitGate;
        return makeApi(harness.state).submitSpeech(taskId, clientAttemptId, audio);
      });
      // mowa 2 próbki (bez martwej strefy — PR #109 P1 #1), cisza 12
      for (let index = 0; index < 3; index += 1) harness.recorder.pushLevel(1);
      for (let index = 0; index < 2; index += 1) harness.recorder.pushLevel(0.2);
      for (let index = 0; index < 12; index += 1) harness.recorder.pushLevel(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.recorder.stopped).toBe(1);
      expect(harness.recorder.cancelled).toBe(0);
      // bip końca po zebraniu bajtów, przed wysyłką (nie blokuje submitSpeech)
      expect(harness.media.beeps).toEqual(["start", "end"]);
      expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", processing: true, busy: true });
      releaseSubmit();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.state.speechSubmissions).toHaveLength(1);
      expect(harness.state.speechSubmissions[0]).toMatchObject({ taskId: task.taskId });
      expect(harness.controller.getScreen()).toMatchObject({ feedback: { modality: "audio" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cisza bez mowy: limit 15 s anuluje nagrywanie z komunikatem i bez próby (SPEC §15)", async () => {
    const harness = await startAtTask(baseState(), speechTask());
    await harness.controller.prepareMicrophone();
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    harness.recorder.hitLimit();
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.recorder.stopped).toBe(0);
    expect(harness.state.speechSubmissions).toHaveLength(0);
    expect(harness.controller.getScreen()).toMatchObject({
      recordingPhase: "idle",
      recordingNotice: messages.kid.autoCaptureNoSpeech,
    });
  });

  it("limit po usłyszanej mowie prowadzi do stopRecording — realna mowa nie zostaje porzucona", async () => {
    vi.useFakeTimers();
    try {
      const harness = await startAtTask(baseState(), speechTask());
      await harness.controller.prepareMicrophone();
      await harness.controller.autoCaptureSpeech();
      await vi.advanceTimersByTimeAsync(400);
      // 5 próbek mowy → speechDetected (sustain 2); bez ciszy limit domyka nagranie
      for (let index = 0; index < 5; index += 1) harness.recorder.pushLevel(0.3);
      harness.recorder.hitLimit();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.recorder.stopped).toBe(1);
      expect(harness.recorder.cancelled).toBe(0);
      expect(harness.state.speechSubmissions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("odmowa mikrofonu w trybie auto: ścieżka micDenied, zero próby, brak pętli ponowień", async () => {
    const harness = await startAtTask(baseState(), speechTask());
    harness.media.prepareMicrophone = async () => {
      throw new DOMException("Permission dismissed", "NotAllowedError");
    };
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ micDenied: true, recordingPhase: "idle", recording: false });
    expect(harness.recorder.started).toBe(0);
    expect(harness.state.speechSubmissions).toHaveLength(0);
    expect(harness.storage.read(MIC_DENIED_KEY)).toBe("1");
    // ponowne wywołanie nie odpala kolejnej próby — tylko przycisk
    await harness.controller.autoCaptureSpeech();
    expect(harness.recorder.started).toBe(0);
  });

  it("teardown w trakcie auto-nagrywania anuluje bez próby; drugie autoCaptureSpeech to no-op (RF5)", async () => {
    const harness = await startAtTask(baseState(), speechTask());
    await harness.controller.prepareMicrophone();
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    await harness.controller.autoCaptureSpeech();
    expect(harness.recorder.started).toBe(1);
    harness.controller.teardown();
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.state.speechSubmissions).toHaveLength(0);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle" });
  });

  it("autoCaptureSpeech nic nie robi dla zadania pisemnego i w kartkówce (D-02)", async () => {
    const written = await startAtTask(baseState(), taskDto("written", { kind: "recall", prompt: "czwartek" }));
    await written.controller.autoCaptureSpeech();
    expect(written.recorder.started).toBe(0);
    expect(written.media.beeps).toEqual([]);

    const state = baseState();
    state.tasks = [speechTask()];
    const mockHarness = makeHarness(state);
    await mockHarness.controller.start();
    await mockHarness.controller.selectProfile(PROFILE_A.childId);
    await mockHarness.controller.startMockTest(DECK.deckId);
    await mockHarness.controller.beginMockTest();
    expect(mockHarness.controller.getScreen()).toMatchObject({ kind: "learning" });
    await mockHarness.controller.autoCaptureSpeech();
    expect(mockHarness.recorder.started).toBe(0);
    expect(mockHarness.media.beeps).toEqual([]);
  });

  it("po powrocie do ćwiczenia z retry (Nagraj jeszcze raz) autoCaptureSpeech nie startuje samo (SPEC §16)", async () => {
    vi.useFakeTimers();
    try {
      const task = speechTask();
      const state = baseState();
      state.attempts = [attemptDto({ taskId: task.taskId, modality: "audio", feedback: { kind: "almost" }, taskState: "issued" })];
      const harness = await startAtTask(state, task);
      await harness.controller.prepareMicrophone();
      await harness.controller.autoCaptureSpeech();
      await vi.advanceTimersByTimeAsync(300);
      for (let index = 0; index < 3; index += 1) harness.recorder.pushLevel(1);
      for (let index = 0; index < 2; index += 1) harness.recorder.pushLevel(0.2);
      for (let index = 0; index < 12; index += 1) harness.recorder.pushLevel(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.state.speechSubmissions).toHaveLength(1);
      expect(harness.controller.getScreen()).toMatchObject({ feedback: { retry: true } });
      // retry tego samego zadania: feedback znika, ale mikrofon nie startuje sam
      await harness.controller.continueLearning();
      expect(harness.controller.getScreen()).toMatchObject({ feedback: null, task: { taskId: task.taskId } });
      await harness.controller.autoCaptureSpeech();
      expect(harness.recorder.started).toBe(1);
      expect(harness.state.speechSubmissions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ręczne nagrywanie po cichu auto-anulowania działa i nie gra bipów", async () => {
    vi.useFakeTimers();
    try {
      const harness = await startAtTask(baseState(), speechTask());
      await harness.controller.prepareMicrophone();
      await harness.controller.autoCaptureSpeech();
      harness.recorder.hitLimit();
      expect(harness.controller.getScreen()).toMatchObject({ recordingNotice: messages.kid.autoCaptureNoSpeech });
      // przycisk pozostaje fallbackiem: ręczna próba po auto-anulowaniu
      await harness.controller.startRecording();
      await vi.advanceTimersByTimeAsync(301);
      await harness.controller.stopRecording();
      expect(harness.state.speechSubmissions).toHaveLength(1);
      expect(harness.media.beeps).toEqual(["start"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("po udanej auto-próbie ręczne „Nagraj jeszcze raz” nie gra bipu startu (reset stanu auto, D-04)", async () => {
    vi.useFakeTimers();
    try {
      const task = speechTask();
      const state = baseState();
      state.attempts = [attemptDto({ taskId: task.taskId, modality: "audio", feedback: { kind: "almost" }, taskState: "issued" })];
      const harness = await startAtTask(state, task);
      await harness.controller.prepareMicrophone();
      await harness.controller.autoCaptureSpeech();
      await vi.advanceTimersByTimeAsync(300);
      // pełny cykl auto: mowa + cisza → auto-stop → jedyna próba audio
      for (let index = 0; index < 3; index += 1) harness.recorder.pushLevel(1);
      for (let index = 0; index < 2; index += 1) harness.recorder.pushLevel(0.2);
      for (let index = 0; index < 12; index += 1) harness.recorder.pushLevel(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.state.speechSubmissions).toHaveLength(1);
      expect(harness.controller.getScreen()).toMatchObject({ feedback: { retry: true } });
      await harness.controller.continueLearning();
      expect(harness.controller.getScreen()).toMatchObject({ feedback: null, task: { taskId: task.taskId } });

      // ręczna próba na tym samym kontrolerze: bez hooka onMicrophoneReady
      // i bez kolejnego bipu startu — stan auto-próby skonsumował stopRecording
      await harness.controller.startRecording();
      expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
      expect(harness.recorder.started).toBe(2);
      expect(harness.media.lastRecorderOptions?.onMicrophoneReady).toBeUndefined();
      expect(harness.media.beeps).toEqual(["start", "end"]);
      harness.controller.cancelRecording();
      expect(harness.state.speechSubmissions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("WR-02: uprawnienie „prompt” pomija auto-start — bez sondy i bez getUserMedia; micDenied nie zostaje zapamiętane", async () => {
    const log: string[] = [];
    const harness = await startAtTask(baseState(), speechTask(), { sharedLog: log, microphonePermission: "prompt" });
    await harness.controller.autoCaptureSpeech();
    expect(harness.media.permissionQueries).toBe(1);
    // cichy skip: żadnej sondy prepareMicrophone ani startu rejestratora
    expect(log).toEqual(["permission:prompt"]);
    expect(harness.recorder.started).toBe(0);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", micDenied: false, feedback: null });
    expect(harness.state.speechSubmissions).toHaveLength(0);
    // świadome naciśnięcie przycisku pozostaje pełną ścieżką: przygotowanie…
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ microphoneReady: true, recordingPhase: "idle" });
    // …a kolejne wciśnięcie rozpoczyna nagrywanie ręczne
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.recorder.started).toBe(1);
    harness.controller.cancelRecording();
  });

  it("WR-02: uprawnienie „denied” również pomija auto-start bez zapamiętania odmowy", async () => {
    const harness = await startAtTask(baseState(), speechTask(), { microphonePermission: "denied" });
    await harness.controller.autoCaptureSpeech();
    expect(harness.recorder.started).toBe(0);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle", micDenied: false });
  });

  it("WR-02: nieznany stan uprawnień („unknown”) pomija auto-start — bezpieczne domyślnie", async () => {
    const harness = await startAtTask(baseState(), speechTask(), { microphonePermission: "unknown" });
    await harness.controller.autoCaptureSpeech();
    expect(harness.recorder.started).toBe(0);
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "idle" });
  });

  it("WR-02: uprawnienie „granted” — auto-start przebiega jak dotychczas", async () => {
    const log: string[] = [];
    const harness = await startAtTask(baseState(), speechTask(), { sharedLog: log, microphonePermission: "granted" });
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(log).toEqual(["permission:granted", "prepareMicrophone", "beep:start", "capture"]);
    harness.controller.teardown();
  });

  it("WR-02: mikrofon już gotowy w sesji — auto-start bez pytania o uprawnienie", async () => {
    const log: string[] = [];
    const harness = await startAtTask(baseState(), speechTask(), { sharedLog: log });
    await harness.controller.prepareMicrophone();
    harness.media.permissionQueries = 0;
    log.length = 0;
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.media.permissionQueries).toBe(0);
    expect(log).toEqual(["beep:start", "capture"]);
    harness.controller.teardown();
  });

  it("PR #109 P1 #2: niedostępny monitor poziomów przerywa auto-próbę bez bipu, próby i odmowy — przycisk działa", async () => {
    const log: string[] = [];
    const harness = await startAtTask(baseState(), speechTask(), {
      sharedLog: log,
      failStartWith: new LevelMonitorUnavailableError(),
    });
    await harness.controller.autoCaptureSpeech();
    // czysta przerwa: żadnego bipu startu, żadnego przechwytywania, zero prób
    expect(log).toEqual(["permission:granted", "prepareMicrophone"]);
    expect(harness.recorder.started).toBe(0);
    expect(harness.media.beeps).toEqual([]);
    expect(harness.state.speechSubmissions).toHaveLength(0);
    // dziecko widzi komunikat i niezmienioną ścieżkę ręczną (bez micDenied)
    expect(harness.controller.getScreen()).toMatchObject({
      recordingPhase: "idle",
      micDenied: false,
      recordingNotice: messages.kid.autoCaptureListenUnavailable,
    });
    // świadomy przycisk: przygotowanie i nagrywanie działają bez analizatora
    await harness.controller.startRecording();
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.recorder.started).toBe(1);
    expect(harness.media.lastRecorderOptions?.onMicrophoneReady).toBeUndefined();
    expect(harness.media.beeps).toEqual([]);
    harness.controller.cancelRecording();
  });

  it("PR #109 P2 #3: awaria urządzenia w auto-próbie zeruje stan auto — ręczne „Nagraj jeszcze raz” bez bipu startu", async () => {
    const harness = await startAtTask(baseState(), speechTask());
    await harness.controller.autoCaptureSpeech();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.media.beeps).toEqual(["start"]);
    // awaria urządzenia w trakcie auto-nagrania (onError, nie próba dziecka)
    harness.recorder.fail();
    expect(harness.controller.getScreen()).toMatchObject({
      recordingPhase: "idle",
      recordingNotice: messages.kid.recordingUnavailable,
    });
    // ręczna próba na tym samym kontrolerze: bez hooka i bez kolejnego bipu
    await harness.controller.startRecording();
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recordingPhase: "recording" });
    expect(harness.media.lastRecorderOptions?.onMicrophoneReady).toBeUndefined();
    expect(harness.media.beeps).toEqual(["start"]);
    harness.controller.cancelRecording();
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
    disabledSessions: [],
    startedSessions: [],
    submissions: [],
    speechSubmissions: [],
    observations: [],
    feedbackAudioCalls: [],
    endReports: [],
    networkDown: false,
  };
}
