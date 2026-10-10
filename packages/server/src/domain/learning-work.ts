import type { Policy } from "./types";

export interface SkillWorkInput {
  skill: "recall" | "spelling" | "pronunciation";
  progress: { status: string; nextReviewAt: string | null; streak: number } | undefined;
  hasQualifyingAssessment: boolean;
  firstIssuedAt: string | null;
  lastRelevantExposureAt: string | null;
  now: string;
  policy: Policy;
}
export interface SkillWork { reviewDueAt: string | null; eligibleAt: string | null; dueNow: boolean }

export function deriveSkillWork(input: SkillWorkInput): SkillWork {
  const reviewDueAt = input.hasQualifyingAssessment
    ? input.progress?.nextReviewAt ?? null
    : input.firstIssuedAt === null
      ? null
      : new Date(Date.parse(input.firstIssuedAt) + 24 * 60 * 60 * 1000).toISOString();
  const exposureEligibleAt =
    (input.skill === "recall" || input.skill === "spelling") && input.lastRelevantExposureAt !== null
      ? new Date(Date.parse(input.lastRelevantExposureAt) + input.policy.independenceAfterSeconds * 1000).toISOString()
      : null;
  const eligibleAt = reviewDueAt === null
    ? null
    : exposureEligibleAt !== null && exposureEligibleAt > reviewDueAt
      ? exposureEligibleAt
      : reviewDueAt;
  return { reviewDueAt, eligibleAt, dueNow: eligibleAt !== null && eligibleAt <= input.now };
}
