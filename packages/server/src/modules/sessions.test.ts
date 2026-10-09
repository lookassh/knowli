import { describe, expect, it } from "vitest";
import type { TaskPlan } from "../domain/scheduler";
import { materializeTask, type PlannedItem } from "./sessions";

function plannedItem(overrides: Partial<PlannedItem> = {}): PlannedItem {
  return {
    itemId: "item-1",
    source: "czwartek",
    target: "Thursday",
    acceptedAnswers: ["Thursday"],
    visualType: "none",
    sourceLocale: "pl-PL",
    targetLocale: "en-GB",
    ...overrides,
  };
}

function listeningPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    itemRevisionId: "rev-1",
    exerciseType: "listening",
    options: [
      { itemRevisionId: "rev-1", text: "Thursday", correct: true },
      { itemRevisionId: "rev-2", text: "Friday", correct: false },
      { itemRevisionId: "rev-3", text: "Wednesday", correct: false },
    ],
    revealsTargetKeys: [],
    assessed: true,
    reason: "new-practice",
    keepsReservations: [],
    ...overrides,
  };
}

describe("materializeTask option order", () => {
  it("shuffles options so the correct answer has no fixed position", () => {
    const positionsOfCorrect = new Set<number>();

    for (let run = 0; run < 60; run++) {
      const { prompt, answerKey } = materializeTask(
        listeningPlan(),
        plannedItem(),
        "asset-audio-1",
        null,
        null,
      );
      if (prompt.kind !== "listening") {
        throw new Error(`expected listening prompt, got ${prompt.kind}`);
      }
      const correctId = answerKey.correctOptionId;
      expect(typeof correctId).toBe("string");
      const correctOption = prompt.options.find((o) => o.id === correctId);
      expect(correctOption?.text).toBe("Thursday");
      positionsOfCorrect.add(prompt.options.findIndex((o) => o.text === "Thursday"));
    }

    expect(positionsOfCorrect.size).toBeGreaterThanOrEqual(2);
  });
});
