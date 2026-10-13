import type { LessonMockTestSummaryDto } from "@learning/contracts";
import type { MockTestScore } from "./mock-test-score";
import { starsForFraction } from "./stars";

type LessonSolution = LessonMockTestSummaryDto["solutions"][number];
type LessonOutcome = LessonSolution["outcome"];

/** Prosty status zadania w omówieniu lekcji: ocenione poprawnie/błędnie,
 * a pominięte i nieocenione nie są błędem wiedzy (jak w słówkach). */
export type LessonMockStatus = "correct" | "incorrect" | "notAssessed";

export const LESSON_MOCK_STATUS_ICONS: Record<LessonMockStatus, string> = { correct: "✓", incorrect: "✗", notAssessed: "–" };

export function lessonMockOutcomeStatus(outcome: LessonOutcome): LessonMockStatus {
  if (outcome === "correct") return "correct";
  if (outcome === "incorrect") return "incorrect";
  return "notAssessed";
}

/** Wynik X/Y omówienia lekcji liczony per zadanie (slot), nie per cel —
 * omówienie dziecka pokazuje prosty wynik, raport per cel widzi rodzic. */
export function computeLessonMockScore(solutions: ReadonlyArray<Pick<LessonSolution, "outcome">>): MockTestScore {
  const total = solutions.length;
  const correct = solutions.filter(s => lessonMockOutcomeStatus(s.outcome) === "correct").length;
  return {
    correct,
    total,
    percent: total === 0 ? 0 : Math.round((correct * 100) / total),
    stars: starsForFraction(correct, total),
  };
}
