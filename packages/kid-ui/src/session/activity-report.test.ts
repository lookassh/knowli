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

  it("caps idle time before blur using the same rule as freeze", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    clock.advanceMs(300_000);
    reporter.pause("blur");
    const report = reporter.freeze();
    expect(report.activeMs).toBe(SESSION_ACTIVITY_IDLE_MS);
    expect(report.tasks[0]!.pauses).toContainEqual({ kind: "idle", fromMs: SESSION_ACTIVITY_IDLE_MS, toMs: 300_000 });
    expect(SessionActivityReportSchema.safeParse(report).success).toBe(true);
  });

  it("compacts per-task array limits even while global entry count is low", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "spelling");
    for (let i = 0; i < 257; i += 1) {
      reporter.recordEdit();
      clock.advanceMs(30_001);
    }
    const report = reporter.freeze();
    expect(report.compacted).toBe(true);
    expect(report.tasks[0]!.editWindows.length).toBeLessThanOrEqual(256);
    expect(SessionActivityReportSchema.safeParse(report).success).toBe(true);
  });

  it("compacts playback and pause details at their per-task limits", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "listening");
    for (let i = 0; i < 129; i += 1) {
      reporter.playbackStarted(ASSET_A, 1_000);
      clock.advanceMs(1_000);
      reporter.playbackEnded(ASSET_A);
      reporter.pause("blur");
      clock.advanceMs(5_001);
      reporter.recordInteraction();
    }
    const report = reporter.freeze();
    expect(report.compacted).toBe(true);
    expect(report.tasks[0]!.playbacks.length).toBeLessThanOrEqual(128);
    expect(report.tasks[0]!.pauses.length).toBeLessThanOrEqual(128);
    expect(SessionActivityReportSchema.safeParse(report).success).toBe(true);
  });

  it("keeps 257 disjoint active intervals without merging idle gaps", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    for (let i = 0; i < 257; i += 1) {
      clock.advanceMs(1_000);
      reporter.pause("blur");
      clock.advanceMs(1_000);
      reporter.recordInteraction();
    }
    const report = reporter.freeze();
    expect(report.tasks[0]!.activeIntervals.length).toBe(257);
    expect(report.activeMs).toBe(257_000);
    expect(SessionActivityReportSchema.safeParse(report).success).toBe(true);
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
    expect(report.activeMs).toBeLessThanOrEqual(63_000);
  });

  it("does not treat a delayed audio callback as activity after the child's edit", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    reporter.playbackStarted(ASSET_A, 2_000);
    clock.advanceMs(250_000);
    reporter.recordEdit();
    clock.advanceMs(50_000);
    reporter.playbackEnded(ASSET_A);
    const report = reporter.freeze();
    expect(report.activeMs).toBe(112_000);
    expect(report.tasks[0]!.pauses).toContainEqual({ kind: "idle", fromMs: 62_000, toMs: 250_000 });
  });

  it("keeps ordinary thinking time after a short audio ends", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "listening");
    reporter.playbackStarted(ASSET_A, 2_000);
    clock.advanceMs(2_000);
    reporter.playbackEnded(ASSET_A);
    clock.advanceMs(8_000);
    reporter.recordInteraction();
    expect(reporter.freeze().activeMs).toBe(10_000);
  });

  it("freezes an independent payload after edits, attempts, and playback mutate reporter collections", () => {
    const clock = new ManualClock();
    const reporter = new SessionActivityReporter(clock);
    reporter.taskShown(TASK_A, "recall");
    clock.advanceMs(2_000);
    reporter.recordEdit();
    const frozen = reporter.freeze();
    const snapshot = JSON.stringify(frozen);
    clock.advanceMs(2_000);
    reporter.recordEdit(); // mutates the existing five-second edit window
    reporter.attemptSubmitted("66666666-6666-4666-8666-666666666666");
    reporter.playbackStarted(ASSET_A, 1_000);
    clock.advanceMs(1_000);
    reporter.playbackEnded(ASSET_A);
    expect(JSON.stringify(frozen)).toBe(snapshot);
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
    const loaded = store.load("session-1");
    expect(loaded).toMatchObject({ state: { tasks: [{ taskId: TASK_A }] } });
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
