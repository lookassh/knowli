import { describe, expect, it } from "vitest";
import { messages } from "@learning/contracts";
import { materializeGeneratedKeywords } from "./lesson-keywords";

describe("materializeGeneratedKeywords", () => {
  const raw = {
    exerciseType: "lesson_keywords", objectiveId: "o", familyId: "def",
    keywordOptions: [{ id: "k1", text: "światło" }, { id: "k2", text: "cukry" }, { id: "k3", text: "tlen" }, { id: "k4", text: "korzenie" }],
    keyOptionIds: ["k2", "k1"], sourceRefs: [{ quote: "przy udziale światła" }],
    answer: "zmyślona odpowiedź modelu",
  };

  it("computes the canonical answer from the key ids and adds the shared instruction", () => {
    const [out] = materializeGeneratedKeywords([raw]) as Record<string, unknown>[];
    expect(out).toMatchObject({
      exerciseType: "lesson_keywords", familyId: "def", answer: "cukry, światło",
      instructionPl: messages.kid.lessonKeywordsInstruction, acceptedAnswers: [], focus: [],
    });
  });

  it("leaves other exercises untouched and strips the answer of malformed keywords", () => {
    const gap = { exerciseType: "lesson_gap", answer: "x" };
    const [same, broken] = materializeGeneratedKeywords([gap, { ...raw, keywordOptions: [null] }]) as Record<string, unknown>[];
    expect(same).toBe(gap);
    expect(broken!.answer).toBeUndefined();
  });
});
