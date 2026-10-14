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

function contextualGap(
  objectiveId: string,
  stem: string,
  answer: string,
  hint?: string,
): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId,
    stem,
    ...(hint === undefined ? {} : { hint }),
    answer,
    acceptedAnswers: [],
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

  it.each([
    ["operator does not with base verb after gap", "english_grammar.present_simple.negative", "She ___ play tennis.", "does not", "do", true],
    ["contracted operator with base verb after gap", "english_grammar.present_simple.negative", "She ___ play tennis.", "doesn't", "do", true],
    ["operator before inflected verb", "english_grammar.present_simple.negative", "She ___ plays tennis.", "does not", "do", false],
    ["main verb supplied in gap", "english_grammar.present_simple.third_person_s", "She ___ tennis.", "plays", "play", true],
    ["operator and main verb supplied in gap", "english_grammar.present_simple.negative", "She ___ tennis.", "doesn't play", "play", true],
    ["Polish verb hint", "english_grammar.present_simple.third_person_s", "She ___ tennis.", "plays", "grać", false],
  ] as const)("auxiliaryGapWithHintUsesCompletedSentence: %s", (_name, objectiveId, stem, answer, hint, valid) => {
    const errors = validateEnglishGrammarExercise(contextualGap(objectiveId, stem, answer, hint), presentSimpleV1);
    expect(errors.length === 0).toBe(valid);
  });

  it("accepts a short answer operator without requiring a main verb hint", () => {
    const shortAnswer: LessonExerciseDraft = {
      exerciseType: "lesson_gap",
      objectiveId: "english_grammar.present_simple.short_answers",
      stem: "Yes, he ___.",
      answer: "does",
      acceptedAnswers: [],
      focus: ["does"],
    };
    expect(validateEnglishGrammarExercise(shortAnswer, presentSimpleV1)).toEqual([]);
  });

  it("translationCannotUseCanonicalOrAcceptedAnswerAsStimulus", () => {
    const translated: LessonExerciseDraft = {
      exerciseType: "lesson_open_answer",
      objectiveId: "english_grammar.present_simple.third_person_s",
      prompt: "She plays football every day.",
      answer: "She plays football every day.",
      acceptedAnswers: ["SHE   PLAYS football every day!"],
      focus: ["plays"],
    };
    const errors = validateEnglishGrammarExercise(translated, presentSimpleV1);
    expect(errors.some((error) => /prompt.*answer|bodziec.*odpowiedzi/i.test(error))).toBe(true);
    const acceptedLeak = validateEnglishGrammarExercise({
      ...translated,
      prompt: "SHE PLAYS FOOTBALL EVERY DAY!",
      answer: "She plays football daily.",
      acceptedAnswers: ["She plays football every day."],
    }, presentSimpleV1);
    expect(acceptedLeak.some((error) => /prompt.*answer|bodziec.*odpowiedzi/i.test(error))).toBe(true);
  });
});
