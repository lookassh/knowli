import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Services } from "../../config";
import type { Executor } from "../../db/client";
import { childObjectiveProgress, eventExposures, itemRevisions, learningEvents } from "../../db/schema";
import { planLessonMockTest, toLessonMockPoolEntry, type LessonMockPoolEntry } from "../../domain/lessons/mock-test-plan";
import { mapObjectiveStatus } from "../../domain/lessons/progress-status";
import type { LessonContextShape } from "./lesson-sessions";
import { requireTopic } from "./lesson-sessions";

/** Dane przypisanej, widocznej lekcji już pobrane przez właściciela listy. */
export interface LessonDeckOverviewInput {
  deckId: string;
  versionId: string;
  testDate: string | null;
  testGoals: readonly string[] | null;
  mockTestTaskCount: number | null;
  lessonContext: LessonContextShape;
}

export interface LessonDeckOverview {
  itemCount: number;
  independentlyRecalledCount: number;
  recommended: boolean;
  mockTestAvailable: boolean;
}

export type ReadExposedLessonTargetKeys = (args: {
  exec: Executor;
  childId: string;
  targetKeys: readonly string[];
  now: Date;
}) => Promise<ReadonlySet<string>>;

/** Zbiorczy fallback do historii; można podmienić na odczyt projekcji ekspozycji. */
export const readSealedLessonTargetKeys: ReadExposedLessonTargetKeys = async ({ exec, childId, targetKeys, now }) => {
  if (targetKeys.length === 0) return new Set();
  const rows = await exec
    .select({ targetKey: eventExposures.targetKey })
    .from(eventExposures)
    .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(and(
      eq(eventExposures.childId, childId),
      eq(learningEvents.sealed, true),
      lte(learningEvents.occurredAt, now),
      inArray(eventExposures.targetKey, [...targetKeys]),
    )).groupBy(eventExposures.targetKey);
  return new Set<string>(rows.map((row: { targetKey: string }) => row.targetKey));
};

/**
 * Czyta wartości listy lekcji jednym zestawem odczytów, niezależnie od liczby
 * lekcji. Nie ładuje treści ćwiczeń ani zasobów audio; planer dostaje wyłącznie
 * klucze i identyfikatory potrzebne do bezpiecznej selekcji kartkówki.
 */
