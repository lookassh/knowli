import { describe, expect, it } from "vitest";
import { englishGrammarSubject } from "../../domain/lessons/subjects/english-grammar/module";
import { validatePool } from "../../domain/lessons/pool-validation";
import type { LessonTopic } from "../../domain/lessons/types";
import { isWellShapedRawExercise, toExerciseDraft } from "./lesson-drafts";

const OBJECTIVE_ID = "english_grammar.present_simple.third_person_s";

/** Minimalny temat zgodny z celem używanym przez przedmiot english_grammar. */
function presentSimpleTopic(): LessonTopic {
  const topic = englishGrammarSubject.topics.find((t) => t.id === "present_simple");
  if (!topic) throw new Error("fixture topic missing");
  return topic;
}

/** Poprawny kształtowo lesson_choice (surowy obiekt z portu). */
function validChoiceRaw(answer: string) {
  return {
    exerciseType: "lesson_choice",
    objectiveId: OBJECTIVE_ID,
    instructionPl: "Wybierz.",
    answer,
    acceptedAnswers: [],
    focus: [],
    options: [
      { id: "a", text: answer },
      { id: "b", text: `${answer}x` },
    ],
    correctOption: "a",
  };
}

/** lesson_choice o złym kształcie: null w tablicy opcji. */
function malformedOptionsRaw() {
  return {
    exerciseType: "lesson_choice",
    objectiveId: OBJECTIVE_ID,
    instructionPl: "Wybierz.",
    answer: "watches",
    acceptedAnswers: [],
    focus: [],
    options: [null, { id: "b", text: "watch" }],
    correctOption: "b",
  };
}

describe("P2-7: strażnik kształtu surowego ćwiczenia (isWellShapedRawExercise)", () => {
  it("RED-dowód: bez strażnika validatePool rzuca TypeError na options=[null,…]", () => {
    const topic = presentSimpleTopic();
    const drafts = [validChoiceRaw("plays"), malformedOptionsRaw()].map(toExerciseDraft);
    // Dowód luki: semantyczna walidacja dereferencuje options[i].text → TypeError.
    expect(() => validatePool(drafts, englishGrammarSubject, topic)).toThrow(TypeError);
  });

  it("strażnik odrzuca ćwiczenie z null w options", () => {
    expect(isWellShapedRawExercise(malformedOptionsRaw())).toBe(false);
  });

  it("strażnik odrzuca options z elementem bez pola text", () => {
    expect(
      isWellShapedRawExercise({ ...validChoiceRaw("plays"), options: [{ id: "a" }, { id: "b", text: "x" }] }),
    ).toBe(false);
  });

  it("strażnik odrzuca items z elementem o złym typie", () => {
    expect(
      isWellShapedRawExercise({
        exerciseType: "lesson_order",
        objectiveId: OBJECTIVE_ID,
        answer: "a b c",
        acceptedAnswers: [],
        focus: [],
        items: [{ id: "i1", text: "a" }, 42, { id: "i3", text: "c" }],
      }),
    ).toBe(false);
  });

  it("strażnik odrzuca noticeSegments o złym kształcie (null segment)", () => {
    expect(
      isWellShapedRawExercise({
        exerciseType: "lesson_notice",
        objectiveId: OBJECTIVE_ID,
        answer: "plays",
        acceptedAnswers: [],
        focus: [],
        noticeSegments: [["plays", null], ["two"]],
        correctOption: "plays",
      }),
    ).toBe(false);
  });

  it("strażnik przepuszcza poprawny kształtowo lesson_choice", () => {
    expect(isWellShapedRawExercise(validChoiceRaw("plays"))).toBe(true);
  });

  it("strażnik przepuszcza ćwiczenie bez pól tablicowych (gap)", () => {
    expect(
      isWellShapedRawExercise({
        exerciseType: "lesson_gap",
        objectiveId: OBJECTIVE_ID,
        answer: "plays",
        acceptedAnswers: [],
        focus: ["plays"],
        stem: "___ here.",
      }),
    ).toBe(true);
  });

  it("GREEN: po odfiltrowaniu strażnikiem validatePool nie rzuca i zwraca poprawne", () => {
    const topic = presentSimpleTopic();
    const raws = [validChoiceRaw("plays"), malformedOptionsRaw()];
    const wellShaped = raws.filter(isWellShapedRawExercise).map(toExerciseDraft);
    const { valid } = validatePool(wellShaped, englishGrammarSubject, topic);
    expect(valid.map((v) => v.answer)).toEqual(["plays"]);
  });
});
