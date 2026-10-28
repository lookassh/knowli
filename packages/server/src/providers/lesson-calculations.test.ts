import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeLlmProvider } from "./fake";
import { createOpenAiLlmProvider } from "./openai/llm";
import type { LessonPoolInput } from "../ports/ai";
import { isWellShapedRawExercise } from "../modules/materials/lessons/lesson-drafts";

const input: LessonPoolInput = {
  subjectId: "school", subjectTitle: "Geografia", answerLocale: "pl-PL", promptLocale: "pl-PL",
  promptProfile: { generationRole: "role", gradingRole: "grade", almostDefinition: "almost" },
  exerciseTypes: ["lesson_calculation"], transforms: [],
  objectives: [{ id: "scale", descriptionEn: "Map scale", exerciseTypes: ["lesson_calculation"], errorCategories: [] }],
  material: "Skala mapy pozwala przeliczyć odległość na mapie na odległość w terenie.",
  countPerObjective: 7, stageCounts: { guided: 3, productive: 2, independent: 2 }, graderAvailable: true,
};
const raw = {
  exerciseType: "lesson_calculation", objectiveId: "scale",
  calculation: { kind: "scale_distance", params: { scaleDenominator: 25000, mapDistanceCm: 3 }, unit: "m", templateFamilyId: "map-scale" },
  sourceRefs: [{ quote: input.material }],
};

afterEach(() => vi.unstubAllGlobals());

describe("calculation generation adapters", () => {
  it.each(["fake", "openai"])("%s renders canonical content and computes the answer instead of trusting model fields", async (adapter) => {
    const injected = { ...raw, answer: "999 km", prompt: "Nowe fakty geograficzne", focus: ["999"], acceptedAnswers: ["999"] };
    const fake = new FakeLlmProvider();
    fake.queueLesson({ exercises: [injected] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ exercises: [injected] }) } }] }))));
    const provider = adapter === "fake" ? fake : createOpenAiLlmProvider({ apiKey: "fake" });
    const result = await provider.generateLessonPool(input);
    expect(result.exercises[0]).toMatchObject({
      ...raw, answer: "750 m", focus: [], acceptedAnswers: [],
      prompt: "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m.",
    });
  });

  it("keeps invalid calculation records available for individual rejection, alongside valid exercises", async () => {
    const fake = new FakeLlmProvider();
    const invalid = { ...raw, calculation: { ...raw.calculation, kind: "unknown" } };
    fake.queueLesson({ exercises: [invalid, raw, { exerciseType: "lesson_gap", answer: "mapa" }] });
    const result = await fake.generateLessonPool(input);
    expect(result.exercises).toHaveLength(3);
    expect(result.exercises[1]).toMatchObject({ answer: "750 m" });
    expect(result.exercises[2]).toEqual({ exerciseType: "lesson_gap", answer: "mapa" });
  });

  it("forces malformed parameters with an injected answer through individual shape rejection", async () => {
    const fake = new FakeLlmProvider();
    fake.queueLesson({ exercises: [{ ...raw, answer: "750 m", calculation: {
      kind: "unit_conversion", params: null, unit: "m", templateFamilyId: "conversion",
    } }, raw] });
    const result = await fake.generateLessonPool(input);
    expect(result.exercises).toHaveLength(2);
    expect(isWellShapedRawExercise(result.exercises[0])).toBe(false);
    expect(isWellShapedRawExercise(result.exercises[1])).toBe(true);
  });
});
