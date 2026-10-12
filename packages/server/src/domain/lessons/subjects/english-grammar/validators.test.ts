import { describe, expect, it } from "vitest";
import { validateEnglishGrammarExercise } from "./validators";
import { presentSimpleV1 } from "./topics/present-simple";
import type { LessonExerciseDraft } from "../../types";

/** Buduje szkic `lesson_gap` z czasownikiem w podpowiedzi (bezokolicznik) i odpowiedzią luki. */
function gap(hint: string, answer: string): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: "english_grammar.present_simple.third_person_s",
    stem: "He ___ every day.",
    hint,
    answer,
    acceptedAnswers: [answer],
    focus: answer.split(" "),
  };
}

describe("validateEnglishGrammarExercise — lesson_gap, forma czasownika w Present Simple", () => {
  it("akceptuje formę podstawową, +s, +es, y→ies, nieregularne", () => {
    const ok: [string, string][] = [
      ["play", "plays"],
      ["play", "play"],
      ["watch", "watches"],
      ["study", "studies"],
      ["go", "goes"],
      ["have", "has"],
      ["be", "is"],
      ["be", "are"],
      ["be", "am"],
      ["do", "does"],
    ];
    for (const [hint, answer] of ok) {
      expect(validateEnglishGrammarExercise(gap(hint, answer), presentSimpleV1)).toEqual([]);
    }
  });

  it("akceptuje formy z operatorem (doesn't play / does not play)", () => {
    expect(validateEnglishGrammarExercise(gap("play", "doesn't play"), presentSimpleV1)).toEqual([]);
    expect(validateEnglishGrammarExercise(gap("play", "does not play"), presentSimpleV1)).toEqual([]);
  });

  it("odrzuca błędne formy (plaies, played, watchs)", () => {
    expect(validateEnglishGrammarExercise(gap("play", "plaies"), presentSimpleV1).length).toBeGreaterThan(0);
    expect(validateEnglishGrammarExercise(gap("play", "played"), presentSimpleV1).length).toBeGreaterThan(0);
    expect(validateEnglishGrammarExercise(gap("watch", "watchs"), presentSimpleV1).length).toBeGreaterThan(0);
  });

  it("bez podpowiedzi (hint) nie dokłada reguły czasownika", () => {
    const noHint: LessonExerciseDraft = { ...gap("play", "plays"), hint: undefined };
    expect(validateEnglishGrammarExercise(noHint, presentSimpleV1)).toEqual([]);
  });
});

describe("validateEnglishGrammarExercise — inne typy", () => {
  it("typy inne niż luka → []", () => {
    const choice: LessonExerciseDraft = {
      exerciseType: "lesson_choice",
      objectiveId: "english_grammar.present_simple.third_person_s",
      stem: "He ___ football.",
      answer: "plays",
      acceptedAnswers: ["plays"],
      focus: ["plays"],
      options: [
        { id: "a", text: "play" },
        { id: "b", text: "plays" },
      ],
      correctOption: "b",
    };
    expect(validateEnglishGrammarExercise(choice, presentSimpleV1)).toEqual([]);
  });
});
