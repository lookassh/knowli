import { describe, expect, it } from "vitest";
import { summarizeSessionAssessments, type SummaryAssessment } from "./session-summary";

function row(overrides: Partial<SummaryAssessment> = {}): SummaryAssessment {
  return { itemId: "monday", target: "Monday", skill: "recall", outcome: "correct", independent: true, ...overrides };
}

describe("podsumowanie rzeczywistych wyników sesji", () => {
  it("liczy różne słowa osobno dla Recall i pisowni, bez sukcesów ze wsparciem", () => {
    expect(summarizeSessionAssessments([
      row(), row(), row({ skill: "spelling", outcome: "incorrect" }),
      row({ itemId: "tuesday", target: "Tuesday", independent: false }),
      row({ itemId: "tuesday", target: "Tuesday", skill: "spelling" }),
      row({ skill: "listening" }),
    ])).toEqual({
      independentSuccesses: { recall: 1, spelling: 1 },
      practiceItems: [{ itemId: "monday", target: "Monday", skills: ["spelling"] }],
    });
  });

  it("dopiero późniejszy samodzielny sukces usuwa trudność danej umiejętności", () => {
    expect(summarizeSessionAssessments([
      row({ outcome: "incorrect" }), row({ skill: "spelling", outcome: "incorrect" }),
      row(), row({ skill: "spelling", independent: false }),
    ])).toEqual({
      independentSuccesses: { recall: 1, spelling: 0 },
      practiceItems: [{ itemId: "monday", target: "Monday", skills: ["spelling"] }],
    });
    expect(summarizeSessionAssessments([
      row({ outcome: "incorrect" }), row(), row({ outcome: "incorrect" }),
    ]).practiceItems).toEqual([{ itemId: "monday", target: "Monday", skills: ["recall"] }]);
  });

  it("brak oceny nie tworzy trudności ani nie usuwa wcześniejszej", () => {
    expect(summarizeSessionAssessments([row({ outcome: "unassessed" })])).toEqual({
      independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
    });
    expect(summarizeSessionAssessments([
      row({ outcome: "incorrect" }), row({ outcome: "unassessed" }),
    ]).practiceItems).toEqual([{ itemId: "monday", target: "Monday", skills: ["recall"] }]);
    expect(summarizeSessionAssessments([])).toEqual({
      independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
    });
  });
});
