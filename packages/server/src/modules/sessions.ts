import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, max } from "drizzle-orm";
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
  type VisualType,
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
  type SkillSnapshot,
  type TaskPlan,
} from "../domain/scheduler";
import type { ProgressStatus, ReadingDirection, Skill } from "../domain/types";
import { loadPolicy, ensureLearningPolicy, CURRENT_POLICY_ID } from "../policies/registry";
import { lockTaskWithSession, writeSealedEvent, contextOf, type SessionContextShape } from "./events";
import { payloadToItem } from "./item-payload";
import { summarizeSessionAssessments } from "../domain/session-summary";
import { computeTargetKey } from "../domain/target-key";
import { addLegacyTaskPromptDefaults } from "./task-prompt-compat";

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
  return {
    sessionId: row.id,
    childId: row.childId,
    deckId: row.deckId,
    deckVersionId: row.deckVersionId,
    policyId: row.policyId,
    microphoneEnabled: row.microphoneEnabled,
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
    .select({ itemId: itemRevisions.itemId })
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
        lt(learningEvents.occurredAt, before),
      ),
    )
    .groupBy(learningEvents.itemId);
  return Object.fromEntries(rows.map((r) => [r.itemId, r.latest!.toISOString()]));
}

/**
 * Start lub wznowienie sesji dziecka (arch §9.1). Blokada wiersza profilu
 * serializuje równoległe starty; ta sama talia wznawia aktywną sesję, inna
 * lub przeterminowanie (>30 min bez zdarzeń) zamyka ją stanem ended.
 */
export async function startSession(services: Services, input: SessionInput): Promise<SessionDto> {
  const valid = SessionInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    const child = (
      await tx.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, valid.childId)).for("update")
    )[0];
    if (!child) {
      throw new AppError("not_found");
    }
    const assignment = (
      await tx
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.childId, valid.childId),
            eq(assignments.deckId, valid.deckId),
            eq(assignments.active, true),
          ),
        )
    )[0];
    if (!assignment) {
      throw new AppError("not_found");
    }
    const deck = (await tx.select().from(decks).where(eq(decks.id, valid.deckId)))[0];
    if (!deck) {
      throw new AppError("not_found");
    }
    if (deck.archivedAt) {
      throw new AppError("conflict");
    }
    if (!deck.publishedVersionId) {
      throw new AppError("validation", { message: "deck is not published" });
    }

    const now = services.clock.now();
    const active = (
      await tx
        .select()
        .from(learningSessions)
        .where(and(eq(learningSessions.childId, valid.childId), eq(learningSessions.state, "active")))
    )[0];
    if (active) {
      const stale =
        now.getTime() - (await lastActivityAt(tx, active.id, active.startedAt)).getTime() >
        RESUME_WINDOW_MS;
      if (active.deckId === valid.deckId && !stale) {
        return sessionDto(tx, active, true);
      }
      await tx
        .update(learningSessions)
        .set({ state: "ended", endedAt: now })
        .where(eq(learningSessions.id, active.id));
    }

    const version = (
      await tx.select().from(deckVersions).where(eq(deckVersions.id, deck.publishedVersionId))
    )[0]!;
    await ensureLearningPolicy(tx);
    // polityka per dziecko (design 2026-10-09): własna wersja profilu albo bieżąca globalna
    const childProfile = (
      await tx.select({ policyId: childProfiles.policyId }).from(childProfiles).where(eq(childProfiles.id, valid.childId))
    )[0];
    const context: SessionContextShape = {
      timezone: await readTimezone(tx),
      previousContact: await previousContactSnapshot(tx, valid.childId, version.id, now),
      reservations: [],
      settledChecks: [],
    };
    const id = randomUUID();
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
        taskBudget: DEFAULT_TASK_BUDGET,
        startedAt: now,
        context: context as unknown as Record<string, unknown>,
      })
      .returning();
    return sessionDto(tx, row!, false);
  });
}

