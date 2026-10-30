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

/** Wynik kroku dla podsumowania: `corrected` — poprawna odpowiedź dopiero po błędzie albo „Nie pamiętam”. */
export type StepOutcome = NonNullable<Response["outcome"]> | "corrected";

/**
 * Wynik kroku z ostatniej odpowiedzi. Poprawna odpowiedź po wcześniejszym błędzie
 * (feedback mógł już pokazać wzorzec) nie liczy się jako samodzielnie poprawna.
 */
export function stepOutcome(step: Step): StepOutcome | null {
  const last = step.responses.at(-1)?.outcome ?? null;
  if (last !== "correct") return last;
  const struggled = step.responses.slice(0, -1)
    .some((response) => response.outcome === "incorrect" || response.outcome === "partial" || response.modality === "dont_remember");
  return struggled ? "corrected" : "correct";
}

const CORRECTED_MARK: OutcomeMark = { tone: "warning", icon: "refresh", label: messages.workCard.stepCorrected };

/** Oznaczenie kroku: ostatnia odpowiedź; krok bez odpowiedzi to prezentacja albo zadanie bez odpowiedzi. */
export function stepMark(step: Step): OutcomeMark {
  const last = step.responses.at(-1);
  if (last) return stepOutcome(step) === "corrected" ? CORRECTED_MARK : responseMark(last);
  return step.state === "completed"
    ? { tone: "neutral", icon: "eye", label: messages.workCard.stepState.completed }
    : { tone: "neutral", icon: "minus", label: messages.workCard.noResponse };
}

/** Liczba kroków sesji według ich wyniku (tylko kroki z oceną poprawności). */
export function outcomeCounts(steps: readonly Step[]): Record<StepOutcome, number> {
  const counts = { correct: 0, corrected: 0, incorrect: 0, partial: 0 };
  for (const step of steps) {
    const outcome = stepOutcome(step);
    if (outcome) counts[outcome] += 1;
  }
  return counts;
}
