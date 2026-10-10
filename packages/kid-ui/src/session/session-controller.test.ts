import { describe, expect, it } from "vitest";
import { KidApiError } from "../api/client";
import type {
  AttemptDto,
  DisclosureDto,
  FeedbackDto,
  KidDeckDto,
  KidProfileDto,
  PresentationCompletionDto,
  SessionDto,
  SessionSummaryDto,
  TaskDto,
} from "@learning/contracts";
import type { KidApi } from "../api/KidApi";
import type { AudioPlayer, PlatformMedia, SpeechRecorder } from "../media/platform";
import { createMemoryPreferences, MIC_DENIED_KEY } from "../storage";
import { LearningSessionController } from "./session-controller";

/**
 * Testy jednostkowe sterownika przepływu (RF5 i kontrakt e2e zadania 9):
 * logika bez Reacta, na pełnych fake-ach API i mediów.
 */

const PROFILE_A: KidProfileDto = { childId: "11111111-1111-1111-1111-111111111111", displayName: "Ola", avatarKey: "fox" };
const PROFILE_B: KidProfileDto = { childId: "22222222-2222-2222-2222-222222222222", displayName: "Ewa", avatarKey: "bear" };

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

function makeRecorder(opts: { failStartWith?: unknown } = {}): SpeechRecorder & {
  cancelled: number;
  stopped: number;
  started: number;
} {
  const state = { cancelled: 0, stopped: 0, started: 0 };
  return {
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

function makeMedia(recorder: ReturnType<typeof makeRecorder>): PlatformMedia & { playUrls: string[]; stops: number } {
  const media = {
    playUrls: [] as string[],
    stops: 0,
    createRecorder: () => recorder,
    player: {
      async play(url: string) {
        media.playUrls.push(url);
      },
      stop() {
        media.stops += 1;
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
  /** Gdy ustawione, submitAnswer rzuca TypeError (brak sieci). */
  networkDown: boolean;
  disclosureGate?: Promise<void>;
  disclosureError?: unknown;
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
    async completePresentation(taskId): Promise<PresentationCompletionDto> {
      state.presentations.push(taskId);
      return { taskId, state: "completed", completedAt: "2026-10-07T16:00:02.000Z" };
    },
    async recordObservation() {
      return undefined;
    },
    async endSession(sessionId): Promise<SessionSummaryDto> {
      state.endedSessions.push(sessionId);
      return { sessionId, state: "completed", tasksIssued: 3, assessedTasksIssued: 2, endedAt: "2026-10-07T16:05:00.000Z",
        independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [] };
    },
    async readMockTestSummary(sessionId) {
      if (state.networkDown) throw new TypeError("fetch failed");
      return { sessionId, deckId: DECK.deckId, state: "completed", complete: true, taskBudget: 2, answeredCount: 2, solutions: [] };
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

function makeHarness(
  state: ApiState,
  options: { failStartWith?: unknown; initialChildId?: string } = {},
) {
  const recorder = makeRecorder(options);
  const media = makeMedia(recorder);
  const storage = createMemoryPreferences();
  const controller = new LearningSessionController({
    api: makeApi(state),
    media,
    storage,
    ...(options.initialChildId === undefined ? {} : { initialChildId: options.initialChildId }),
    pollIntervalMs: 1,
  });
  return { controller, recorder, media, storage, state };
}

async function startAtTask(state: ApiState, task: TaskDto, recorderOpts?: { failStartWith?: unknown }) {
  state.tasks = [task];
  const harness = makeHarness(state, recorderOpts);
  await harness.controller.start();
  await harness.controller.selectProfile(state.profiles[0]!.childId);
  await harness.controller.startLearning(DECK.deckId);
  return harness;
}

describe("LearningSessionController", () => {
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
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({
      kind: "learning",
      micDenied: true,
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
    await harness.controller.startRecording();
    expect(harness.controller.getScreen()).toMatchObject({ recording: true });
    harness.controller.teardown();
    expect(harness.recorder.cancelled).toBe(1);
    expect(harness.media.stops).toBeGreaterThanOrEqual(1);
    expect(harness.controller.getScreen()).toMatchObject({ recording: false });
  });

  it("odpowiedź ustna przechodzi przez polling aż do wyniku", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const state = baseState();
    state.attempts = [
      attemptDto({ state: "processing", feedback: null, taskState: "issued", modality: "audio", attemptId: "proc-1" }),
      attemptDto({ modality: "audio", feedback: { kind: "not_assessed" }, taskState: "issued" }),
    ];
    const harness = await startAtTask(state, recall);
    await harness.controller.startRecording();
    await harness.controller.stopRecording();
    expect(state.speechSubmissions).toHaveLength(1);
    const screen = harness.controller.getScreen() as { kind: string; feedback?: unknown };
    expect(screen.kind).toBe("learning");
    expect(screen).toMatchObject({ feedback: { dto: { kind: "not_assessed" } } });
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
    await harness.controller.startRecording();
    await harness.controller.stopRecording();
    const screen = harness.controller.getScreen() as {
      feedback: { dto: FeedbackDto | null; chosenOptionId?: string } | null;
    };
    expect(screen.feedback?.dto).toMatchObject({ kind: "not_assessed" });
    expect(screen.feedback?.chosenOptionId).toBeUndefined();
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
    networkDown: false,
  };
}
