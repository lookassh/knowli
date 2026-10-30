import { messages, type ParentWorkCardDto } from "@learning/contracts";
import type { ParentIconName } from "./ParentIcon";

type Step = ParentWorkCardDto["sessions"][number]["steps"][number];
type Response = Step["responses"][number];

/** Ton odznaki (`.pp-status-badge`) i kółka wyniku (`.pp-prog-outcome`). */
export type OutcomeTone = "success" | "danger" | "warning" | "neutral";

export interface OutcomeMark {
  tone: OutcomeTone;
  icon: ParentIconName;
  label: string;
}

const OUTCOME_MARKS: Record<NonNullable<Response["outcome"]>, OutcomeMark> = {
  correct: { tone: "success", icon: "check", label: messages.workCard.outcome.correct },
  incorrect: { tone: "danger", icon: "x", label: messages.workCard.outcome.incorrect },
  partial: { tone: "warning", icon: "minus", label: messages.workCard.outcome.partial },
};

/**
 * Oznaczenie jednej odpowiedzi: wynik zapisanych ocen, a bez niego rodzaj
 * odpowiedzi (pominięcie, „Nie pamiętam” jako trudność) albo brak oceny.
 */
export function responseMark(response: Response): OutcomeMark {
  if (response.outcome) return OUTCOME_MARKS[response.outcome];
  if (response.modality === "dont_remember") return { tone: "warning", icon: "help", label: messages.workCard.dontRemember };
  if (response.modality === "skip") return { tone: "neutral", icon: "arrow-right", label: messages.workCard.skipped };
  return {
    tone: "neutral",
    icon: "minus",
    label: response.assessment === "unassessed" || response.assessment === "mixed" ? messages.workCard.unassessed : messages.workCard.noAssessment,
  };
}

/** Oznaczenie kroku: ostatnia odpowiedź; krok bez odpowiedzi to prezentacja albo zadanie bez odpowiedzi. */
export function stepMark(step: Step): OutcomeMark {
  const last = step.responses.at(-1);
  if (last) return responseMark(last);
  return step.state === "completed"
    ? { tone: "neutral", icon: "eye", label: messages.workCard.stepState.completed }
    : { tone: "neutral", icon: "minus", label: messages.workCard.noResponse };
}

/** Liczba kroków sesji według wyniku ostatniej odpowiedzi (tylko kroki z oceną poprawności). */
export function outcomeCounts(steps: readonly Step[]): Record<NonNullable<Response["outcome"]>, number> {
  const counts = { correct: 0, incorrect: 0, partial: 0 };
  for (const step of steps) {
    const outcome = step.responses.at(-1)?.outcome;
    if (outcome) counts[outcome] += 1;
  }
  return counts;
}
