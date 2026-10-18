import { eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { childSkillProgress, itemRevisionSkills } from "../db/schema";
import { projectProgress } from "../domain/progress";
import type { History, Policy, SkillProgress } from "../domain/types";
import type { HistoryScope } from "./skill-history";

export const SKILL_PROJECTION_VERSION = "proj-3" as const;

function dbStatus(status: string): string {
  return status === "not_assessed" ? "unseen" : status === "learning" ? "practicing" : status;
}

export async function persistSkillProjection(
  tx: Tx,
  scope: HistoryScope,
  history: History,
  policy: Policy,
  now: Date,
  receivedAt: Date,
): Promise<void> {
  const policyHistory = history.filter((entry) => entry.policyVersion === policy.version);
  const qualifies = policyHistory.some((entry) => entry.independent && entry.outcome !== "unevaluated");
  const projected = projectProgress(history, policy, now.toISOString()).skills[scope.skill];
  if (!projected) return;
  const latestCredible = policyHistory
    .filter((entry) => entry.outcome !== "unevaluated")
    .reduce<string | null>((latest, entry) => latest === null || entry.receivedAt > latest ? entry.receivedAt : latest, null);
  await writeSkillProjection(
    tx,
    scope,
    policy.version,
    projected,
    latestCredible === null ? receivedAt : new Date(latestCredible),
    now,
    null,
    qualifies,
  );
}

/** Pierwsze wydanie zapisujemy w tej samej transakcji co wydanie zadania. */
export async function recordSkillIssued(
  tx: Tx,
  scope: HistoryScope,
  policyId: string,
  issuedAt: Date,
): Promise<void> {
  await tx.insert(childSkillProgress).values({
    childId: scope.childId,
    skillVersionId: scope.skillVersionId,
    policyId,
    status: "unseen",
    independentSuccessStreak: 0,
    lastReviewedAt: null,
    nextReviewAt: null,
    delayedConfirmationAt: null,
    firstIssuedAt: issuedAt,
    hasQualifyingAssessment: false,
    projectionVersion: SKILL_PROJECTION_VERSION,
    updatedAt: issuedAt,
  }).onConflictDoUpdate({
    target: [childSkillProgress.childId, childSkillProgress.skillVersionId, childSkillProgress.policyId],
    set: {
      firstIssuedAt: sql`case
        when ${childSkillProgress.firstIssuedAt} is null then excluded.first_issued_at
        when excluded.first_issued_at is null then ${childSkillProgress.firstIssuedAt}
        else least(${childSkillProgress.firstIssuedAt}, excluded.first_issued_at)
      end`,
      updatedAt: sql`greatest(${childSkillProgress.updatedAt}, excluded.updated_at)`,
    },
  });
}

/** Mapuje zadanie na umiejętności, których pierwsze wydanie wpływa na scheduler. */
export async function recordTaskSkillFacts(
  tx: Tx,
  input: { childId: string; itemRevisionId: string; policyId: string; exerciseType: string; issuedAt: Date },
): Promise<void> {
  const links = await tx.select({ skill: itemRevisionSkills.skill, skillVersionId: itemRevisionSkills.skillVersionId })
    .from(itemRevisionSkills).where(eq(itemRevisionSkills.itemRevisionId, input.itemRevisionId));
  for (const link of links) {
    const relevant = input.exerciseType === "recall"
      ? link.skill === "recall" || link.skill === "spelling"
      : input.exerciseType === "speech"
        ? link.skill === "pronunciation"
        : input.exerciseType === "letter_completion"
          ? link.skill === "spelling"
          : false;
    if (!relevant) continue;
    await recordSkillIssued(tx, {
      childId: input.childId,
      skillVersionId: link.skillVersionId,
      skill: link.skill as HistoryScope["skill"],
    }, input.policyId, input.issuedAt);
  }
}

/** Wspólny zapis wartości odtworzonej dla zwykłej finalizacji i rebuild. */
export async function writeSkillProjection(
  tx: Tx,
  scope: HistoryScope,
  policyId: string,
  projected: SkillProgress,
  reviewedAt: Date | null,
  now: Date,
  firstIssuedAt: Date | null,
  hasQualifyingAssessment: boolean,
): Promise<void> {
  await tx.insert(childSkillProgress).values({
    childId: scope.childId,
    skillVersionId: scope.skillVersionId,
    policyId,
    status: dbStatus(projected.status),
    independentSuccessStreak: projected.streak,
    lastReviewedAt: reviewedAt,
    nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
    delayedConfirmationAt: null,
    firstIssuedAt,
    hasQualifyingAssessment,
    projectionVersion: SKILL_PROJECTION_VERSION,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [childSkillProgress.childId, childSkillProgress.skillVersionId, childSkillProgress.policyId],
    set: {
      status: dbStatus(projected.status),
      independentSuccessStreak: projected.streak,
      lastReviewedAt: sql`case
        when ${childSkillProgress.lastReviewedAt} is null then excluded.last_reviewed_at
        when excluded.last_reviewed_at is null then ${childSkillProgress.lastReviewedAt}
        else greatest(${childSkillProgress.lastReviewedAt}, excluded.last_reviewed_at)
      end`,
      nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
      delayedConfirmationAt: null,
      firstIssuedAt: sql`case
        when ${childSkillProgress.firstIssuedAt} is null then excluded.first_issued_at
        when excluded.first_issued_at is null then ${childSkillProgress.firstIssuedAt}
        else least(${childSkillProgress.firstIssuedAt}, excluded.first_issued_at)
      end`,
      hasQualifyingAssessment: sql`${childSkillProgress.hasQualifyingAssessment} or excluded.has_qualifying_assessment`,
      projectionVersion: SKILL_PROJECTION_VERSION,
      updatedAt: now,
    },
  });
}
