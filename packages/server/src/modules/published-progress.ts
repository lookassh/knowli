import { asc, eq, inArray } from "drizzle-orm";
import {
  REPORT_SKILLS,
  type ItemSkillStatus,
  type ProgressItemDto,
  type SkillReportDto,
  type ReportSkill,
} from "@learning/contracts";
import type { Executor } from "../db/client";
import { childProfiles, childSkillProgress, decks, deckVersions, itemRevisions, itemRevisionSkills, skillVersions } from "../db/schema";
import { AppError } from "../errors";

export type PublishedProgress = {
  deckId: string;
  deckVersionId: string;
  deckTitle: string;
  deckVersionNumber: number;
  totalItems: number;
  items: ProgressItemDto[];
  skills: SkillReportDto[];
};

interface RevisionRow {
  id: string;
  itemId: string;
  position: number;
  payload: Record<string, unknown>;
}

function wordsOf(payload: Record<string, unknown>): { source: string; target: string } {
  return {
    source: typeof payload.source === "string" ? payload.source : "",
    target: typeof payload.target === "string" ? payload.target : "",
  };
}

export async function readDeckRevisionIds(exec: Executor, deckId: string): Promise<string[]> {
  const rows = await exec.select({ id: itemRevisions.id })
    .from(itemRevisions)
    .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
    .where(eq(deckVersions.deckId, deckId));
  return rows.map(({ id }) => id);
}

export async function readPublishedProgress(
  exec: Executor,
  childId: string,
  deckId: string,
): Promise<PublishedProgress> {
  const profile = (await exec.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, childId)))[0];
  const deck = (await exec.select().from(decks).where(eq(decks.id, deckId)))[0];
  if (!profile || !deck || !deck.publishedVersionId) throw new AppError("not_found");
  const version = (await exec.select({
    id: deckVersions.id,
    title: deckVersions.title,
    versionNumber: deckVersions.versionNumber,
  }).from(deckVersions).where(eq(deckVersions.id, deck.publishedVersionId)))[0];
  if (!version) throw new AppError("not_found");

  const revisions = (await exec.select({
    id: itemRevisions.id,
    itemId: itemRevisions.itemId,
    position: itemRevisions.position,
    payload: itemRevisions.payload,
  }).from(itemRevisions).where(eq(itemRevisions.deckVersionId, version.id)).orderBy(asc(itemRevisions.position))) as RevisionRow[];
  const revisionIds = revisions.map(({ id }) => id);
  const skillLinks = revisionIds.length
    ? await exec.select({
        itemRevisionId: itemRevisionSkills.itemRevisionId,
        skill: itemRevisionSkills.skill,
        skillVersionId: itemRevisionSkills.skillVersionId,
      }).from(itemRevisionSkills).where(inArray(itemRevisionSkills.itemRevisionId, revisionIds))
    : [];
  const versionByRevision = new Map(skillLinks.map((link) => [`${link.itemRevisionId}:${link.skill}`, link.skillVersionId]));
  const itemIds = [...new Set(revisions.map(({ itemId }) => itemId))];
  const versions = itemIds.length
    ? await exec.select({ id: skillVersions.id, predecessorId: skillVersions.predecessorId })
        .from(skillVersions).where(inArray(skillVersions.itemId, itemIds))
    : [];
  const predecessorOf = new Map(versions.map((item) => [item.id, item.predecessorId]));
  const projected = await exec.select({ skillVersionId: childSkillProgress.skillVersionId, status: childSkillProgress.status })
    .from(childSkillProgress).where(eq(childSkillProgress.childId, childId));
  const statusOfVersion = new Map(projected.map(({ skillVersionId, status }) => [skillVersionId, status]));

  const statusFor = (skillVersionId: string): { status: ItemSkillStatus; changed: boolean } => {
    const status = statusOfVersion.get(skillVersionId);
    if (status && ["mastered", "needs_confirmation", "needs_reconfirmation", "practicing"].includes(status)) {
      return { status: status as ItemSkillStatus, changed: false };
    }
    let predecessor = predecessorOf.get(skillVersionId) ?? null;
    while (predecessor !== null) {
      const previousStatus = statusOfVersion.get(predecessor);
      if (previousStatus && previousStatus !== "unseen") return { status: "needs_confirmation", changed: true };
      predecessor = predecessorOf.get(predecessor) ?? null;
    }
    return { status: "not_assessed", changed: false };
  };

  const items: ProgressItemDto[] = revisions.map((revision) => {
    const skills = {} as Record<ReportSkill, ItemSkillStatus>;
    for (const skill of REPORT_SKILLS) {
      const skillVersionId = versionByRevision.get(`${revision.id}:${skill}`);
      skills[skill] = skillVersionId ? statusFor(skillVersionId).status : "not_assessed";
    }
    return { itemId: revision.itemId, position: revision.position, ...wordsOf(revision.payload), skills, meaningChanged: REPORT_SKILLS.some((skill) => {
      const skillVersionId = versionByRevision.get(`${revision.id}:${skill}`);
      return skillVersionId ? statusFor(skillVersionId).changed : false;
    }) };
  });

  const skills: SkillReportDto[] = REPORT_SKILLS.map((skill) => {
    const counts = { mastered: 0, needs_confirmation: 0, needs_reconfirmation: 0, practicing: 0, not_assessed: 0 };
    for (const item of items) counts[item.skills[skill]] += 1;
    return {
      skill,
      totalItems: items.length,
      mastered: counts.mastered,
      needsConfirmation: counts.needs_confirmation,
      needsReconfirmation: counts.needs_reconfirmation,
      practicing: counts.practicing,
      notAssessed: counts.not_assessed,
    };
  });
  return {
    deckId,
    deckVersionId: version.id,
    deckTitle: version.title,
    deckVersionNumber: version.versionNumber,
    totalItems: items.length,
    items,
    skills,
  };
}
