import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../db/client";
import { childSkillProgress, eventExposures, itemRevisionSkills, itemRevisions, learningEvents, learningSessions, sessionTasks } from "../db/schema";
import { projectProgress } from "../domain/progress";
import { deriveSkillWork, type SkillWork } from "../domain/learning-work";
import { computeTargetKey } from "../domain/target-key";
import type { Policy, ProgressStatus, ReadingDirection, Skill } from "../domain/types";
import { payloadToItem } from "./item-payload";
import { readSkillHistories, skillHistoryKey } from "./skill-history";
import type { SkillSnapshot } from "../domain/scheduler";

export interface LearningSnapshotScope {
  childId: string;
  revisionIds: readonly string[];
  policy: Policy;
  now: string;
}

export interface LearningSnapshotItem {
  itemRevisionId: string;
  skillVersionIds: Partial<Record<Skill, string>>;
  progress: Partial<Record<Skill, SkillSnapshot>>;
  work: Partial<Record<"recall" | "spelling" | "pronunciation", SkillWork>>;
  introducedSkills: { recall: boolean; pronunciation: boolean };
  ownPresentationCompleted: boolean;
  readingEvidenceDirections: Partial<Record<ReadingDirection, number>>;
  lastRelevantExposureAt: string | null;
}

function mapProgressStatus(status: string): ProgressStatus {
  switch (status) {
    case "unseen": return "not_assessed";
    case "practicing": return "learning";
    case "needs_confirmation": return "needs_confirmation";
    case "needs_reconfirmation": return "needs_reconfirmation";
    case "mastered": return "mastered";
    default: return "not_assessed";
  }
}

