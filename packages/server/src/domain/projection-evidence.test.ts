import { describe, expect, it } from "vitest";
import { qualifyProjectionEvidence } from "./projection-evidence";

const entry = {
  receivedAt: "2026-10-09T10:00:00.000Z",
  policyVersion: "learning-v1",
  skill: "reading" as const,
  outcome: "correct" as const,
  independent: true,
  confirmationEligible: true,
};

describe("qualifyProjectionEvidence", () => {
  it("removes only mastery evidence from singleton and audio-assisted reading", () => {
    const result = qualifyProjectionEvidence([
      { entry, exerciseType: "reading", distinctChoiceCount: 1, audioIssuedBeforeAnswer: false },
      { entry, exerciseType: "reading", distinctChoiceCount: 3, audioIssuedBeforeAnswer: true },
      { entry, exerciseType: "listening", distinctChoiceCount: 3, audioIssuedBeforeAnswer: true },
    ]);
    expect(result.map((row) => [row.independent, row.confirmationEligible, row.outcome])).toEqual([
      [false, false, "correct"], [false, false, "correct"], [true, true, "correct"],
    ]);
  });

  it("disqualifies audio-assisted picture_recognition but keeps a clean choice independent", () => {
    const result = qualifyProjectionEvidence([
      { entry, exerciseType: "picture_recognition", distinctChoiceCount: 3, audioIssuedBeforeAnswer: true },
      { entry, exerciseType: "picture_recognition", distinctChoiceCount: 3, audioIssuedBeforeAnswer: false },
      { entry, exerciseType: "picture_recognition", distinctChoiceCount: 1, audioIssuedBeforeAnswer: false },
    ]);
    expect(result.map((row) => [row.independent, row.confirmationEligible])).toEqual([
      [false, false], [true, true], [false, false],
    ]);
  });

  it("leaves assessment records unchanged when the evidence is disqualified", () => {
    const before = structuredClone(entry);
    qualifyProjectionEvidence([{ entry, exerciseType: "reverse_recognition", distinctChoiceCount: 1, audioIssuedBeforeAnswer: false }]);
    expect(entry).toEqual(before);
  });
});
