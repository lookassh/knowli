import { describe, expect, it } from "vitest";
import {
  EXERCISE_TYPES,
  TaskPromptSchema,
  AttemptInputSchema,
  AttemptModalitySchema,
  FeedbackDtoSchema,
  KidDeckDtoSchema,
  SessionSummaryDtoSchema,
} from "./kid";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

const option = { id: UUID, text: "plays" };

describe("EXERCISE_TYPES includes the 9 lesson types", () => {
  it("contains every lesson_* type", () => {
    for (const t of [
      "lesson_card", "lesson_notice", "lesson_choice", "lesson_order",
      "lesson_short_answer", "lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer",
    ]) {
      expect(EXERCISE_TYPES as readonly string[]).toContain(t);
    }
  });
});

describe("TaskPrompt lesson branches parse", () => {
  it("lesson_card", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_card", card: { title: "Reguła", body: "Dodaj -s", examples: ["He plays."] },
    }).success).toBe(true);
  });
  it("lesson_notice exposes segments only", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_notice", instructionPl: "Dotknij słowa",
      segments: [[{ id: UUID, text: "He" }, { id: UUID2, text: "plays" }]],
    }).success).toBe(true);
  });
  it("lesson_choice", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_choice", instructionPl: "Wybierz", stem: "He ___ football.", options: [option],
    }).success).toBe(true);
  });
  it("lesson_order shuffled items", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_order", instructionPl: "Ułóż", items: [{ id: UUID, text: "He" }, { id: UUID2, text: "plays" }],
    }).success).toBe(true);
  });
  it("lesson_short_answer", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_short_answer", question: "Does he play?", options: [option],
    }).success).toBe(true);
  });
  it("lesson_gap with stemWithGap", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_gap", instructionPl: "Uzupełnij", stemWithGap: "He ___ (play).",
    }).success).toBe(true);
  });
  it("lesson_error_fix", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_error_fix", instructionPl: "Popraw", statement: "He play football.",
    }).success).toBe(true);
  });
  it("lesson_transform", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_transform", instructionPl: "Zamień na przeczenie", statement: "He plays.",
    }).success).toBe(true);
  });
  it("lesson_open_answer", () => {
    expect(TaskPromptSchema.safeParse({
      kind: "lesson_open_answer", instructionPl: "Odpowiedz", prompt: "Przetłumacz: On gra.",
    }).success).toBe(true);
  });
});

describe("TaskPrompt lesson branches never leak private fields", () => {
  it.each([
    ["answer", { kind: "lesson_gap", instructionPl: "i", stemWithGap: "He ___.", answer: "plays" }],
    ["acceptedAnswers", { kind: "lesson_gap", instructionPl: "i", stemWithGap: "He ___.", acceptedAnswers: ["plays"] }],
    ["focus", { kind: "lesson_gap", instructionPl: "i", stemWithGap: "He ___.", focus: ["plays"] }],
    ["objectiveId", { kind: "lesson_choice", instructionPl: "i", stem: "s", options: [option], objectiveId: "o1" }],
    ["errorCategory", { kind: "lesson_choice", instructionPl: "i", stem: "s", options: [option], errorCategory: "missing_s" }],
    ["correctOption", { kind: "lesson_notice", instructionPl: "i", segments: [[{ id: UUID, text: "He" }]], correctOption: "He" }],
  ])("rejects a lesson prompt carrying %s", (_label, prompt) => {
    expect(TaskPromptSchema.safeParse(prompt).success).toBe(false);
  });
});

