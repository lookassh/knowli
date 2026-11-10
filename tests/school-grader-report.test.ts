import { describe, expect, it } from "vitest";
import { formOkForCase, groupReportLines, isUnneededShorten, type CaseOutcome } from "./probes/school-grader-report";

const outcome = (over: Partial<CaseOutcome>): CaseOutcome => ({
  id: "X", input: "written", disputed: false, status: "graded", knowledgeMatch: true, precisionMatch: true, unneededShorten: false, ...over,
});

describe("formOkForCase", () => {
  it("counts sentences only for written one_sentence answers", () => {
    expect(formOkForCase("one_sentence", "written", "Jedno zdanie.")).toBe(true);
    expect(formOkForCase("one_sentence", "written", "Pierwsze. Drugie.")).toBe(false);
    expect(formOkForCase("one_sentence", "speech", "Pierwsze. Drugie.")).toBeNull();
    expect(formOkForCase("explanation", "written", "Pierwsze. Drugie.")).toBeNull();
  });
});

describe("isUnneededShorten", () => {
  const verdict = { knowledge: "correct", precision: "verbose", redundantFragments: ["yyy"], offTopicFragments: [] };
  it("flags a shorten offer the expectation did not call for", () => {
    expect(isUnneededShorten(verdict, "concise")).toBe(true);
    expect(isUnneededShorten({ ...verdict, redundantFragments: [], offTopicFragments: ["no"] }, "concise")).toBe(true);
  });
  it("stays quiet when shortening is expected or would not be offered", () => {
    expect(isUnneededShorten(verdict, "verbose")).toBe(false);
    expect(isUnneededShorten({ ...verdict, redundantFragments: [] }, "concise")).toBe(false);
    expect(isUnneededShorten({ ...verdict, precision: "concise" }, "concise")).toBe(false);
    expect(isUnneededShorten({ ...verdict, knowledge: "partial" }, "concise")).toBe(false);
  });
});

describe("groupReportLines", () => {
  it("reports each input group separately and splits rejections from provider errors", () => {
    expect(groupReportLines([
      outcome({}),
      outcome({ knowledgeMatch: false }),
      outcome({ input: "speech", precisionMatch: false, unneededShorten: true }),
      outcome({ input: "speech", status: "rejected", knowledgeMatch: null, precisionMatch: null }),
      outcome({ input: "speech", status: "provider_error", knowledgeMatch: null, precisionMatch: null }),
    ])).toEqual([
      "pisane: przypadki=2 wiedzaZgodna=1 precyzjaZgodna=2 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0",
      "mówione: przypadki=3 wiedzaZgodna=1 precyzjaZgodna=0 odrzuconeWalidator=1 bladDostawcy=1 niepotrzebneSkracanie=1",
    ]);
  });
  it("prints a zero row for a group with no cases", () => {
    expect(groupReportLines([outcome({})])[1])
      .toBe("mówione: przypadki=0 wiedzaZgodna=0 precyzjaZgodna=0 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0");
  });
});
