import { describe, expect, it } from "vitest";
import type { MockTestReportRow } from "@learning/contracts";
import { groupMockReportWords } from "./mock-report-words";

function row(itemId: string, overrides: Partial<MockTestReportRow> = {}): MockTestReportRow {
  return {
    itemId,
    source: `pl-${itemId}`,
    target: `en-${itemId}`,
    skill: "recall",
    outcome: "not_tested",
    independent: false,
    reason: null,
    masteryStatus: "not_assessed",
    independenceReason: null,
    ...overrides,
  };
}

describe("groupMockReportWords", () => {
  it("grupyje wiersze po słowie w kolejności pierwszego wystąpienia i odrzuca słowa poza porcją", () => {
    const { words } = groupMockReportWords([
      row("a", { outcome: "correct", independent: true }),
      row("b", { reason: "outside_portion" }),
      row("a", { skill: "spelling", outcome: "correct", independent: true }),
      row("c", { reason: "not_known" }),
      row("d", { reason: "missing_audio", skill: "listening" }),
      row("e", { outcome: "incorrect" }),
    ]);
    expect(words.map(w => w.itemId)).toEqual(["a", "e"]);
    expect(words[0]!.rows).toHaveLength(2);
    expect(words[0]!.source).toBe("pl-a");
    expect(words[0]!.target).toBe("en-a");
  });

  it("zostawia w porcji słowo przerwane (interrupted) jako niesprawdzone", () => {
    const { words } = groupMockReportWords([
      row("a", { outcome: "not_tested", reason: "interrupted" }),
      row("a", { skill: "spelling", outcome: "not_tested", reason: "interrupted" }),
    ]);
    expect(words).toHaveLength(1);
    expect(words[0]!.status).toBe("notAssessed");
    expect(words[0]!.detail).toEqual({ type: "label", label: "notTested" });
  });

  it("liczy status, pastylki i wynik tylko po wierszach z porcji", () => {
    const { words, score } = groupMockReportWords([
      row("a", { outcome: "correct", independent: true }),
      row("a", { skill: "spelling", outcome: "correct", independent: true }),
      row("a", { skill: "listening", reason: "missing_audio" }),
      row("b", { outcome: "correct", independent: true }),
      row("b", { skill: "spelling", outcome: "incorrect", reason: "capitalization" }),
      row("c", { reason: "outside_portion" }),
    ]);
    expect(words[0]!.results).toEqual([
      { skill: "recall", outcome: "correct" },
      { skill: "spelling", outcome: "correct" },
    ]);
    expect(words[0]!.status).toBe("correct");
    expect(words[0]!.detail).toEqual({ type: "none" });
    expect(words[1]!.status).toBe("incorrect");
    expect(words[1]!.detail).toEqual({ type: "perSkill" });
    expect(score).toEqual({ correct: 1, total: 2, percent: 50, stars: 3 });
  });

  it("zwraca pusty wynik bez wierszy", () => {
    expect(groupMockReportWords([])).toEqual({ words: [], score: { correct: 0, total: 0, percent: 0, stars: 0 }, gaps: [] });
  });

  it("zgłasza jednolite i mieszane statusy opanowania", () => {
    const { words } = groupMockReportWords([
      row("a", { outcome: "correct", independent: true, masteryStatus: "needs_confirmation" }),
      row("a", { skill: "spelling", outcome: "correct", independent: true, masteryStatus: "needs_confirmation" }),
      row("b", { outcome: "correct", independent: true, masteryStatus: "mastered" }),
      row("b", { skill: "spelling", outcome: "correct", independent: true, masteryStatus: "practicing" }),
    ]);
    expect(words[0]!.masteryUniform).toBe("needs_confirmation");
    expect(words[0]!.masteryMixed).toBeNull();
    expect(words[1]!.masteryUniform).toBeNull();
    expect(words[1]!.masteryMixed).toEqual([
      { skill: "recall", status: "mastered" },
      { skill: "spelling", status: "practicing" },
    ]);
  });

  it("flaguje brak samodzielności przy poprawnych i błędnych odpowiedziach, z priorytetem poprawnej", () => {
    const { words } = groupMockReportWords([
      row("a", { outcome: "correct", independent: true }),
      row("b", { outcome: "correct", independent: false, independenceReason: "recent_exposure" }),
      row("c", { outcome: "incorrect", independent: false, independenceReason: "assisted" }),
      row("d", { outcome: "incorrect", independent: true }),
      row("e", { outcome: "correct", independent: false, independenceReason: "not_first_try" }),
      row("e", { skill: "spelling", outcome: "incorrect", independent: false, independenceReason: "assisted" }),
    ]);
    expect(words[0]!.notIndependent).toBeNull();
    expect(words[1]!.notIndependent).toEqual({ reason: "recent_exposure" });
    expect(words[2]!.notIndependent).toEqual({ reason: "assisted" });
    expect(words[3]!.notIndependent).toBeNull();
    expect(words[4]!.notIndependent).toEqual({ reason: "not_first_try" });
  });

  it("agreguje przyczyny braków słów poza porcją według priorytetu powodu", () => {
    const { gaps } = groupMockReportWords([
      row("a", { outcome: "correct", independent: true }),
      row("b", { reason: "not_known" }),
      row("b", { skill: "spelling", reason: "not_known" }),
      row("c", { reason: "outside_portion" }),
      row("c", { skill: "spelling", reason: "outside_portion" }),
      row("d", { skill: "listening", reason: "missing_audio" }),
      row("d", { reason: "outside_portion" }),
      row("e", { skill: "listening", reason: "insufficient_options" }),
      row("e", { reason: "outside_portion" }),
    ]);
    expect(gaps).toEqual([
      { reason: "not_known", count: 1 },
      { reason: "missing_audio", count: 1 },
      { reason: "insufficient_options", count: 1 },
      { reason: "outside_portion", count: 1 },
    ]);
  });

  it("liczy słowa poza porcją per powód, nie per wiersz umiejętności", () => {
    const { gaps } = groupMockReportWords([
      row("c", { reason: "outside_portion" }),
      row("c", { skill: "spelling", reason: "outside_portion" }),
      row("d", { reason: "outside_portion" }),
    ]);
    expect(gaps).toEqual([{ reason: "outside_portion", count: 2 }]);
  });

  it("pomija powód skipped i skleja jednolity powód w jeden bez umiejętności", () => {
    const { words } = groupMockReportWords([
      row("a", { outcome: "skipped", reason: "skipped" }),
      row("a", { skill: "spelling", outcome: "skipped", reason: "skipped" }),
      row("b", { outcome: "not_tested", reason: "interrupted" }),
      row("b", { skill: "spelling", outcome: "not_tested", reason: "interrupted" }),
    ]);
    expect(words[0]!.reasons).toEqual([]);
    expect(words[1]!.reasons).toEqual([{ skill: null, reason: "interrupted" }]);
  });

  it("podpisuje powody umiejętnością, gdy dotyczą tylko części wierszy słowa", () => {
    const { words } = groupMockReportWords([
      row("a", { outcome: "correct", independent: true }),
      row("a", { skill: "spelling", outcome: "incorrect", reason: "dont_remember" }),
    ]);
    expect(words[0]!.reasons).toEqual([{ skill: "spelling", reason: "dont_remember" }]);
  });
});
