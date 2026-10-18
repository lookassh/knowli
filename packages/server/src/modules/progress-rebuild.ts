import { UuidSchema } from "@learning/contracts";
import { and, eq, inArray, max, min } from "drizzle-orm";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  assessments,
  attempts,
  childObjectiveProgress,
  childProfiles,
  childSkillProgress,
  deckVersions,
  itemRevisions,
  learningSessions,
  skillVersions,
  sessionTasks,
  itemRevisionSkills,
  childSkillProgressLegacy,
  childTargetExposures,
  eventExposures,
  learningEvents,
} from "../db/schema";
import type { ProgressStatus, Skill } from "../domain/types";
import { VOCABULARY_SKILLS } from "../domain/types";
import { AppError } from "../errors";
import { loadPolicy } from "../policies/registry";
import { projectProgress } from "../domain/progress";
import { projectObjectiveProgress, lastIndependentObjectiveAt, type ObjectiveHistoryEntry } from "../domain/lessons/progress";
import { readSkillHistories, skillHistoryKey, type HistoryScope } from "./skill-history";
import { SKILL_PROJECTION_VERSION, writeSkillProjection } from "./skill-projections";

export interface RebuildProgressOptions {
  childId?: string;
  apply: boolean;
}

export interface RebuildProgressReport {
  projectionVersion: typeof SKILL_PROJECTION_VERSION;
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
  return { projectionVersion: SKILL_PROJECTION_VERSION, children: 0, examined: 0, inserted: 0, updated: 0, deleted: 0, downgraded: 0, unchanged: 0 };
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
  const issuedRows = await tx.select({
    skillVersionId: itemRevisionSkills.skillVersionId,
    skill: itemRevisionSkills.skill,
    policyId: learningSessions.policyId,
    issuedAt: sessionTasks.issuedAt,
    exerciseType: sessionTasks.exerciseType,
  }).from(sessionTasks)
    .innerJoin(learningSessions, eq(learningSessions.id, sessionTasks.sessionId))
    .innerJoin(itemRevisionSkills, eq(itemRevisionSkills.itemRevisionId, sessionTasks.itemRevisionId))
    .where(and(eq(learningSessions.childId, childId), inArray(sessionTasks.exerciseType, ["recall", "speech", "letter_completion"])));
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
  for (const row of issuedRows) {
    const relevant = row.exerciseType === "recall" ? row.skill === "recall" || row.skill === "spelling"
      : row.exerciseType === "speech" ? row.skill === "pronunciation"
        : row.skill === "spelling";
    if (!relevant) continue;
    const scope: HistoryScope = { childId, skillVersionId: row.skillVersionId, skill: row.skill as Skill };
    scopesByKey.set(skillHistoryKey(scope), scope);
  }
  const scopes = [...scopesByKey.values()];
  const histories = await readSkillHistories(tx, scopes);
  const existingByVersion = new Map(existingRows.map((row) => [`${row.skillVersionId}:${row.policyId}`, row]));
  const policies = new Map<string, Awaited<ReturnType<typeof loadPolicy>>>();
  const report: ChildReport = { examined: scopes.length, inserted: 0, updated: 0, deleted: 0, downgraded: 0, unchanged: 0 };
  const rebuiltKeys = new Set<string>();

  const firstIssuedAt = new Map<string, Date>();
  for (const row of issuedRows) {
    const skills = row.exerciseType === "recall" ? ["recall", "spelling"] : row.exerciseType === "speech" ? ["pronunciation"] : ["spelling"];
    for (const skill of skills) {
      if (row.skill !== skill) continue;
      const key = `${row.skillVersionId}:${row.policyId}:${row.skill}`;
      const at = firstIssuedAt.get(key);
      if (!at || row.issuedAt < at) firstIssuedAt.set(key, row.issuedAt);
    }
  }

