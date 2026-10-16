import { randomInt, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, max } from "drizzle-orm";
import {
  PresentationCompletionInputSchema,
  SessionInputSchema,
  SessionSummaryDtoSchema,
  UuidSchema,
  type PresentationCompletionDto,
  type PresentationCompletionInput,
  type SessionDto,
  type SessionInput,
  type SessionSummaryDto,
  type TaskDto,
  type TaskPrompt,
  type TestGoal,
  type VisualType,
  type MeaningVisual,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  assessments,
  assignments,
  attempts,
  childProfiles,
  childSkillProgress,
  deckVersions,
  decks,
  eventExposures,
  familySettings,
  itemRevisions,
  itemRevisionSkills,
  learningEvents,
  learningSessions,
  revisionAssets,
  sessionTasks,
} from "../db/schema";
import { AppError } from "../errors";
import {
  selectTask,
  type ScheduleCandidate,
  type ScheduleReason,
  type SkillSnapshot,
  type TaskPlan,
} from "../domain/scheduler";
import type { ProgressStatus, ReadingDirection, Skill } from "../domain/types";
import { loadPolicy, ensureLearningPolicy, CURRENT_POLICY_ID } from "../policies/registry";
import { lockTaskWithSession, writeSealedEvent, contextOf, type SessionContextShape } from "./events";
import { payloadToItem } from "./item-payload";
import { summarizeSessionAssessments } from "../domain/session-summary";
import { computeTargetKey } from "../domain/target-key";
import { buildLetterFragment } from "../domain/letter-fragment";
import { MeaningVisualSchema } from "@learning/contracts";
import { readUiAudio } from "./ui-audio";
import { getVocabularyCapabilities } from "../domain/vocabulary-capabilities";
import { addLegacyTaskPromptDefaults } from "./task-prompt-compat";
import { deriveSupportStates, type SupportAttempt, type SupportTask } from "../domain/support-cycle";
import { isDailyRoundFailureFeedback } from "../domain/feedback";
import { readLearningSnapshot } from "./learning-snapshot";
import { createMockTestPlan, issueMockTestTask, closeMockTest } from "./mock-tests";
import { assertVocabularyDeck, readVersionDeckKind, type DeckKind } from "./deck-kind";
import {
  buildLessonSessionContext,
  hasSchedulableDailyRoundTask,
  issueNextLessonTask,
  lessonTaskCounts,
} from "./lessons/lesson-sessions";
import {
  createLessonMockTestPlan,
  issueLessonMockTestTask,
  closeLessonMockTest,
  isLessonMockPlan,
} from "./lessons/lesson-mock-tests";
import { buildLessonSummaryObjectives } from "./lessons/lesson-attempts";
import { completeDisabledVoiceTask } from "./voice-task-lifecycle";
import { finishRewardActivitySession, readSessionRewardDelta, settleRewardActivity } from "./reward-activity";
import { hasDailyRoundForDate, readDailyRoundPool } from "./daily-round";
import { localDateAt, validRewardTimezone } from "../domain/reward-activity";

/** Okno wznowienia aktywnej sesji od ostatniego zdarzenia (arch §9.1). */
export const RESUME_WINDOW_MS = 30 * 60_000;
/** Miękki limit czasu sesji — egzekwowany tylko między zadaniami (arch §9.3). */
export const SESSION_TIME_LIMIT_MS = 10 * 60_000;
/** Po komunikacie „Jeszcze N” obietnica wobec dziecka waży więcej niż limit. */
const PROMISE_REMAINING = 3;
/** Startowy budżet zadań ocenianych; prezentacje go nie powiększają. */
export const DEFAULT_TASK_BUDGET = 12;

/** Statusy child_skill_progress odwzorowane na domenową projekcję zadania 5. */
export function mapStatus(dbStatus: string): ProgressStatus {
  switch (dbStatus) {
    case "unseen":
      return "not_assessed";
    case "practicing":
      return "learning";
    case "needs_confirmation":
      return "needs_confirmation";
    case "needs_reconfirmation":
      return "needs_reconfirmation";
    case "mastered":
      return "mastered";
    default:
      return "not_assessed";
  }
}

async function lockSession(tx: Tx, sessionId: string) {
  const session = (
    await tx.select().from(learningSessions).where(eq(learningSessions.id, sessionId)).for("update")
  )[0];
  if (!session) {
    throw new AppError("not_found");
  }
  return session;
}

/** Czy sesja dotyczy lekcji (rozstrzyga delegację `nextTask` do silnika lekcji). */
async function sessionIsLesson(tx: Tx, deckVersionId: string): Promise<boolean> {
  return (await readVersionDeckKind(tx, deckVersionId)) === "lesson";
}

async function taskCounts(tx: Tx, sessionId: string): Promise<{ total: number; assessed: number }> {
  const rows = await tx
    .select({ exerciseType: sessionTasks.exerciseType })
    .from(sessionTasks)
    .where(eq(sessionTasks.sessionId, sessionId));
  return {
    total: rows.length,
    assessed: rows.filter((r) => r.exerciseType !== "exposure").length,
  };
}

/**
 * Ostatnia aktywność sesji: wydanie zadania, zdarzenie (ujawnienie, próba
 * obserwacji) lub próba. Po przekroczeniu okna wznowienia sesja jest przeterminowana.
 */
async function lastActivityAt(tx: Tx, sessionId: string, startedAt: Date): Promise<Date> {
  const [taskRow] = await tx
    .select({ latest: max(sessionTasks.issuedAt) })
    .from(sessionTasks)
    .where(eq(sessionTasks.sessionId, sessionId));
  const [eventRow] = await tx
    .select({ latest: max(learningEvents.occurredAt) })
    .from(learningEvents)
    .innerJoin(sessionTasks, eq(sessionTasks.id, learningEvents.taskId))
    .where(eq(sessionTasks.sessionId, sessionId));
  const [attemptRow] = await tx
    .select({ latest: max(attempts.receivedAt) })
    .from(attempts)
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .where(eq(sessionTasks.sessionId, sessionId));
  const candidates = [taskRow?.latest, eventRow?.latest, attemptRow?.latest].filter(
    (value): value is Date => value !== null && value !== undefined,
  );
  return candidates.reduce(
    (latest, value) => (value.getTime() > latest.getTime() ? value : latest),
    startedAt,
  );
}

async function sessionDto(tx: Tx, row: typeof learningSessions.$inferSelect, resumed: boolean): Promise<SessionDto> {
  const counts = await taskCounts(tx, row.id);
  const snapshot = contextOf(row);
  return {
    sessionId: row.id,
    mode: row.mode,
    childId: row.childId,
    deckId: row.deckId,
    deckVersionId: row.deckVersionId,
    policyId: row.policyId,
    microphoneEnabled: row.microphoneEnabled,
    canRead: snapshot.canRead,
    vocabularyFormat: snapshot.vocabularyFormat,
    state: row.state as SessionDto["state"],
    taskBudget: row.taskBudget,
    tasksIssued: counts.total,
    assessedTasksIssued: counts.assessed,
    startedAt: row.startedAt.toISOString(),
    resumed,
  };
}

