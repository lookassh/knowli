import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { KidDeckDto, KidProfileDto } from "@learning/contracts";
import type { Services } from "../config";
import { hasScheduledWork, type DeckWorkloadItem, type SkillSnapshot } from "../domain/scheduler";
import type { Skill } from "../domain/types";
import { assignments, childProfiles, childSkillProgress, decks, itemRevisionSkills, itemRevisions } from "../db/schema";
import { AppError } from "../errors";
import { mapStatus } from "./sessions";

/**
 * Widoki startowe Kid Mode (arch §12): profile dzieci (tylko nazwa i awatar)
 * oraz opublikowane zestawy przypisane dziecku. Model zaufany — bez autoryzacji
 * dziecka (arch §13); wybór profilu nie jest zabezpieczeniem instancji.
 */
export async function listKidProfiles(services: Services): Promise<KidProfileDto[]> {
  const rows = await services.db
    .select({ childId: childProfiles.id, displayName: childProfiles.displayName, avatarKey: childProfiles.avatarKey })
    .from(childProfiles)
    .orderBy(asc(childProfiles.createdAt));
  return rows;
}

export async function listKidDecks(services: Services, childId: string): Promise<KidDeckDto[]> {
  const child = (
    await services.db.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, childId))
  )[0];
  if (!child) {
    throw new AppError("not_found");
  }
  const rows = await services.db
    .select({ deckId: decks.id, title: decks.title, testDate: assignments.testDate, versionId: decks.publishedVersionId })
    .from(assignments)
    .innerJoin(decks, eq(decks.id, assignments.deckId))
    .where(
      and(
        eq(assignments.childId, childId),
        eq(assignments.active, true),
        isNotNull(decks.publishedVersionId),
      ),
    )
    .orderBy(asc(decks.createdAt));
  if (rows.length === 0) {
    return [];
  }

  // Rekomendacja (arch §9.3, §12): czy w wersji jest teraz zaplanowana praca
  // dla tego dziecka? Elementy bez postępu to nowy materiał; rozpoczęte
  // sprawdzamy pod kątem należnych terminów. Utrwalanie dodatkowe jest
  // dostępne zawsze i nie czyni zestawu rekomendowanym.
  const versionIds = rows.map((row) => row.versionId!);
  const revisions = await services.db
    .select({ revisionId: itemRevisions.id, versionId: itemRevisions.deckVersionId })
    .from(itemRevisions)
    .where(inArray(itemRevisions.deckVersionId, versionIds));
  const progressRows = await services.db
    .select({
      revisionId: itemRevisionSkills.itemRevisionId,
      skill: itemRevisionSkills.skill,
      status: childSkillProgress.status,
      nextReviewAt: childSkillProgress.nextReviewAt,
      streak: childSkillProgress.independentSuccessStreak,
    })
    .from(itemRevisionSkills)
    .innerJoin(
      childSkillProgress,
      and(
        eq(childSkillProgress.skillVersionId, itemRevisionSkills.skillVersionId),
        eq(childSkillProgress.childId, childId),
      ),
    )
    .where(
      inArray(
        itemRevisionSkills.itemRevisionId,
        revisions.map((r) => r.revisionId),
      ),
    );

  const progressByRevision = new Map<string, Array<SkillSnapshot & { skill: Skill }>>();
  const independentlyRecalledRevisions = new Set<string>();
  for (const row of progressRows) {
    const list = progressByRevision.get(row.revisionId) ?? [];
    list.push({
      skill: row.skill as Skill,
      status: mapStatus(row.status),
      nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
      streak: row.streak ?? 0,
    });
    progressByRevision.set(row.revisionId, list);
    if (row.skill === "recall" && row.status === "mastered") {
      independentlyRecalledRevisions.add(row.revisionId);
    }
  }
  const now = services.clock.now().toISOString();
  const itemsByVersion = new Map<string, DeckWorkloadItem[]>();
  for (const revision of revisions) {
    const list = itemsByVersion.get(revision.versionId) ?? [];
    list.push({ progress: progressByRevision.get(revision.revisionId) ?? [] });
    itemsByVersion.set(revision.versionId, list);
  }
  const itemCountByVersion = new Map<string, number>();
  const recalledCountByVersion = new Map<string, number>();
  for (const revision of revisions) {
    itemCountByVersion.set(revision.versionId, (itemCountByVersion.get(revision.versionId) ?? 0) + 1);
    if (independentlyRecalledRevisions.has(revision.revisionId)) {
      recalledCountByVersion.set(
        revision.versionId,
        (recalledCountByVersion.get(revision.versionId) ?? 0) + 1,
      );
    }
  }
  return rows.map((row) => ({
    deckId: row.deckId,
    title: row.title,
    itemCount: itemCountByVersion.get(row.versionId!) ?? 0,
    independentlyRecalledCount: recalledCountByVersion.get(row.versionId!) ?? 0,
    testDate: row.testDate,
    recommended: hasScheduledWork(itemsByVersion.get(row.versionId!) ?? [], now),
  }));
}
