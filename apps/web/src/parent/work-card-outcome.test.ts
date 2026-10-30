import { describe, expect, it } from "vitest";
import { messages, type ParentWorkCardDto } from "@learning/contracts";
import { outcomeCounts, responseMark, stepMark } from "./work-card-outcome";

type Step = ParentWorkCardDto["sessions"][number]["steps"][number];
type Response = Step["responses"][number];

function response(overrides: Partial<Response> = {}): Response {
  return { modality: "text", answerExample: "cat", feedbackKind: "great", assessment: "assessed", outcome: "correct", responseSeconds: 3, ...overrides };
}

function step(responses: Response[], state: Step["state"] = "answered"): Step {
  return { taskId: "00000000-0000-4000-8000-000000000001", ordinal: 0, exerciseType: "recall", state, issuedAt: "2026-10-16T10:00:00.000Z", responses };
}

describe("responseMark", () => {
  it("wynik oceny: poprawna, błędna i częściowo poprawna mają osobny ton, ikonę i tekst", () => {
    expect(responseMark(response())).toEqual({ tone: "success", icon: "check", label: messages.workCard.outcome.correct });
    expect(responseMark(response({ outcome: "incorrect" }))).toEqual({ tone: "danger", icon: "x", label: messages.workCard.outcome.incorrect });
    expect(responseMark(response({ outcome: "partial" }))).toEqual({ tone: "warning", icon: "minus", label: messages.workCard.outcome.partial });
  });

  it("„Nie pamiętam” to trudność, pominięcie i brak oceny są neutralne — żadne nie udaje błędu", () => {
    expect(responseMark(response({ modality: "dont_remember", outcome: null, assessment: "none" })).tone).toBe("warning");
    expect(responseMark(response({ modality: "skip", outcome: null, assessment: "none" }))).toMatchObject({ tone: "neutral", label: messages.workCard.skipped });
    expect(responseMark(response({ outcome: null, assessment: "unassessed" }))).toMatchObject({ tone: "neutral", label: messages.workCard.unassessed });
    expect(responseMark(response({ outcome: null, assessment: "none" }))).toMatchObject({ tone: "neutral", label: messages.workCard.noAssessment });
  });
});

describe("stepMark i outcomeCounts", () => {
  it("krok przyjmuje wynik ostatniej odpowiedzi; liczniki liczą kroki, nie próby", () => {
    const retried = step([response({ outcome: "incorrect" }), response({ outcome: "correct" })]);
    expect(stepMark(retried).tone).toBe("success");
    expect(stepMark(step([], "completed")).icon).toBe("eye");
    expect(stepMark(step([], "issued")).label).toBe(messages.workCard.noResponse);
    expect(outcomeCounts([retried, step([response({ outcome: "partial" })]), step([response({ modality: "skip", outcome: null })])]))
      .toEqual({ correct: 1, incorrect: 0, partial: 1 });
  });
});
