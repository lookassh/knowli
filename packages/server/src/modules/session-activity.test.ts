import { describe, expect, it } from "vitest";
import { MeaningVisualSchema, TaskPromptSchema } from "@learning/contracts";
import { describeTaskPrompt, lessonAnswerValues, LessonAnswerSnapshotSchema } from "./session-activity";
import { englishGrammarSubject } from "../domain/lessons/subjects/english-grammar/module";
import { materializeExercise, type LoadedExercise } from "./lessons/lesson-materialize";

describe("session activity lesson snapshot formatting", () => {
  it.each([
    { kind: "exposure", source: "kot", target: "cat", example: null, audioAssetId: null, exampleAudioAssetId: null, imageAssetId: null, visualType: "none" },
    { kind: "picture_exposure", visual: { kind: "number", count: 3 }, audioAssetId: null },
    { kind: "listening", options: [{ id: "11111111-1111-4111-8111-111111111111", text: "kot" }], audioAssetId: "22222222-2222-4222-8222-222222222222" },
    { kind: "picture_listening", options: [{ id: "11111111-1111-4111-8111-111111111111", labelPl: "kot", visual: { kind: "number", count: 2 } }, { id: "22222222-2222-4222-8222-222222222222", labelPl: "pies", visual: { kind: "number", count: 3 } }], audioAssetId: "22222222-2222-4222-8222-222222222222" },
    { kind: "picture_recall", visual: { kind: "color", color: "#ff0000" } },
    { kind: "picture_recognition", visual: { kind: "number", count: 2 }, source: "kot", options: [{ id: "11111111-1111-4111-8111-111111111111", text: "cat" }, { id: "22222222-2222-4222-8222-222222222222", text: "dog" }] },
    { kind: "reading", text: "kot", options: [{ id: "11111111-1111-4111-8111-111111111111", text: "cat" }] },
    { kind: "reverse_recognition", prompt: "cat", options: [{ id: "11111111-1111-4111-8111-111111111111", text: "kot" }] },
    { kind: "recall", prompt: "kot" }, { kind: "spelling", prompt: "kot" },
    { kind: "letter_completion", prompt: "c_t", fragment: "a" },
    { kind: "speech", text: "cat", audioAssetId: null, imageAssetId: null, visualType: "none" },
    { kind: "picture_speech", visual: { kind: "image", imageAssetId: "22222222-2222-4222-8222-222222222222" }, audioAssetId: null },
    { kind: "lesson_card", card: { title: "Reguła", body: "Treść", examples: [] } },
    { kind: "lesson_notice", instructionPl: "Zauważ", segments: [[{ id: "11111111-1111-4111-8111-111111111111", text: "He" }], [{ id: "22222222-2222-4222-8222-222222222222", text: "goes" }]] },
    { kind: "lesson_choice", instructionPl: "Wybierz", stem: "He ___.", options: [{ id: "11111111-1111-4111-8111-111111111111", text: "go" }] },
    { kind: "lesson_order", instructionPl: "Ułóż", items: [{ id: "11111111-1111-4111-8111-111111111111", text: "He" }] },
    { kind: "lesson_short_answer", question: "Co robi?", options: [{ id: "11111111-1111-4111-8111-111111111111", text: "czyta" }] },
    { kind: "lesson_gap", instructionPl: "Uzupełnij", stemWithGap: "He ___." },
    { kind: "lesson_error_fix", instructionPl: "Popraw", statement: "He go." },
    { kind: "lesson_transform", instructionPl: "Zmień", statement: "I go." },
    { kind: "lesson_open_answer", instructionPl: "Odpowiedz", prompt: "Powiedz zdanie" },
  ])("describes every TaskPromptSchema variant: $kind", (prompt) => {
    const parsed = TaskPromptSchema.parse(prompt);
    const described = describeTaskPrompt(parsed);
    expect(described.instruction.length).toBeGreaterThan(0);
    expect(described).toHaveProperty("options");
  });

  it.each([
    ["lesson_order", { kind: "lesson_order", instructionPl: "Ułóż zdanie", items: [{ id: "11111111-1111-4111-8111-111111111111", text: "She" }, { id: "22222222-2222-4222-8222-222222222222", text: "reads" }, { id: "33333333-3333-4333-8333-333333333333", text: "books" }] }, { itemIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"], itemValues: { "11111111-1111-4111-8111-111111111111": "She", "22222222-2222-4222-8222-222222222222": "reads", "33333333-3333-4333-8333-333333333333": "books" } }, "She reads books"],
    ["lesson_gap", { kind: "lesson_gap", instructionPl: "Uzupełnij", stemWithGap: "She ___ books" }, { answer: "reads" }, "reads"],
    ["lesson_choice", { kind: "lesson_choice", instructionPl: "Wybierz", stem: "Present Simple", options: [{ id: "44444444-4444-4444-8444-444444444444", text: "do" }] }, { answer: "does", acceptedAnswers: [] }, "does"],
  ])("keeps canonical answer for %s", (kind, prompt, key, expected) => {
    const parsedPrompt = TaskPromptSchema.parse(prompt);
    expect(lessonAnswerValues(LessonAnswerSnapshotSchema.parse(key), parsedPrompt).acceptedAnswers).toContain(expected);
    expect(describeTaskPrompt(parsedPrompt).instruction).not.toBe("");
  });

  it("includes card copy, notice segments, and safe visual descriptions without asset IDs", () => {
    expect(describeTaskPrompt({ kind: "lesson_card", card: { title: "Czas", body: "She reads.", examples: ["I read."] } }).stimulus)
      .toBe("Czas\nShe reads.\nI read.");
    expect(describeTaskPrompt({ kind: "lesson_notice", instructionPl: "Zauważ", segments: [[{ id: "11111111-1111-4111-8111-111111111111", text: "She reads" }], [{ id: "22222222-2222-4222-8222-222222222222", text: "They read" }]] }).stimulus)
      .toBe("She reads | They read");
    const picture = describeTaskPrompt({ kind: "picture_recall", visual: { kind: "image", imageAssetId: "33333333-3333-4333-8333-333333333333" } });
    expect(picture.stimulus).toBe("Ilustracja obrazkowa");
    expect(JSON.stringify(picture)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("reads typed prompts produced by lesson materialization, including ordered IDs and 2D notice segments", () => {
    const subject = englishGrammarSubject;
    const topic = subject.topics[0]!;
    const loaded = (payload: LoadedExercise["payload"]): LoadedExercise => ({ revisionId: "revision", itemId: "item", position: 0, payload, targetKey: "key", audioAssetId: null });
    const ordered = materializeExercise({ independentCheck: false, reason: "practice" }, "order-seed", loaded({
      exerciseType: "lesson_order", objectiveId: "english_grammar.present_simple.third_person_s", instructionPl: "Ułóż zdanie",
      items: [{ id: "one", text: "She" }, { id: "two", text: "reads" }], answer: "She reads", acceptedAnswers: [], focus: ["reads"], answerLocale: "en-GB", promptLocale: "pl-PL",
    }), topic, subject);
    expect(TaskPromptSchema.parse(ordered.prompt).kind).toBe("lesson_order");
    expect(lessonAnswerValues(ordered.answerKey, ordered.prompt).acceptedAnswers).toContain("She reads");
    expect(describeTaskPrompt(ordered.prompt).options).toEqual(expect.arrayContaining(["She", "reads"]));

    const notice = materializeExercise({ independentCheck: false, reason: "practice" }, "notice-seed", loaded({
      exerciseType: "lesson_notice", objectiveId: "english_grammar.present_simple.third_person_s", instructionPl: "Zauważ",
      noticeSegments: [["She", "reads"], ["They", "read"]], correctOption: "reads", answer: "reads", acceptedAnswers: [], focus: ["reads"], answerLocale: "en-GB", promptLocale: "pl-PL",
    }), topic, subject);
    expect(TaskPromptSchema.parse(notice.prompt).kind).toBe("lesson_notice");
    expect(describeTaskPrompt(notice.prompt).stimulus).toBe("She reads | They read");
    expect(lessonAnswerValues(notice.answerKey, notice.prompt).acceptedAnswers).toContain("reads");
    expect(MeaningVisualSchema.parse({ kind: "number", count: 3 })).toEqual({ kind: "number", count: 3 });
  });

  it("uses answer-key value maps for selected options and ordered segments", () => {
    const notice = TaskPromptSchema.parse({ kind: "lesson_notice", instructionPl: "Wskaż", segments: [[{ id: "11111111-1111-4111-8111-111111111111", text: "She" }]] });
    expect(lessonAnswerValues(LessonAnswerSnapshotSchema.parse({ correctOptionId: "good", optionValues: { good: "went" }, acceptedAnswers: [] }), notice).acceptedAnswers).toEqual(["went"]);
    expect(lessonAnswerValues(LessonAnswerSnapshotSchema.parse({ correctOptionId: "segment", segmentValues: { segment: "yesterday" } }), notice).acceptedAnswers).toEqual(["yesterday"]);
    const order = TaskPromptSchema.parse({ kind: "lesson_order", instructionPl: "Ułóż", items: [{ id: "11111111-1111-4111-8111-111111111111", text: "She" }, { id: "22222222-2222-4222-8222-222222222222", text: "reads" }] });
    expect(lessonAnswerValues(LessonAnswerSnapshotSchema.parse({ itemIds: ["2", "1"], itemValues: { "1": "She", "2": "reads" } }), order).acceptedAnswers).toEqual(["reads She"]);
  });
});