  for (const scope of scopes) {
    const key = skillHistoryKey(scope);
    const history = histories.get(key) ?? [];
    const policyVersions = new Set(history.filter(e => e.outcome !== "unevaluated").map(e => e.policyVersion));
    for (const issued of issuedRows) if (issued.skillVersionId === scope.skillVersionId) policyVersions.add(issued.policyId);
    for (const policyVersion of policyVersions) {
      rebuiltKeys.add(`${scope.skillVersionId}:${policyVersion}`);
      let policy = policies.get(policyVersion);
      if (!policy) { policy = await loadPolicy(tx, policyVersion); policies.set(policyVersion, policy); }
      const policyHistory = history.filter((entry) => entry.policyVersion === policyVersion);
      const credible = policyHistory.filter((entry) => entry.outcome !== "unevaluated");
      const latestCredible = credible.reduce<string | null>((latest, entry) => latest === null || entry.receivedAt > latest ? entry.receivedAt : latest, null);
      const projected = projectProgress(policyHistory, policy, now.toISOString()).skills[scope.skill];
      const issuedAt = firstIssuedAt.get(`${scope.skillVersionId}:${policyVersion}:${scope.skill}`) ?? null;
      const existing = existingByVersion.get(`${scope.skillVersionId}:${policyVersion}`);
      if (!projected && !issuedAt) continue;
      const value = projected ?? { status: "not_assessed" as const, streak: 0, nextReviewAt: null };
      const reviewedAt = latestCredible ? new Date(latestCredible) : null;
      const expected = {
        status: dbStatus(value.status), streak: value.streak,
        lastReviewedAt: reviewedAt,
        nextReviewAt: value.nextReviewAt === null ? null : new Date(value.nextReviewAt),
        projectionVersion: SKILL_PROJECTION_VERSION,
      };
      if (!existing) { report.inserted += 1; }
      else if (existing.status === expected.status && existing.independentSuccessStreak === expected.streak && asIso(existing.lastReviewedAt) === asIso(expected.lastReviewedAt) && asIso(existing.nextReviewAt) === asIso(expected.nextReviewAt) && existing.delayedConfirmationAt === null && existing.projectionVersion === expected.projectionVersion && asIso(existing.firstIssuedAt) === asIso(issuedAt) && existing.hasQualifyingAssessment === credible.some(e => e.independent)) { report.unchanged += 1; continue; }
      else { report.updated += 1; if (isDowngrade(existing, expected.status, expected.streak)) report.downgraded += 1; }
      if (apply) await writeSkillProjection(tx, scope, policyVersion, value, reviewedAt, now, issuedAt, credible.some(e => e.independent), "exact");
    }
  }

  for (const row of existingRows) {
    if (rebuiltKeys.has(`${row.skillVersionId}:${row.policyId}`)) continue;
    report.deleted += 1;
    if (apply) await tx.delete(childSkillProgress).where(and(
      eq(childSkillProgress.childId, childId), eq(childSkillProgress.skillVersionId, row.skillVersionId), eq(childSkillProgress.policyId, row.policyId),
    ));
  }

  const exposureFacts = await tx.select({ targetKey: eventExposures.targetKey, firstAt: min(learningEvents.occurredAt), lastAt: max(learningEvents.occurredAt) })
    .from(eventExposures).innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(and(eq(eventExposures.childId, childId), eq(learningEvents.sealed, true)))
    .groupBy(eventExposures.targetKey);
  if (apply) {
    await tx.delete(childTargetExposures).where(eq(childTargetExposures.childId, childId));
    if (exposureFacts.length) await tx.insert(childTargetExposures).values(exposureFacts.flatMap(row => row.firstAt && row.lastAt ? [{
      childId, targetKey: row.targetKey, firstExposureAt: row.firstAt, lastExposureAt: row.lastAt,
    }] : []));
  }

  if (apply) {
    await tx.update(childProfiles).set({ learningProjectionVersion: SKILL_PROJECTION_VERSION }).where(eq(childProfiles.id, childId));
    await tx.delete(childSkillProgressLegacy).where(eq(childSkillProgressLegacy.childId, childId));
  }

