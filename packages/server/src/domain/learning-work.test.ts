import { describe, expect, it } from "vitest";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import { deriveSkillWork } from "./learning-work";

const BASE = {
  skill: "recall" as const,
  progress: undefined,
  hasQualifyingAssessment: false,
  firstIssuedAt: "2026-10-09T16:00:00.000Z",
  lastRelevantExposureAt: "2026-10-09T16:00:00.000Z",
  policy: LEARNING_V1_POLICY,
};

describe("deriveSkillWork", () => {
  it("keeps the first independent check due 24 hours after first issue", () => {
    const work = deriveSkillWork({ ...BASE, now: "2026-10-10T16:00:00.000Z" });
    expect(work.reviewDueAt).toBe("2026-10-10T16:00:00.000Z");
    expect(work.dueNow).toBe(true);
  });

  it("waits 300 seconds after relevant exposure for an otherwise due check", () => {
    const input = {
      ...BASE,
      hasQualifyingAssessment: true,
      progress: { status: "learning" as const, nextReviewAt: "2026-10-09T16:00:00.000Z", streak: 1 },
    };
    expect(deriveSkillWork({ ...input, now: "2026-10-09T16:04:59.000Z" }).dueNow).toBe(false);
    expect(deriveSkillWork({ ...input, now: "2026-10-09T16:05:00.000Z" }).dueNow).toBe(true);
  });

  it("uses the normal review date once a qualifying assessment exists", () => {
    const work = deriveSkillWork({
      ...BASE,
      hasQualifyingAssessment: true,
      progress: { status: "learning", nextReviewAt: "2026-10-12T16:00:00.000Z", streak: 1 },
      now: "2026-10-11T16:00:00.000Z",
    });
    expect(work.reviewDueAt).toBe("2026-10-12T16:00:00.000Z");
    expect(work.dueNow).toBe(false);
  });
});
