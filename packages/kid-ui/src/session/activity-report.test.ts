import { describe, expect, it } from "vitest";
import { SessionActivityReportSchema, SESSION_ACTIVITY_REPORT_VERSION } from "@learning/contracts";
import { SessionActivityReporter, SESSION_ACTIVITY_IDLE_MS, type ActivityClock } from "./activity-report";
import { ACTIVITY_DRAFT_TTL_MS, createMemoryActivityDraftStore } from "./activity-draft-store";

/** Zegar sterowany ręcznie — testy kontrolują upływ czasu bez czekania. */
class ManualClock implements ActivityClock {
  #nowMs: number;
  constructor(startMs = 1_000_000) {
    this.#nowMs = startMs;
  }
  now(): number {
    return this.#nowMs;
  }
  advanceMs(ms: number): this {
    this.#nowMs += ms;
    return this;
  }
}

const TASK_A = "10000000-0000-4000-8000-00000000000a";
const TASK_B = "10000000-0000-4000-8000-00000000000b";
const ATTEMPT_A = "10000000-0000-4000-8000-00000000000c";
const ASSET_A = "10000000-0000-4000-8000-00000000000d";

describe("SessionActivityReporter", () => {
  it("measures the shown task and interactions as one active interval", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    clock.advanceMs(10_000);
    reporter.recordEdit();
    clock.advanceMs(10_000);
    reporter.attemptSubmitted(ATTEMPT_A);
    clock.advanceMs(5_000);
    const report = reporter.freeze();
    expect(report.activeMs).toBe(25_000);
    expect(report.elapsedMs).toBe(25_000);
    expect(report.tasks[0]).toMatchObject({
      taskId: TASK_A,
      editCount: 1,
      submittedAttempts: [ATTEMPT_A],
      activeIntervals: [[0, 25_000]],
    });
    expect(SessionActivityReportSchema.parse(report)).toBeDefined();
  });

  it("stops the active interval after the idle threshold and does not resume on time alone", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "spelling");
    clock.advanceMs(10_000);
    reporter.recordInteraction();
    // Karta zostaje otwarta bez interakcji daleko poza próg 60 s.
    clock.advanceMs(SESSION_ACTIVITY_IDLE_MS + 120_000);
    const report = reporter.freeze();
    // Aktywność domknięta na ostatniej interakcji + próg czytania.
    expect(report.activeMs).toBe(10_000 + SESSION_ACTIVITY_IDLE_MS);
    expect(report.tasks[0]!.pauses).toEqual([{ kind: "idle", fromMs: 70_000, toMs: 190_000 }]);
    expect(report.elapsedMs).toBe(190_000);
  });

  it("counts real playback as activity in union with typing (not a sum)", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "listening");
    clock.advanceMs(5_000);
    reporter.playbackStarted(ASSET_A, 20_000);
    clock.advanceMs(8_000);
    // Odsłuch gra, tymczasem interakcja — unia, nie suma.
    reporter.recordInteraction();
    clock.advanceMs(12_000);
    reporter.playbackEnded(ASSET_A);
    clock.advanceMs(5_000);
    const report = reporter.freeze();
    // 0–5 pomiar; 5–25 odsłuch (limitem 20 s, skończony wcześniej); 25–30 ogon.
    expect(report.tasks[0]!.playbacks).toEqual([{ assetId: ASSET_A, fromMs: 5_000, toMs: 25_000 }]);
    expect(report.activeMs).toBe(30_000);
  });

  it("clips playback to the recording length", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "exposure");
    reporter.playbackStarted(ASSET_A, 3_000);
    clock.advanceMs(60_000);
    reporter.playbackEnded(ASSET_A);
    const report = reporter.freeze();
    expect(report.tasks[0]!.playbacks).toEqual([{ assetId: ASSET_A, fromMs: 0, toMs: 3_000 }]);
  });

  it("records lifecycle pauses and resumes only on activity", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    clock.advanceMs(5_000);
    reporter.pause("background");
    clock.advanceMs(30_000);
    // Powrót do widoku sam w sobie nie wznawia pomiaru — dopiero działanie.
    clock.advanceMs(10_000);
    reporter.recordInteraction();
    clock.advanceMs(5_000);
    const report = reporter.freeze();
    expect(report.tasks[0]!.pauses).toEqual([{ kind: "background", fromMs: 5_000, toMs: 45_000 }]);
    expect(report.tasks[0]!.activeIntervals).toEqual([[0, 5_000], [45_000, 50_000]]);
    expect(report.activeMs).toBe(10_000);
  });

  it("splits non-overlapping intervals across consecutive tasks", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    clock.advanceMs(30_000);
    reporter.taskShown(TASK_B, "spelling");
    clock.advanceMs(20_000);
    reporter.recordEdit();
    clock.advanceMs(10_000);
    const report = reporter.freeze();
    expect(report.tasks).toHaveLength(2);
    expect(report.tasks[0]!.activeIntervals).toEqual([[0, 30_000]]);
    expect(report.tasks[1]!.activeIntervals).toEqual([[30_000, 60_000]]);
    expect(SessionActivityReportSchema.parse(report)).toBeDefined();
  });

  it("marks an unobserved gap on resume from a saved draft", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    clock.advanceMs(10_000);
    reporter.recordInteraction();
    const state = reporter.state;
    clock.advanceMs(300_000);
    const resumed = SessionActivityReporter.resume(new ManualClock(clock.now()), JSON.parse(JSON.stringify(state)) as typeof state);
    clock.advanceMs(5_000);
    const report = resumed.freeze();
    expect(report.tasks[0]!.pauses).toEqual([{ kind: "unobserved", fromMs: 10_000, toMs: 310_000 }]);
    // Brak obserwacji nie zalicza się jako praca; brak też fikcyjnych przedziałów.
    expect(report.activeMs).toBe(10_000);
  });

  it("groups edits into five-second windows without recording contents", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "spelling");
    for (let index = 0; index < 6; index += 1) {
      reporter.recordEdit();
      clock.advanceMs(1_000);
    }
    clock.advanceMs(6_000);
    reporter.recordEdit();
    const report = reporter.freeze();
    expect(report.tasks[0]!.editCount).toBe(7);
    expect(report.tasks[0]!.editWindows).toEqual([{ atMs: 0, count: 5 }, { atMs: 5_000, count: 1 }, { atMs: 12_000, count: 1 }]);
  });

  it("compacts old detail when entries exceed the limit and flags it", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    // Duża kartkówka: 60 zadań po 80 grupowanych okien edycji > limit 4096 wpisów.
    for (let task = 0; task < 60; task += 1) {
      reporter.taskShown(`20000000-0000-4000-8000-${String(task).padStart(12, "0")}`, "spelling");
      for (let edit = 0; edit < 80; edit += 1) {
        reporter.recordEdit();
        clock.advanceMs(10_000);
      }
    }
    const report = reporter.freeze();
    expect(report.compacted).toBe(true);
    expect(SessionActivityReportSchema.parse(report)).toBeDefined();
    expect(report.tasks).toHaveLength(60);
    // Licznik edycji (suma) pozostaje kompletny po zgrubnieniu okien.
    expect(report.tasks.reduce((total, task) => total + task.editCount, 0)).toBe(60 * 80);
  });

  it("flags storage unavailability explicitly", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    reporter.markStorageUnavailable();
    const report = reporter.freeze();
    expect(report.incomplete).toBe("storage_unavailable");
  });

  it("keeps version pinned to the contract", () => {
    const reporter = new SessionActivityReporter(new ManualClock());
    expect(reporter.freeze().version).toBe(SESSION_ACTIVITY_REPORT_VERSION);
  });
});

describe("SessionActivityDraftStore", () => {
  it("saves, loads and removes a specific session draft only", () => {
    let nowMs = 1_000_000;
    const store = createMemoryActivityDraftStore(() => nowMs);
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    expect(store.save({ sessionId: "session-1", savedAtMs: nowMs, state: reporter.state })).toBe(true);
    expect(store.load("session-1")?.state.tasks[0]!.taskId).toBe(TASK_A);
    expect(store.load("session-2")).toBeNull();
    store.remove("session-1");
    expect(store.load("session-1")).toBeNull();
  });

  it("drops drafts older than the retention window", () => {
    let nowMs = 1_000_000;
    const store = createMemoryActivityDraftStore(() => nowMs);
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    store.save({ sessionId: "session-1", savedAtMs: nowMs, state: reporter.state });
    nowMs += ACTIVITY_DRAFT_TTL_MS + 1;
    expect(store.load("session-1")).toBeNull();
  });

  it("rejects drafts with an unknown state version", () => {
    const store = createMemoryActivityDraftStore();
    expect(store.load("session-1")).toBeNull();
  });
});
