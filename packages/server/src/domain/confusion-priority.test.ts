import { describe, expect, it } from "vitest";
import { rankConfusions, type ConfusionObservation } from "./confusion-priority";

function observation(overrides: Partial<ConfusionObservation> = {}): ConfusionObservation {
  return {
    attemptId: crypto.randomUUID(), receivedAt: "2026-10-01T12:00:00.000Z", childId: "child-a",
    expectedItemRevisionId: "thursday", answeredItemRevisionId: "tuesday",
    exerciseType: "reading", direction: "target_to_source", reliable: true, ...overrides,
  };
}

describe("rankConfusions", () => {
  it("ranks only repeated directional mistakes in the latest 20 reliable recognition attempts", () => {
    const pair = { expectedItemRevisionId: "thursday", answeredItemRevisionId: "tuesday", exerciseType: "reading" as const, direction: "target_to_source" as const };
    const rows = [observation({ attemptId: "a" }), observation({ attemptId: "b", receivedAt: "2026-10-02T12:00:00.000Z" })];
    expect(rankConfusions(rows)).toEqual([{ ...pair, count: 2 }]);
    expect(rankConfusions(rows.slice(0, 1))).toEqual([]);

    const onlyOnce = [rows[0]!, ...Array.from({ length: 20 }, (_, i) => observation({
      attemptId: `correct-${i}`, receivedAt: `2026-10-${String(3 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      expectedItemRevisionId: `right-${i}`, answeredItemRevisionId: `right-${i}`,
    }))];
    expect(rankConfusions(onlyOnce)).toEqual([]);
  });

  it("deduplicates per attempt, keeps directions distinct, and excludes unreliable evidence", () => {
    expect(rankConfusions([
      observation({ attemptId: "a" }), observation({ attemptId: "a" }),
      observation({ attemptId: "b", direction: "source_to_target" }),
      observation({ attemptId: "c", reliable: false }),
    ])).toEqual([]);
  });

  it("never combines evidence from different children", () => {
    expect(rankConfusions([
      observation({ attemptId: "child-a-1", childId: "child-a" }),
      observation({ attemptId: "child-b-1", childId: "child-b" }),
    ])).toEqual([]);
  });
});
