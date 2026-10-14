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
