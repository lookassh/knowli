import { describe, expect, it } from "vitest";
import { mockPrecisionHint, objectivesWorthReviewing, schoolMockAggregate } from "./mock-test-precision";

describe("schoolMockAggregate", () => {
  it("counts knowledge, precision, form violations and the most frequent missing elements", () => {
    const aggregate = schoolMockAggregate([
      { knowledge: "correct", precision: "verbose", formOk: false },
      { knowledge: "partial", precision: "concise", missingElementTexts: ["roślina wytwarza cukry"] },
      { knowledge: "incorrect", precision: "unfocused", missingElementTexts: ["roślina wytwarza cukry", "wykorzystuje światło"] },
    ]);
    expect(aggregate).toEqual({
      knowledge: { correct: 1, partial: 1, incorrect: 1 },
      precision: { concise: 1, verbose: 1, unfocused: 1 },
      formViolations: 1,
      missingElements: [{ text: "roślina wytwarza cukry", count: 2 }, { text: "wykorzystuje światło", count: 1 }],
    });
  });

  it("ignores closed exercises and unevaluated answers; no open answers gives null", () => {
    expect(schoolMockAggregate([{}, { knowledge: "unevaluated" }])).toBeNull();
    expect(schoolMockAggregate([{ knowledge: "correct" }, {}])?.knowledge).toEqual({ correct: 1, partial: 0, incorrect: 0 });
  });

  it("keeps at most five missing elements", () => {
    const aggregate = schoolMockAggregate([{ knowledge: "incorrect", missingElementTexts: ["a", "b", "c", "d", "e", "f"] }]);
    expect(aggregate?.missingElements).toHaveLength(5);
  });
});

describe("mockPrecisionHint", () => {
  it.each([
    [{ knowledge: "correct", precision: "verbose" }, "shorter"],
    [{ knowledge: "correct", precision: "concise", formOk: false }, "shorter"],
    [{ knowledge: "correct", precision: "unfocused" }, "focus"],
    [{ knowledge: "partial", precision: "concise", missingElementIds: ["e2"] }, "missing"],
    // Komplet elementów i błędne stwierdzenie: o brakach mówić nie wolno.
    [{ knowledge: "partial", precision: "concise", missingElementIds: [] }, null],
    [{ knowledge: "correct", precision: "concise" }, null],
    [{ knowledge: "incorrect", precision: "verbose" }, null],
    [{}, null],
  ] as const)("%j → %s", (details, hint) => {
    expect(mockPrecisionHint(details)).toBe(hint);
  });
});

describe("objectivesWorthReviewing", () => {
  it("lists objectives with wrong, partial or skipped answers in topic order, not unassessed ones", () => {
    expect(objectivesWorthReviewing([
      { objectiveId: "b", outcome: "skipped" },
      { objectiveId: "a", outcome: "incorrect", knowledge: "partial" },
      { objectiveId: "c", outcome: "unassessed" },
      { objectiveId: "d", outcome: "correct" },
      { objectiveId: "a", outcome: "incorrect" },
    ], ["a", "b", "c", "d"])).toEqual(["a", "b"]);
  });
});
