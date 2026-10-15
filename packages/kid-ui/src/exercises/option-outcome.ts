import type { FeedbackDto } from "@learning/contracts";

export type OptionOutcome = "correct" | "wrong";

/**
 * Podświetlenie opcji po próbie wyboru (design 2026-10-09): kolor wyniku
 * pochodzi wyłącznie z feedbacku serwera — lokalne zgadywanie nie zapala
 * zielonego także przy braku sieci (plan zadania 9). Sukces zapala wybraną
 * opcję; pomyłka zapala wybraną na czerwono, a poprawną — dopasowaną po
 * tekście `correctText`, który serwer buduje z tekstów opcji zadania —
 * na zielono. Próby nieocenione i pozawyborowe nie podświetlają nic.
 */
export function optionOutcomes(
  feedback: FeedbackDto | null,
  chosenOptionId: string | undefined,
  options: readonly { id: string; text?: string; labelPl?: string }[],
): ReadonlyMap<string, OptionOutcome> {
  const outcomes = new Map<string, OptionOutcome>();
  if (feedback === null || chosenOptionId === undefined) {
    return outcomes;
  }
  switch (feedback.kind) {
    case "great":
    case "capitalization_hint":
      outcomes.set(chosenOptionId, "correct");
      return outcomes;
    case "almost":
    case "incorrect": {
      outcomes.set(chosenOptionId, "wrong");
      const correct = options.find((option) => (option.text ?? option.labelPl) === feedback.correctText);
      if (correct !== undefined) {
        outcomes.set(correct.id, "correct");
      }
      return outcomes;
    }
    default:
      return outcomes;
  }
}
