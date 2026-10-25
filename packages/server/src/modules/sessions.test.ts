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
  it.each([
    { position: 0, random: [0.99, 0.99] },
    { position: 1, random: [0.99, 0] },
    { position: 2, random: [0, 0.99] },
  ])("uses injected Fisher-Yates values to place the answer at $position", ({ position, random }) => {
    const calls: string[] = [];
    let ids = 0;
    const effects = {
      random: () => { calls.push("random"); return random.shift()!; },
      createOptionId: () => { calls.push("id"); ids += 1; return `o${ids}`; },
    };
    const { prompt, answerKey } = materializeTask(listeningPlan(), plannedItem(), "asset-audio-1", null, null, effects);
    expect(calls).toEqual(["random", "random", "id", "id", "id"]);
    if (prompt.kind !== "listening") throw new Error(`expected listening prompt, got ${prompt.kind}`);
    expect(prompt.options.findIndex((option) => option.id === answerKey.correctOptionId)).toBe(position);
    expect(prompt.options.map((option) => option.id)).toEqual(["o1", "o2", "o3"]);
    expect(prompt.options.map((option) => option.text)).toEqual(position === 0
      ? ["Thursday", "Friday", "Wednesday"]
      : position === 1 ? ["Friday", "Thursday", "Wednesday"] : ["Wednesday", "Friday", "Thursday"]);
  });

  it.each([{ count: 0, expectedIds: 0 }, { count: 1, expectedIds: 1 }])("uses no randomness for $count option(s)", ({ count, expectedIds }) => {
    const calls: string[] = [];
    const plan = listeningPlan({ options: listeningPlan().options!.slice(0, count) });
    const { prompt } = materializeTask(plan, plannedItem(), "asset-audio-1", null, null, {
      random: () => { calls.push("random"); return 0.5; },
      createOptionId: () => { calls.push("id"); return "only-id"; },
    });
    expect(calls).toEqual(Array(expectedIds).fill("id"));
    if (prompt.kind !== "listening") throw new Error("expected listening prompt");
    expect(prompt.options).toHaveLength(count);
  });

  it("preserves the existing last-ID mapping for duplicate option text", () => {
    const plan = listeningPlan({ options: [
      { itemRevisionId: "rev-1", text: "Thursday", correct: true },
      { itemRevisionId: "rev-2", text: "Thursday", correct: false },
    ] });
    let id = 0;
    const { prompt, answerKey } = materializeTask(plan, plannedItem(), "audio", null, null, {
      random: () => 0,
      createOptionId: () => `duplicate-${++id}`,
    });
    if (prompt.kind !== "listening") throw new Error("expected listening prompt");
    expect(prompt.options.map((option) => option.id)).toEqual(["duplicate-2", "duplicate-2"]);
    expect(answerKey.correctOptionId).toBe("duplicate-2");
    expect(answerKey.optionItemRevisionIds).toEqual({ "duplicate-2": "rev-1" });
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
    let randomIndex = 0;
    let optionId = 0;
    const { prompt, answerKey } = materializeTask(plan, plannedItem({ meaningVisual }), "asset-audio-1", null, null, {
      random: () => random[randomIndex++]!, createOptionId: () => `option-${++optionId}`,
    });
    expect(randomIndex).toBe(2);
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
