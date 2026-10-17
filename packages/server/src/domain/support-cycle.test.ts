import { describe, expect, it } from "vitest";
import { deriveSupportStates, type SupportAttempt, type SupportTask } from "./support-cycle";

const task = (overrides: Partial<SupportTask> = {}): SupportTask => ({
  taskId: "task-a", itemRevisionId: "item-a", ordinal: 1, exerciseType: "recall", state: "answered", reason: "stage-introduction", ...overrides,
});

describe("deriveSupportStates", () => {
  const supportHistory = (state: SupportTask["state"] = "answered"): SupportTask[] => [
    task({ taskId: "source", sessionId: "first", ordinal: 0 }),
    task({ taskId: "support", sessionId: "second", ordinal: 1, exerciseType: "exposure", state: "completed", reason: "support", supportCycleId: "source" }),
    task({ taskId: "retry", sessionId: "second", ordinal: 2, exerciseType: "listening", state, reason: "retry-after-support", supportCycleId: "source" }),
  ];
  const sourceDifficulty: SupportAttempt = { attemptId: "source-bad", taskId: "source", modality: "dont_remember", outcomes: [{ skill: "listening", outcome: "incorrect" }] };

  it.each(["dont_remember", "two_errors", "skip", "technical"])("preserves unresolved support after %s in a later session", (result) => {
    const retryAttempts: SupportAttempt[] = result === "two_errors"
      ? [1, 2].map((n) => ({ attemptId: `retry-${n}`, taskId: "retry", modality: "choice", outcomes: [{ skill: "listening", outcome: "incorrect" }] }))
      : [{ attemptId: "retry-one", taskId: "retry", modality: result === "technical" ? "audio" : result, outcomes: [] }];
    const tasks = supportHistory(result === "technical" ? "issued" : result === "skip" ? "skipped" : "answered");
    expect(deriveSupportStates(tasks, [sourceDifficulty, ...retryAttempts], 2, "third").get("item-a"))
      .toMatchObject({ phase: "needed", retryType: "listening" });
    // The current session cannot open another cycle, including during plan construction.
    expect(deriveSupportStates(tasks, [sourceDifficulty, ...retryAttempts], 2, "second").get("item-a")?.phase)
      .not.toBe("needed");
  });

  it("settles historical difficulty after a real successful retry", () => {
    const attempts: SupportAttempt[] = [sourceDifficulty, { attemptId: "retry-good", taskId: "retry", modality: "choice", outcomes: [{ skill: "listening", outcome: "correct" }] }];
    expect(deriveSupportStates(supportHistory(), attempts, 2, "third").get("item-a")?.phase).toBe("none");
  });

  it("carries a later difficulty after the session already consumed its support cycle", () => {
    const tasks = [...supportHistory(), task({ taskId: "later", sessionId: "second", ordinal: 3 })];
    const attempts: SupportAttempt[] = [sourceDifficulty,
      { attemptId: "retry-good", taskId: "retry", modality: "choice", outcomes: [{ skill: "listening", outcome: "correct" }] },
      { attemptId: "later-bad", taskId: "later", modality: "dont_remember", outcomes: [{ skill: "spelling", outcome: "incorrect" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2, "third").get("item-a"))
      .toMatchObject({ phase: "needed", sourceTaskId: "later", retryType: "letter_completion" });
    expect(deriveSupportStates(tasks, attempts, 2, "second").get("item-a")?.phase).toBe("settled");
  });

  it("does not settle spelling difficulty with a success in listening", () => {
    const attempts: SupportAttempt[] = [
      { ...sourceDifficulty, outcomes: [{ skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "retry-good", taskId: "retry", modality: "choice", outcomes: [{ skill: "listening", outcome: "correct" }] },
    ];
    expect(deriveSupportStates(supportHistory(), attempts, 2, "third").get("item-a"))
      .toMatchObject({ phase: "needed", retryType: "letter_completion" });
  });

  it("settles a correct skill even when the same task reaches the failure threshold in another skill", () => {
    const tasks = supportHistory().map((row) => row.taskId === "retry" ? { ...row, exerciseType: "letter_completion" as const } : row);
    const attempts: SupportAttempt[] = [
      { attemptId: "first-try", taskId: "source", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }, { skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "second-try", taskId: "source", modality: "text", outcomes: [{ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "retry-good", taskId: "retry", modality: "text", outcomes: [{ skill: "spelling", outcome: "correct" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2, "third").get("item-a")?.phase).toBe("none");
  });

  it.each(["issued", "skipped"] as const)("keeps a saved skill success when its task is %s", (state) => {
    const tasks = [
      task({ taskId: "source", sessionId: "first", ordinal: 0 }),
      task({ taskId: "partial", sessionId: "second", ordinal: 1, state }),
      task({ taskId: "spelling", sessionId: "third", ordinal: 2, exerciseType: "letter_completion" }),
    ];
    const attempts: SupportAttempt[] = [
      { attemptId: "source-bad", taskId: "source", modality: "dont_remember", outcomes: [{ skill: "recall", outcome: "incorrect" }, { skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "partial-good", taskId: "partial", modality: "text", outcomes: [{ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "incorrect" }] },
      ...(state === "skipped" ? [{ attemptId: "partial-skip", taskId: "partial", modality: "skip", outcomes: [] }] : []),
      { attemptId: "spelling-good", taskId: "spelling", modality: "text", outcomes: [{ skill: "spelling", outcome: "correct" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2, "fourth").get("item-a")?.phase).toBe("none");
  });

  it("counts one multi-skill attempt once and does not combine different tasks", () => {
    const attempts: SupportAttempt[] = [
      { attemptId: "a1", taskId: "task-a", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }, { skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "a2", taskId: "task-b", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }] },
    ];
    const states = deriveSupportStates([task(), task({ taskId: "task-b", ordinal: 2 })], attempts, 2);
    expect(states.get("item-a")?.phase).toBe("none");
  });

  it("creates only one support and retry cycle for an item in a session", () => {
    const tasks = [
      task(),
      task({ taskId: "support", ordinal: 2, exerciseType: "exposure", reason: "support", supportCycleId: "task-a" }),
      task({ taskId: "retry", ordinal: 4, exerciseType: "listening", reason: "retry-after-support", supportCycleId: "task-a" }),
    ];
    const attempts: SupportAttempt[] = [
      { attemptId: "a1", taskId: "task-a", modality: "dont_remember", outcomes: [] },
      { attemptId: "a2", taskId: "retry", modality: "text", outcomes: [{ skill: "listening", outcome: "correct" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2).get("item-a")?.phase).toBe("settled");
  });

  it("chooses a written fragment retry after a spelling failure and settles it once", () => {
    const tasks = [
      task({ taskId: "source", exerciseType: "recall", state: "answered", reason: "due-check" }),
      task({ taskId: "support", ordinal: 2, exerciseType: "exposure", state: "completed", reason: "support", supportCycleId: "source" }),
      task({ taskId: "retry", ordinal: 4, exerciseType: "letter_completion", state: "completed", reason: "retry-after-support", supportCycleId: "source" }),
    ];
    const attempts: SupportAttempt[] = [
      { attemptId: "bad-1", taskId: "source", modality: "text", outcomes: [{ skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "bad-2", taskId: "source", modality: "text", outcomes: [{ skill: "spelling", outcome: "incorrect" }] },
      { attemptId: "good", taskId: "retry", modality: "text", outcomes: [{ skill: "spelling", outcome: "correct" }] },
    ];
    const state = deriveSupportStates(tasks, attempts, 2).get("item-a");
    expect(state).toMatchObject({ phase: "settled", retryType: "letter_completion", sourceTaskId: "source" });
  });

  it("keeps technical retry attempts from closing the issued task", () => {
    const tasks = [task({ state: "issued" })];
    const attempts: SupportAttempt[] = [
      { attemptId: "t1", taskId: "task-a", modality: "audio", outcomes: [{ skill: "pronunciation", outcome: "unevaluated" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2).get("item-a")?.phase).toBe("none");
  });

  it("reopens support after a later real difficulty following a settled cycle", () => {
    const tasks = [
      task({ taskId: "source", sessionId: "session-a", ordinal: 1 }),
      task({ taskId: "support", sessionId: "session-a", ordinal: 2, exerciseType: "exposure", reason: "support", supportCycleId: "source" }),
      task({ taskId: "retry", sessionId: "session-a", ordinal: 3, reason: "retry-after-support", supportCycleId: "source" }),
      task({ taskId: "later", sessionId: "session-b", ordinal: 4, reason: "due-check" }),
    ];
    const attempts: SupportAttempt[] = [
      { attemptId: "bad-1", taskId: "source", modality: "dont_remember", outcomes: [] },
      { attemptId: "good", taskId: "retry", modality: "text", outcomes: [{ skill: "recall", outcome: "correct" }] },
      { attemptId: "bad-2", taskId: "later", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }] },
      { attemptId: "bad-3", taskId: "later", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2).get("item-a")?.phase).toBe("needed");
  });

  it("does not reopen a settled cycle after later difficulty in the same session", () => {
    const sameSession = (value: Partial<SupportTask>) => ({ ...task(), sessionId: "session-a", ...value }) as SupportTask;
    const tasks = [
      sameSession({ taskId: "source", ordinal: 1 }),
      sameSession({ taskId: "support", ordinal: 2, exerciseType: "exposure", reason: "support", supportCycleId: "source" }),
      sameSession({ taskId: "retry", ordinal: 3, reason: "retry-after-support", supportCycleId: "source" }),
      sameSession({ taskId: "later", ordinal: 4, reason: "due-check" }),
    ];
    const attempts: SupportAttempt[] = [
      { attemptId: "bad-1", taskId: "source", modality: "dont_remember", outcomes: [] },
      { attemptId: "good", taskId: "retry", modality: "text", outcomes: [{ skill: "recall", outcome: "correct" }] },
      { attemptId: "bad-2", taskId: "later", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }] },
      { attemptId: "bad-3", taskId: "later", modality: "text", outcomes: [{ skill: "recall", outcome: "incorrect" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2).get("item-a")?.phase).toBe("settled");
  });
});
