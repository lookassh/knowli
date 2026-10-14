import { describe, expect, it } from "vitest";
import { englishGrammarSubject } from "../../domain/lessons/subjects/english-grammar/module";
import { validatePool } from "../../domain/lessons/pool-validation";
import type { LessonTopic } from "../../domain/lessons/types";
import { collectBatchExerciseMetadata, filterExercisesToRequestedObjective, isWellShapedRawExercise, summarizeLessonPoolValidation, toExerciseDraft } from "./lesson-drafts";

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
    stem: "She ___ football.",
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
  it.each(["acceptedAnswers", "focus"])("odrzuca null w %s zamiast wywracać walidację puli", (field) => {
    const raw = { ...validChoiceRaw("watches"), [field]: [null] };
    expect(isWellShapedRawExercise(raw)).toBe(false);
    const rows = [validChoiceRaw("plays"), raw].filter(isWellShapedRawExercise).map(toExerciseDraft);
    expect(validatePool(rows, englishGrammarSubject, presentSimpleTopic()).valid.map((r) => r.answer)).toEqual(["plays"]);
  });
  it("validatePool odrzuca zły kształt bez wyjątku i zachowuje poprawne rekordy", () => {
    const topic = presentSimpleTopic();
    const drafts = [validChoiceRaw("plays"), malformedOptionsRaw()].map(toExerciseDraft);
    const result = validatePool(drafts, englishGrammarSubject, topic);
    expect(result.valid.map((ex) => ex.answer)).toEqual(["plays"]);
    expect(result.rejected).toHaveLength(1);
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

  it("top-level null in model output is rejected before mapping, preserving valid siblings", () => {
    const raws: unknown[] = [validChoiceRaw("plays"), null];
    const wellShaped = raws.filter(isWellShapedRawExercise).map(toExerciseDraft);
    expect(wellShaped).toHaveLength(1);
    expect(validatePool(wellShaped, englishGrammarSubject, presentSimpleTopic()).valid.map((ex) => ex.answer)).toEqual(["plays"]);
  });

  it("collects metadata from a batch containing top-level null without throwing", () => {
    expect(() => collectBatchExerciseMetadata([validChoiceRaw("plays"), null], true)).not.toThrow();
    expect(collectBatchExerciseMetadata([validChoiceRaw("plays"), null], true).answers).toEqual(["plays"]);
  });

  it("summarizes rejection rules and counts without logging answer text", () => {
    const summary = summarizeLessonPoolValidation({
      rawCount: 2,
      shapeRejected: 0,
      outOfScopeCount: 0,
      rejectedExerciseCount: 1,
      rejectedErrors: ["lesson_gap: answer secret-child-text does not match", "lesson_gap: answer other-secret does not match"],
      duplicateCount: 0,
      validCount: 0,
    });
    expect(summary).toContain("lesson_gap×2");
    expect(summary).toContain("odrzucone=1");
    expect(summary).not.toContain("secret-child-text");
    expect(summary).not.toContain("other-secret");
  });

  it("rejects a well-shaped exercise returned for a different objective in this batch", () => {
    const foreign = { ...validChoiceRaw("plays"), objectiveId: "english_grammar.present_simple.negative" };
    const result = filterExercisesToRequestedObjective([validChoiceRaw("watches"), foreign, null], OBJECTIVE_ID);
    expect(result.outOfScopeCount).toBe(1);
    expect(result.exercises).toEqual([validChoiceRaw("watches"), null]);
  });

  it("GREEN: po odfiltrowaniu strażnikiem validatePool nie rzuca i zwraca poprawne", () => {
    const topic = presentSimpleTopic();
    const raws = [validChoiceRaw("plays"), malformedOptionsRaw()];
    const wellShaped = raws.filter(isWellShapedRawExercise).map(toExerciseDraft);
    const { valid } = validatePool(wellShaped, englishGrammarSubject, topic);
    expect(valid.map((v) => v.answer)).toEqual(["plays"]);
  });
});
