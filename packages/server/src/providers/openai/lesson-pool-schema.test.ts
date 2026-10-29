import { describe, expect, it } from "vitest";
import type { LessonPoolInput } from "../../ports/ai";
import { lessonPoolJsonSchema } from "./lesson-pool-schema";

const input: LessonPoolInput = {
  subjectId: "subject",
  subjectTitle: "Subject",
  answerLocale: "en-GB",
  promptLocale: "pl-PL",
  promptProfile: { generationRole: "role", gradingRole: "grade", almostDefinition: "almost" },
  exerciseTypes: ["lesson_card", "lesson_choice", "lesson_gap", "lesson_transform"],
  transforms: [{ id: "to_negative", instructionPl: "Zmień na przeczenie" }],
  objectives: [{
    id: "objective-a",
    descriptionEn: "Objective A",
    exerciseTypes: ["lesson_choice", "lesson_gap", "lesson_card"],
    errorCategories: [],
  }],
  material: "play",
  countPerObjective: 3,
  stageCounts: { guided: 1, productive: 1, independent: 1 },
  graderAvailable: false,
};

describe("lessonPoolJsonSchema", () => {
  it("requires 1–3 quotes per exercise when grounding is required, keeps them optional otherwise", () => {
    const grounded = lessonPoolJsonSchema({ ...input, groundingRequired: true }) as any;
    expect(grounded.properties.exercises.items.properties.sourceRefs).toMatchObject({ type: "array", minItems: 1, maxItems: 3 });
    const plain = lessonPoolJsonSchema(input) as any;
    expect(plain.properties.exercises.items.properties.sourceRefs.type).toEqual(["null", "array"]);
    expect(plain.properties.exercises.items.properties.sourceRefs).not.toHaveProperty("minItems");
  });

  it("gives calculations a strict parameter-only branch, with all three closed kinds", () => {
    const schema = lessonPoolJsonSchema({
      ...input,
      exerciseTypes: ["lesson_gap", "lesson_calculation"],
      objectives: [{ ...input.objectives[0]!, exerciseTypes: ["lesson_gap", "lesson_calculation"] }],
    }) as any;
    const branches = schema.properties.exercises.items.anyOf;
    expect(branches).toHaveLength(2);
    const calculation = branches.find((branch: any) => branch.properties.exerciseType.enum.includes("lesson_calculation"));
    expect(calculation.required.sort()).toEqual(["exerciseType", "objectiveId", "calculation", "sourceRefs"].sort());
    expect(calculation.properties).not.toHaveProperty("answer");
    expect(calculation.properties).not.toHaveProperty("prompt");
    expect(calculation.additionalProperties).toBe(false);
    const kinds = calculation.properties.calculation.anyOf;
    expect(kinds.map((kind: any) => kind.properties.kind.enum[0])).toEqual(["scale_distance", "height_difference", "unit_conversion"]);
    expect(kinds[0].properties.params.required).toEqual(["scaleDenominator", "mapDistanceCm"]);
    for (const kind of kinds) {
      expect(kind.additionalProperties).toBe(false);
      expect(kind.properties.params.additionalProperties).toBe(false);
      expect(kind.required.sort()).toEqual(Object.keys(kind.properties).sort());
    }
    expect(branches[0].properties.exerciseType.enum).toEqual(["lesson_gap"]);
  });

  it("gives keywords a strict branch without answer, linked to an open-answer family", () => {
    const schema = lessonPoolJsonSchema({
      ...input,
      exerciseTypes: ["lesson_gap", "lesson_open_answer", "lesson_keywords"],
      objectives: [{ ...input.objectives[0]!, exerciseTypes: ["lesson_gap", "lesson_open_answer", "lesson_keywords"] }],
    }) as any;
    const branches = schema.properties.exercises.items.anyOf;
    expect(branches).toHaveLength(2);
    const keywords = branches.find((branch: any) => branch.properties.exerciseType.enum.includes("lesson_keywords"));
    expect(keywords.required.sort()).toEqual(["exerciseType", "objectiveId", "familyId", "keywordOptions", "keyOptionIds", "sourceRefs"].sort());
    expect(keywords.properties).not.toHaveProperty("answer");
    expect(keywords.additionalProperties).toBe(false);
    expect(keywords.properties.keywordOptions).toMatchObject({ minItems: 4, maxItems: 6 });
    expect(keywords.properties.keyOptionIds).toMatchObject({ minItems: 2, maxItems: 3 });
    expect(branches[0].properties.exerciseType.enum).toEqual(["lesson_gap", "lesson_open_answer"]);
  });

  it("keeps strict root, nullable required fields, and only the objective's pool types", () => {
    const schema = lessonPoolJsonSchema(input) as any;
    const item = schema.properties.exercises.items;
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["exercises", "examples"] });
    expect(item.properties.exerciseType.enum).toEqual(["lesson_choice", "lesson_gap"]);
    expect(item.properties.objectiveId.enum).toEqual(["objective-a"]);
    expect(item.properties.transformId.enum).toEqual([null, "to_negative"]);
    expect(item.properties.options.type).toEqual(["null", "array"]);
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.additionalProperties).toBe(false);
    expect(schema.properties.examples.items.properties.objectiveId.enum).toEqual(["objective-a"]);
  });

  it("uses complete strict branches to pair each objective with its allowed exercise types", () => {
    const schema = lessonPoolJsonSchema({
      ...input,
      objectives: [
        { ...input.objectives[0]!, id: "objective-a", exerciseTypes: ["lesson_choice"] },
        { ...input.objectives[0]!, id: "objective-b", exerciseTypes: ["lesson_gap"] },
      ],
    }) as any;
    const branches = schema.properties.exercises.items.anyOf;
    expect(branches.map((branch: any) => [branch.properties.objectiveId.enum[0], branch.properties.exerciseType.enum[0]])).toEqual([
      ["objective-a", "lesson_choice"],
      ["objective-b", "lesson_gap"],
    ]);
    for (const branch of branches) {
      expect(branch.additionalProperties).toBe(false);
      expect(branch.required.sort()).toEqual(Object.keys(branch.properties).sort());
    }
  });

  it("rejects empty objective sets and objectives with no supported pool types", () => {
    expect(() => lessonPoolJsonSchema({ ...input, objectives: [] })).toThrow(/at least one objective/);
    expect(() => lessonPoolJsonSchema({
      ...input,
      objectives: [{ ...input.objectives[0]!, exerciseTypes: ["lesson_card"] }],
    })).toThrow(/no supported pool exercise types/);
  });
});
