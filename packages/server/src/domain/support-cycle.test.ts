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

  it("keeps technical retry attempts from closing the issued task", () => {
    const tasks = [task({ state: "issued" })];
    const attempts: SupportAttempt[] = [
      { attemptId: "t1", taskId: "task-a", modality: "audio", outcomes: [{ skill: "pronunciation", outcome: "unevaluated" }] },
    ];
    expect(deriveSupportStates(tasks, attempts, 2).get("item-a")?.phase).toBe("none");
  });
});
