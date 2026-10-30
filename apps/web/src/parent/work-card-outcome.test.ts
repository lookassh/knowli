import { describe, expect, it } from "vitest";
import { messages, type ParentWorkCardDto } from "@learning/contracts";
import { outcomeCounts, responseMark, stepMark, stepOutcome } from "./work-card-outcome";

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

describe("stepOutcome, stepMark i outcomeCounts", () => {
  it("poprawna odpowiedź dopiero po błędzie albo „Nie pamiętam” nie jest samodzielnie poprawna", () => {
    const retried = step([response({ outcome: "incorrect" }), response({ outcome: "correct" })]);
    expect(stepOutcome(retried)).toBe("corrected");
    expect(stepMark(retried)).toEqual({ tone: "warning", icon: "refresh", label: messages.workCard.stepCorrected });
    expect(stepOutcome(step([response({ modality: "dont_remember", outcome: null }), response()]))).toBe("corrected");
    // pominięcie albo nieoceniona próba przed poprawną nie są błędem
    expect(stepOutcome(step([response({ outcome: null, assessment: "unassessed" }), response()]))).toBe("correct");
    // ostatnia błędna zostaje błędna
    expect(stepOutcome(step([response(), response({ outcome: "incorrect" })]))).toBe("incorrect");
  });

  it("krok bez odpowiedzi; liczniki liczą kroki, nie próby", () => {
    expect(stepMark(step([], "completed")).icon).toBe("eye");
    expect(stepMark(step([], "issued")).label).toBe(messages.workCard.noResponse);
    const retried = step([response({ outcome: "incorrect" }), response({ outcome: "correct" })]);
    expect(outcomeCounts([retried, step([response()]), step([response({ outcome: "partial" })]), step([response({ modality: "skip", outcome: null })])]))
      .toEqual({ correct: 1, corrected: 1, incorrect: 0, partial: 1 });
  });
});
