import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { KidDeckDto, KidProfileDto } from "@learning/contracts";
import type { Services } from "../config";
import { assignments, childProfiles, decks } from "../db/schema";
import { AppError } from "../errors";

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
  return services.db
    .select({ deckId: decks.id, title: decks.title, testDate: assignments.testDate })
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
}
