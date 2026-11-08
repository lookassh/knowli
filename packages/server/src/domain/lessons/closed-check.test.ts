import { describe, expect, it } from "vitest";
import { solverView } from "./agent/solver";
import { closedCheckContract, closedCheckItems, closedCheckVerdict } from "./closed-check";
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

const verdict = (draft: LessonExerciseDraft, raw: unknown) => closedCheckVerdict(draft, [raw], englishNormalizer);
const verdictOf = (draft: LessonExerciseDraft, raws: readonly unknown[]) => closedCheckVerdict(draft, raws, englishNormalizer);
const closedCheckItem = (draft: LessonExerciseDraft, t: LessonTopic) => closedCheckItems(draft, t)?.[0] ?? null;

describe("closedCheckContract", () => {
  it("maps closed types to their contract and text types to none", () => {
    expect(closedCheckContract("lesson_choice")).toBe("choice");
    expect(closedCheckContract("lesson_listen_choice")).toBe("choice");
    expect(closedCheckContract("lesson_short_answer")).toBe("choice");
    expect(closedCheckContract("lesson_notice")).toBe("choice");
    expect(closedCheckContract("lesson_order")).toBe("order");
    for (const type of ["lesson_match", "lesson_group", "lesson_cloze"] as const) expect(closedCheckContract(type)).toBe("choice");
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

const match: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_match",
  instructionPl: "Połącz w pary.",
  answer: "coat, hat, scarf",
  pairs: [{ left: "coat", right: "płaszcz" }, { left: "hat", right: "kapelusz" }, { left: "scarf", right: "szalik" }],
  extraRight: ["but"],
};

const group: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_group",
  instructionPl: "Podziel słowa.",
  answer: "Ubrania / Pogoda",
  groups: [{ id: "g1", label: "Ubrania" }, { id: "g2", label: "Pogoda" }],
  groupItems: [{ text: "sunny", groupId: "g2" }, { text: "coat", groupId: "g1" }, { text: "rainy", groupId: "g2" }, { text: "hat", groupId: "g1" }],
};

const cloze: LessonExerciseDraft = {
  ...base,
  exerciseType: "lesson_cloze",
  instructionPl: "Mam czerwony płaszcz i niebieski kapelusz. Uzupełnij tekst.",
  answer: "red, blue",
  clozeText: "I have a ___ coat and a ____ hat.",
  gapAnswers: ["red", "blue"],
  extraWords: ["green"],
};

describe("closedCheckItems for multi-field types", () => {
  it("match: one item per left side with the right column as options, without the key", () => {
    const items = closedCheckItems(match, topic)!;
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Field: coat");
    expect(items[1]).toContain("Field: hat");
    for (const item of items) {
      expect(item).toContain("Options: but | kapelusz | płaszcz | szalik");
      expect(item).toMatch(/other fields/i);
      expect(item).not.toContain("coat → płaszcz");
      expect(item).not.toContain("Teraz");
    }
  });

  it("group: fields in view order with group labels as options", () => {
    const items = closedCheckItems(group, topic)!;
    expect(items.map((item) => item.match(/Field: (\S+)/)![1])).toEqual(["coat", "hat", "rainy", "sunny"]);
    expect(items[0]).toContain("Options: Pogoda | Ubrania");
  });

  it("cloze: gaps numbered only in the check view", () => {
    const items = closedCheckItems(cloze, topic)!;
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("I have a ___ (1) coat and a ___ (2) hat.");
    expect(items[1]).toContain("Field: gap 2");
    expect(items[0]).toContain("Options: blue | green | red");
    expect(solverView(cloze, topic)).toContain("I have a ___ coat and a ____ hat.");
  });

  it("single-field types keep one item", () => {
    for (const draft of [choice, listen, order, notice]) expect(closedCheckItems(draft, topic)).toHaveLength(1);
  });
});

describe("closedCheckVerdict for multi-field types", () => {
  const ok = [{ answers: ["płaszcz"] }, { answers: ["kapelusz"] }, { answers: ["szalik"] }];

  it("passes only when every field equals its key", () => {
    expect(verdictOf(match, ok)).toEqual({ pass: true });
    expect(verdictOf(match, [ok[0], { answers: ["kapelusz", "but"] }, ok[2]])).toEqual({ pass: false, code: "check_wrong_set" });
    expect(verdictOf(match, [ok[0], { answers: [] }, ok[2]])).toEqual({ pass: false, code: "check_wrong_set" });
    expect(verdictOf(match, [ok[0], { answers: ["czapka"] }, ok[2]])).toEqual({ pass: false, code: "check_wrong_set" });
    expect(verdictOf(match, [{ answers: [" PŁASZCZ "] }, ok[1], ok[2]])).toEqual({ pass: true });
  });

  it("an unknown or missing field result makes the exercise unknown", () => {
    expect(verdictOf(match, [ok[0], { answers: null }, ok[2]])).toEqual({ pass: false, code: "check_unknown" });
    expect(verdictOf(match, [ok[0], ok[1]])).toEqual({ pass: false, code: "check_unknown" });
  });

  it("group and cloze fields", () => {
    expect(verdictOf(group, [{ answers: ["Ubrania"] }, { answers: ["Ubrania"] }, { answers: ["Pogoda"] }, { answers: ["Pogoda"] }])).toEqual({ pass: true });
    expect(verdictOf(group, [{ answers: ["Ubrania", "Pogoda"] }, { answers: ["Ubrania"] }, { answers: ["Pogoda"] }, { answers: ["Pogoda"] }])).toEqual({ pass: false, code: "check_wrong_set" });
    expect(verdictOf(cloze, [{ answers: ["red"] }, { answers: ["blue"] }])).toEqual({ pass: true });
    expect(verdictOf(cloze, [{ answers: ["red", "blue"] }, { answers: ["blue"] }])).toEqual({ pass: false, code: "check_wrong_set" });
  });
});
