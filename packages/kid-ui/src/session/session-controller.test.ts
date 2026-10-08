import { describe, expect, it } from "vitest";
import type {
  AttemptDto,
  DisclosureDto,
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

function makeRecorder(opts: { failStart?: boolean } = {}): SpeechRecorder & {
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
      if (opts.failStart) {
        throw new Error("NotAllowedError");
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
      return sessionDto(input.childId, "55555555-5555-5555-5555-555555555555", input.microphoneEnabled);
    },
    async nextTask() {
      return state.tasks.shift() ?? null;
    },
    async submitAnswer(input) {
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
      return { sessionId, state: "completed", tasksIssued: 3, assessedTasksIssued: 2, endedAt: "2026-10-07T16:05:00.000Z" };
    },
    mediaUrl(assetId) {
      return `https://media.test/${assetId}`;
    },
  };
}

const DECK: KidDeckDto = { deckId: "33333333-3333-3333-3333-333333333333", title: "Dni tygodnia", testDate: null };

function makeHarness(state: ApiState, recorderOpts: { failStart?: boolean } = {}) {
  const recorder = makeRecorder(recorderOpts);
  const media = makeMedia(recorder);
  const storage = createMemoryPreferences();
  const controller = new LearningSessionController({
    api: makeApi(state),
    media,
    storage,
    pollIntervalMs: 1,
  });
  return { controller, recorder, media, storage, state };
}

async function startAtTask(state: ApiState, task: TaskDto, recorderOpts?: { failStart?: boolean }) {
  state.tasks = [task];
  const harness = makeHarness(state, recorderOpts);
  await harness.controller.start();
  await harness.controller.selectProfile(state.profiles[0]!.childId);
  await harness.controller.startLearning(DECK.deckId);
  return harness;
}

describe("LearningSessionController", () => {
  it("jeden profil pomija ekran wyboru", async () => {
    const harness = makeHarness({ ...baseState(), profiles: [PROFILE_A] });
    await harness.controller.start();
    expect(harness.controller.getScreen()).toMatchObject({ kind: "deck", childId: PROFILE_A.childId });
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
    const exposure = taskDto("t1", { kind: "exposure", source: "czwartek", target: "Thursday", example: null, audioAssetId: null });
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
    const harness = await startAtTask(state, recall, { failStart: true });
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

  it("wzorzec w recall wymaga zgody serwera; pytanie słuchowe nie", async () => {
    const recall = taskDto("t1", { kind: "recall", prompt: "czwartek" });
    const recallHarness = await startAtTask(baseState(), recall);
    await recallHarness.controller.playTaskAudio();
    // recall nie ma audioAssetId w prompcie — brak odtworzenia i zgody
    expect(recallHarness.state.disclosures).toHaveLength(0);

    const listening = taskDto("t2", { kind: "listening", options: [], audioAssetId: "asset-1" });
    const listenHarness = await startAtTask(baseState(), listening);
    await listenHarness.controller.playTaskAudio();
    expect(listenHarness.media.playUrls).toEqual(["https://media.test/asset-1"]);
    expect(listenHarness.state.disclosures).toHaveLength(0);

    const speech = taskDto("t3", { kind: "speech", text: "Thursday", audioAssetId: "asset-2" });
    const speechHarness = await startAtTask(baseState(), speech);
    await speechHarness.controller.playTaskAudio();
    expect(speechHarness.state.disclosures).toEqual([{ taskId: "t3", kind: "audio" }]);
    expect(speechHarness.media.playUrls).toEqual(["https://media.test/asset-2"]);
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
