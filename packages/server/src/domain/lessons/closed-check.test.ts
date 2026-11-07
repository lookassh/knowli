import { describe, expect, it } from "vitest";
import { closedCheckContract, closedCheckItem, closedCheckVerdict } from "./closed-check";
import { englishNormalizer } from "./subjects/english/normalizer";
import type { LessonExerciseDraft, LessonTopic } from "./types";

const topic = {
  id: "t",
  version: 1,
  titlePl: "Temat",
  transforms: [],
  objectives: [{ id: "t.o", titlePl: "Teraz: am/is/are + -ing", descriptionEn: "Present continuous.", cards: [], errorCategories: [], hints: {}, exerciseTypes: [] }],
} as unknown as LessonTopic;

const base = { objectiveId: "t.o", answer: "", acceptedAnswers: [], focus: [] } as const;

const choice: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_choice",
  instructionPl: "Wybierz formę.",
  stem: "She ___ reading.",
  answer: "is",
  options: [{ id: "a", text: "are" }, { id: "b", text: "is" }, { id: "c", text: "is not" }],
  correctOption: "b",
  hint: "be",
  explanationPl: "She → is.",
};

const listen: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_listen_choice",
  stem: "They ___ playing.",
  answer: "are",
  options: [{ id: "a", text: "are" }, { id: "b", text: "is" }],
  correctOption: "a",
};

const order: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_order",
  instructionPl: "Ułóż zdanie.",
  answer: "Tom is reading now.",
  items: [{ id: "1", text: "Tom" }, { id: "2", text: "is" }, { id: "3", text: "reading" }, { id: "4", text: "now." }],
};

const notice: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_notice",
  instructionPl: "Wskaż słowo z -ing.",
  noticeSegments: [["She", "is", "reading"], ["He", "plays"]],
  correctOption: "reading",
};

const verdict = (draft: LessonExerciseDraft, raw: unknown) => closedCheckVerdict(draft, raw, englishNormalizer);

describe("closedCheckContract", () => {
  it("maps closed types to their contract and text types to none", () => {
    expect(closedCheckContract("lesson_choice")).toBe("choice");
    expect(closedCheckContract("lesson_listen_choice")).toBe("choice");
    expect(closedCheckContract("lesson_short_answer")).toBe("choice");
    expect(closedCheckContract("lesson_notice")).toBe("choice");
    expect(closedCheckContract("lesson_order")).toBe("order");
    for (const type of ["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"] as const) {
      expect(closedCheckContract(type)).toBeNull();
    }
  });
});

describe("closedCheckItem", () => {
  it("shows the child view without key, hint, explanation or objective title", () => {
    const view = closedCheckItem(choice, topic)!;
    expect(view).toContain("She ___ reading.");
    expect(view).not.toContain("She → is");
    expect(view).not.toContain("be\n");
    expect(closedCheckItem({ ...choice, instructionPl: undefined }, topic)!).not.toContain("Teraz");
  });

  it("adds the transcript of the recording to listen_choice", () => {
    expect(closedCheckItem(listen, topic)).toContain("Recording (transcript): They are playing.");
  });

  it("adds the arranged key to order", () => {
    expect(closedCheckItem(order, topic)).toContain("Arranged answer: Tom is reading now.");
  });

  it("returns null for text types", () => {
    expect(closedCheckItem({ ...base, exerciseType: "lesson_gap", stem: "She ___ reading.", answer: "is" }, topic)).toBeNull();
  });
});

describe("closedCheckVerdict", () => {
  it("passes only the exact key set", () => {
    expect(verdict(choice, { answers: ["is"] })).toEqual({ pass: true });
    expect(verdict(choice, { answers: [" IS "] })).toEqual({ pass: true });
    expect(verdict(choice, { answers: ["is", "is"] })).toEqual({ pass: true });
    expect(verdict(choice, { answers: ["is", "are"] })).toEqual({ pass: false, code: "check_wrong_set" });
    expect(verdict(choice, { answers: [] })).toEqual({ pass: false, code: "check_wrong_set" });
    expect(verdict(choice, { answers: ["was"] })).toEqual({ pass: false, code: "check_wrong_set" });
  });

  it("maps a contracted answer to the option with the full form", () => {
    expect(verdict(choice, { answers: ["isn't"] })).toEqual({ pass: false, code: "check_wrong_set" });
    const contracted = { ...choice, answer: "isn't", options: [{ id: "a", text: "are" }, { id: "b", text: "isn’t" }], correctOption: "b" };
    expect(verdict(contracted, { answers: ["is not"] })).toEqual({ pass: true });
  });

  it("treats unknown and malformed results as unknown", () => {
    expect(verdict(choice, { answers: null })).toEqual({ pass: false, code: "check_unknown" });
    expect(verdict(choice, undefined)).toEqual({ pass: false, code: "check_unknown" });
    expect(verdict(choice, { answers: "is" })).toEqual({ pass: false, code: "check_unknown" });
  });

  it("checks notice words against segments and rejects a key that occurs twice", () => {
    expect(verdict(notice, { answers: ["reading"] })).toEqual({ pass: true });
    expect(verdict(notice, { answers: ["plays"] })).toEqual({ pass: false, code: "check_wrong_set" });
    const twice = { ...notice, noticeSegments: [["She", "is", "reading"], ["He", "is", "reading"]] };
    expect(verdict(twice, { answers: ["reading"] })).toEqual({ pass: false, code: "check_wrong_set" });
  });

  it("passes order only on yes", () => {
    expect(verdict(order, { verdict: "yes" })).toEqual({ pass: true });
    expect(verdict(order, { verdict: "no" })).toEqual({ pass: false, code: "check_order_no" });
    expect(verdict(order, { verdict: "unknown" })).toEqual({ pass: false, code: "check_unknown" });
    expect(verdict(order, { answers: ["x"] })).toEqual({ pass: false, code: "check_unknown" });
  });
});
