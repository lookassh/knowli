import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../../db/client";
import { assessments, attempts, childSkillProgress, childTargetExposures, eventExposures, itemRevisionSkills, itemRevisions, learningEvents, learningSessions, sessionTasks } from "../../db/schema";
import { projectProgress } from "../../domain/progress";
import { rankConfusions, type ConfusionPair, type ConfusionObservation } from "../../domain/confusion-priority";
import { deriveSkillWork, type SkillWork } from "../../domain/learning-work";
import { computeTargetKey, normalizeTargetText } from "../../domain/target-key";
import type { Policy, ProgressStatus, ReadingDirection, Skill } from "../../domain/types";
import { payloadToItem } from "../materials";
import { readSkillHistories, skillHistoryKey } from "./skill-history";
import type { SkillSnapshot } from "../../domain/scheduler";

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
  confusions: readonly ConfusionPair[];
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
    firstIssuedAt: childSkillProgress.firstIssuedAt,
    hasQualifyingAssessment: childSkillProgress.hasQualifyingAssessment,
  }).from(childSkillProgress).where(and(
    eq(childSkillProgress.childId, scope.childId),
    eq(childSkillProgress.policyId, scope.policy.version),
    inArray(childSkillProgress.skillVersionId, versions),
  ));
  const progressByVersion = new Map(progressRows.map((row) => [row.skillVersionId, {
    status: mapProgressStatus(row.status),
    nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    streak: row.streak,
  } satisfies SkillSnapshot]));
  const factsByVersion = new Map(progressRows.map((row) => [row.skillVersionId, row]));

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
  const itemByRevision = new Map(revisionRows.map((revision) => [revision.id, payloadToItem(revision.payload as Record<string, unknown>)]));
  const recognitionRows = await exec.select({
    attemptId: attempts.id,
    receivedAt: attempts.receivedAt,
    childId: attempts.childId,
    expectedItemRevisionId: attempts.itemRevisionId,
    modality: attempts.modality,
    outcome: assessments.outcome,
    reason: assessments.reason,
    details: assessments.details,
    exerciseType: sessionTasks.exerciseType,
    direction: sessionTasks.direction,
  }).from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .where(and(
      eq(assessments.childId, scope.childId),
      inArray(attempts.itemRevisionId, [...scope.revisionIds]),
      inArray(sessionTasks.exerciseType, ["listening", "reading", "reverse_recognition", "picture_recognition"]),
      inArray(assessments.skill, ["listening", "reading"]),
    ));
  const observations: ConfusionObservation[] = recognitionRows.map((row) => {
    const details = row.details as Record<string, unknown>;
    const expected = typeof details.expectedItemRevisionId === "string" ? details.expectedItemRevisionId : row.expectedItemRevisionId;
    let answered = typeof details.answeredItemRevisionId === "string" ? details.answeredItemRevisionId : null;
    if (answered === null) {
      const confusion = details.confusion as { answered?: unknown } | undefined;
      const answerText = typeof confusion?.answered === "string" ? normalizeTargetText(confusion.answered) : null;
      if (answerText !== null) {
        const useSource = row.exerciseType === "listening" || row.direction === "target_to_source";
        const matches = [...itemByRevision].filter(([, item]) => {
          const candidates = useSource ? [item.source] : [item.target, ...item.acceptedAnswers];
          return candidates.some((candidate) => normalizeTargetText(candidate) === answerText);
        }).map(([id]) => id);
        if (matches.length === 1) answered = matches[0]!;
      }
    }
    return {
      attemptId: row.attemptId,
      receivedAt: row.receivedAt.toISOString(),
      childId: row.childId,
      expectedItemRevisionId: expected,
      answeredItemRevisionId: answered,
      exerciseType: row.exerciseType as ConfusionObservation["exerciseType"],
      ...(row.direction === null ? {} : { direction: row.direction as ReadingDirection }),
      reliable: row.modality === "choice" && (row.outcome === "correct" || row.outcome === "incorrect") && row.reason !== "ambiguous" && row.reason !== "technical",
    };
  });
  const confusionPairs = rankConfusions(observations);
  const keysByRevision = new Map<string, string[]>();
  const allTargetKeys = new Set<string>();
  for (const revision of revisionRows) {
    const item = payloadToItem(revision.payload as Record<string, unknown>);
    const keys = [item.target, ...item.acceptedAnswers].map((text) => computeTargetKey(text, item.locales.target));
    keysByRevision.set(revision.id, keys);
    for (const key of keys) allTargetKeys.add(key);
  }
  const exposureRows = allTargetKeys.size === 0 ? [] : await exec.select({ targetKey: childTargetExposures.targetKey, occurredAt: childTargetExposures.lastExposureAt })
    .from(childTargetExposures)
    .where(and(
      eq(childTargetExposures.childId, scope.childId),
      inArray(childTargetExposures.targetKey, [...allTargetKeys]),
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
      const crediblePolicyHistory = policyHistory.filter((entry) => entry.outcome !== "unevaluated");
      const projected = crediblePolicyHistory.length > 0
        ? projectProgress(crediblePolicyHistory, scope.policy, scope.now).skills[skill]
        : undefined;
      const snapshot = projected
        ? { status: projected.status, nextReviewAt: projected.nextReviewAt, streak: projected.streak }
        : storedSnapshot;
      if (snapshot) progress[skill] = snapshot;
      if (skill !== "recall" && skill !== "spelling" && skill !== "pronunciation") continue;
      work[skill] = deriveSkillWork({
        skill,
        progress: snapshot,
        hasQualifyingAssessment: factsByVersion.get(link.skillVersionId)?.hasQualifyingAssessment ?? crediblePolicyHistory.some((entry) => entry.independent),
        firstIssuedAt: factsByVersion.get(link.skillVersionId)?.firstIssuedAt?.toISOString() ?? firstIssued.get(`${link.skillVersionId}:${skill}`) ?? null,
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
      confusions: confusionPairs.filter((pair) => pair.expectedItemRevisionId === itemRevisionId),
    };
  });
}
