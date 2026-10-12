import { UuidSchema } from "@learning/contracts";
import { and, eq, inArray } from "drizzle-orm";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  assessments,
  attempts,
  childProfiles,
  childSkillProgress,
  learningSessions,
  skillVersions,
} from "../db/schema";
import type { ProgressStatus, Skill } from "../domain/types";
import { VOCABULARY_SKILLS } from "../domain/types";
import { AppError } from "../errors";
import { loadPolicy } from "../policies/registry";
import { projectProgress } from "../domain/progress";
import { readSkillHistories, skillHistoryKey, type HistoryScope } from "./skill-history";
import { writeSkillProjection } from "./skill-projections";

export interface RebuildProgressOptions {
  childId?: string;
  apply: boolean;
}

export interface RebuildProgressReport {
  projectionVersion: "proj-2";
  children: number;
  examined: number;
  inserted: number;
  updated: number;
  deleted: number;
  downgraded: number;
  unchanged: number;
}

type ChildReport = Omit<RebuildProgressReport, "projectionVersion" | "children">;
type ProgressRow = typeof childSkillProgress.$inferSelect;

function emptyReport(): RebuildProgressReport {
  return { projectionVersion: "proj-2", children: 0, examined: 0, inserted: 0, updated: 0, deleted: 0, downgraded: 0, unchanged: 0 };
}

function dbStatus(status: ProgressStatus): string {
  return status === "not_assessed" ? "unseen" : status === "learning" ? "practicing" : status;
}

function asIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function projectionMatches(existing: ProgressRow, expected: {
  status: string;
  streak: number;
  lastReviewedAt: Date;
  nextReviewAt: Date | null;
  projectionVersion: string;
}): boolean {
  return existing.status === expected.status &&
    existing.independentSuccessStreak === expected.streak &&
    asIso(existing.lastReviewedAt) === expected.lastReviewedAt.toISOString() &&
    asIso(existing.nextReviewAt) === asIso(expected.nextReviewAt) &&
    existing.delayedConfirmationAt === null &&
    existing.projectionVersion === expected.projectionVersion;
}

function masteryRank(status: string): number {
  switch (status) {
    case "mastered": return 4;
    case "needs_confirmation": return 3;
    case "needs_reconfirmation": return 2;
    case "practicing": return 1;
    case "unseen": return 0;
    default: return -1;
  }
}

function isDowngrade(existing: ProgressRow, nextStatus: string, nextStreak: number): boolean {
  return masteryRank(nextStatus) < masteryRank(existing.status) || nextStreak < existing.independentSuccessStreak;
}