async function readTimezone(tx: Tx): Promise<string> {
  const row = (await tx.select().from(familySettings).limit(1))[0];
  return row?.timezone ?? "Europe/Warsaw";
}

/** Snapshot kontaktów z poprzednich sesji — zamrożony przy starcie (arch §9.3). */
async function previousContactSnapshot(
  tx: Tx,
  childId: string,
  deckVersionId: string,
  before: Date,
): Promise<Record<string, string>> {
  const revisions = await tx
    .select({ itemId: itemRevisions.itemId, payload: itemRevisions.payload, targetKey: itemRevisions.targetKey })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, deckVersionId));
  if (revisions.length === 0) {
    return {};
  }
  const rows = await tx
    .select({ itemId: learningEvents.itemId, latest: max(learningEvents.occurredAt) })
    .from(learningEvents)
    .where(
      and(
        eq(learningEvents.childId, childId),
        inArray(
          learningEvents.itemId,
          revisions.map((r) => r.itemId),
        ),
        lte(learningEvents.occurredAt, before),
      ),
    )
    .groupBy(learningEvents.itemId);
  const latestByItem = new Map(rows.map(r => [r.itemId, r.latest!.toISOString()]));
  const keysByItem = new Map(revisions.map(r => {
    const item = payloadToItem(r.payload);
    return [r.itemId, [...new Set([r.targetKey, ...[item.target, ...item.acceptedAnswers].map(answer => computeTargetKey(answer, item.locales.target))])]] as const;
  }));
  const keys = [...new Set([...keysByItem.values()].flat())];
  const exposures = await tx.select({ targetKey: eventExposures.targetKey, latest: max(learningEvents.occurredAt) }).from(eventExposures)
    .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(and(eq(eventExposures.childId, childId), inArray(eventExposures.targetKey, keys), lte(learningEvents.occurredAt, before)))
    .groupBy(eventExposures.targetKey);
  const latestByKey = new Map(exposures.map(e => [e.targetKey, e.latest!.toISOString()]));
  for (const [itemId, targetKeys] of keysByItem) for (const key of targetKeys) {
    const value = latestByKey.get(key);
    if (value && (!latestByItem.has(itemId) || value > latestByItem.get(itemId)!)) latestByItem.set(itemId, value);
  }
  return Object.fromEntries(latestByItem);
}

/**
 * Start lub wznowienie sesji dziecka (arch §9.1). Blokada wiersza profilu
 * serializuje równoległe starty; ta sama talia i tryb wznawiają aktywną sesję.
 * Inna talia/tryb wymagają jawnego końca; przeterminowanie zamyka starą sesję.
 */
export async function startSession(services: Services, input: SessionInput): Promise<SessionDto> {
  const valid = SessionInputSchema.parse(input);
  const mode = valid.mode ?? "training";
  return services.db.transaction(async (tx) => {
    const child = (
      await tx.select({ id: childProfiles.id, canRead: childProfiles.canRead }).from(childProfiles).where(eq(childProfiles.id, valid.childId)).for("update")
    )[0];
    if (!child) {
      throw new AppError("not_found");
    }
    const now = services.clock.now();
    const active = (
      await tx
        .select()
        .from(learningSessions)
        .where(and(eq(learningSessions.childId, valid.childId), eq(learningSessions.state, "active")))
      .for("update")
    )[0];
    if (active) {
      const stale =
        now.getTime() - (await lastActivityAt(tx, active.id, active.startedAt)).getTime() >
        RESUME_WINDOW_MS;
      const roundDayChanged = mode === "daily_round" && active.mode === "daily_round"
        && active.dailyRoundDate !== localDateAt(now, validRewardTimezone(await readTimezone(tx)));
      if (active.deckId === valid.deckId && active.mode === mode && !stale && !roundDayChanged) {
        if (contextOf(active).vocabularyFormat === "picture" && !valid.supportsPictureVocabulary) {
          throw new AppError("validation", { details: { reason: "picture_client_update_required" } });
        }
        return sessionDto(tx, active, true);
      }
      if (!stale && !roundDayChanged) throw new AppError("conflict", { message: "Wróć do rozpoczętej sesji albo zakończ ją przed nową." });
      if (active.mode === "mock_test") {
        if (isLessonMockPlan(active.mockTestPlan)) await closeLessonMockTest(tx, services, active);
        else await closeMockTest(tx, services, active, "ended");
      } else await tx
        .update(learningSessions)
        .set({ state: "ended", endedAt: now })
        .where(eq(learningSessions.id, active.id));
    }

    const assignment = (
      await tx.select().from(assignments).where(and(
        eq(assignments.childId, valid.childId),
        eq(assignments.deckId, valid.deckId),
        eq(assignments.active, true),
      ))
    )[0];
    if (!assignment) throw new AppError("not_found");
    const deck = (await tx.select().from(decks).where(eq(decks.id, valid.deckId)))[0];
    if (!deck) throw new AppError("not_found");
    if (deck.archivedAt) throw new AppError("conflict");
    if (!deck.publishedVersionId) throw new AppError("validation", { message: "deck is not published" });
    const deckKind = deck.kind as DeckKind;

    const dailyRoundPool = mode === "daily_round"
      ? await readDailyRoundPool(tx, valid.childId, valid.deckId, now)
      : null;
    if (mode === "daily_round" && !dailyRoundPool) throw new AppError("validation", { details: { reason: "daily_round_unavailable" } });
    if (dailyRoundPool && await hasDailyRoundForDate(tx, valid.childId, dailyRoundPool.date)) {
      throw new AppError("conflict", { message: "Runda dnia została już rozpoczęta." });
    }
    const timezone = dailyRoundPool?.timezone ?? await readTimezone(tx);
    const versionId = dailyRoundPool?.deckVersionId ?? deck.publishedVersionId;
    const version = (await tx.select().from(deckVersions).where(eq(deckVersions.id, versionId)))[0]!;
    if (version.vocabularyFormat === "picture" && !valid.supportsPictureVocabulary) {
      throw new AppError("validation", { details: { reason: "picture_client_update_required" } });
    }
    if (!child.canRead) {
      if (mode === "mock_test") throw new AppError("validation", { details: { reason: "non_reader_mock_test_unavailable" } });
      if (deckKind !== "vocabulary" || version.vocabularyFormat !== "picture") {
        throw new AppError("validation", { details: { reason: "vocabulary_requires_reading" } });
      }
      if (!(await readUiAudio(services)).ready) {
        throw new AppError("validation", { details: { reason: "picture_guidance_unavailable" } });
      }
    }
    await ensureLearningPolicy(tx);
    // polityka per dziecko (design 2026-10-09): własna wersja profilu albo bieżąca globalna
    const childProfile = (
      await tx.select({ policyId: childProfiles.policyId }).from(childProfiles).where(eq(childProfiles.id, valid.childId))
    )[0];
    const contextBase = deckKind === "lesson"
      ? await buildLessonSessionContext(tx, {
          childId: valid.childId,
          deckVersionId: version.id,
          timezone,
          testDate: assignment.testDate,
          now,
        })
      : {
          timezone,
          testDate: assignment.testDate,
          previousContact: await previousContactSnapshot(tx, valid.childId, version.id, now),
          reservations: [],
          settledChecks: [],
        };
    const context: SessionContextShape = {
      ...contextBase,
      ...(dailyRoundPool ? { dailyRoundRevisionIds: dailyRoundPool.revisionIds, dailyRoundDate: dailyRoundPool.date } : {}),
      canRead: child.canRead,
      vocabularyFormat: version.vocabularyFormat,
      microphoneDisabledTaskIds: [],
    };
    const id = randomUUID();
    if (mode === "mock_test" && !assignment.testGoals?.length) throw new AppError("validation", { message: "Rodzic musi najpierw ustawić cel kartkówki." });
    // Kartkówka lekcji (zadanie 17): wymaga celu `lesson` w przypisaniu; plan z
    // planera kartkówki lekcji (bezpieczna porcja przypiętej wersji). Kartkówka
    // słówek: cele słówkowe i planer słówek. Oba zapisują snapshot w tej samej
    // kolumnie `mock_test_plan` (dyskryminator `kind` dla lekcji).
    const mockTestPlan =
      mode !== "mock_test"
        ? null
        : deckKind === "lesson"
          ? (assignment.testGoals!.includes("lesson")
              ? await createLessonMockTestPlan(tx, services, {
                  childId: valid.childId,
                  deckVersionId: version.id,
                  requestedTaskCount: assignment.mockTestTaskCount,
                })
              : (() => { throw new AppError("validation", { message: "Rodzic musi najpierw ustawić cel kartkówki lekcji." }); })())
          : await createMockTestPlan(tx, services, {
              // Kartkówka słówek obsługuje tylko cele słówkowe; cel `lesson`
              // dotyczy lekcji (osobna ścieżka) i nie trafia tu w czasie wykonania.
              childId: valid.childId, deckVersionId: version.id,
              testGoals: assignment.testGoals!.filter((g): g is TestGoal => g !== "lesson"), testDate: assignment.testDate,
              requestedTaskCount: assignment.mockTestTaskCount,
            });
    if (mockTestPlan && !mockTestPlan.slots.length) throw new AppError("mock_test_unavailable");
    const [row] = await tx
      .insert(learningSessions)
      .values({
        id,
        childId: valid.childId,
        assignmentId: assignment.id,
        deckId: valid.deckId,
        deckVersionId: version.id,
        policyId: childProfile?.policyId ?? CURRENT_POLICY_ID,
        microphoneEnabled: valid.microphoneEnabled,
        state: "active",
        taskBudget: mode === "daily_round" ? dailyRoundPool!.revisionIds.length : mockTestPlan?.slots.length ?? DEFAULT_TASK_BUDGET,
        mode,
        dailyRoundDate: dailyRoundPool?.date ?? null,
        mockTestPlan,
        startedAt: now,
        context: context as unknown as Record<string, unknown>,
      })
      .returning();
    if (mode === "daily_round") {
      const schedulable = deckKind === "lesson"
        ? await hasSchedulableDailyRoundTask(services, tx, row!, now)
        : (await planNextTask(tx, row!, now, row!.taskBudget, 0)) !== null;
      if (!schedulable) throw new AppError("validation", { details: { reason: "daily_round_unavailable" } });
    }
    return sessionDto(tx, row!, false);
  });
}

