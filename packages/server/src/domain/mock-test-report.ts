import type { MockTestReportRow, MockTestSkillReportDto, TestGoal } from "@learning/contracts";

export function summarizeMockTestRows(rows: readonly MockTestReportRow[], goals: readonly TestGoal[]): MockTestSkillReportDto[] {
  const unique = [...new Map(rows.map(r => [`${r.itemId}:${r.skill}`, r])).values()];
  return goals.map(skill => {
    const subset = unique.filter(r => r.skill === skill);
    return { skill, totalItems: subset.length,
      independentCorrect: subset.filter(r => r.outcome === "correct" && r.independent).length,
      practiceNeeded: subset.filter(r => r.outcome === "incorrect").length,
      correctNotIndependent: subset.filter(r => r.outcome === "correct" && !r.independent).length,
      notTested: subset.filter(r => ["skipped", "unassessed", "not_tested"].includes(r.outcome)).length,
      skipped: subset.filter(r => r.outcome === "skipped").length, unassessed: subset.filter(r => r.outcome === "unassessed").length };
  });
}