interface PlannedItem {
  itemId: string;
  source: string;
  target: string;
  acceptedAnswers: string[];
  visualType: VisualType;
  visualData?: Record<string, unknown>;
  example?: string;
  sourceLocale: string;
  targetLocale: string;
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
  const revisions = await tx
    .select()
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, session.deckVersionId))
    .orderBy(asc(itemRevisions.position));
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
        readingDirections: {},
        practiceMix: { listening: 0, reading: 0 },
      },
    ]),
  );
  const taskRows = await tx
    .select({
      itemRevisionId: sessionTasks.itemRevisionId,
      exerciseType: sessionTasks.exerciseType,
      direction: sessionTasks.direction,
      ordinal: sessionTasks.ordinal,
      context: sessionTasks.context,
    })
    .from(sessionTasks)
    .where(eq(sessionTasks.sessionId, session.id));
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
  const gradedRows = await tx
    .select({
      attemptId: attempts.id,
      itemRevisionId: sessionTasks.itemRevisionId,
      modality: attempts.modality,
      outcome: assessments.outcome,
    })
    .from(attempts)
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .leftJoin(assessments, eq(assessments.attemptId, attempts.id))
    .where(eq(sessionTasks.sessionId, session.id));
  const failuresByRevision = new Map<string, number>();
  const incorrectAttempts = new Set<string>();
  for (const row of gradedRows) {
    if (row.outcome === "incorrect") {
      incorrectAttempts.add(row.attemptId);
    }
  }
  for (const row of gradedRows) {
    const current = failuresByRevision.get(row.itemRevisionId) ?? 0;
    if (incorrectAttempts.has(row.attemptId)) {
      failuresByRevision.set(row.itemRevisionId, current + 1);
    } else if (row.modality === "dont_remember" && !incorrectAttempts.has(row.attemptId)) {
      failuresByRevision.set(row.itemRevisionId, current + policy.supportAfterFailures);
    }
  }

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
        },
      ];
    }),
  );

  // kontakt z poprzednich sesji zamrożony przy starcie (arch §9.3) —
  // porządek rotacji utrwalania na rozpoczętym zestawie
  const sessionContext = contextOf(session);

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
    const progress: Partial<Record<Skill, SkillSnapshot>> = {};
    for (const row of progressRows) {
      if (row.itemRevisionId !== r.id || row.status === null) continue;
      progress[row.skill as Skill] = {
        status: mapStatus(row.status),
        nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
        streak: row.streak ?? 0,
      };
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
      failuresThisSession: failuresByRevision.get(r.id) ?? 0,
      supportedThisSession: stats.supportedThisSession,
      usedThisSession: stats.usedThisSession,
      presentationsThisSession: stats.presentationsThisSession,
      lastContactAt: sessionContext.previousContact[r.itemId] ?? null,
      lastUsedOrdinal: stats.lastUsedOrdinal,
      readingDirections: stats.readingDirections,
      practiceMix: stats.practiceMix,
      introducedSkills: introducedByRevision.get(r.id) ?? { recall: false, pronunciation: false },
    };
  });
  const peers = candidates.map((c) => ({
    itemRevisionId: c.itemRevisionId,
    position: c.position,
    target: c.target,
    source: c.source,
    targetLocale: c.targetLocale,
  }));

  const plan = selectTask({
    now: now.toISOString(),
    policy,
    microphoneEnabled: session.microphoneEnabled,
    assessedRemaining,
    nextOrdinal,
    candidates,
    peers,
    reservedTargetKeys: sessionContext.reservations,
    settledCheckTargetKeys: sessionContext.settledChecks,
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

/** Deterministyczny fragment uzupełniania liter: co druga litera widoczna. */
function letterFragment(target: string): string {
  const chars = [...target];
  if (chars.length <= 2) {
    return chars[0] ?? target;
  }
  return chars.map((char, index) => (index % 2 === 0 ? char : "_")).join("");
}

function materializeTask(
  plan: TaskPlan,
  item: PlannedItem,
  audioAssetId: string | null,
  imageAssetId: string | null,
  exampleAudioAssetId: string | null,
): { prompt: TaskPrompt; answerKey: Record<string, unknown> } {
  const optionIds = new Map(
    (plan.options ?? []).map((o) => [o.text, randomUUID()] as const),
  );
  const promptOptions = (plan.options ?? []).map((o) => ({
    id: optionIds.get(o.text)!,
    text: o.text,
  }));
  const correctOption = plan.options?.find((o) => o.correct);
  const answerKey: Record<string, unknown> = {
    exerciseType: plan.exerciseType,
    target: item.target,
    acceptedAnswers: item.acceptedAnswers,
    ...(plan.direction ? { direction: plan.direction } : {}),
    ...(correctOption ? { correctOptionId: optionIds.get(correctOption.text)! } : {}),
  };

  let prompt: TaskPrompt;
  switch (plan.exerciseType) {
    case "exposure":
      prompt = {
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
      prompt = { kind: "listening", options: promptOptions, audioAssetId: audioAssetId! };
      break;
    case "reading":
      prompt = { kind: "reading", text: item.target, options: promptOptions };
      break;
    case "reverse_recognition":
      prompt = { kind: "reverse_recognition", prompt: item.source, options: promptOptions };
      break;
    case "recall":
      prompt = { kind: "recall", prompt: item.source };
      break;
    case "spelling":
      prompt = { kind: "spelling", prompt: item.source };
      break;
    case "letter_completion":
      prompt = { kind: "letter_completion", prompt: item.source, fragment: letterFragment(item.target) };
      break;
    case "speech":
      prompt = {
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

    const issued = (
      await tx
        .select()
        .from(sessionTasks)
        .where(and(eq(sessionTasks.sessionId, id), eq(sessionTasks.state, "issued")))
        .limit(1)
    )[0];
    if (issued) {
      const counts = await taskCounts(tx, id);
      const assessedBefore =
        counts.assessed - (issued.exerciseType !== "exposure" ? 1 : 0);
      return issuedTaskDto(session, issued, assessedBefore);
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
      context: { reason: plan.reason },
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
): TaskDto {
  // Zachowaj znaczenie snapshotów i dopełnij jedynie brakujące pola kontraktu.
  const prompt = addLegacyTaskPromptDefaults(task.publicPrompt as Record<string, unknown>);
  return {
    taskId: task.id,
    sessionId: session.id,
    ordinal: task.ordinal,
    exerciseType: task.exerciseType as TaskDto["exerciseType"],
    direction: (task.direction ?? null) as TaskDto["direction"],
    state: "issued",
    prompt: prompt as TaskPrompt,
    remainingAssessed: session.taskBudget - assessedBefore,
  };
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
    if (task.exerciseType !== "exposure") {
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
    return { taskId: task.id, state: "completed" as const, completedAt: now.toISOString() };
  });
}

/** Jawny koniec z podsumowaniem; idempotentny dla sesji już zakończonej. */
export async function endSession(services: Services, sessionId: string): Promise<SessionSummaryDto> {
  const id = UuidSchema.parse(sessionId);
  return services.db.transaction(async (tx) => {
    const session = await lockSession(tx, id);
    let state = session.state as "active" | "completed" | "ended";
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
    const summary: SessionSummaryDto = saved.success ? saved.data : {
      sessionId: id,
      state,
      tasksIssued: counts.total,
      assessedTasksIssued: counts.assessed,
      endedAt: endedAt!.toISOString(),
      ...summarizeSessionAssessments(rows.map(row => ({ ...row, target: payloadToItem(row.payload).target }))),
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
