import { and, asc, eq } from "drizzle-orm";
import type { Executor } from "../db/client";
import { deckVersions, familySettings, learningSessions, sessionTasks } from "../db/schema";
import { localDateAt, validRewardTimezone } from "../domain/reward-activity";

export interface DailyRoundPool {
  date: string;
  timezone: string;
  deckVersionId: string;
  revisionIds: string[];
}

/** Today's issued tasks are the contact ledger; only their pinned revisions can enter the round. */
export async function readDailyRoundPool(
  db: Executor,
  childId: string,
  deckId: string,
  now: Date,
): Promise<DailyRoundPool | null> {
  const [family] = await db.select({ timezone: familySettings.timezone }).from(familySettings).limit(1);
  const timezone = validRewardTimezone(family?.timezone);
  const date = localDateAt(now, timezone);
  const rows = await db.select({
    revisionId: sessionTasks.itemRevisionId,
    deckVersionId: sessionTasks.deckVersionId,
    versionNumber: deckVersions.versionNumber,
    ordinal: sessionTasks.ordinal,
    issuedAt: sessionTasks.issuedAt,
  }).from(sessionTasks)
    .innerJoin(learningSessions, eq(learningSessions.id, sessionTasks.sessionId))
    .innerJoin(deckVersions, eq(deckVersions.id, sessionTasks.deckVersionId))
    .where(and(eq(learningSessions.childId, childId), eq(learningSessions.deckId, deckId)))
    .orderBy(asc(sessionTasks.issuedAt), asc(deckVersions.versionNumber), asc(sessionTasks.ordinal));
  const today = rows.filter(row => localDateAt(row.issuedAt, timezone) === date);
  if (today.length === 0) return null;
  const latest = today[today.length - 1]!;
  const revisionIds = [...new Set(today.filter(row => row.deckVersionId === latest.deckVersionId).reverse().map(row => row.revisionId))].slice(0, 3);
  if (revisionIds.length === 0) return null;
  return { date, timezone, deckVersionId: latest.deckVersionId, revisionIds };
}

export async function hasDailyRoundForDate(db: Executor, childId: string, date: string): Promise<boolean> {
  const rows = await db.select({ id: learningSessions.id }).from(learningSessions).where(and(
    eq(learningSessions.childId, childId), eq(learningSessions.mode, "daily_round"), eq(learningSessions.dailyRoundDate, date),
  )).limit(1);
  return rows.length > 0;
}
