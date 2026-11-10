import { describe, expect, it } from "vitest";
import { decisionLines, formOkForCase, groupReportLines, isUnneededShorten, type CaseOutcome } from "./probes/school-grader-report";

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
      outcome({ input: "speech", holdout: true, knowledgeMatch: false }),
    ])).toEqual([
      "pisane: przypadki=2 wiedzaZgodna=1 precyzjaZgodna=2 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0",
      "mówione: przypadki=3 wiedzaZgodna=1 precyzjaZgodna=0 odrzuconeWalidator=1 bladDostawcy=1 niepotrzebneSkracanie=1",
      "mówione-nowe: przypadki=1 wiedzaZgodna=0 precyzjaZgodna=1 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0",
    ]);
  });
  it("prints a zero row for a group with no cases", () => {
    expect(groupReportLines([outcome({})])[1])
      .toBe("mówione: przypadki=0 wiedzaZgodna=0 precyzjaZgodna=0 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0");
  });
});

describe("decisionLines", () => {
  const speech = (id: string, over: Partial<CaseOutcome> = {}) => outcome({ id, input: "speech", ...over });
  const bad = { knowledgeMatch: false };
  const warn = (n: number) => `UWAGA: błędy dostawcy w mowie lub bliźniakach: ${n} — rozstrzygnięcie niepełne`;
  it("needs three runs", () => {
    expect(decisionLines([[speech("S01", bad)]])).toEqual(["REGUŁA: wymaga --runs=3"]);
  });
  it("calls story 2 needed for one stable knowledge failure", () => {
    expect(decisionLines([[speech("S02", bad)], [speech("S02", bad)], [speech("S02")]]))
      .toEqual(["S02: wiedza 2/3", "REGUŁA: mowa stabilnie błędna"]);
  });
  it("counts validator rejections but not provider errors", () => {
    const rejected = { status: "rejected", knowledgeMatch: null, precisionMatch: null } as const;
    const provider = { status: "provider_error", knowledgeMatch: null, precisionMatch: null } as const;
    expect(decisionLines([[speech("S02", rejected)], [speech("S02", rejected)], [speech("S02", provider)]]))
      .toEqual(["S02: odrzucenie 2/3", warn(1), "REGUŁA: mowa stabilnie błędna"]);
    expect(decisionLines([[speech("S02", provider)], [speech("S02", provider)], [speech("S02", provider)]]))
      .toEqual([warn(3), "REGUŁA: mowa bez stabilnych błędów"]);
  });
  it("warns about provider errors on a written twin that hides a paired failure", () => {
    const run = [
      speech("S03", { ...bad, pairOf: "G09" }),
      outcome({ id: "G09", status: "provider_error", knowledgeMatch: null, precisionMatch: null }),
    ];
    expect(decisionLines([run, run, run])).toEqual([warn(3), "REGUŁA: mowa bez stabilnych błędów"]);
  });
  it("applies the rule only for exactly three runs", () => {
    const run = [speech("S02", bad)];
    expect(decisionLines([run, run, [], []])).toEqual(["REGUŁA: wymaga --runs=3"]);
  });
  it("needs two cases for the shorten dimension", () => {
    const shorten = { unneededShorten: true };
    const one = [speech("S01", shorten), speech("S02")];
    const two = [speech("S01", shorten), speech("S02", shorten)];
    expect(decisionLines([one, one, one])).toEqual(["S01: skracanie 3/3", "REGUŁA: mowa bez stabilnych błędów"]);
    expect(decisionLines([two, two, two])).toEqual(["S01: skracanie 3/3", "S02: skracanie 3/3", "REGUŁA: mowa stabilnie błędna"]);
  });
  it("ignores single failures, disputed cases and pairs whose written twin fails", () => {
    const run = [
      speech("S11", { ...bad, disputed: true }),
      speech("S03", { ...bad, pairOf: "G09" }),
      outcome({ id: "G09", knowledgeMatch: false }),
    ];
    expect(decisionLines([run, run, [...run, speech("S04", bad)]])).toEqual(["REGUŁA: mowa bez stabilnych błędów"]);
  });
  it("counts a paired case when its written twin passes", () => {
    const run = [speech("S03", { ...bad, pairOf: "G09" }), outcome({ id: "G09" })];
    expect(decisionLines([run, run, run])).toEqual(["S03: wiedza 3/3", "REGUŁA: mowa stabilnie błędna"]);
  });
});
