import { describe, expect, it, vi } from "vitest";
import type { TaskPlan } from "../domain/scheduler";
import { materializeTask, type PlannedItem } from "./sessions";
import { contextOf } from "./events";

describe("session context", () => {
  it("preserves the bounded daily-round revision pool through context updates", () => {
    expect(contextOf({ context: {
      canRead: true,
      vocabularyFormat: "standard",
      microphoneDisabledTaskIds: [],
      timezone: "Europe/Warsaw",
      previousContact: {},
      reservations: ["target"],
      settledChecks: [],
      dailyRoundRevisionIds: ["revision-a", "revision-b"],
      dailyRoundDate: "2026-10-16",
    } })).toMatchObject({
      dailyRoundRevisionIds: ["revision-a", "revision-b"],
      dailyRoundDate: "2026-10-16",
    });
  });
});

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

describe("materializeTask picture prompts", () => {
  const meaningVisual = { kind: "color" as const, color: "#ff0000" };

  it.each([
    { position: 0, random: [0.99, 0.99] },
    { position: 1, random: [0.99, 0] },
    { position: 2, random: [0, 0.99] },
  ])("umieszcza poprawny obrazek na pozycji $position i zachowuje klucz", ({ position, random }) => {
    const plan = listeningPlan({ options: [
      { itemRevisionId: "rev-1", text: "czerwony", correct: true, visual: meaningVisual },
      { itemRevisionId: "rev-2", text: "niebieski", correct: false, visual: { kind: "color", color: "#0000ff" } },
      { itemRevisionId: "rev-3", text: "zielony", correct: false, visual: { kind: "color", color: "#00ff00" } },
    ] });
    const originalPlan = structuredClone(plan);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValueOnce(random[0]!).mockReturnValueOnce(random[1]!);
    try {
      const { prompt, answerKey } = materializeTask(plan, plannedItem({ meaningVisual }), "asset-audio-1", null, null);
      expect(randomSpy).toHaveBeenCalledTimes(2);
      if (prompt.kind !== "picture_listening") throw new Error("expected picture listening prompt");
      expect(prompt.options[position]).toMatchObject({ labelPl: "czerwony", visual: meaningVisual });
      expect(answerKey.correctOptionId).toBe(prompt.options[position]!.id);
      for (const option of prompt.options) {
        const planned = plan.options!.find((item) => item.text === option.labelPl)!;
        expect(option.visual).toEqual(planned.visual);
        expect((answerKey.optionItemRevisionIds as Record<string, string>)[option.id]).toBe(planned.itemRevisionId);
        expect(option).not.toHaveProperty("correct");
      }
      expect(prompt).not.toHaveProperty("correctOptionId");
      expect(JSON.stringify(prompt)).not.toContain("Thursday");
      expect(plan).toEqual(originalPlan);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("nie ujawnia angielskiego tekstu przed odpowiedzią w prezentacji obrazkowej", () => {
    const { prompt } = materializeTask(
      { itemRevisionId: "rev-1", exerciseType: "exposure", revealsTargetKeys: [], assessed: false, reason: "new-material", keepsReservations: [] },
      plannedItem({ meaningVisual }), "asset-audio-1", null, null,
    );
    expect(prompt).toEqual({ kind: "picture_exposure", visual: meaningVisual, audioAssetId: "asset-audio-1" });
    expect(JSON.stringify(prompt)).not.toContain("Thursday");
  });

  it("opcje rozpoznawania przenoszą polskie etykiety i wizualizacje zamiast odpowiedzi", () => {
    const { prompt, answerKey } = materializeTask(listeningPlan({ options: [
      { itemRevisionId: "rev-1", text: "czwartek", correct: true, visual: meaningVisual },
      { itemRevisionId: "rev-2", text: "piątek", correct: false, visual: { kind: "number", count: 5 } },
    ] }), plannedItem({ meaningVisual }), "asset-audio-1", null, null);
    expect(prompt.kind).toBe("picture_listening");
    if (prompt.kind !== "picture_listening") throw new Error("expected picture listening prompt");
    expect(prompt.options.map((option) => option.labelPl).sort()).toEqual(["czwartek", "piątek"]);
    expect(JSON.stringify(prompt)).not.toContain("Thursday");
    expect(answerKey.target).toBe("Thursday");
  });
});
