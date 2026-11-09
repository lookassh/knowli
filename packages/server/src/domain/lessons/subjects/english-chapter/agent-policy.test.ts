import { describe, expect, it } from "vitest";
import type { LessonExerciseDraft } from "../../types";
import { chapterAgentPolicy } from "./agent-policy";
import { englishChapterSubject } from "./module";
import { TRANSLATION_INSTRUCTION } from "./validators";

describe("chapterAgentPolicy — pola modułu", () => {
  it("moduł rozdziału składa pola generowania z polityki", () => {
    expect(englishChapterSubject.checkerNeedsMaterial).toBe(false);
    expect(englishChapterSubject.ruleNotes).toBe(chapterAgentPolicy.ruleNotes);
    expect(englishChapterSubject.sanitize).toBe(chapterAgentPolicy.sanitize);
  });

  it("jedyny dopisek reguły to duplikat wariantu (reguła rdzenia w sekcji ogólnej księgi)", () => {
    expect(Object.keys(chapterAgentPolicy.ruleNotes ?? {})).toEqual(["variants.duplicate"]);
  });
});

describe("sanitize", () => {
  it("tłumaczenie bez polecenia dostaje stałe polecenie", () => {
    const translation: LessonExerciseDraft = {
      exerciseType: "lesson_open_answer", objectiveId: "english_chapter.dx.room", prompt: "Mam łóżko.", answer: "I have a bed.", acceptedAnswers: [], focus: ["bed"],
    };
    expect(chapterAgentPolicy.sanitize!(translation, { material: "" })).toEqual({ draft: { ...translation, instructionPl: TRANSLATION_INSTRUCTION }, removed: [] });
  });
});
