import { describe, expect, it } from "vitest";
import type { TaskPlan } from "./scheduler";
import { buildTaskContent, type PlannedItem, type TaskContentInput } from "./task-materialization";

const meaningVisual = { kind: "color" as const, color: "#ff0000" };
const item: PlannedItem = {
  itemId: "item-1", source: "czwartek", target: "Thursday", acceptedAnswers: ["Thu"],
  visualType: "none", sourceLocale: "pl-PL", targetLocale: "en-GB", example: "Today is Thursday.",
};
const options = [
  { id: "f", itemRevisionId: "r2", text: "Friday", correct: false },
  { id: "t", itemRevisionId: "r1", text: "Thursday", correct: true },
];
function input(exerciseType: TaskPlan["exerciseType"], overrides: Partial<TaskContentInput> = {}): TaskContentInput {
  return {
    plan: { exerciseType, ...(exerciseType === "reading" ? { direction: "source_to_target" as const } : {}) },
    item, options: ["listening", "reading", "reverse_recognition", "picture_recognition"].includes(exerciseType) ? options : [],
    audioAssetId: "audio-1", imageAssetId: "image-1", exampleAudioAssetId: "example-audio-1", ...overrides,
  };
}
const key = (exerciseType: TaskPlan["exerciseType"], extras: Record<string, unknown> = {}) => ({
  exerciseType, target: "Thursday", acceptedAnswers: ["Thu"], ...extras,
});