export interface PlannedItem {
  itemId: string;
  source: string;
  target: string;
  acceptedAnswers: string[];
  visualType: VisualType;
  visualData?: Record<string, unknown>;
  example?: string;
  sourceLocale: string;
  targetLocale: string;
  meaningVisual?: MeaningVisual;
}

interface PlannedTask {
  plan: TaskPlan;
  item: PlannedItem;
  audioAssetId: string | null;
  imageAssetId: string | null;
  exampleAudioAssetId: string | null;
}

interface ItemStats {
  usedThisSession: number;
  presentationsThisSession: number;
  lastUsedOrdinal: number | null;
  supportedThisSession: boolean;
  recognitionFallbackUsedThisSession: boolean;
  readingDirections: Partial<Record<ReadingDirection, number>>;
  practiceMix: { listening: number; reading: number };
}

/** Buduje wejście schedulera z przypiętej wersji, projekcji i statystyki sesji. */
async function planNextTask(
  tx: Tx,
  session: typeof learningSessions.$inferSelect,
  now: Date,
  assessedRemaining: number,
  nextOrdinal: number,
): Promise<PlannedTask | null> {
  const allRevisions = await tx
    .select()
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, session.deckVersionId))
    .orderBy(asc(itemRevisions.position));
  const dailyRoundRevisionIds = (session.context as { dailyRoundRevisionIds?: unknown }).dailyRoundRevisionIds;
  const revisions = session.mode === "daily_round" && Array.isArray(dailyRoundRevisionIds)
    ? allRevisions.filter((revision) => dailyRoundRevisionIds.includes(revision.id))
    : allRevisions;
  if (revisions.length === 0) {
    return null;
  }
  const revisionIds = revisions.map((r) => r.id);

  const audioRows = await tx
    .select({ itemRevisionId: revisionAssets.itemRevisionId, assetId: revisionAssets.assetId })
    .from(revisionAssets)
    .where(
      and(
        inArray(revisionAssets.itemRevisionId, revisionIds),
        eq(revisionAssets.role, "target_audio"),
        eq(revisionAssets.state, "approved"),
      ),
    );
  const audioByRevision = new Map(audioRows.map((a) => [a.itemRevisionId, a.assetId]));

  // Audio zdania przykładowego (SPEC §22): odtwarzane z pliku przygotowanego
  // z zestawem; karta bez przykładu po prostu dostaje null.
  const exampleRows = await tx
    .select({ itemRevisionId: revisionAssets.itemRevisionId, assetId: revisionAssets.assetId })
    .from(revisionAssets)
    .where(
      and(
        inArray(revisionAssets.itemRevisionId, revisionIds),
        eq(revisionAssets.role, "example_audio"),
        eq(revisionAssets.state, "approved"),
      ),
    );
  const exampleByRevision = new Map(exampleRows.map((a) => [a.itemRevisionId, a.assetId]));

  // Pomoc wizualna prezentacji (SPEC §12.1): zatwierdzona ilustracja rodzica;
  // pominięty obraz pozostaje null i nie blokuje zadania.
  const imageRows = await tx
    .select({ itemRevisionId: revisionAssets.itemRevisionId, assetId: revisionAssets.assetId })
    .from(revisionAssets)
    .where(
      and(
        inArray(revisionAssets.itemRevisionId, revisionIds),
        eq(revisionAssets.role, "illustration"),
        eq(revisionAssets.state, "approved"),
      ),
    );
  const imageByRevision = new Map(imageRows.map((a) => [a.itemRevisionId, a.assetId]));

  const progressRows = await tx
    .select({
      itemRevisionId: itemRevisionSkills.itemRevisionId,
      skill: itemRevisionSkills.skill,
      status: childSkillProgress.status,
      nextReviewAt: childSkillProgress.nextReviewAt,
      streak: childSkillProgress.independentSuccessStreak,
    })
    .from(itemRevisionSkills)
    .leftJoin(
      childSkillProgress,
      and(
        eq(childSkillProgress.skillVersionId, itemRevisionSkills.skillVersionId),
        eq(childSkillProgress.childId, session.childId),
      ),
    )
    .where(inArray(itemRevisionSkills.itemRevisionId, revisionIds));

  const statsByRevision = new Map<string, ItemStats>(
    revisions.map((r) => [
      r.id,
      {
        usedThisSession: 0,
        presentationsThisSession: 0,
        lastUsedOrdinal: null,
        supportedThisSession: false,
        recognitionFallbackUsedThisSession: false,
        readingDirections: {},
        practiceMix: { listening: 0, reading: 0 },
      },
    ]),
  );
  const taskRows = await tx
    .select({
      id: sessionTasks.id,
      itemRevisionId: sessionTasks.itemRevisionId,
      exerciseType: sessionTasks.exerciseType,
      direction: sessionTasks.direction,
      ordinal: sessionTasks.ordinal,
      context: sessionTasks.context,
      state: sessionTasks.state,
    })
    .from(sessionTasks)
    .where(eq(sessionTasks.sessionId, session.id))
    .orderBy(asc(sessionTasks.ordinal));
  for (const row of taskRows) {
    const stats = statsByRevision.get(row.itemRevisionId);
    if (!stats) continue;
    stats.usedThisSession += 1;
    stats.lastUsedOrdinal = Math.max(stats.lastUsedOrdinal ?? -1, row.ordinal);
    if (row.exerciseType === "exposure") {
      stats.presentationsThisSession += 1;
    }
    if ((row.context as { reason?: string } | null)?.reason === "support") {
      stats.supportedThisSession = true;
    }
    if ((row.context as { reason?: string } | null)?.reason === "recognition-fallback") {
      stats.recognitionFallbackUsedThisSession = true;
    }
    if (row.exerciseType === "listening") {
      stats.practiceMix.listening += 1;
    } else if (row.exerciseType === "reading" || row.exerciseType === "reverse_recognition") {
      stats.practiceMix.reading += 1;
      const direction = (row.direction ?? (row.exerciseType === "reading" ? "target_to_source" : "source_to_target")) as ReadingDirection;
      stats.readingDirections[direction] = (stats.readingDirections[direction] ?? 0) + 1;
    }
  }

  // Trudności z prób tej sesji: oceniony błąd liczy się pojedynczo, a jedno
  // „Nie pamiętam” nasycie próg wsparcia — deklarowana trudność prowadzi do
  // wsparcia bez czekania na drugi błąd (SPEC §15.1, §16).
  const policy = await loadPolicy(tx, session.policyId);
  const learningSnapshots = await readLearningSnapshot(tx, {
    childId: session.childId,
    revisionIds,
    policy,
    now: now.toISOString(),
  });
  const snapshotByRevision = new Map(learningSnapshots.map((snapshot) => [snapshot.itemRevisionId, snapshot]));
  const gradedRows = await tx
    .select({
      attemptId: attempts.id,
      taskId: attempts.taskId,
      itemRevisionId: sessionTasks.itemRevisionId,
      exerciseType: sessionTasks.exerciseType,
      modality: attempts.modality,
      feedback: attempts.feedback,
      skill: assessments.skill,
      outcome: assessments.outcome,
    })
    .from(attempts)
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .leftJoin(assessments, eq(assessments.attemptId, attempts.id))
    .where(eq(sessionTasks.sessionId, session.id));
  const attemptsById = new Map<string, SupportAttempt>();
  for (const row of gradedRows) {
    const current = attemptsById.get(row.attemptId) ?? {
      attemptId: row.attemptId, taskId: row.taskId, modality: row.modality,
      outcomes: [] as { skill: Skill; outcome: "correct" | "incorrect" | "unevaluated" }[],
    };
    if (row.skill !== null && row.outcome !== null) {
      current.outcomes = [...current.outcomes, { skill: row.skill as Skill, outcome: row.outcome === "unassessed" ? "unevaluated" : row.outcome as "correct" | "incorrect" }];
    } else if (session.mode === "daily_round" && row.feedback) {
      const kind = (row.feedback as { kind?: string }).kind;
      if (isDailyRoundFailureFeedback(kind)) {
        const skill: Skill = kind === "spelling_hint" || kind === "capitalization_hint" || row.exerciseType === "spelling" || row.exerciseType === "letter_completion"
          ? "spelling"
          : row.exerciseType === "listening" ? "listening"
            : row.exerciseType === "reading" || row.exerciseType === "reverse_recognition" ? "reading"
              : "recall";
        current.outcomes = [...current.outcomes, { skill, outcome: "incorrect" }];
      }
    }
    attemptsById.set(row.attemptId, current);
  }
  const supportTasks: SupportTask[] = taskRows.map((row) => {
    const context = row.context as { reason?: string; supportCycleId?: string } | null;
    return {
      taskId: row.id,
      itemRevisionId: row.itemRevisionId,
      ordinal: row.ordinal,
      exerciseType: row.exerciseType as SupportTask["exerciseType"],
      state: row.state === "completed" || row.state === "answered" || row.state === "skipped" ? row.state : "issued",
      reason: context?.reason ?? "",
      ...(context?.supportCycleId ? { supportCycleId: context.supportCycleId } : {}),
    };
  });
  const supportByRevision = deriveSupportStates(supportTasks, [...attemptsById.values()], policy.supportAfterFailures);

  const sessionContext = contextOf(session);
  const items = new Map<string, PlannedItem>(
    revisions.map((r) => {
      const item = payloadToItem(r.payload as Record<string, unknown>);
      return [
        r.id,
        {
          itemId: r.itemId,
          source: item.source,
          target: item.target,
          acceptedAnswers: [...item.acceptedAnswers],
          visualType: item.visualType,
          ...(item.visualData === undefined ? {} : { visualData: item.visualData }),
          ...(item.example === undefined ? {} : { example: item.example }),
          sourceLocale: item.locales.source,
          targetLocale: item.locales.target,
          ...(sessionContext.vocabularyFormat === "picture"
            ? {
                meaningVisual: item.visualType === "image"
                  ? MeaningVisualSchema.parse({ kind: "image", imageAssetId: imageByRevision.get(r.id) })
                  : item.visualType === "color"
                    ? MeaningVisualSchema.parse({ kind: "color", color: item.visualData?.color })
                    : MeaningVisualSchema.parse({ kind: "number", count: item.visualData?.count }),
              }
            : {}),
        },
      ];
    }),
  );

  // kontakt z poprzednich sesji zamrożony przy starcie (arch §9.3) —
  // porządek rotacji utrwalania na rozpoczętym zestawie
  // Każda ujawniona treść (cel lub dystraktor) ma wcześniej zapieczętowany
  // event_exposures. Używamy klucza odpowiedzi, nie samej historii zadań,
  // żeby nie uznać nieujawnionego/legacy tasku za znane słowo.
  const targetKeysByRevision = new Map(
    revisions.map((revision) => {
      const item = items.get(revision.id)!;
      return [revision.id, computeTargetKey(item.target, item.targetLocale)] as const;
    }),
  );
  const historicalExposureRows = await tx
    .select({ targetKey: eventExposures.targetKey })
    .from(eventExposures)
    .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(
      and(
        eq(eventExposures.childId, session.childId),
        eq(learningEvents.sealed, true),
        inArray(eventExposures.targetKey, [...targetKeysByRevision.values()]),
      ),
    );
  const historicallyExposed = new Set(historicalExposureRows.map((row) => row.targetKey));

  const terminalTasks = taskRows.filter((row) => row.state === "answered" || row.state === "skipped");
  const assessedTasks = terminalTasks.filter((row) => row.state === "answered");
  const recentAssessedReasons = assessedTasks
    .filter((row) => row.exerciseType !== "exposure")
    .map((row) => (row.context as { reason?: unknown } | null)?.reason)
    .filter((reason): reason is ScheduleReason => typeof reason === "string")
    .slice(-2);
  const recentAssessedTasks = assessedTasks
    .filter((row) => row.exerciseType !== "exposure")
    .slice(-2)
    .map((row) => {
      const context = row.context as { reason?: unknown; skillAtIssue?: unknown; statusAtIssue?: unknown } | null;
      return {
        reason: typeof context?.reason === "string" ? context.reason as ScheduleReason : "new-practice" as ScheduleReason,
        skill: typeof context?.skillAtIssue === "string" ? context.skillAtIssue as Skill : null,
        statusAtIssue: typeof context?.statusAtIssue === "string" ? context.statusAtIssue as SkillSnapshot["status"] : null,
      };
    });
  const settledReviewSkillsByRevision = new Map<string, Skill[]>();
  for (const row of terminalTasks) {
    const context = row.context as { reason?: unknown; skillAtIssue?: unknown } | null;
    if (context?.reason !== "due-review") continue;
    const inferred: Partial<Record<string, Skill>> = {
      listening: "listening", reading: "reading", reverse_recognition: "reading", speech: "pronunciation",
    };
    const skill = typeof context.skillAtIssue === "string" ? context.skillAtIssue as Skill : inferred[row.exerciseType];
    if (!skill) continue;
    const values = settledReviewSkillsByRevision.get(row.itemRevisionId) ?? [];
    if (!values.includes(skill)) settledReviewSkillsByRevision.set(row.itemRevisionId, [...values, skill]);
  }

  // Etapy już wprowadzone zadaniem w dowolnej sesji dziecka (SPEC §13): pierwsze
  // recall/wymowa nie może czekać na postęp, którego bez tego zadania nie będzie;
  // technicznie nieoceniona próba wymowy nie zapętla wprowadzania.
  const introRows = await tx
    .select({ itemRevisionId: sessionTasks.itemRevisionId, exerciseType: sessionTasks.exerciseType })
    .from(sessionTasks)
    .innerJoin(learningSessions, eq(learningSessions.id, sessionTasks.sessionId))
    .where(
      and(
        eq(learningSessions.childId, session.childId),
        inArray(sessionTasks.itemRevisionId, revisionIds),
        inArray(sessionTasks.exerciseType, ["recall", "speech"]),
      ),
    );
  const introducedByRevision = new Map<string, { recall: boolean; pronunciation: boolean }>();
  for (const row of introRows) {
    const flags = introducedByRevision.get(row.itemRevisionId) ?? { recall: false, pronunciation: false };
    if (row.exerciseType === "recall") flags.recall = true;
    if (row.exerciseType === "speech") flags.pronunciation = true;
    introducedByRevision.set(row.itemRevisionId, flags);
  }

  const candidates: ScheduleCandidate[] = revisions.map((r) => {
    const item = items.get(r.id)!;
    const stats = statsByRevision.get(r.id)!;
    const learning = snapshotByRevision.get(r.id);
    const progress: Partial<Record<Skill, SkillSnapshot>> = {};
    for (const row of progressRows) {
      if (row.itemRevisionId !== r.id || row.status === null) continue;
      progress[row.skill as Skill] = {
        status: mapStatus(row.status),
        nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
        streak: row.streak ?? 0,
      };
    }
    if (learning) {
      for (const [skill, snapshot] of Object.entries(learning.progress) as [Skill, SkillSnapshot][]) {
        progress[skill] = snapshot;
      }
    }
    return {
      itemRevisionId: r.id,
      itemId: r.itemId,
      position: r.position,
      target: item.target,
      source: item.source,
      acceptedAnswers: item.acceptedAnswers,
      targetLocale: item.targetLocale,
      progress,
      // trudności z prawdziwych prób tej sesji (błędy i „Nie pamiętam”)
      failuresThisSession: 0,
      supportedThisSession: stats.supportedThisSession,
      support: supportByRevision.get(r.id),
      work: learning?.work,
      ownPresentationCompleted: learning?.ownPresentationCompleted ?? false,
      recognitionFallbackUsedThisSession: stats.recognitionFallbackUsedThisSession,
      readingEvidenceDirections: learning?.readingEvidenceDirections ?? {},
      usedThisSession: stats.usedThisSession,
      presentationsThisSession: stats.presentationsThisSession,
      lastContactAt: sessionContext.previousContact[r.itemId] ?? null,
      lastUsedOrdinal: stats.lastUsedOrdinal,
      readingDirections: stats.readingDirections,
      practiceMix: stats.practiceMix,
      introducedSkills: learning?.introducedSkills ?? introducedByRevision.get(r.id) ?? { recall: false, pronunciation: false },
      hasBeenPresented: historicallyExposed.has(targetKeysByRevision.get(r.id)!),
      testPreparationIssued: taskRows.some(
        (row) =>
          row.itemRevisionId === r.id &&
          (row.context as { reason?: unknown } | null)?.reason === "test-preparation",
      ),
      settledReviewSkills: settledReviewSkillsByRevision.get(r.id) ?? [],
      ...(item.meaningVisual ? { visual: item.meaningVisual } : {}),
    };
  });
  const peers = candidates.map((c) => ({
    itemRevisionId: c.itemRevisionId,
    position: c.position,
    target: c.target,
    source: c.source,
    targetLocale: c.targetLocale,
    acceptedAnswers: c.acceptedAnswers,
    ...(c.visual ? { visual: c.visual } : {}),
  }));

  const plan = selectTask({
    selectionSeed: randomInt(0x1_0000_0000),
    now: now.toISOString(),
    policy,
    microphoneEnabled: session.microphoneEnabled,
    canRead: sessionContext.canRead,
    vocabularyFormat: sessionContext.vocabularyFormat,
    assessedRemaining,
    nextOrdinal,
    candidates,
    peers,
    reservedTargetKeys: sessionContext.reservations,
    settledCheckTargetKeys: sessionContext.settledChecks,
    ...(sessionContext.testDate === undefined
      ? {}
      : { testPreparation: { testDate: sessionContext.testDate, timezone: sessionContext.timezone } }),
    recentAssessedReasons,
    recentAssessedTasks,
    confusions: learningSnapshots.flatMap((snapshot) => snapshot.confusions),
  });
  if (!plan) {
    return null;
  }
  return {
    plan,
    item: items.get(plan.itemRevisionId)!,
    audioAssetId: audioByRevision.get(plan.itemRevisionId) ?? null,
    imageAssetId: imageByRevision.get(plan.itemRevisionId) ?? null,
    exampleAudioAssetId: exampleByRevision.get(plan.itemRevisionId) ?? null,
  };
}

