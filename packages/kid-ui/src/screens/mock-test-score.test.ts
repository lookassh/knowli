import { describe, expect, test } from "vitest";
import type { MockTestSummaryDto } from "@learning/contracts";
import { computeMockTestScore, mockTestWordStatus } from "./mock-test-score";

type Solution = MockTestSummaryDto["solutions"][number];
type Results = Solution["results"];

function solution(taskId: string, results: Results): Solution {
  return { taskId, source: "pies", target: "dog", audioAssetId: null, results };
}

function results(...outcomes: { skill: Results[number]["skill"]; outcome: Results[number]["outcome"] }[]): Results {
  return outcomes;
}

describe("mockTestWordStatus", () => {
  test("wszystkie sprawdzone umiejętności poprawne dają correct", () => {
    expect(mockTestWordStatus(results({ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "correct" }))).toBe("correct");
  });

  test("jakakolwiek pomyłka daje incorrect, nawet gdy druga umiejętność poprawna", () => {
    expect(mockTestWordStatus(results({ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "incorrect" }))).toBe("incorrect");
  });

  test("pominięta lub niesprawdzona umiejętność nie jest błędem — słowo z samym skipem to notAssessed", () => {
    expect(mockTestWordStatus(results({ skill: "recall", outcome: "skipped" }))).toBe("notAssessed");
    expect(mockTestWordStatus(results({ skill: "recall", outcome: "not_tested" }))).toBe("notAssessed");
    expect(mockTestWordStatus(results({ skill: "recall", outcome: "unassessed" }))).toBe("notAssessed");
  });

  test("poprawna odpowiedź plus pominięta umiejętność liczy się jako correct", () => {
    expect(mockTestWordStatus(results({ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "skipped" }))).toBe("correct");
  });

  test("pusta lista wyników to notAssessed", () => {
    expect(mockTestWordStatus([])).toBe("notAssessed");
  });
});

describe("computeMockTestScore", () => {
  test("liczy słowa, nie umiejętności: słowo mieszane psuje wynik", () => {
    const solutions: Solution[] = [
      solution("1", results({ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "correct" })),
      solution("2", results({ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "incorrect" })),
      solution("3", results({ skill: "recall", outcome: "incorrect" })),
    ];
    expect(computeMockTestScore(solutions)).toEqual({ correct: 1, total: 3, percent: 33, stars: 2 });
  });

  test("komplet poprawnych słów to 100% i komplet 6 gwiazdek", () => {
    const solutions: Solution[] = [
      solution("1", results({ skill: "recall", outcome: "correct" })),
      solution("2", results({ skill: "listening", outcome: "correct" })),
    ];
    expect(computeMockTestScore(solutions)).toEqual({ correct: 2, total: 2, percent: 100, stars: 6 });
  });

  test("niepełna próba: niesprawdzone słowa obniżają wynik, ale nie są błędem", () => {
    const solutions: Solution[] = [
      solution("1", results({ skill: "recall", outcome: "correct" })),
      solution("2", results({ skill: "recall", outcome: "not_tested" })),
      solution("3", results({ skill: "recall", outcome: "skipped" })),
      solution("4", results({ skill: "recall", outcome: "incorrect" })),
    ];
    expect(computeMockTestScore(solutions)).toEqual({ correct: 1, total: 4, percent: 25, stars: 1 });
  });

  test("gwiazdki liczą się z dokładnego ułamka: 5/6 słów to dokładnie 5 gwiazdek", () => {
    const solutions: Solution[] = Array.from({ length: 6 }, (_, i) =>
      solution(String(i), i < 5 ? results({ skill: "recall", outcome: "correct" }) : results({ skill: "recall", outcome: "incorrect" })));
    expect(computeMockTestScore(solutions)).toEqual({ correct: 5, total: 6, percent: 83, stars: 5 });
  });

  test("pusta próba nie dzieli przez zero", () => {
    expect(computeMockTestScore([])).toEqual({ correct: 0, total: 0, percent: 0, stars: 0 });
  });
});
