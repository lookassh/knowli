import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readTrainingSessionPlan } from "./training-session-plan";

const plan = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  taskBudget: 1,
  slots: [{
    taskId: randomUUID(), itemId: randomUUID(), itemRevisionId: randomUUID(), ordinal: 0,
    exerciseType: "reading", direction: null, assessed: true,
    prompt: { kind: "reading", text: "cat", options: [{ id: randomUUID(), text: "kot" }] },
    answerKey: { target: "cat" }, reason: "new-material", revealsTargetKeys: [], keepsReservations: [],
  }],
  ...overrides,
});

describe("prywatny plan treningu", () => {
  it("odczytuje wyłącznie kompletny, uporządkowany plan wersji 1", () => {
    expect(readTrainingSessionPlan(plan())?.slots).toHaveLength(1);
    expect(() => readTrainingSessionPlan(plan({ version: 2 }))).toThrow("unsupported_training_session_plan_version");
    expect(() => readTrainingSessionPlan(plan({ taskBudget: 0 }))).toThrow("invalid_training_session_plan");
    expect(() => readTrainingSessionPlan(plan({ taskBudget: 1, slots: [{ ...plan().slots[0], assessed: false }] }))).not.toThrow();
    expect(() => readTrainingSessionPlan(plan({ taskBudget: 1, slots: [{ ...plan().slots[0], assessed: true }, { ...plan().slots[0], taskId: randomUUID(), ordinal: 1, assessed: true }] }))).toThrow("invalid_training_session_plan");
    expect(() => readTrainingSessionPlan(plan({ slots: [{ ...plan().slots[0], ordinal: 1 }] }))).toThrow("invalid_training_session_plan");
  });
});