/** Tasowanie Fishera–Yatesa; pętla nie wykonuje się dla 0/1 elementów. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function materializeTask(
  plan: TaskPlan,
  item: PlannedItem,
  audioAssetId: string | null,
  imageAssetId: string | null,
  exampleAudioAssetId: string | null,
): { prompt: TaskPrompt; answerKey: Record<string, unknown> } {
  // Plan trzyma kanoniczną kolejność (poprawna pierwsza); kolejność prezentacji
  // losujemy raz przy wydaniu zadania, bo wydany prompt jest niezmienny, więc
  // ponowne wyświetlenie tego samego zadania zachowuje układ opcji.
  const plannedOptions = shuffled(plan.options ?? []);
  const optionIds = new Map(
    plannedOptions.map((o) => [o.text, randomUUID()] as const),
  );
  const promptOptions = plannedOptions.map((o) => ({
    id: optionIds.get(o.text)!,
    text: o.text,
  }));
  const picturePromptOptions = plannedOptions.map((o) => ({
    id: optionIds.get(o.text)!,
    labelPl: o.text,
    visual: o.visual!,
  }));
  const correctOption = plannedOptions.find((o) => o.correct);
  const answerKey: Record<string, unknown> = {
    exerciseType: plan.exerciseType,
    target: item.target,
    acceptedAnswers: item.acceptedAnswers,
    ...(plan.direction ? { direction: plan.direction } : {}),
    ...(correctOption ? { correctOptionId: optionIds.get(correctOption.text)! } : {}),
    ...(plannedOptions.length > 0 ? { optionItemRevisionIds: Object.fromEntries(plannedOptions.map((option) => [optionIds.get(option.text)!, option.itemRevisionId])) } : {}),
  };

  let prompt: TaskPrompt;
  switch (plan.exerciseType) {
    case "exposure":
      prompt = item.meaningVisual
        ? { kind: "picture_exposure", visual: item.meaningVisual, audioAssetId }
        : {
        kind: "exposure",
        source: item.source,
        target: item.target,
        example: item.example ?? null,
        audioAssetId,
        exampleAudioAssetId,
        imageAssetId,
        visualType: item.visualType,
        ...(item.visualType !== "image" && item.visualType !== "none" && item.visualData !== undefined
          ? { visualData: item.visualData }
          : {}),
        };
      break;
    case "listening":
      prompt = plannedOptions.length > 0 && plannedOptions.every((option) => option.visual !== undefined)
        ? { kind: "picture_listening", options: picturePromptOptions, audioAssetId: audioAssetId! }
        : { kind: "listening", options: promptOptions, audioAssetId: audioAssetId! };
      break;
    case "reading":
      prompt = { kind: "reading", text: item.target, options: promptOptions };
      break;
    case "reverse_recognition":
      prompt = { kind: "reverse_recognition", prompt: item.source, options: promptOptions };
      break;
    case "recall":
      prompt = plan.pictureRecall
        ? { kind: "picture_recall", visual: item.meaningVisual! }
        : { kind: "recall", prompt: item.source };
      break;
    case "spelling":
      prompt = { kind: "spelling", prompt: item.source };
      break;
    case "letter_completion":
      prompt = { kind: "letter_completion", prompt: item.source, fragment: buildLetterFragment(item.target) };
      break;
    case "speech":
      prompt = item.meaningVisual
        ? { kind: "picture_speech", visual: item.meaningVisual, audioAssetId }
        : {
        kind: "speech",
        text: item.target,
        audioAssetId,
        imageAssetId,
        visualType: item.visualType,
        ...(item.visualType !== "image" && item.visualType !== "none" && item.visualData !== undefined
          ? { visualData: item.visualData }
          : {}),
        };
      break;
  }
  return { prompt, answerKey };
}

/**
 * Wydanie kolejnego zadania pod blokadą sesji (arch §9.1a): dla issued zwraca
 * to samo zadanie; nowe tworzy dopiero po terminalnym stanie poprzedniego.
 * Ujawnienia treści promptu zapisuje w tej samej transakcji.
 */
