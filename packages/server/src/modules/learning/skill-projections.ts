import { eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { childSkillProgress, itemRevisionSkills } from "../../db/schema";
import { projectProgress } from "../../domain/progress";
import type { History, Policy, SkillProgress } from "../../domain/types";
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

export interface SkillProjectionEntry {
  scope: HistoryScope;
  history: History;
  policy: Policy;
  now: Date;
  receivedAt: Date;
}

function projectionRowOf(entry: SkillProjectionEntry) {
  const { scope, history, policy, now, receivedAt } = entry;
  const policyHistory = history.filter((e) => e.policyVersion === policy.version);
  const qualifies = policyHistory.some((e) => e.independent && e.outcome !== "unevaluated");
  const projected = projectProgress(history, policy, now.toISOString()).skills[scope.skill];
  if (!projected) return null;
  const latestCredible = policyHistory
    .filter((e) => e.outcome !== "unevaluated")
    .reduce<string | null>((latest, e) => latest === null || e.receivedAt > latest ? e.receivedAt : latest, null);
  return {
    childId: scope.childId,
    skillVersionId: scope.skillVersionId,
    policyId: policy.version,
    status: dbStatus(projected.status),
    independentSuccessStreak: projected.streak,
    lastReviewedAt: latestCredible === null ? receivedAt : new Date(latestCredible),
    nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
    delayedConfirmationAt: null,
    firstIssuedAt: null,
    hasQualifyingAssessment: qualifies,
    projectionVersion: SKILL_PROJECTION_VERSION,
    updatedAt: now,
  };
}

/**
 * Wsadowy odpowiednik wielokrotnego persistSkillProjection: wszystkie wiersze
 * projekcji finalizowanej próby jednym wielowierszowym upsertem, z tą samą
 * semantyką monotoniczną per wiersz co writeSkillProjection.
 */
export async function persistSkillProjections(tx: Tx, entries: readonly SkillProjectionEntry[]): Promise<void> {
  const rows = entries.map(projectionRowOf).filter((row) => row !== null);
  if (rows.length === 0) return;
  await tx.insert(childSkillProgress).values(rows).onConflictDoUpdate({
    target: [childSkillProgress.childId, childSkillProgress.skillVersionId, childSkillProgress.policyId],
    set: {
      status: sql`excluded.status`,
      independentSuccessStreak: sql`excluded.independent_success_streak`,
      lastReviewedAt: sql`case
        when ${childSkillProgress.lastReviewedAt} is null then excluded.last_reviewed_at
        when excluded.last_reviewed_at is null then ${childSkillProgress.lastReviewedAt}
        else greatest(${childSkillProgress.lastReviewedAt}, excluded.last_reviewed_at)
      end`,
      nextReviewAt: sql`excluded.next_review_at`,
      delayedConfirmationAt: null,
      firstIssuedAt: sql`case
        when ${childSkillProgress.firstIssuedAt} is null then excluded.first_issued_at
        when excluded.first_issued_at is null then ${childSkillProgress.firstIssuedAt}
        else least(${childSkillProgress.firstIssuedAt}, excluded.first_issued_at)
      end`,
      hasQualifyingAssessment: sql`${childSkillProgress.hasQualifyingAssessment} or excluded.has_qualifying_assessment`,
      projectionVersion: SKILL_PROJECTION_VERSION,
      updatedAt: sql`excluded.updated_at`,
    },
  });
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
  // Fakty pierwszego wydania dotyczą tylko recall/speech/letter_completion;
  // dla pozostałych ćwiczeń zapytanie o linki zawsze kończyło się pustą listą.
  if (input.exerciseType !== "recall" && input.exerciseType !== "speech" && input.exerciseType !== "letter_completion") return;
  const links = await tx.select({ skill: itemRevisionSkills.skill, skillVersionId: itemRevisionSkills.skillVersionId })
    .from(itemRevisionSkills).where(eq(itemRevisionSkills.itemRevisionId, input.itemRevisionId));
  const scopes: HistoryScope[] = [];
  for (const link of links) {
    const relevant = input.exerciseType === "recall"
      ? link.skill === "recall" || link.skill === "spelling"
      : input.exerciseType === "speech"
        ? link.skill === "pronunciation"
        : input.exerciseType === "letter_completion"
          ? link.skill === "spelling"
          : false;
    if (!relevant) continue;
    scopes.push({
      childId: input.childId,
      skillVersionId: link.skillVersionId,
      skill: link.skill as HistoryScope["skill"],
    });
  }
  if (scopes.length === 0) return;
  // Jeden wielowierszowy upsert zamiast jednego inserta na umiejętność;
  // semantyka per wiersz identyczna jak recordSkillIssued.
  await tx.insert(childSkillProgress).values(scopes.map((scope) => ({
    childId: scope.childId,
    skillVersionId: scope.skillVersionId,
    policyId: input.policyId,
    status: "unseen",
    independentSuccessStreak: 0,
    lastReviewedAt: null,
    nextReviewAt: null,
    delayedConfirmationAt: null,
    firstIssuedAt: input.issuedAt,
    hasQualifyingAssessment: false,
    projectionVersion: SKILL_PROJECTION_VERSION,
    updatedAt: input.issuedAt,
  }))).onConflictDoUpdate({
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
  mode: "monotonic" | "exact" = "monotonic",
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
      lastReviewedAt: mode === "exact" ? sql`excluded.last_reviewed_at` : sql`case
        when ${childSkillProgress.lastReviewedAt} is null then excluded.last_reviewed_at
        when excluded.last_reviewed_at is null then ${childSkillProgress.lastReviewedAt}
        else greatest(${childSkillProgress.lastReviewedAt}, excluded.last_reviewed_at)
      end`,
      nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
      delayedConfirmationAt: null,
      firstIssuedAt: mode === "exact" ? sql`excluded.first_issued_at` : sql`case
        when ${childSkillProgress.firstIssuedAt} is null then excluded.first_issued_at
        when excluded.first_issued_at is null then ${childSkillProgress.firstIssuedAt}
        else least(${childSkillProgress.firstIssuedAt}, excluded.first_issued_at)
      end`,
      hasQualifyingAssessment: mode === "exact" ? sql`excluded.has_qualifying_assessment` : sql`${childSkillProgress.hasQualifyingAssessment} or excluded.has_qualifying_assessment`,
      projectionVersion: SKILL_PROJECTION_VERSION,
      updatedAt: now,
    },
  });
}
