import { and, eq, inArray, lte } from "drizzle-orm";
import type { Executor } from "../../db/client";
import { childSkillProgress, childTargetExposures, itemRevisionSkills, itemRevisions } from "../../db/schema";
import { deriveSkillWork, type SkillWork } from "../../domain/learning-work";
import type { SkillSnapshot } from "../../domain/scheduler";
import { computeTargetKey } from "../../domain/target-key";
import type { Policy, Skill } from "../../domain/types";
import { AppError } from "../../errors";
import { payloadToItem } from "../materials";
import { SKILL_PROJECTION_VERSION } from "../learning";

export interface DeckLearningOverviewItem {
  itemRevisionId: string;
  progress: Partial<Record<Skill, SkillSnapshot>>;
  work: Partial<Record<"recall" | "spelling" | "pronunciation", SkillWork>>;
  introducedSkills: { recall: boolean; pronunciation: boolean };
}

function statusOf(status: string): SkillSnapshot["status"] {
  switch (status) {
    case "unseen": return "not_assessed";
    case "practicing": return "learning";
    default: return status as SkillSnapshot["status"];
  }
}

/** One fact per target, regardless of the number of historical disclosures. */
export async function readProjectedExposedTargetKeys(
  exec: Executor, childId: string, targetKeys: readonly string[], now: Date,
): Promise<ReadonlySet<string>> {
  if (!targetKeys.length) return new Set();
  const rows = await exec.select({ targetKey: childTargetExposures.targetKey })
    .from(childTargetExposures).where(and(
      eq(childTargetExposures.childId, childId),
      inArray(childTargetExposures.targetKey, [...targetKeys]),
      lte(childTargetExposures.firstExposureAt, now),
    ));
  return new Set(rows.map(row => row.targetKey));
}

/** Bounded list projection: no attempts, historical tasks, grades or event replay. */
export async function readDeckLearningOverview(
  exec: Executor,
  input: {
    childId: string;
    revisionIds: readonly string[];
    policy: Policy;
    now: string;
    revisions?: readonly { id: string; payload: Record<string, unknown> }[];
  },
): Promise<readonly DeckLearningOverviewItem[]> {
  if (!input.revisionIds.length) return [];
  const links = await exec.select({
    revisionId: itemRevisionSkills.itemRevisionId,
    skill: itemRevisionSkills.skill,
    skillVersionId: itemRevisionSkills.skillVersionId,
  }).from(itemRevisionSkills).where(inArray(itemRevisionSkills.itemRevisionId, [...input.revisionIds]));
  const versions = [...new Set(links.map(link => link.skillVersionId))];
  const progressRows = versions.length ? await exec.select({
    skillVersionId: childSkillProgress.skillVersionId,
    status: childSkillProgress.status,
    nextReviewAt: childSkillProgress.nextReviewAt,
    streak: childSkillProgress.independentSuccessStreak,
    firstIssuedAt: childSkillProgress.firstIssuedAt,
    hasQualifyingAssessment: childSkillProgress.hasQualifyingAssessment,
    projectionVersion: childSkillProgress.projectionVersion,
  }).from(childSkillProgress).where(and(
    eq(childSkillProgress.childId, input.childId),
    eq(childSkillProgress.policyId, input.policy.version),
    inArray(childSkillProgress.skillVersionId, versions),
  )) : [];
  if (progressRows.some(row => row.projectionVersion !== SKILL_PROJECTION_VERSION)) {
    throw new AppError("conflict", { message: "learning projection rebuild required" });
  }
  const rowByVersion = new Map(progressRows.map(row => [row.skillVersionId, row]));
  const linksByRevision = new Map<string, typeof links>();
  for (const link of links) {
    const list = linksByRevision.get(link.revisionId) ?? [];
    list.push(link);
    linksByRevision.set(link.revisionId, list);
  }
  const wanted = new Set(input.revisionIds);
  const revisions = input.revisions?.filter(row => wanted.has(row.id)) ?? await exec.select({
    id: itemRevisions.id, payload: itemRevisions.payload,
  }).from(itemRevisions).where(inArray(itemRevisions.id, [...input.revisionIds]));
  const keysByRevision = new Map<string, string[]>();
  const keys = new Set<string>();
  for (const revision of revisions) {
    const item = payloadToItem(revision.payload);
    const itemKeys = [item.target, ...item.acceptedAnswers].map(text => computeTargetKey(text, item.locales.target));
    keysByRevision.set(revision.id, itemKeys);
    for (const key of itemKeys) keys.add(key);
  }
  const exposures = keys.size ? await exec.select({
    targetKey: childTargetExposures.targetKey, last: childTargetExposures.lastExposureAt,
  }).from(childTargetExposures).where(and(
    eq(childTargetExposures.childId, input.childId),
    inArray(childTargetExposures.targetKey, [...keys]),
  )) : [];
  const exposureByKey = new Map(exposures.map(row => [row.targetKey, row.last.toISOString()]));
  return input.revisionIds.map(itemRevisionId => {
    const progress: DeckLearningOverviewItem["progress"] = {};
    const work: DeckLearningOverviewItem["work"] = {};
    const introducedSkills = { recall: false, pronunciation: false };
    const lastRelevantExposureAt = (keysByRevision.get(itemRevisionId) ?? [])
      .map(key => exposureByKey.get(key)).filter((time): time is string => time !== undefined).sort().at(-1) ?? null;
    for (const link of linksByRevision.get(itemRevisionId) ?? []) {
      const skill = link.skill as Skill;
      const row = rowByVersion.get(link.skillVersionId);
      const snapshot = row ? {
        status: statusOf(row.status), nextReviewAt: row.nextReviewAt?.toISOString() ?? null, streak: row.streak,
      } : undefined;
      if (snapshot) progress[skill] = snapshot;
      if (skill === "recall" || skill === "pronunciation") introducedSkills[skill] = row?.firstIssuedAt != null;
      if (skill === "recall" || skill === "spelling" || skill === "pronunciation") {
        work[skill] = deriveSkillWork({
          skill, progress: snapshot, hasQualifyingAssessment: row?.hasQualifyingAssessment ?? false,
          firstIssuedAt: row?.firstIssuedAt?.toISOString() ?? null,
          lastRelevantExposureAt, now: input.now, policy: input.policy,
        });
      }
    }
    return { itemRevisionId, progress, work, introducedSkills };
  });
}