export async function nextTask(services: Services, sessionId: string): Promise<TaskDto | null> {
  const id = UuidSchema.parse(sessionId);
  return services.db.transaction(async (tx) => {
    const session = await lockSession(tx, id);
    if (session.state !== "active") {
      return null;
    }
    const now = services.clock.now();
    if (session.mode === "mock_test") {
      const lessonMock = isLessonMockPlan(session.mockTestPlan);
      if (now.getTime() - session.startedAt.getTime() > SESSION_TIME_LIMIT_MS) {
        if (lessonMock) await closeLessonMockTest(tx, services, session);
        else await closeMockTest(tx, services, session, "ended");
        return null;
      }
      const task = lessonMock ? await issueLessonMockTestTask(tx, services, session) : await issueMockTestTask(tx, services, session);
      if (!task) {
        if (lessonMock) await closeLessonMockTest(tx, services, session);
        else await closeMockTest(tx, services, session, "completed");
      }
      return task;
    }

    // Lekcja (zadanie 13): wspólne kroki (blokada, idempotencja wydanego zadania,
    // przeterminowanie, budżet, limit czasu, obietnica „Jeszcze N”) są te same co
    // słówka; różni się tylko plan i materializacja — delegacja do silnika lekcji.
    const isLesson = await sessionIsLesson(tx, session.deckVersionId);
    let issuedTask: typeof sessionTasks.$inferSelect | undefined = (
      await tx.select().from(sessionTasks).where(and(eq(sessionTasks.sessionId, id), eq(sessionTasks.state, "issued"))).limit(1)
    )[0];
    if (issuedTask && contextOf(session).microphoneDisabledTaskIds.includes(issuedTask.id)) {
      if (await completeDisabledVoiceTask(tx, id, issuedTask.id) === "skipped") issuedTask = undefined;
    }
    if (isLesson) {
      if (issuedTask) {
        const counts = await lessonTaskCounts(tx, id);
        const assessedBefore = counts.assessed - (issuedTask.exerciseType !== "lesson_card" ? 1 : 0);
        const version = (await tx.select({ lessonContext: deckVersions.lessonContext }).from(deckVersions)
          .where(eq(deckVersions.id, session.deckVersionId)))[0];
        const subjectId = (version?.lessonContext as { subjectId?: string } | null)?.subjectId;
        const audioAllowed = subjectId ? services.subjects.getSubject(subjectId)?.ttsForAnswers === true : false;
        return issuedTaskDto(session, issuedTask, assessedBefore, audioAllowed);
      }
      const lastActivity = await lastActivityAt(tx, id, session.startedAt);
      if (now.getTime() - lastActivity.getTime() > RESUME_WINDOW_MS) {
        await tx.update(learningSessions).set({ state: "ended", endedAt: now }).where(eq(learningSessions.id, id));
        return null;
      }
      const counts = await lessonTaskCounts(tx, id);
      if (session.mode === "daily_round" && counts.total >= session.taskBudget) return null;
      const remaining = session.taskBudget - counts.assessed;
      if (remaining <= 0) return null;
      if (now.getTime() - session.startedAt.getTime() > SESSION_TIME_LIMIT_MS && remaining > PROMISE_REMAINING) {
        return null;
      }
      return issueNextLessonTask(services, tx, session, now, remaining, counts.total);
    }

    const issued = issuedTask;
    if (issued) {
      const counts = await taskCounts(tx, id);
      const assessedBefore =
        counts.assessed - (issued.exerciseType !== "exposure" ? 1 : 0);
      const pending = contextOf(session).microphoneDisabledTaskIds.includes(issued.id)
        ? (await tx.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.taskId, issued.id), eq(attempts.state, "processing"))))[0]
        : undefined;
      return issuedTaskDto(session, issued, assessedBefore, true, pending?.id);
    }

    const lastActivity = await lastActivityAt(tx, id, session.startedAt);
    if (now.getTime() - lastActivity.getTime() > RESUME_WINDOW_MS) {
      await tx
        .update(learningSessions)
        .set({ state: "ended", endedAt: now })
        .where(eq(learningSessions.id, id));
      return null;
    }

    const counts = await taskCounts(tx, id);
    if (session.mode === "daily_round" && counts.total >= session.taskBudget) return null;
    const remaining = session.taskBudget - counts.assessed;
    if (remaining <= 0) {
      return null;
    }
    // limit czasu tylko między zadaniami; obiecane ostatnie zadania są dokończone
    if (now.getTime() - session.startedAt.getTime() > SESSION_TIME_LIMIT_MS && remaining > PROMISE_REMAINING) {
      return null;
    }

    const planned = await planNextTask(tx, session, now, remaining, counts.total);
    if (!planned) {
      return null;
    }
    const { plan, item, audioAssetId, imageAssetId, exampleAudioAssetId } = planned;
    const materialized = materializeTask(plan, item, audioAssetId, imageAssetId, exampleAudioAssetId);
    const taskId = randomUUID();

    await tx.insert(sessionTasks).values({
      id: taskId,
      sessionId: session.id,
      childId: session.childId,
      deckVersionId: session.deckVersionId,
      itemRevisionId: plan.itemRevisionId,
      ordinal: counts.total,
      exerciseType: plan.exerciseType,
      direction: plan.direction ?? null,
      state: "issued",
      publicPrompt: materialized.prompt as unknown as Record<string, unknown>,
      answerKey: materialized.answerKey,
      context: {
        reason: plan.reason,
        ...(plan.supportCycleId ? { supportCycleId: plan.supportCycleId } : {}),
        ...(plan.skillAtIssue ? { skillAtIssue: plan.skillAtIssue } : {}),
        ...(plan.statusAtIssue ? { statusAtIssue: plan.statusAtIssue } : {}),
        ...(plan.assessmentSkills ? { assessmentSkills: plan.assessmentSkills } : {}),
      },
      issuedAt: now,
    });
    await writeSealedEvent(tx, {
      childId: session.childId,
      taskId,
      itemId: item.itemId,
      kind: "prompt_issued",
      stepId: `${taskId}:prompt`,
      occurredAt: now,
      exposures: plan.revealsTargetKeys,
    });
    const context = contextOf(session);
    if (JSON.stringify(context.reservations) !== JSON.stringify(plan.keepsReservations)) {
      await tx
        .update(learningSessions)
        .set({ context: { ...context, reservations: plan.keepsReservations } })
        .where(eq(learningSessions.id, session.id));
    }
    return issuedTaskDto(session, { exerciseType: plan.exerciseType, direction: plan.direction ?? null, id: taskId, ordinal: counts.total, publicPrompt: materialized.prompt }, counts.assessed);
  });
}