  // Cele lekcji w tej samej transakcji (jedno przejście): projekcja
  // child_objective_progress z ocen skill='objective'. Słówka wyżej i cele tu
  // dzielą transakcję/blokadę per dziecko i te same odmowy (aktywna sesja /
  // processing sprawdzone na początku rebuildChild).
  await rebuildChildObjectives(tx, childId, apply, now, report);
  return report;
}

/** Historia ocen celu dziecka do odbudowy (bieżąca wersja polityki filtruje projektor). */
interface ObjectiveRebuildEntry extends ObjectiveHistoryEntry {
  subjectId: string;
  topicId: string;
}

type ObjectiveProgressRow = typeof childObjectiveProgress.$inferSelect;

/**
 * Odbudowa `child_objective_progress` dziecka z ocen celów. Analogiczna do
 * słówek, ale projekcja per cel (`projectObjectiveProgress`) i klucz
 * (child, subject, objective). `lastIndependentAt` z historii (ostatni
 * niezależny sukces). Osierocone projekcje (brak dowodu) kasowane. Statusy w
 * słowniku bazy; wersja projekcji = wersja polityki ostatniego wiarygodnego
 * dowodu, jak ścieżka przyrostowa (lesson-attempts.projectAndUpsertObjective).
 */
async function rebuildChildObjectives(
  tx: Tx,
  childId: string,
  apply: boolean,
  now: Date,
  report: ChildReport,
): Promise<void> {
  const rows = await tx
    .select({
      receivedAt: attempts.receivedAt,
      policyId: attempts.policyId,
      itemId: itemRevisions.itemId,
      outcome: assessments.outcome,
      reason: assessments.reason,
      independent: assessments.independent,
      confirmationEligible: assessments.confirmationEligible,
      details: assessments.details,
      lessonContext: deckVersions.lessonContext,
    })
    .from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .innerJoin(itemRevisions, eq(itemRevisions.id, assessments.itemRevisionId))
    .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
    .where(and(eq(assessments.childId, childId), eq(assessments.skill, "objective")));

  // Wersja polityki WPROST z rekordu polityki (jak objectiveHistory), cache per id.
  const versionByPolicyId = new Map<string, string>();
  const resolveVersion = async (policyId: string): Promise<string> => {
    const cached = versionByPolicyId.get(policyId);
    if (cached !== undefined) return cached;
    const version = (await loadPolicy(tx, policyId)).version;
    versionByPolicyId.set(policyId, version);
    return version;
  };

  // Grupy per (subject, objective) z zachowaniem topicId.
  const byKey = new Map<string, ObjectiveRebuildEntry[]>();
  const keyMeta = new Map<string, { subjectId: string; objectiveId: string; topicId: string }>();
  for (const row of rows) {
    const context = (row.lessonContext ?? {}) as { subjectId?: string; topicId?: string };
    const details = (row.details ?? {}) as { objectiveId?: string };
    const subjectId = context.subjectId ?? "";
    const topicId = context.topicId ?? "";
    const objectiveId = details.objectiveId ?? "";
    if (!subjectId || !objectiveId) continue; // niespójny dowód — pomiń, nie zgaduj
    const key = `${subjectId}\u0000${objectiveId}`;
    const list = byKey.get(key) ?? [];
    list.push({
      receivedAt: row.receivedAt.toISOString(),
      policyVersion: await resolveVersion(row.policyId),
      objectiveId,
      itemId: row.itemId,
      outcome: row.outcome === "unassessed" ? "unevaluated" : (row.outcome as ObjectiveHistoryEntry["outcome"]),
      ...(row.reason ? { reason: row.reason } : {}),
      independent: row.independent,
      confirmationEligible: row.confirmationEligible,
      subjectId,
      topicId,
    });
    byKey.set(key, list);
    keyMeta.set(key, { subjectId, objectiveId, topicId });
  }

  const existingRows = await tx.select().from(childObjectiveProgress).where(eq(childObjectiveProgress.childId, childId));
  const existingByKey = new Map<string, ObjectiveProgressRow>();
  for (const row of existingRows) existingByKey.set(`${row.subjectId}\u0000${row.objectiveId}`, row);

  const policies = new Map<string, Awaited<ReturnType<typeof loadPolicy>>>();
  const seenKeys = new Set<string>();

  for (const [key, entries] of byKey) {
    seenKeys.add(key);
    const meta = keyMeta.get(key)!;
    const existing = existingByKey.get(key);
    const latestCredible = entries
      .filter((e) => e.outcome !== "unevaluated")
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
      .at(-1);
    if (!latestCredible) {
      if (existing) {
        report.deleted += 1;
        if (apply) await tx.delete(childObjectiveProgress).where(and(
          eq(childObjectiveProgress.childId, childId),
          eq(childObjectiveProgress.subjectId, meta.subjectId),
          eq(childObjectiveProgress.objectiveId, meta.objectiveId),
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
    const projected = projectObjectiveProgress(entries, policy, now.toISOString())[meta.objectiveId];
    if (!projected) { report.unchanged += 1; continue; }
    const lastIndependentAt = lastIndependentObjectiveAt(entries, policy.version);
    const expected = {
      status: dbStatus(projected.status),
      streak: projected.streak,
      nextReviewAt: projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt),
      lastIndependentAt: lastIndependentAt ? new Date(lastIndependentAt) : null,
      projectionVersion: policy.version,
    };
    if (!existing) {
      report.inserted += 1;
      if (apply) await writeObjectiveProjection(tx, childId, meta, expected, now);
    } else if (objectiveMatches(existing, expected)) {
      report.unchanged += 1;
    } else {
      report.updated += 1;
      if (objectiveMasteryRank(expected.status) < objectiveMasteryRank(existing.status) || expected.streak < existing.streak) {
        report.downgraded += 1;
      }
      if (apply) await writeObjectiveProjection(tx, childId, meta, expected, now);
    }
  }

  // Osierocone projekcje: cel bez żadnego dowodu w ocenach → skasuj.
  for (const [key, existing] of existingByKey) {
    if (seenKeys.has(key)) continue;
    report.deleted += 1;
    if (apply) await tx.delete(childObjectiveProgress).where(and(
      eq(childObjectiveProgress.childId, childId),
      eq(childObjectiveProgress.subjectId, existing.subjectId),
      eq(childObjectiveProgress.objectiveId, existing.objectiveId),
    ));
  }
}

interface ExpectedObjective {
  status: string;
  streak: number;
  nextReviewAt: Date | null;
  lastIndependentAt: Date | null;
  projectionVersion: string;
}

function objectiveMatches(existing: ObjectiveProgressRow, expected: ExpectedObjective): boolean {
  return existing.status === expected.status &&
    existing.streak === expected.streak &&
    asIso(existing.nextReviewAt) === asIso(expected.nextReviewAt) &&
    asIso(existing.lastIndependentAt) === asIso(expected.lastIndependentAt) &&
    existing.projectionVersion === expected.projectionVersion;
}

function objectiveMasteryRank(status: string): number {
  return masteryRank(status);
}

async function writeObjectiveProjection(
  tx: Tx,
  childId: string,
  meta: { subjectId: string; objectiveId: string; topicId: string },
  expected: ExpectedObjective,
  now: Date,
): Promise<void> {
  await tx
    .insert(childObjectiveProgress)
    .values({
      childId,
      subjectId: meta.subjectId,
      objectiveId: meta.objectiveId,
      topicId: meta.topicId,
      status: expected.status,
      streak: expected.streak,
      nextReviewAt: expected.nextReviewAt,
      lastIndependentAt: expected.lastIndependentAt,
      projectionVersion: expected.projectionVersion,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [childObjectiveProgress.childId, childObjectiveProgress.subjectId, childObjectiveProgress.objectiveId],
      set: {
        topicId: meta.topicId,
        status: expected.status,
        streak: expected.streak,
        nextReviewAt: expected.nextReviewAt,
        lastIndependentAt: expected.lastIndependentAt,
        projectionVersion: expected.projectionVersion,
        updatedAt: now,
      },
    });
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
