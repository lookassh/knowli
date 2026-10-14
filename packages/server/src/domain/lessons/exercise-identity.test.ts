import { describe, expect, it } from "vitest";
import { lessonExerciseIdentity } from "./exercise-identity";
import type { LessonExerciseDraft } from "./types";

function exercise(overrides: Partial<LessonExerciseDraft>): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: "english_grammar.present_simple.question",
    stem: "___ she play tennis?",
    answer: "does",
    acceptedAnswers: [],
    focus: ["does"],
    ...overrides,
  };
}

describe("lessonExerciseIdentity", () => {
  it("uses normalized stimulus, objective, and exercise type", () => {
    expect(lessonExerciseIdentity(exercise({}))).toBe(lessonExerciseIdentity(exercise({
      stem: "  ___ SHE   play tennis? ", instructionPl: "Inne polecenie", hint: "play",
    })));
    expect(lessonExerciseIdentity(exercise({ objectiveId: "english_grammar.present_simple.negative" })))
      .not.toBe(lessonExerciseIdentity(exercise({})));
    expect(lessonExerciseIdentity(exercise({ exerciseType: "lesson_open_answer", prompt: "___ she play tennis?" })))
      .not.toBe(lessonExerciseIdentity(exercise({})));
  });

  it("includes transform identity and ignores option presentation IDs", () => {
    const transformed = exercise({ exerciseType: "lesson_transform", statement: "She plays tennis.", transformId: "to_negative" });
    expect(lessonExerciseIdentity(transformed)).not.toBe(lessonExerciseIdentity({ ...transformed, transformId: "to_question" }));
    const choice = exercise({ exerciseType: "lesson_choice", stem: "Do you play?", options: [
      { id: "a", text: "Yes" }, { id: "b", text: "No" },
    ] });
    expect(lessonExerciseIdentity(choice)).toBe(lessonExerciseIdentity({ ...choice, options: [
      { id: "x", text: "Yes" }, { id: "y", text: "No" },
    ] }));
  });

  it("uses the displayed question as the short-answer stimulus before a legacy stem", () => {
    const first = exercise({
      exerciseType: "lesson_short_answer",
      prompt: "Does she play tennis?",
      stem: "Legacy stem A",
    });
    const second = { ...first, stem: "Legacy stem B" };
    expect(lessonExerciseIdentity(first)).toBe(lessonExerciseIdentity(second));
  });
});
