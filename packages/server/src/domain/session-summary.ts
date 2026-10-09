import type { SessionSummaryResults } from "@learning/contracts";

export interface SummaryAssessment {
  itemId: string;
  target: string;
  skill: string;
  outcome: string;
  independent: boolean;
}

/** Oceny w kolejności prób. Sukces jest faktem sesji, trudność jej ostatnim stanem. */
export function summarizeSessionAssessments(rows: readonly SummaryAssessment[]): SessionSummaryResults {
  const successes = { recall: new Set<string>(), spelling: new Set<string>() };
  const practice = new Map<string, { target: string; skills: Set<"recall" | "spelling"> }>();
  for (const row of rows) {
    if (row.skill !== "recall" && row.skill !== "spelling") continue;
    if (row.outcome === "correct" && row.independent) {
      successes[row.skill].add(row.itemId);
      practice.get(row.itemId)?.skills.delete(row.skill);
    } else if (row.outcome === "incorrect") {
      const item = practice.get(row.itemId) ?? { target: row.target, skills: new Set<"recall" | "spelling">() };
      item.skills.add(row.skill);
      practice.set(row.itemId, item);
    }
  }
  return {
    independentSuccesses: { recall: successes.recall.size, spelling: successes.spelling.size },
    practiceItems: [...practice].filter(([, item]) => item.skills.size > 0).map(([itemId, item]) => ({
      itemId, target: item.target,
      skills: (["recall", "spelling"] as const).filter(skill => item.skills.has(skill)),
    })),
  };
}
