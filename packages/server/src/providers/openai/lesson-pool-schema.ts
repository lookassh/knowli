import type { LessonPoolInput } from "../../ports/ai";

const NON_POOL_EXERCISE_TYPES: ReadonlySet<string> = new Set(["lesson_card"]);

export const poolExerciseTypes = (types: readonly string[]): string[] =>
  types.filter((type) => !NON_POOL_EXERCISE_TYPES.has(type));

function lessonExerciseSchema(
  input: LessonPoolInput,
  objective: LessonPoolInput["objectives"][number],
): Record<string, unknown> {
  const allowedTypes = poolExerciseTypes(objective.exerciseTypes.filter((type) => input.exerciseTypes.includes(type)));
  if (allowedTypes.length === 0) {
    throw new Error(`objective ${objective.id} has no supported pool exercise types`);
  }
  const quoteItem = { type: "object", additionalProperties: false, required: ["quote"], properties: { quote: { type: "string" } } };
  const idTextItem = {
    type: "object",
    additionalProperties: false,
    required: ["id", "text"],
    properties: { id: { type: "string" }, text: { type: "string" } },
  };
  const nullable = (schema: Record<string, unknown>) => ({
    type: ["null", schema.type],
    ...(schema.items ? { items: schema.items } : {}),
  });
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "exerciseType", "objectiveId", "answer", "acceptedAnswers", "focus", "instructionPl",
      "stem", "statement", "prompt", "hint", "transformId", "noticeSegments", "visualSubject", "options",
      "correctOption", "items", "questionType", "requiredElements", "supplementaryElements",
      "commonErrors", "expectedForm", "familyId", "sourceRefs",
    ],
    properties: {
      exerciseType: { type: "string", enum: allowedTypes },
      objectiveId: { type: "string", enum: [objective.id] },
      answer: { type: "string" },
      acceptedAnswers: { type: "array", items: { type: "string" } },
      focus: { type: "array", items: { type: "string" } },
      instructionPl: { type: ["null", "string"] },
      stem: { type: ["null", "string"] },
      statement: { type: ["null", "string"] },
      prompt: { type: ["null", "string"] },
      hint: { type: ["null", "string"] },
      transformId: { type: ["null", "string"], enum: [null, ...input.transforms.map((transform) => transform.id)] },
      noticeSegments: { type: ["null", "array"], items: { type: "array", items: { type: "string" } } },
      visualSubject: { type: ["null", "string"], enum: [null, "boy", "girl", "man", "woman", "group", "dog"] },
      options: nullable({ type: "array", items: idTextItem }),
      correctOption: { type: ["null", "string"] },
      items: nullable({ type: "array", items: idTextItem }),
      questionType: { type: ["null", "string"], enum: [null, "definition", "enumeration", "cause", "comparison", "fact", "process"] },
      requiredElements: nullable({ type: "array", items: idTextItem }),
      supplementaryElements: { type: ["null", "array"], items: { type: "string" } },
      commonErrors: { type: ["null", "array"], items: { type: "string" } },
      expectedForm: { type: ["null", "string"], enum: [null, "short", "one_sentence", "explanation", "list"] },
      familyId: { type: ["null", "string"] },
      sourceRefs: input.groundingRequired ? { type: "array", items: quoteItem } : nullable({ type: "array", items: quoteItem }),
    },
  };
}

/** Strict JSON Schema: każda gałąź wiąże typ ćwiczenia z jednym celem. */
export function lessonPoolJsonSchema(input: LessonPoolInput): Record<string, unknown> {
  if (input.objectives.length === 0) throw new Error("lesson pool requires at least one objective");
  const branches = input.objectives.map((objective) => lessonExerciseSchema(input, objective));
  const objectiveIds = input.objectives.map((objective) => objective.id);
  return {
    type: "object",
    additionalProperties: false,
    required: ["exercises", "examples"],
    properties: {
      exercises: { type: "array", items: branches.length === 1 ? branches[0] : { anyOf: branches } },
      examples: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["objectiveId", "examples"],
          properties: {
            objectiveId: { type: "string", enum: objectiveIds },
            examples: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}