export async function readLearningSnapshot(
  exec: Executor,
  scope: LearningSnapshotScope,
): Promise<readonly LearningSnapshotItem[]> {
  if (scope.revisionIds.length === 0) return [];
  const links = await exec.select({
    itemRevisionId: itemRevisionSkills.itemRevisionId,
    skill: itemRevisionSkills.skill,
    skillVersionId: itemRevisionSkills.skillVersionId,
  }).from(itemRevisionSkills).where(inArray(itemRevisionSkills.itemRevisionId, [...scope.revisionIds]));
  const versions = [...new Set(links.map((link) => link.skillVersionId))];
  const scopes = links.map((link) => ({ childId: scope.childId, skillVersionId: link.skillVersionId, skill: link.skill as Skill }));
  const histories = await readSkillHistories(exec, scopes);
  const linksByRevision = new Map<string, typeof links>();
  for (const link of links) linksByRevision.set(link.itemRevisionId, [...(linksByRevision.get(link.itemRevisionId) ?? []), link]);

  const progressRows = versions.length === 0 ? [] : await exec.select({
    skillVersionId: childSkillProgress.skillVersionId,
    status: childSkillProgress.status,
    nextReviewAt: childSkillProgress.nextReviewAt,
    streak: childSkillProgress.independentSuccessStreak,
  }).from(childSkillProgress).where(and(
    eq(childSkillProgress.childId, scope.childId),
    inArray(childSkillProgress.skillVersionId, versions),
  ));
  const progressByVersion = new Map(progressRows.map((row) => [row.skillVersionId, {
    status: mapProgressStatus(row.status),
    nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    streak: row.streak,
  } satisfies SkillSnapshot]));

  const taskRows = versions.length === 0 ? [] : await exec.select({
    taskId: sessionTasks.id,
    itemRevisionId: sessionTasks.itemRevisionId,
    skill: itemRevisionSkills.skill,
    skillVersionId: itemRevisionSkills.skillVersionId,
    exerciseType: sessionTasks.exerciseType,
    state: sessionTasks.state,
    context: sessionTasks.context,
    issuedAt: sessionTasks.issuedAt,
  }).from(sessionTasks)
    .innerJoin(learningSessions, eq(learningSessions.id, sessionTasks.sessionId))
    .innerJoin(itemRevisionSkills, eq(itemRevisionSkills.itemRevisionId, sessionTasks.itemRevisionId))
    .where(and(
      eq(learningSessions.childId, scope.childId),
      eq(learningSessions.policyId, scope.policy.version),
      inArray(itemRevisionSkills.skillVersionId, versions),
      inArray(sessionTasks.exerciseType, ["recall", "speech", "letter_completion", "exposure"]),
    )).orderBy(asc(sessionTasks.issuedAt));
  const firstIssued = new Map<string, string>();
  const introducedByVersion = new Map<string, { recall: boolean; pronunciation: boolean }>();
  const ownPresentationCompleted = new Set<string>();
  for (const row of taskRows) {
    const flags = introducedByVersion.get(row.skillVersionId) ?? { recall: false, pronunciation: false };
    if (row.exerciseType === "recall") {
      if (row.skill === "recall") flags.recall = true;
      if (row.skill === "recall" || row.skill === "spelling") {
        const key = `${row.skillVersionId}:${row.skill}`;
        if (!firstIssued.has(key)) firstIssued.set(key, row.issuedAt.toISOString());
      }
    } else if (row.exerciseType === "speech") {
      if (row.skill === "pronunciation") {
        flags.pronunciation = true;
        const key = `${row.skillVersionId}:pronunciation`;
        if (!firstIssued.has(key)) firstIssued.set(key, row.issuedAt.toISOString());
      }
    } else if (row.exerciseType === "letter_completion") {
      if (row.skill === "spelling") {
        const key = `${row.skillVersionId}:spelling`;
        if (!firstIssued.has(key)) firstIssued.set(key, row.issuedAt.toISOString());
      }
    }
    introducedByVersion.set(row.skillVersionId, flags);
    if (
      row.exerciseType === "exposure" &&
      row.state === "completed" &&
      (row.context as { reason?: string } | null)?.reason === "new-material" &&
      scope.revisionIds.includes(row.itemRevisionId)
    ) {
      ownPresentationCompleted.add(row.itemRevisionId);
    }
  }

  const revisionRows = await exec.select({ id: itemRevisions.id, payload: itemRevisions.payload })
    .from(itemRevisions).where(inArray(itemRevisions.id, [...scope.revisionIds]));
  const keysByRevision = new Map<string, string[]>();
  const allTargetKeys = new Set<string>();
  for (const revision of revisionRows) {
    const item = payloadToItem(revision.payload as Record<string, unknown>);
    const keys = [item.target, ...item.acceptedAnswers].map((text) => computeTargetKey(text, item.locales.target));
    keysByRevision.set(revision.id, keys);
    for (const key of keys) allTargetKeys.add(key);
  }
  const exposureRows = allTargetKeys.size === 0 ? [] : await exec.select({ targetKey: eventExposures.targetKey, occurredAt: learningEvents.occurredAt })
    .from(eventExposures).innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(and(
      eq(eventExposures.childId, scope.childId),
      eq(learningEvents.sealed, true),
      inArray(eventExposures.targetKey, [...allTargetKeys]),
    ));
  const exposureByKey = new Map<string, string>();
  for (const row of exposureRows) {
    const time = row.occurredAt.toISOString();
    if (time > (exposureByKey.get(row.targetKey) ?? "")) exposureByKey.set(row.targetKey, time);
  }

  return scope.revisionIds.map((itemRevisionId) => {
    const skillVersionIds: LearningSnapshotItem["skillVersionIds"] = {};
    const progress: LearningSnapshotItem["progress"] = {};
    const work: LearningSnapshotItem["work"] = {};
    const readingHistory = (linksByRevision.get(itemRevisionId) ?? []).find((link) => link.skill === "reading");
    let readingEvidenceDirections: Partial<Record<ReadingDirection, number>> = {};
    if (readingHistory) {
      const history = histories.get(skillHistoryKey({ childId: scope.childId, skillVersionId: readingHistory.skillVersionId, skill: "reading" })) ?? [];
      const reading = projectProgress(history, scope.policy, scope.now).skills.reading;
      readingEvidenceDirections = reading?.directions ?? {};
    }
    const keys = keysByRevision.get(itemRevisionId) ?? [];
    const lastRelevantExposureAt = keys.map((key) => exposureByKey.get(key)).filter((value): value is string => value !== undefined).sort().at(-1) ?? null;
    for (const link of linksByRevision.get(itemRevisionId) ?? []) {
      const skill = link.skill as Skill;
      skillVersionIds[skill] = link.skillVersionId;
      const storedSnapshot = progressByVersion.get(link.skillVersionId);
      const history = histories.get(skillHistoryKey({ childId: scope.childId, skillVersionId: link.skillVersionId, skill })) ?? [];
      const policyHistory = history.filter((entry) => entry.policyVersion === scope.policy.version);
      const projected = policyHistory.length > 0
        ? projectProgress(policyHistory, scope.policy, scope.now).skills[skill]
        : undefined;
      const snapshot = projected
        ? { status: projected.status, nextReviewAt: projected.nextReviewAt, streak: projected.streak }
        : storedSnapshot;
      if (snapshot) progress[skill] = snapshot;
      if (skill !== "recall" && skill !== "spelling" && skill !== "pronunciation") continue;
      work[skill] = deriveSkillWork({
        skill,
        progress: snapshot,
        hasQualifyingAssessment: policyHistory.some((entry) => entry.independent && entry.outcome !== "unevaluated"),
        firstIssuedAt: firstIssued.get(`${link.skillVersionId}:${skill}`) ?? null,
        lastRelevantExposureAt,
        now: scope.now,
        policy: scope.policy,
      });
    }
    return {
      itemRevisionId,
      skillVersionIds,
      progress,
      work,
      introducedSkills: {
        recall: introducedByVersion.get(skillVersionIds.recall ?? "")?.recall ?? false,
        pronunciation: introducedByVersion.get(skillVersionIds.pronunciation ?? "")?.pronunciation ?? false,
      },
      ownPresentationCompleted: ownPresentationCompleted.has(itemRevisionId),
      readingEvidenceDirections,
      lastRelevantExposureAt,
    };
  });
}