type IssuedShape = {
  id: string;
  ordinal: number;
  exerciseType: string;
  direction: string | null;
  publicPrompt: unknown;
};

function issuedTaskDto(
  session: typeof learningSessions.$inferSelect,
  task: IssuedShape,
  assessedBefore: number,
  audioAllowed = true,
  pendingAttemptId?: string,
): TaskDto {
  // Zachowaj znaczenie snapshotów i dopełnij jedynie brakujące pola kontraktu.
  const storedPrompt = addLegacyTaskPromptDefaults(task.publicPrompt as Record<string, unknown>);
  // Dostępność audio jest bieżącą możliwością przedmiotu. Nie przepisujemy
  // niezmiennego snapshotu zadania ani wcześniejszych ekspozycji.
  const { audioAssetId: _audioAssetId, ...withoutAudio } = storedPrompt;
  const prompt = audioAllowed ? storedPrompt : withoutAudio;
  return {
    taskId: task.id,
    sessionId: session.id,
    ordinal: task.ordinal,
    exerciseType: task.exerciseType as TaskDto["exerciseType"],
    direction: (task.direction ?? null) as TaskDto["direction"],
    state: "issued",
    prompt: prompt as TaskPrompt,
    remainingAssessed: session.mode === "daily_round"
      ? Math.max(1, session.taskBudget - task.ordinal)
      : session.taskBudget - assessedBefore,
    ...(pendingAttemptId ? { pendingAttemptId } : {}),
  };
}

