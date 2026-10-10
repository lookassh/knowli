import { expect, it } from "vitest";
import { summarizeMockTestRows } from "./mock-test-report";
import type { MockTestReportRow } from "./mock-test-types";
it("partitions full scope including skipped and unwritten without double counting", () => {
  const rows: MockTestReportRow[] = Array.from({ length: 10 }, (_, i) => ({ itemId: `${i}`, source: "", target: "", skill: "spelling", masteryStatus: "practicing", reason: null,
    independent: i < 6, outcome: i < 6 ? "correct" : i < 8 ? "incorrect" : i === 8 ? "skipped" : "not_tested" }));
  expect(summarizeMockTestRows([...rows, rows[0]!], ["spelling"])).toEqual([{ skill: "spelling", totalItems: 10, independentCorrect: 6, practiceNeeded: 2, correctNotIndependent: 0, notTested: 2, skipped: 1, unassessed: 0 }]);
});
it("separates nonqualifying correctness, no evidence and each written skill", () => {
  const row: MockTestReportRow = { itemId: "a", source: "", target: "", skill: "recall", outcome: "correct", independent: false, reason: "recent_exposure", masteryStatus: "not_assessed" };
  expect(summarizeMockTestRows([row, { ...row, skill: "spelling", outcome: "incorrect" }, { ...row, itemId: "b", outcome: "unassessed" }], ["recall", "spelling"])).toEqual([
    { skill: "recall", totalItems: 2, independentCorrect: 0, practiceNeeded: 0, correctNotIndependent: 1, notTested: 1, skipped: 0, unassessed: 1 },
    { skill: "spelling", totalItems: 1, independentCorrect: 0, practiceNeeded: 1, correctNotIndependent: 0, notTested: 0, skipped: 0, unassessed: 0 },
  ]);
});
