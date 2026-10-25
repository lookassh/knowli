import type { SkillOutcome } from "./types";

export type TaskCompletionState = "issued" | "answered" | "skipped";

export interface TaskCompletionInput {
  readonly isMockTest: boolean;
  readonly action: "answer" | "dont_remember" | "skip";
  readonly outcomes: readonly SkillOutcome[];
  readonly attemptNumber: number;
  readonly incorrectAttemptCount: number;
  readonly speechContentMatched?: boolean;
}

/** Chooses whether a submitted task stays open, completes, or is skipped. */
export function taskStateAfterAttempt(input: TaskCompletionInput): TaskCompletionState {
  if (input.action === "skip") return "skipped";
  if (input.isMockTest) return "answered";

  if (input.speechContentMatched !== undefined) {
    if (input.speechContentMatched || input.attemptNumber >= 2) return "answered";
  }

  const anyCorrect = input.outcomes.some((outcome) => outcome === "correct");
  const anyIncorrect = input.outcomes.some((outcome) => outcome === "incorrect");
  if (anyCorrect && !anyIncorrect) return "answered";
  if (input.action === "dont_remember") return "answered";
  if (anyIncorrect && input.incorrectAttemptCount >= 2) return "answered";
  return "issued";
}
