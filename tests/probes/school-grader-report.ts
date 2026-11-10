import { countSentences } from "../../packages/server/src/domain/lessons/evaluate";

export interface CaseOutcome {
  readonly id: string;
  readonly input: "written" | "speech";
  readonly pairOf?: string;
  readonly disputed: boolean;
  /** Przypadek mówiony dopisany po zamrożeniu promptu mowy (AC-34): własny wiersz raportu. */
  readonly holdout?: boolean;
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

/** Trzy wiersze raportu, zawsze w kolejności: pisane, mówione, mówione-nowe (holdout). */
export function groupReportLines(outcomes: readonly CaseOutcome[]): string[] {
  return (["pisane", "mówione", "mówione-nowe"] as const).map((label) => {
    const group = outcomes.filter((o) => (o.input === "written" ? "pisane" : o.holdout ? "mówione-nowe" : "mówione") === label);
    const count = (pick: (o: CaseOutcome) => boolean) => group.filter(pick).length;
    return `${label}: przypadki=${group.length} wiedzaZgodna=${count((o) => o.knowledgeMatch === true)} ` +
      `precyzjaZgodna=${count((o) => o.precisionMatch === true)} odrzuconeWalidator=${count((o) => o.status === "rejected")} ` +
      `bladDostawcy=${count((o) => o.status === "provider_error")} niepotrzebneSkracanie=${count((o) => o.unneededShorten)}`;
  });
}

const DIMENSIONS = [
  ["wiedza", (o: CaseOutcome) => o.status === "graded" && o.knowledgeMatch === false],
  ["odrzucenie", (o: CaseOutcome) => o.status === "rejected"],
  ["skracanie", (o: CaseOutcome) => o.unneededShorten],
] as const;

/**
 * Reguła z acceptance-scenarios.md. `runs[i]` to wyniki wszystkich przypadków i-tego przebiegu.
 * Zwraca po jednym wierszu na stabilnie błędny przypadek mówiony i wiersz końcowy.
 */
export function decisionLines(runs: readonly (readonly CaseOutcome[])[]): string[] {
  if (runs.length !== 3) return ["REGUŁA: wymaga --runs=3"];
  const ids = [...new Set(runs.flat().filter((o) => o.input === "speech" && !o.disputed).map((o) => o.id))].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  const stableCases = { wiedza: 0, odrzucenie: 0, skracanie: 0 };
  for (const id of ids) {
    for (const [name, isBad] of DIMENSIONS) {
      const count = runs.filter((run) => {
        const o = run.find((x) => x.id === id);
        if (o === undefined || !isBad(o)) return false;
        if (o.pairOf === undefined) return true;
        const twin = run.find((x) => x.id === o.pairOf);
        return twin?.status === "graded" && twin.knowledgeMatch === true;
      }).length;
      if (count < 2) continue;
      stableCases[name] += 1;
      lines.push(`${id}: ${name} ${count}/${runs.length}`);
    }
  }
  const needed = stableCases.wiedza >= 1 || stableCases.odrzucenie >= 1 || stableCases.skracanie >= 2;
  // Błąd dostawcy w mowie albo w pisanym bliźniaku mógł ukryć porażkę.
  const twins = new Set(runs.flat().filter((o) => o.input === "speech" && !o.disputed && o.pairOf !== undefined).map((o) => o.pairOf));
  const providerErrors = runs.flat().filter((o) => o.status === "provider_error" &&
    (o.input === "speech" ? !o.disputed : twins.has(o.id))).length;
  const warning = providerErrors > 0 ? [`UWAGA: błędy dostawcy w mowie lub bliźniakach: ${providerErrors} — rozstrzygnięcie niepełne`] : [];
  return [...lines, ...warning,`REGUŁA: ${needed ? "mowa stabilnie błędna" : "mowa bez stabilnych błędów"}`];
}