async function rebuildChild(
  tx: Tx,
  childId: string,
  apply: boolean,
  now: Date,
): Promise<ChildReport> {
  const child = await tx.select({ id: childProfiles.id }).from(childProfiles)
    .where(eq(childProfiles.id, childId)).for("update");
  if (child.length === 0) throw new AppError("not_found");

  if (apply) {
    const activeSession = (await tx.select({ id: learningSessions.id }).from(learningSessions)
      .where(and(eq(learningSessions.childId, childId), eq(learningSessions.state, "active"))).limit(1))[0];
    const processingAttempt = (await tx.select({ id: attempts.id }).from(attempts)
      .where(and(eq(attempts.childId, childId), eq(attempts.state, "processing"))).limit(1))[0];
    if (activeSession || processingAttempt) {
      throw new AppError("conflict", { message: "progress rebuild requires no active sessions or processing attempts" });
    }
  }

  const existingRows = await tx.select().from(childSkillProgress).where(eq(childSkillProgress.childId, childId));
  // Izolacja lekcji (zadanie 9): odbudowa postępu słówek projektuje WYŁĄCZNIE
  // umiejętności słówek. Oceny celów lekcji ('objective') żyją w assessments,
  // ale nie trafiają do child_skill_progress — pomijamy je tu w jednym miejscu.
  const assessmentRows = await tx.selectDistinct({ skillVersionId: assessments.skillVersionId, skill: assessments.skill })
    .from(assessments).where(and(eq(assessments.childId, childId), inArray(assessments.skill, [...VOCABULARY_SKILLS])));
  const existingScopes = await tx.select({ skillVersionId: childSkillProgress.skillVersionId, skill: skillVersions.skill })
    .from(childSkillProgress)
    .innerJoin(skillVersions, eq(skillVersions.id, childSkillProgress.skillVersionId))
    .where(eq(childSkillProgress.childId, childId));
  const scopesByKey = new Map<string, HistoryScope>();
  for (const row of existingScopes) {
    const scope: HistoryScope = { childId, skillVersionId: row.skillVersionId, skill: row.skill as Skill };
    scopesByKey.set(skillHistoryKey(scope), scope);
  }
  for (const row of assessmentRows) {
    const scope: HistoryScope = { childId, skillVersionId: row.skillVersionId, skill: row.skill as Skill };
    scopesByKey.set(skillHistoryKey(scope), scope);
  }
  const scopes = [...scopesByKey.values()];
  const histories = await readSkillHistories(tx, scopes);
  const existingByVersion = new Map(existingRows.map((row) => [row.skillVersionId, row]));
  const policies = new Map<string, Awaited<ReturnType<typeof loadPolicy>>>();
  const report: ChildReport = { examined: scopes.length, inserted: 0, updated: 0, deleted: 0, downgraded: 0, unchanged: 0 };

  for (const scope of scopes) {
    const key = skillHistoryKey(scope);
    const history = histories.get(key) ?? [];
    // Reader returns receivedAt/attemptId order; skip unassessed and technically
    // invalid evidence when selecting the policy used for this projection.
    const latestCredible = history.filter((entry) => entry.outcome !== "unevaluated").at(-1);
    const existing = existingByVersion.get(scope.skillVersionId);
    if (!latestCredible) {
      if (existing) {
        report.deleted += 1;
        if (apply) await tx.delete(childSkillProgress).where(and(
          eq(childSkillProgress.childId, childId), eq(childSkillProgress.skillVersionId, scope.skillVersionId),
        ));
      } else {
        report.unchanged += 1;
      }
      continue;
    }

    let policy = policies.get(latestCredible.policyVersion);
    if (!policy) {
      policy = await loadPolicy(tx, latestCredible.policyVersion);
      policies.set(latestCredible.policyVersion, policy);
    }
    const policyHistory = history.filter((entry) => entry.policyVersion === latestCredible.policyVersion);
    const projected = projectProgress(policyHistory, policy, now.toISOString()).skills[scope.skill];
    if (!projected) {
      report.unchanged += 1;
      continue;
    }
    const expected = {
      status: dbStatus(projected.status),
      streak: projected.streak,
      lastReviewedAt: new Date(latestCredible.receivedAt),
      nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
      projectionVersion: "proj-2",
    };
    if (!existing) {
      report.inserted += 1;
      if (apply) await writeSkillProjection(tx, scope, projected, expected.lastReviewedAt, now);
    } else if (projectionMatches(existing, expected)) {
      report.unchanged += 1;
    } else {
      report.updated += 1;
      if (isDowngrade(existing, expected.status, expected.streak)) report.downgraded += 1;
      if (apply) await writeSkillProjection(tx, scope, projected, expected.lastReviewedAt, now);
    }
  }
  return report;
}

/** Dry-run domyślnie; apply atomowo dla każdego dziecka i wyłącznie dla projekcji. */
export async function rebuildProgress(
  services: Services,
  options: RebuildProgressOptions,
): Promise<RebuildProgressReport> {
  const selectedChildId = options.childId === undefined ? undefined : UuidSchema.parse(options.childId);
  const childRows = selectedChildId === undefined
    ? await services.db.select({ id: childProfiles.id }).from(childProfiles)
    : await services.db.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, selectedChildId));
  if (selectedChildId !== undefined && childRows.length === 0) throw new AppError("not_found");

  const report = emptyReport();
  for (const row of childRows) {
    const childReport = await services.db.transaction((tx) => rebuildChild(tx, row.id, options.apply, services.clock.now()));
    report.children += 1;
    report.examined += childReport.examined;
    report.inserted += childReport.inserted;
    report.updated += childReport.updated;
    report.deleted += childReport.deleted;
    report.downgraded += childReport.downgraded;
    report.unchanged += childReport.unchanged;
  }
  return report;
}
