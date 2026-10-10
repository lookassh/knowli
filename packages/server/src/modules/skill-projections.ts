import { and, eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { childSkillProgress } from "../db/schema";
import { projectProgress } from "../domain/progress";
import type { History, Policy, SkillProgress } from "../domain/types";
import type { HistoryScope } from "./skill-history";

const PROJECTION_VERSION = "proj-2";

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
  const existing = (await tx
    .select({ skillVersionId: childSkillProgress.skillVersionId })
    .from(childSkillProgress)
    .where(and(
      eq(childSkillProgress.childId, scope.childId),
      eq(childSkillProgress.skillVersionId, scope.skillVersionId),
    )))[0];
  if (!existing && !history.some((entry) => entry.outcome !== "unevaluated")) return;

  const projected = projectProgress(history, policy, now.toISOString()).skills[scope.skill];
  if (!projected) return;
  await writeSkillProjection(tx, scope, projected, receivedAt, now);
}

/** Wspólny zapis wartości odtworzonej dla zwykłej finalizacji i rebuild. */
export async function writeSkillProjection(
  tx: Tx,
  scope: HistoryScope,
  projected: SkillProgress,
  reviewedAt: Date,
  now: Date,
): Promise<void> {
  await tx.insert(childSkillProgress).values({
    childId: scope.childId,
    skillVersionId: scope.skillVersionId,
    status: dbStatus(projected.status),
    independentSuccessStreak: projected.streak,
    lastReviewedAt: reviewedAt,
    nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
    delayedConfirmationAt: null,
    projectionVersion: PROJECTION_VERSION,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [childSkillProgress.childId, childSkillProgress.skillVersionId],
    set: {
      status: dbStatus(projected.status),
      independentSuccessStreak: projected.streak,
      lastReviewedAt: reviewedAt,
      nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
      delayedConfirmationAt: null,
      projectionVersion: PROJECTION_VERSION,
      updatedAt: now,
    },
  });
}