/** Parent disables recording for a non-reader session; issued voice work is skipped safely. */
export async function disableSessionMicrophone(services: Services, sessionId: string): Promise<SessionDto> {
  const id = UuidSchema.parse(sessionId);
  return services.db.transaction(async (tx) => {
    const session = await lockSession(tx, id);
    const context = contextOf(session);
    if ((session.mode !== "training" && session.mode !== "daily_round") || context.canRead || context.vocabularyFormat !== "picture") {
      throw new AppError("validation");
    }
    if (session.state !== "active") throw new AppError("conflict", { message: "session is not active" });
    if (!session.microphoneEnabled) return sessionDto(tx, session, true);
    const voiceTasks = await tx.select({ id: sessionTasks.id }).from(sessionTasks).where(and(
      eq(sessionTasks.sessionId, id), eq(sessionTasks.state, "issued"),
      inArray(sessionTasks.exerciseType, ["recall", "speech"]),
    ));
    const microphoneDisabledTaskIds = [...new Set([...context.microphoneDisabledTaskIds, ...voiceTasks.map((task) => task.id)])];
    await tx.update(learningSessions).set({
      microphoneEnabled: false,
      context: { ...context, microphoneDisabledTaskIds, reservations: [] } as unknown as Record<string, unknown>,
    }).where(eq(learningSessions.id, id));
    for (const task of voiceTasks) await completeDisabledVoiceTask(tx, id, task.id);
    const fresh = (await tx.select().from(learningSessions).where(eq(learningSessions.id, id)))[0]!;
    return sessionDto(tx, fresh, true);
  });
}

/**
 * Kończy wyłącznie zadanie exposure: issued → completed (arch §9.1a). Nie tworzy
 * próby ani oceny i nie zużywa budżetu; ponowne wywołanie zwraca ten sam rezultat
 * i nie dotyka nowo wydanego zadania.
 */