describe("AttemptInput sequence modality", () => {
  it("accepts a sequence of unique item ids", () => {
    expect(AttemptInputSchema.safeParse({
      taskId: UUID, clientAttemptId: UUID2, modality: "sequence", itemIds: [UUID, UUID2],
    }).success).toBe(true);
  });
  it("rejects empty, duplicate, or >10 item ids", () => {
    expect(AttemptInputSchema.safeParse({ taskId: UUID, clientAttemptId: UUID2, modality: "sequence", itemIds: [] }).success).toBe(false);
    expect(AttemptInputSchema.safeParse({ taskId: UUID, clientAttemptId: UUID2, modality: "sequence", itemIds: [UUID, UUID] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `${(i + 1).toString().repeat(8)}-1111-4111-8111-111111111111`.slice(0, 36));
    expect(AttemptInputSchema.safeParse({ taskId: UUID, clientAttemptId: UUID2, modality: "sequence", itemIds: eleven }).success).toBe(false);
  });
  it("AttemptModalitySchema includes sequence", () => {
    expect(AttemptModalitySchema.safeParse("sequence").success).toBe(true);
  });
});

describe("FeedbackDto lesson kinds", () => {
  const seg = [{ text: "he ", state: "plain" }, { text: "play", state: "pill" }];
  it("accepts lesson_almost with answerSegments", () => {
    expect(FeedbackDtoSchema.safeParse({
      kind: "lesson_almost", correctText: "he plays", answerSegments: seg,
    }).success).toBe(true);
  });
  it("accepts lesson_hint with hintPl", () => {
    expect(FeedbackDtoSchema.safeParse({
      kind: "lesson_hint", correctText: "he plays", hintPl: "Dodaj -s w 3. osobie.",
    }).success).toBe(true);
  });
  it("rejects lesson_hint without hintPl", () => {
    expect(FeedbackDtoSchema.safeParse({ kind: "lesson_hint", correctText: "he plays" }).success).toBe(false);
  });
  it("rejects answerSegments on a non-lesson kind", () => {
    expect(FeedbackDtoSchema.safeParse({ kind: "great", answerSegments: seg }).success).toBe(false);
  });
  it("still accepts the existing spelling_hint rule", () => {
    const diff = {
      given: [{ text: "We", state: "plain" }, { text: "nd", state: "pill" }, { text: "esday", state: "plain" }],
      expected: [{ text: "We", state: "plain" }, { text: "dn", state: "pill" }, { text: "esday", state: "plain" }],
    };
    expect(FeedbackDtoSchema.safeParse({ kind: "spelling_hint", correctText: "Wednesday", spellingDiff: diff }).success).toBe(true);
  });
});

describe("SessionSummaryDto lesson objectives variant", () => {
  const base = {
    sessionId: UUID,
    state: "completed" as const,
    tasksIssued: 5,
    assessedTasksIssued: 4,
    endedAt: "2026-10-12T18:00:00.000Z",
    independentSuccesses: { recall: 0, spelling: 0 },
    practiceItems: [],
  };
  it("accepts a vocab summary WITHOUT objectives (backward compatible)", () => {
    expect(SessionSummaryDtoSchema.safeParse(base).success).toBe(true);
    expect(SessionSummaryDtoSchema.parse(base).objectives).toBeUndefined();
  });
  it("accepts a lesson summary with objectives (no percentages, no technical status)", () => {
    const parsed = SessionSummaryDtoSchema.safeParse({
      ...base,
      objectives: [
        { objectiveId: "english_grammar.present_simple.third_person_s", titlePl: "-s w 3. osobie", practiced: 3, correct: 2 },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects an objective carrying a technical status or percentage field", () => {
    expect(SessionSummaryDtoSchema.safeParse({
      ...base,
      objectives: [{ objectiveId: "o1", titlePl: "t", practiced: 1, correct: 1, status: "mastered" }],
    }).success).toBe(false);
    expect(SessionSummaryDtoSchema.safeParse({
      ...base,
      objectives: [{ objectiveId: "o1", titlePl: "t", practiced: 1, correct: 1, percent: 100 }],
    }).success).toBe(false);
  });
});

describe("KidDeckDto kind/subjectTitle backward compat", () => {
  const base = {
    deckId: UUID, title: "Present Simple", itemCount: 10, independentlyRecalledCount: 0,
    testDate: null, recommended: false,
  };
  it("parses a legacy deck without kind/subjectTitle (optional, undefined)", () => {
    const parsed = KidDeckDtoSchema.parse(base);
    expect(parsed.kind).toBeUndefined();
    expect(parsed.subjectTitle).toBeUndefined();
  });
  it("accepts kind lesson with a subjectTitle", () => {
    expect(KidDeckDtoSchema.safeParse({ ...base, kind: "lesson", subjectTitle: "Angielski — gramatyka" }).success).toBe(true);
  });
  it("accepts kind vocabulary with null subjectTitle", () => {
    expect(KidDeckDtoSchema.safeParse({ ...base, kind: "vocabulary", subjectTitle: null }).success).toBe(true);
  });
});
