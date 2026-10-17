import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { ParentWorkCardDtoSchema, ParentWorkCardQuerySchema, type ParentWorkCardDto } from "@learning/contracts";
import type { Services } from "../config";
import { localDateAt, splitRewardIntervalByLocalDay, validRewardTimezone } from "../domain/reward-activity";
import { AppError } from "../errors";
import { attempts, assessments, childProfiles, deckVersions, familySettings, learningSessions, rewardActivitySegments, rewardActivitySettlements, rewardActivityXboxRequests, sessionTasks } from "../db/schema";

/** Read-only, child-scoped work report. The HTTP parent router authenticates before calling this. */
export async function readParentWorkCard(services: Services, input: unknown): Promise<ParentWorkCardDto> {
  const parsed = ParentWorkCardQuerySchema.parse(input);
  const [family] = await services.db.select({ timezone: familySettings.timezone }).from(familySettings).limit(1);
  const query = { ...parsed, date: parsed.date ?? localDateAt(services.clock.now(), validRewardTimezone(family?.timezone)) };
  const child = await services.db.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, query.childId)).limit(1);
  if (!child.length) throw new AppError("not_found");

  const xboxRequests = await services.db.select().from(rewardActivityXboxRequests)
    .where(and(eq(rewardActivityXboxRequests.childId, query.childId), or(
      eq(rewardActivityXboxRequests.status, "pending"),
      eq(rewardActivityXboxRequests.localDateSnapshot, query.date),
    ))).orderBy(asc(rewardActivityXboxRequests.requestedAt));

  const sessions = await services.db.select({
    id: learningSessions.id, mode: learningSessions.mode, state: learningSessions.state,
    startedAt: learningSessions.startedAt, endedAt: learningSessions.endedAt,
    dailyRoundDate: learningSessions.dailyRoundDate, context: learningSessions.context, taskBudget: learningSessions.taskBudget,
    deckTitle: deckVersions.title, deckVersionNumber: deckVersions.versionNumber,
  }).from(learningSessions).innerJoin(deckVersions, eq(deckVersions.id, learningSessions.deckVersionId))
    .where(eq(learningSessions.childId, query.childId)).orderBy(asc(learningSessions.startedAt));

  const segments = await services.db.select({ sessionId: rewardActivitySegments.sessionId,
    taskId: rewardActivitySegments.taskId, startedAt: rewardActivitySegments.startedAt, endedAt: rewardActivitySegments.endedAt,
    timezone: rewardActivitySettlements.timezone }).from(rewardActivitySegments)
    .innerJoin(rewardActivitySettlements, eq(rewardActivitySettlements.id, rewardActivitySegments.settlementRef))
    .where(and(eq(rewardActivitySegments.childId, query.childId), isNotNull(rewardActivitySegments.settlementRef)));

  const daySessions = new Map<string, { timezone: string }>();
  const dayTaskIds = new Set<string>();
  for (const session of sessions) {
    const timezone = validRewardTimezone((session.context as Record<string, unknown>).timezone);
    if (localDateAt(session.startedAt, timezone) === query.date) daySessions.set(session.id, { timezone });
  }
  for (const segment of segments) {
    const timezone = validRewardTimezone(segment.timezone);
    const days = splitRewardIntervalByLocalDay(segment.startedAt, segment.endedAt, timezone);
    if (!days.has(query.date)) continue;
    if (!daySessions.has(segment.sessionId)) daySessions.set(segment.sessionId, { timezone });
    dayTaskIds.add(segment.taskId);
  }
  // A completed answer can be relevant even when all active time was discarded (skip/cancel).
  const allAttempts = await services.db.select({ attempt: attempts, sessionId: sessionTasks.sessionId, taskId: sessionTasks.id,
    issuedAt: sessionTasks.issuedAt, context: learningSessions.context })
    .from(attempts).innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .innerJoin(learningSessions, eq(learningSessions.id, sessionTasks.sessionId))
    .where(eq(attempts.childId, query.childId));
  const attemptsByTask = new Map<string, typeof allAttempts>();
  for (const row of allAttempts) {
    const timezone = validRewardTimezone((row.context as Record<string, unknown>).timezone);
    if (localDateAt(row.attempt.receivedAt, timezone) !== query.date) continue;
    const list = attemptsByTask.get(row.taskId) ?? [];
    list.push(row);
    attemptsByTask.set(row.taskId, list);
    dayTaskIds.add(row.taskId);
    if (!daySessions.has(row.sessionId)) daySessions.set(row.sessionId, { timezone });
  }
  const roundRows = sessions.filter(session => session.mode === "daily_round" && session.dailyRoundDate === query.date);
  for (const session of roundRows) daySessions.set(session.id, { timezone: validRewardTimezone((session.context as Record<string, unknown>).timezone) });
  const issuedTasks = await services.db.select({ sessionId: sessionTasks.sessionId, issuedAt: sessionTasks.issuedAt })
    .from(sessionTasks).where(eq(sessionTasks.childId, query.childId));
  const sessionById = new Map(sessions.map(session => [session.id, session]));
  for (const task of issuedTasks) {
    const session = sessionById.get(task.sessionId);
    if (!session) continue;
    const timezone = validRewardTimezone((session.context as Record<string, unknown>).timezone);
    if (localDateAt(task.issuedAt, timezone) === query.date) daySessions.set(session.id, { timezone });
  }
  const sessionIds = [...daySessions.keys()];
  const tasks = sessionIds.length ? await services.db.select().from(sessionTasks).where(and(
    eq(sessionTasks.childId, query.childId), inArray(sessionTasks.sessionId, sessionIds),
  )).orderBy(asc(sessionTasks.ordinal)) : [];
  const taskIds = tasks.map(task => task.id);
  const assessmentRows = taskIds.length ? await services.db.select({ attemptId: assessments.attemptId, outcome: assessments.outcome })
    .from(assessments).innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .where(and(eq(assessments.childId, query.childId), inArray(attempts.taskId, taskIds))) : [];
  const assessmentByAttempt = new Map<string, Set<string>>();
  for (const row of assessmentRows) {
    const values = assessmentByAttempt.get(row.attemptId) ?? new Set<string>();
    values.add(row.outcome);
    assessmentByAttempt.set(row.attemptId, values);
  }
  const secondsBySession = new Map<string, number>();
  for (const segment of segments) {
    const zone = validRewardTimezone(segment.timezone);
    const milliseconds = splitRewardIntervalByLocalDay(segment.startedAt, segment.endedAt, zone).get(query.date) ?? 0;
    if (milliseconds) secondsBySession.set(segment.sessionId, (secondsBySession.get(segment.sessionId) ?? 0) + milliseconds);
  }

  const reportSessions = sessionIds.map(sessionId => {
    const session = sessionById.get(sessionId)!;
    const zone = daySessions.get(sessionId)!.timezone;
    const sessionTasksForDay = tasks.filter(task => task.sessionId === sessionId && (
      session.mode === "daily_round" ? session.dailyRoundDate === query.date || dayTaskIds.has(task.id) || localDateAt(task.issuedAt, zone) === query.date
        : dayTaskIds.has(task.id) || localDateAt(task.issuedAt, zone) === query.date
    ));
    const steps = sessionTasksForDay.map(task => {
      const relevant = (attemptsByTask.get(task.id) ?? []).sort((a, b) => a.attempt.receivedAt.getTime() - b.attempt.receivedAt.getTime());
      const responses = relevant.map(({ attempt }) => {
        const rawAnswer = attempt.answer as Record<string, unknown> | null;
        const textAnswer = attempt.modality === "text" && typeof rawAnswer?.text === "string" ? rawAnswer.text.trim().slice(0, 160) : null;
        const optionAnswer = attempt.modality === "choice" && typeof rawAnswer?.optionText === "string" ? rawAnswer.optionText.trim().slice(0, 160) : null;
        const itemValues = (task.answerKey as { itemValues?: Record<string, unknown> } | null)?.itemValues;
        const sequenceAnswer = attempt.modality === "sequence" && Array.isArray(rawAnswer?.itemIds)
          ? rawAnswer.itemIds.map(id => typeof id === "string" && typeof itemValues?.[id] === "string" ? itemValues[id] as string : "").filter(Boolean).join(" ").trim().slice(0, 160) || null
          : null;
        const feedbackKind = typeof attempt.feedback?.kind === "string" ? attempt.feedback.kind : null;
        const assessment = session.mode === "daily_round" ? null
          : attempt.modality === "skip" || attempt.modality === "dont_remember" ? "none"
            : assessmentByAttempt.get(attempt.id)?.has("unassessed") && [...assessmentByAttempt.get(attempt.id)!].some(outcome => outcome !== "unassessed") ? "mixed"
              : assessmentByAttempt.get(attempt.id)?.has("unassessed") ? "unassessed"
                : assessmentByAttempt.has(attempt.id) ? "assessed" : "none";
        return {
          modality: attempt.modality as "choice" | "text" | "audio" | "dont_remember" | "skip" | "sequence",
          answerExample: attempt.modality === "dont_remember" ? "Nie pamiętam" : textAnswer ?? optionAnswer ?? sequenceAnswer,
          feedbackKind, assessment,
          responseSeconds: Math.max(0, Math.ceil((attempt.receivedAt.getTime() - task.issuedAt.getTime()) / 1000)),
        };
      });
      return {
        taskId: task.id, ordinal: task.ordinal, exerciseType: task.exerciseType, state: task.state as "issued" | "answered" | "completed" | "skipped",
        issuedAt: task.issuedAt.toISOString(), responses,
      };
    });
    return {
      sessionId, mode: session.mode as "training" | "mock_test" | "daily_round", state: session.state as "active" | "completed" | "ended",
      startedAt: session.startedAt.toISOString(), endedAt: session.endedAt?.toISOString() ?? null,
      deckTitle: session.deckTitle, deckVersionNumber: session.deckVersionNumber,
      creditedSeconds: secondsBySession.get(sessionId) ? Math.floor(secondsBySession.get(sessionId)! / 1000) : 0,
      remainingSteps: Math.max(0, session.taskBudget - tasks.filter(task => task.sessionId === sessionId &&
        (session.mode === "daily_round" || (task.exerciseType !== "exposure" && task.exerciseType !== "lesson_card"))).length), steps,
    };
  });
  const round = roundRows[0];
  const roundSteps = round ? tasks.filter(task => task.sessionId === round.id) : [];
  const dayMilliseconds = segments.reduce((total, segment) => total + (splitRewardIntervalByLocalDay(segment.startedAt, segment.endedAt, validRewardTimezone(segment.timezone)).get(query.date) ?? 0), 0);
  return ParentWorkCardDtoSchema.parse({
    childId: query.childId, date: query.date, creditedSeconds: Math.floor(dayMilliseconds / 1000), sessions: reportSessions,
    xboxRequests: xboxRequests.map(request => ({
      requestId: request.id, status: request.status, requestedAt: request.requestedAt.toISOString(),
      timezone: request.timezoneSnapshot, localDate: request.localDateSnapshot,
      blockNumber: request.blockNumberSnapshot, creditedSeconds: request.creditedSecondsSnapshot,
      pointsCost: request.pointsCost, xboxMinutes: request.xboxMinutes,
    })),
    dailyRound: { state: round?.state ?? null, sessionId: round?.id ?? null, deckTitle: round?.deckTitle ?? null,
      steps: round ? roundSteps.length : null, answered: round ? roundSteps.filter(task => task.state === "answered").length : null },
  });
}
