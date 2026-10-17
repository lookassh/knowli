import { describe, expect, it } from "vitest";
import { deriveSupportStates, type SupportAttempt, type SupportTask } from "./support-cycle";

const task = (overrides: Partial<SupportTask> = {}): SupportTask => ({
  taskId: "task-a", itemRevisionId: "item-a", ordinal: 1, exerciseType: "recall", state: "answered", reason: "stage-introduction", ...overrides,
});

describe("deriveSupportStates", () => {
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