describe("buildTaskContent", () => {
  it("builds a listening prompt and answer key from explicit option IDs and order", () => {
    const result = buildTaskContent(input("listening"));
    expect(result.prompt).toEqual({ kind: "listening", audioAssetId: "audio-1", options: [
      { id: "f", text: "Friday" }, { id: "t", text: "Thursday" },
    ] });
    expect(result.answerKey).toEqual({ exerciseType: "listening", target: "Thursday", acceptedAnswers: ["Thu"],
      correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } });
  });

  it("preserves the literal output of every prompt branch", () => {
    const visualOptions = [
      { id: "f", itemRevisionId: "r2", text: "Piątek", correct: false, visual: { kind: "number" as const, count: 5 } },
      { id: "t", itemRevisionId: "r1", text: "Czwartek", correct: true, visual: meaningVisual },
    ];
    const cases: Array<{ name: string; exerciseType: TaskPlan["exerciseType"]; expectedPrompt: unknown; expectedKey: unknown; overrides?: Partial<TaskContentInput> }> = [
      { name: "text exposure", exerciseType: "exposure", expectedPrompt: { kind: "exposure", source: "czwartek", target: "Thursday", example: "Today is Thursday.", audioAssetId: "audio-1", exampleAudioAssetId: "example-audio-1", imageAssetId: "image-1", visualType: "none" }, expectedKey: key("exposure") },
      { name: "picture exposure", exerciseType: "exposure", expectedPrompt: { kind: "picture_exposure", visual: meaningVisual, audioAssetId: "audio-1" }, expectedKey: key("exposure"), overrides: { item: { ...item, meaningVisual } } },
      { name: "text listening", exerciseType: "listening", expectedPrompt: { kind: "listening", audioAssetId: "audio-1", options: [{ id: "f", text: "Friday" }, { id: "t", text: "Thursday" }] }, expectedKey: key("listening", { correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } }) },
      { name: "picture listening", exerciseType: "listening", expectedPrompt: { kind: "picture_listening", audioAssetId: "audio-1", options: [{ id: "f", labelPl: "Piątek", visual: { kind: "number", count: 5 } }, { id: "t", labelPl: "Czwartek", visual: meaningVisual }] }, expectedKey: key("listening", { correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } }), overrides: { options: visualOptions } },
      { name: "mixed visual listening", exerciseType: "listening", expectedPrompt: { kind: "listening", audioAssetId: "audio-1", options: [{ id: "f", text: "Friday" }, { id: "t", text: "Thursday" }] }, expectedKey: key("listening", { correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } }), overrides: { options: [{ ...options[0]!, visual: meaningVisual }, options[1]!] } },
      { name: "reading", exerciseType: "reading", expectedPrompt: { kind: "reading", text: "Thursday", options: [{ id: "f", text: "Friday" }, { id: "t", text: "Thursday" }] }, expectedKey: key("reading", { direction: "source_to_target", correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } }) },
      { name: "reverse recognition", exerciseType: "reverse_recognition", expectedPrompt: { kind: "reverse_recognition", prompt: "czwartek", options: [{ id: "f", text: "Friday" }, { id: "t", text: "Thursday" }] }, expectedKey: key("reverse_recognition", { correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } }) },
      { name: "picture recognition fallback", exerciseType: "picture_recognition", expectedPrompt: { kind: "picture_recognition", visual: meaningVisual, source: "czwartek", options: [{ id: "f", text: "Friday" }, { id: "t", text: "Thursday" }] }, expectedKey: key("picture_recognition", { correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } }), overrides: { item: { ...item, listeningVisual: meaningVisual } } },
      { name: "recall", exerciseType: "recall", expectedPrompt: { kind: "recall", prompt: "czwartek" }, expectedKey: key("recall") },
      { name: "picture recall", exerciseType: "recall", expectedPrompt: { kind: "picture_recall", visual: meaningVisual }, expectedKey: key("recall"), overrides: { plan: { exerciseType: "recall", pictureRecall: true }, item: { ...item, meaningVisual } } },
      { name: "spelling", exerciseType: "spelling", expectedPrompt: { kind: "spelling", prompt: "czwartek" }, expectedKey: key("spelling") },
      { name: "letter completion", exerciseType: "letter_completion", expectedPrompt: { kind: "letter_completion", prompt: "Monday", fragment: "M_n_a_" }, expectedKey: key("letter_completion", { target: "Monday", acceptedAnswers: ["Monday"] }), overrides: { item: { ...item, source: "Monday", target: "Monday", acceptedAnswers: ["Monday"] } } },
      { name: "speech", exerciseType: "speech", expectedPrompt: { kind: "speech", text: "Thursday", audioAssetId: "audio-1", imageAssetId: "image-1", visualType: "none" }, expectedKey: key("speech") },
      { name: "picture speech", exerciseType: "speech", expectedPrompt: { kind: "picture_speech", visual: meaningVisual, audioAssetId: "audio-1" }, expectedKey: key("speech"), overrides: { item: { ...item, meaningVisual } } },
    ];
    for (const testCase of cases) {
      expect(buildTaskContent(input(testCase.exerciseType, testCase.overrides)), testCase.name)
        .toEqual({ prompt: testCase.expectedPrompt, answerKey: testCase.expectedKey });
    }
  });

  it("keeps exposure visual data only for non-image and non-none visuals", () => {
    expect(buildTaskContent(input("exposure", { item: { ...item, visualType: "number", visualData: { count: 4 } } })).prompt)
      .toMatchObject({ kind: "exposure", visualData: { count: 4 } });
    expect(buildTaskContent(input("exposure", { item: { ...item, visualType: "image", visualData: { ignored: true } } })).prompt)
      .not.toHaveProperty("visualData");
  });

  it("preserves null media IDs and an absent example", () => {
    expect(buildTaskContent(input("exposure", {
      item: { ...item, example: undefined }, audioAssetId: null, imageAssetId: null, exampleAudioAssetId: null,
    }))).toEqual({
      prompt: { kind: "exposure", source: "czwartek", target: "Thursday", example: null, audioAssetId: null,
        exampleAudioAssetId: null, imageAssetId: null, visualType: "none" },
      answerKey: key("exposure"),
    });
  });

  it("does not leak answer or private option metadata into picture prompts", () => {
    const visualOptions = options.map((option, index) => ({ ...option, text: index ? "Czwartek" : "Piątek", visual: index ? meaningVisual : { kind: "number" as const, count: 5 } }));
    for (const [exerciseType, planOverrides, itemOverrides] of [
      ["exposure", {}, { meaningVisual }], ["recall", { pictureRecall: true }, { meaningVisual }], ["speech", {}, { meaningVisual }],
    ] as const) {
      const { prompt } = buildTaskContent(input(exerciseType, { plan: { exerciseType, ...planOverrides }, item: { ...item, ...itemOverrides } }));
      expect(JSON.stringify(prompt)).not.toContain("Thursday");
      expect(JSON.stringify(prompt)).not.toContain("correctOptionId");
    }
    const { prompt } = buildTaskContent(input("listening", { options: visualOptions }));
    expect(JSON.stringify(prompt)).not.toContain("Thursday");
    if (prompt.kind === "picture_listening") expect(prompt.options[0]).not.toHaveProperty("correct");
    const recognition = buildTaskContent(input("picture_recognition", { item: { ...item, listeningVisual: meaningVisual }, audioAssetId: "audio-1" })).prompt;
    expect(recognition.kind).toBe("picture_recognition");
    expect(JSON.stringify(recognition)).not.toContain("audioAssetId");
    if (recognition.kind === "picture_recognition") expect(recognition.options[0]).not.toHaveProperty("correct");
  });

  it("is deterministic and does not mutate frozen inputs", () => {
    const frozen = Object.freeze({ ...item, acceptedAnswers: Object.freeze(["Thu"]) as unknown as string[] });
    const frozenOptions = Object.freeze(options.map((option) => Object.freeze(option)));
    const source = input("listening", { item: frozen, options: frozenOptions });
    expect(buildTaskContent(source)).toEqual(buildTaskContent(source));
    expect(source.item).toBe(frozen);
    expect(source.options).toBe(frozenOptions);
  });
});
