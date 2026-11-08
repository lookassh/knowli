import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { wilson, scoreStage2, agreement } = require("./score.cjs") as {
  wilson(defects: number, n: number): { low: number; high: number };
  scoreStage2(groups: readonly { key: unknown; verdicts: readonly Record<string, string>[] }[]): { report: Record<string, Record<string, { defects: number; n: number; perRun: { min: number; max: number } }>>; missing: string[]; levels: Record<string, number> };
  agreement(key: unknown, a: readonly Record<string, string>[], b: readonly Record<string, string>[]): Record<string, { agree: number; n: number; differing: string[] }>;
};

const key = {
  prefix: "tb",
  rows: [
    { rowId: "tb-r001", model: "baseline-r1", index: 0, type: "lesson_choice", hasExplanation: true },
    { rowId: "tb-r002", model: "baseline-r2", index: 0, type: "lesson_listen_choice", hasExplanation: false },
    { rowId: "tb-r003", model: "agent-r1", index: 0, type: "lesson_gap", hasExplanation: false },
  ],
};
const verdict = (rowId: string, value: string, criterion = "", level = "") => ({ rowId, verdict: value, criterion, level, adjudicatorNote: "" });

describe("score.cjs (etap 2)", () => {
  it("computes the Wilson 95% interval", () => {
    expect(wilson(0, 400).high).toBeCloseTo(0.0095, 4);
    const four = wilson(4, 400);
    expect(four.low).toBeCloseTo(0.0039, 4);
    expect(four.high).toBeCloseTo(0.0254, 4);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("counts class denominators per variant from the exercise type", () => {
    const { report, missing, levels } = scoreStage2([{ key, verdicts: [verdict("tb-r001", "defect", "W3"), verdict("tb-r002", "ok", "", "too_easy")] }]);
    expect(missing).toEqual(["tb-r003"]);
    expect(levels).toEqual({ "baseline @tb too_easy": 1 });
    expect(report.baseline!.W1).toMatchObject({ defects: 0, n: 2 });
    // Dwa przebiegi bazowe (r1, r2); W3 ma wiersz tylko w r1, więc min = 0.
    expect(report.baseline!.W3).toMatchObject({ defects: 1, n: 1, perRun: { min: 0, max: 1 } });
    expect(report.baseline!.W8).toMatchObject({ defects: 0, n: 1 });
    expect(report.baseline!.W7).toMatchObject({ n: 1 });
    expect(report["baseline @tb"]!.W1!.n).toBe(2);
    expect(report["baseline #lesson_choice"]!.W3!.defects).toBe(1);
  });

  it("treats the same source name in two topics as two runs", () => {
    const other = { prefix: "ps", rows: [{ rowId: "ps-r001", model: "baseline-r1", index: 0, type: "lesson_choice", hasExplanation: false }] };
    const { report } = scoreStage2([
      { key, verdicts: [verdict("tb-r001", "defect", "W1"), verdict("tb-r002", "ok"), verdict("tb-r003", "ok")] },
      { key: other, verdicts: [verdict("ps-r001", "ok")] },
    ]);
    expect(report.baseline!.W1).toMatchObject({ defects: 1, n: 3, perRun: { min: 0, max: 1 } });
  });

  it("rejects a repeated row, a defect without a class and a class outside its denominator", () => {
    expect(() => scoreStage2([{ key, verdicts: [] }, { key, verdicts: [] }])).toThrow(/powtórzony/u);
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r001", "defect")] }])).toThrow(/bez klasy/u);
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r003", "defect", "W8")] }])).toThrow(/nie dotyczy/u);
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r001", "defect", "K3")] }])).toThrow(/nieznana/u);
  });

  it("rejects an empty or misspelled verdict, ok with a class and an unknown level", () => {
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r001", "", "W1")] }])).toThrow(/spoza ok\/defect/u);
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r001", "defekt", "W1")] }])).toThrow(/spoza ok\/defect/u);
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r001", "ok", "W1")] }])).toThrow(/ok z klasą/u);
    expect(() => scoreStage2([{ key, verdicts: [verdict("tb-r001", "ok", "", "bogus")] }])).toThrow(/nieznany level/u);
  });

  it("stage 5 school classes: W1 and W3 on keywords, no W6h (school open-answer hints are hidden from the sheet)", () => {
    const school = {
      prefix: "sc",
      rows: [
        { rowId: "sc-r001", model: "baseline-r1", index: 0, type: "lesson_keywords", hasExplanation: false },
        { rowId: "sc-r002", model: "baseline-r1", index: 1, type: "lesson_open_answer", hasExplanation: false },
      ],
    };
    const { report } = scoreStage2([{ key: school, verdicts: [verdict("sc-r001", "defect", "W1|W3"), verdict("sc-r002", "ok")] }]);
    expect(report.baseline!.W1).toMatchObject({ defects: 1, n: 1 });
    expect(report.baseline!.W3).toMatchObject({ defects: 1, n: 1 });
    expect(report.baseline!.W6h).toBeUndefined();
    expect(() => scoreStage2([{ key: school, verdicts: [verdict("sc-r002", "defect", "W6h")] }])).toThrow();
  });

  it("measures agreement of two judges per class", () => {
    const result = agreement(key, [verdict("tb-r001", "defect", "W3"), verdict("tb-r003", "ok")], [verdict("tb-r001", "ok"), verdict("tb-r003", "ok")]);
    expect(result.W3).toEqual({ agree: 0, n: 1, differing: ["tb-r001"] });
    expect(result.W2).toEqual({ agree: 1, n: 1, differing: [] });
  });
});
