import { countSentences } from "../../packages/server/src/domain/lessons/evaluate";

export interface CaseOutcome {
  readonly id: string;
  readonly input: "written" | "speech";
  readonly pairOf?: string;
  readonly disputed: boolean;
  /** rejected = walidacja odrzuciła werdykt; provider_error = transport/dostawca. */
  readonly status: "graded" | "rejected" | "provider_error";
  /** null, gdy status !== "graded". */
  readonly knowledgeMatch: boolean | null;
  readonly precisionMatch: boolean | null;
  readonly unneededShorten: boolean;
}

/** Forma jednego zdania; null = bez znaczenia. Mowa nigdy nie liczy zdań. */
export function formOkForCase(expectedForm: string, input: "written" | "speech", childAnswer: string): boolean | null {
  return expectedForm === "one_sentence" && input === "written" ? countSentences(childAnswer) <= 1 : null;
}

/** Produkcyjny warunek oferty skracania (correct + verbose/unfocused + ≥1 fragment), gdy oczekiwano concise. */
export function isUnneededShorten(
  verdict: { knowledge: string; precision: string; redundantFragments: readonly string[]; offTopicFragments: readonly string[] },
  expectedPrecision: string,
): boolean {
  return expectedPrecision === "concise" && verdict.knowledge === "correct" && verdict.precision !== "concise" &&
    verdict.redundantFragments.length + verdict.offTopicFragments.length > 0;
}

/** Dwa wiersze raportu, zawsze w kolejności: pisane, mówione. */
export function groupReportLines(outcomes: readonly CaseOutcome[]): string[] {
  return (["written", "speech"] as const).map((input) => {
    const group = outcomes.filter((o) => o.input === input);
    const count = (pick: (o: CaseOutcome) => boolean) => group.filter(pick).length;
    return `${input === "written" ? "pisane" : "mówione"}: przypadki=${group.length} wiedzaZgodna=${count((o) => o.knowledgeMatch === true)} ` +
      `precyzjaZgodna=${count((o) => o.precisionMatch === true)} odrzuconeWalidator=${count((o) => o.status === "rejected")} ` +
      `bladDostawcy=${count((o) => o.status === "provider_error")} niepotrzebneSkracanie=${count((o) => o.unneededShorten)}`;
  });
}