export async function readLessonDeckOverviews(
  services: Services,
  exec: Executor,
  input: {
    childId: string;
    now: Date;
    decks: readonly LessonDeckOverviewInput[];
    readExposedTargetKeys?: ReadExposedLessonTargetKeys;
  },
): Promise<Map<string, LessonDeckOverview>> {
  const result = new Map<string, LessonDeckOverview>();
  if (input.decks.length === 0) return result;

  const topicByDeck = new Map<string, { objectiveOrder: string[]; subjectId: string }>();
  const subjectIds = new Set<string>();
  for (const deck of input.decks) {
    const { topic } = requireTopic(services, deck.lessonContext);
    const objectiveOrder = topic.objectives.map((objective) => objective.id)
      .filter((id) => deck.lessonContext.objectiveIds.includes(id));
    topicByDeck.set(deck.deckId, { objectiveOrder, subjectId: deck.lessonContext.subjectId });
    subjectIds.add(deck.lessonContext.subjectId);
  }

  const versionIds = [...new Set(input.decks.map((deck) => deck.versionId))];
  const versionIdSet = new Set(versionIds);
  const revisionRows = await exec.select({
    itemRevisionId: itemRevisions.id,
    itemId: itemRevisions.itemId,
    versionId: itemRevisions.deckVersionId,
    objectiveId: sql<string | null>`${itemRevisions.payload}->>'objectiveId'`,
    exerciseType: sql<string | null>`${itemRevisions.payload}->>'exerciseType'`,
    targetKey: itemRevisions.targetKey,
  }).from(itemRevisions)
    .where(inArray(itemRevisions.deckVersionId, versionIds))
    .orderBy(asc(itemRevisions.position), asc(itemRevisions.id));

  const poolByVersion = new Map<string, LessonMockPoolEntry[]>();
  const objectiveIdsWithExercisesByVersion = new Map<string, Set<string>>();
  const targetKeys = new Set<string>();
  for (const row of revisionRows) {
    if (!row.objectiveId || !row.exerciseType || !row.targetKey) continue;
    if (!versionIdSet.has(row.versionId)) continue;
    const entry = toLessonMockPoolEntry({
      itemId: row.itemId,
      itemRevisionId: row.itemRevisionId,
      objectiveId: row.objectiveId,
      exerciseType: row.exerciseType as LessonMockPoolEntry["exerciseType"],
      targetKey: row.targetKey,
    });
    const pool = poolByVersion.get(row.versionId) ?? [];
    pool.push(entry);
    poolByVersion.set(row.versionId, pool);
    const objectives = objectiveIdsWithExercisesByVersion.get(row.versionId) ?? new Set<string>();
    objectives.add(row.objectiveId);
    objectiveIdsWithExercisesByVersion.set(row.versionId, objectives);
    targetKeys.add(row.targetKey);
  }

  const subjectList = [...subjectIds];
  const progressRows = subjectList.length
    ? await exec.select({
      subjectId: childObjectiveProgress.subjectId,
      objectiveId: childObjectiveProgress.objectiveId,
      status: childObjectiveProgress.status,
      nextReviewAt: childObjectiveProgress.nextReviewAt,
    }).from(childObjectiveProgress)
      .where(and(eq(childObjectiveProgress.childId, input.childId), inArray(childObjectiveProgress.subjectId, subjectList)))
    : [];
  const progressBySubject = new Map<string, Map<string, { status: ReturnType<typeof mapObjectiveStatus>; nextReviewAt: string | null }>>();
  for (const row of progressRows) {
    const progress = progressBySubject.get(row.subjectId) ?? new Map();
    progress.set(row.objectiveId, {
      status: mapObjectiveStatus(row.status),
      nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    });
    progressBySubject.set(row.subjectId, progress);
  }

  const hasMockGoal = input.decks.some((deck) => deck.testGoals?.includes("lesson"));
  const exposed = hasMockGoal
    ? await (input.readExposedTargetKeys ?? readSealedLessonTargetKeys)({
      exec, childId: input.childId, targetKeys: [...targetKeys], now: input.now,
    })
    : new Set<string>();
  const nowIso = input.now.toISOString();

  for (const deck of input.decks) {
    const topic = topicByDeck.get(deck.deckId)!;
    const progress = progressBySubject.get(topic.subjectId) ?? new Map();
    const objectiveIdsWithExercises = objectiveIdsWithExercisesByVersion.get(deck.versionId) ?? new Set<string>();
    const masteredCount = topic.objectiveOrder.filter((id) => progress.get(id)?.status === "mastered").length;
    const recommended = topic.objectiveOrder.some((id) => {
      if (!objectiveIdsWithExercises.has(id)) return false;
      const objectiveProgress = progress.get(id);
      if (!objectiveProgress || objectiveProgress.status === "not_assessed") return true;
      if (objectiveProgress.status !== "mastered") return true;
      return objectiveProgress.nextReviewAt !== null && objectiveProgress.nextReviewAt <= nowIso;
    });
    const mockTestAvailable = Boolean(deck.testGoals?.includes("lesson")) && planLessonMockTest({
      pool: poolByVersion.get(deck.versionId) ?? [],
      objectiveIds: topic.objectiveOrder,
      requestedCount: deck.mockTestTaskCount ?? 10,
      exposedTargetKeys: [...exposed],
    }).length > 0;
    result.set(deck.deckId, {
      itemCount: topic.objectiveOrder.length,
      independentlyRecalledCount: masteredCount,
      recommended,
      mockTestAvailable,
    });
  }
  return result;
}