export async function completePresentation(
  services: Services,
  input: PresentationCompletionInput,
): Promise<PresentationCompletionDto> {
  const valid = PresentationCompletionInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    const { task, itemId } = await lockTaskWithSession(tx, valid.taskId);
    if (task.exerciseType !== "exposure" && task.exerciseType !== "lesson_card") {
      throw new AppError("validation", { message: "task is not a presentation" });
    }
    if (task.state === "completed") {
      const row = (
        await tx
          .select({ occurredAt: learningEvents.occurredAt })
          .from(learningEvents)
          .where(and(eq(learningEvents.taskId, task.id), eq(learningEvents.kind, "presentation_completed")))
          .limit(1)
      )[0];
      return {
        taskId: task.id,
        state: "completed" as const,
        completedAt: (row?.occurredAt ?? task.issuedAt).toISOString(),
      };
    }
    if (task.state !== "issued") {
      throw new AppError("conflict", { message: "presentation task is not issued" });
    }
    const now = services.clock.now();
    await tx.update(sessionTasks).set({ state: "completed" }).where(eq(sessionTasks.id, task.id));
    await writeSealedEvent(tx, {
      childId: task.childId,
      taskId: task.id,
      itemId,
      kind: "presentation_completed",
      stepId: `${task.id}:done`,
      occurredAt: now,
      ...(valid.clientCommandId ? { clientEventId: valid.clientCommandId } : {}),
      exposures: [],
    });
    await settleRewardActivity(tx, {
      childId: task.childId,
      sessionId: task.sessionId,
      taskId: task.id,
      completionRef: valid.clientCommandId ?? randomUUID(),
      kind: "presentation",
      at: now,
    });
    return { taskId: task.id, state: "completed" as const, completedAt: now.toISOString() };
  });
}

/** Jawny koniec z podsumowaniem; idempotentny dla sesji już zakończonej. */
export async function endSession(services: Services, sessionId: string): Promise<SessionSummaryDto> {
  const id = UuidSchema.parse(sessionId);
  return services.db.transaction(async (tx) => {
    const session = await lockSession(tx, id);
    await finishRewardActivitySession(tx, id, services.clock.now());
    const reward = await readSessionRewardDelta(tx, id);
    let state = session.state as "active" | "completed" | "ended";
    if (session.mode === "mock_test") {
      if (isLessonMockPlan(session.mockTestPlan)) {
        // Kartkówka lekcji: zamknięcie wspólną ścieżką lekcji (raport per cel do
        // kontekstu); podsumowanie sesji ma kształt słówkowy z zerowymi licznikami
        // (omówienie i wynik idą przez endpoint mock-test-summary, nie endSession).
        const report = await closeLessonMockTest(tx, services, session);
        const counts = await taskCounts(tx, id);
        const fresh = (await tx.select().from(learningSessions).where(eq(learningSessions.id, id)))[0]!;
        return {
          sessionId: id,
          state: report.complete ? "completed" : "ended",
          tasksIssued: counts.total,
          assessedTasksIssued: counts.assessed,
          endedAt: (fresh.endedAt ?? services.clock.now()).toISOString(),
          independentSuccesses: { recall: 0, spelling: 0 },
          practiceItems: [],
          reward,
        };
      }
      const report = await closeMockTest(tx, services, session, "completed");
      const counts = await taskCounts(tx, id);
      const summaryRows = await tx.select({ itemRevisionId: assessments.itemRevisionId, skill: assessments.skill }).from(assessments)
        .innerJoin(attempts, eq(attempts.id, assessments.attemptId)).innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
        .where(and(eq(sessionTasks.sessionId, id), eq(assessments.independent, true), eq(assessments.outcome, "correct")));
      return { sessionId: id, state: report.state, tasksIssued: counts.total, assessedTasksIssued: counts.assessed, endedAt: report.endedAt,
        independentSuccesses: { recall: new Set(summaryRows.filter(r => r.skill === "recall").map(r => r.itemRevisionId)).size,
          spelling: new Set(summaryRows.filter(r => r.skill === "spelling").map(r => r.itemRevisionId)).size }, practiceItems: [], reward };
    }
    let endedAt = session.endedAt;
    if (state === "active") {
      endedAt = services.clock.now();
      state = "completed";
      await tx
        .update(learningSessions)
        .set({ state, endedAt })
        .where(eq(learningSessions.id, id));
    }
    const counts = await taskCounts(tx, id);
    const saved = SessionSummaryDtoSchema.safeParse(session.context.summary);
    const isLesson = await sessionIsLesson(tx, session.deckVersionId);
    const rows = saved.success ? [] : await tx
      .select({
        itemId: itemRevisions.itemId, payload: itemRevisions.payload,
        skill: assessments.skill, outcome: assessments.outcome, independent: assessments.independent,
      })
      .from(assessments)
      .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
      .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
      .innerJoin(itemRevisions, eq(itemRevisions.id, assessments.itemRevisionId))
      .where(and(eq(sessionTasks.sessionId, id), eq(attempts.state, "completed")))
      .orderBy(asc(attempts.receivedAt), asc(sessionTasks.ordinal), asc(attempts.attemptNumber));
    // Lekcja (req 7.7): podsumowanie per cel. Wartości słówkowe (recall/spelling)
    // są puste — `summarizeSessionAssessments` ignoruje skill `objective` — więc
    // bezpiecznie dołączamy `objectives` do tego samego kształtu DTO.
    const lessonObjectives = saved.success || !isLesson ? undefined : await buildLessonSummaryObjectives(services, tx, id);
    const summary: SessionSummaryDto = saved.success ? saved.data : {
      sessionId: id,
      state,
      tasksIssued: counts.total,
      assessedTasksIssued: counts.assessed,
      endedAt: endedAt!.toISOString(),
      ...summarizeSessionAssessments(rows.map(row => ({ ...row, target: payloadToItem(row.payload).target }))),
      reward,
      ...(lessonObjectives ? { objectives: lessonObjectives } : {}),
    };
    if (!saved.success) {
      await tx.update(learningSessions)
        .set({ context: { ...session.context, summary } })
        .where(eq(learningSessions.id, id));
    }
    // Lista pokazuje wzorce także przy ponownym odczycie. Każda odpowiedź
    // ma nową, zamkniętą ekspozycję; snapshot wyników pozostaje ten sam.
    if (summary.practiceItems.length > 0) {
      const items = await tx.select({ taskId: sessionTasks.id, itemId: itemRevisions.itemId, payload: itemRevisions.payload })
        .from(sessionTasks)
        .innerJoin(itemRevisions, eq(itemRevisions.id, sessionTasks.itemRevisionId))
        .where(and(eq(sessionTasks.sessionId, id), inArray(itemRevisions.itemId, summary.practiceItems.map(item => item.itemId))))
        .orderBy(asc(sessionTasks.ordinal));
      const disclosed = new Set<string>();
      for (const item of items) {
        if (disclosed.has(item.itemId)) continue;
        disclosed.add(item.itemId);
        const vocabulary = payloadToItem(item.payload);
        await writeSealedEvent(tx, {
          childId: session.childId, taskId: item.taskId, itemId: item.itemId,
          kind: "feedback_issued", stepId: `${id}:summary:${item.itemId}`,
          occurredAt: services.clock.now(),
          exposures: [computeTargetKey(vocabulary.target, vocabulary.locales.target)],
        });
      }
    }
    return summary;
  });
}
