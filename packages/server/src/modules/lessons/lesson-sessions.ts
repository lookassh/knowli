import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, max } from "drizzle-orm";
import type { TaskDto, TaskPrompt } from "@learning/contracts";
import type { Services } from "../../config";
import type { Executor, Tx } from "../../db/client";
import {
  assessments,
  attempts,
  childObjectiveProgress,
  deckVersions,
  eventExposures,
  itemRevisions,
  learningEvents,
  learningSessions,
  mediaAssets,
  revisionAssets,
  sessionTasks,
} from "../../db/schema";
import { AppError } from "../../errors";
import type { LearningObjective, LessonExerciseType, LessonTopic, SubjectModule } from "../../domain/lessons/types";
import {
  selectLessonTask,
  type LessonExerciseCandidate,
  type LessonScheduleInput,
  type LessonSessionOutcome,
  type LessonSessionTask,
  type LessonTaskPlan,
  type ObjectiveProgressSnapshot,
} from "../../domain/lessons/scheduler";
import { DEFAULT_LESSON_POLICY } from "../../domain/lessons/lesson-policy";
import { renderCard } from "../../domain/lessons/card";
import { computeTargetKey } from "../../domain/target-key";
import { isTestPreparationWindow } from "../../domain/test-preparation";
import type { ProgressStatus } from "../../domain/types";
import { contextOf, writeSealedEvent, type SessionContextShape } from "../events";
import { mapObjectiveStatus as mapStatus } from "../../domain/lessons/progress-status";
import {
  materializeCard,
  materializeExercise,
  type LessonExercisePayload,
  type LoadedExercise,
  type MaterializedLessonTask,
} from "./lesson-materialize";

/**
 * Sesja lekcji po stronie serwera (zadanie 13). `sessions.ts` deleguje tu dla
 * zestawów `kind='lesson'`: `buildLessonSessionContext` daje kontekst startowy,
 * `issueNextLessonTask` składa wejście selektora z bazy, woła `selectLessonTask`
 * i wydaje zadanie (publiczny prompt + prywatny `answer_key`), zapisując
 * ekspozycje ujawnianej treści PRZED odpowiedzią HTTP w tej samej transakcji.
 *
 * Kroki wspólne obu rodzajów (blokada profilu, jedna aktywna sesja, wznowienie,
 * przeterminowanie, budżet, limit czasu, obietnica „Jeszcze N”) są w `sessions.ts`
 * i działają przed delegacją — tu żyje wyłącznie to, co w lekcjach inne niż w
 * słówkach. Vocabulary pozostaje nietknięte.
 */

/** Domyślny limit wywołań modelu na sesję, gdy grader niekonfigurowany (zadanie 15). */
const GRADER_CALLS_PER_SESSION_FALLBACK = 20;

/** Kontekst sesji lekcji: pola wspólne + lekcyjne (bezpieczne rozszerzenie). */
export interface LessonSessionContext extends SessionContextShape {
  /** Wywołania modelu oceniającego w tej sesji (limit polityki) — zadanie 13B/15. */
  graderCalls: number;
  /** Ostatni kontakt dziecka z ćwiczeniem danego celu przed startem sesji. */
  previousObjectiveContact: Record<string, string>;
  initialObjectiveProgress?: Record<string, ObjectiveProgressSnapshot>;
}

/** `lesson_context` zapisany w `deck_versions.lesson_context`. */
interface LessonContextShape {
  subjectId: string;
  topicId: string;
  topicVersion: number;
  objectiveIds: string[];
  examples: Record<string, string[]>;
}

/** Odczyt `lesson_context` z wersji sesji; rzuca, gdy brak (nie powinno się zdarzyć dla lekcji). */
export function lessonContextOf(version: typeof deckVersions.$inferSelect): LessonContextShape {
  const raw = version.lessonContext as Partial<LessonContextShape> | null;
  if (!raw || typeof raw.subjectId !== "string" || typeof raw.topicId !== "string") {
    throw new AppError("internal", { message: "lesson version without lesson_context" });
  }
  return {
    subjectId: raw.subjectId,
    topicId: raw.topicId,
    topicVersion: typeof raw.topicVersion === "number" ? raw.topicVersion : 1,
    objectiveIds: Array.isArray(raw.objectiveIds) ? raw.objectiveIds : [],
    examples: raw.examples ?? {},
  };
}

/** Przypięta wersja tematu z rejestru (publikacja przypina `topicVersion`). */
export function requireTopic(services: Services, ctx: LessonContextShape): { subject: SubjectModule; topic: LessonTopic } {
  const subject = services.subjects.getSubject(ctx.subjectId);
  const topic = subject ? services.subjects.getTopic(ctx.subjectId, ctx.topicId, ctx.topicVersion) : undefined;
  if (!subject || !topic) {
    throw new AppError("internal", { message: `lesson subject/topic missing: ${ctx.subjectId}/${ctx.topicId} v${ctx.topicVersion}` });
  }
  return { subject, topic };
}

/** Czy model oceniający jest skonfigurowany (zadanie 15 — rzeczywisty port). */
function graderAvailable(services: Services): boolean {
  return services.grader !== undefined;
}

/**
 * Snapshot ostatniego kontaktu dziecka z każdym celem PRZED startem sesji
 * (odpowiednik `previousContactSnapshot` słówek): najpóźniejsze zdarzenie na
 * dowolnym ćwiczeniu celu w tej wersji, zamrożone w kontekście przy starcie.
 */
async function previousObjectiveContactSnapshot(
  tx: Tx,
  childId: string,
  deckVersionId: string,
  before: Date,
): Promise<Record<string, string>> {
  const rows = await tx
    .select({ payload: itemRevisions.payload, latest: max(learningEvents.occurredAt) })
    .from(learningEvents)
    .innerJoin(sessionTasks, eq(sessionTasks.id, learningEvents.taskId))
    .innerJoin(itemRevisions, eq(itemRevisions.id, sessionTasks.itemRevisionId))
    .where(and(eq(learningEvents.childId, childId), eq(itemRevisions.deckVersionId, deckVersionId), lte(learningEvents.occurredAt, before)))
    .groupBy(itemRevisions.payload);
  const result: Record<string, string> = {};
  for (const row of rows) {
    const objectiveId = (row.payload as { objectiveId?: string }).objectiveId;
    if (!objectiveId || !row.latest) continue;
    const iso = row.latest.toISOString();
    if (!result[objectiveId] || iso > result[objectiveId]!) {
      result[objectiveId] = iso;
    }
  }
  return result;
}

/** Buduje kontekst startowy sesji lekcji (wołane z `startSession` w `sessions.ts`). */
export async function buildLessonSessionContext(
  tx: Tx,
  args: { childId: string; deckVersionId: string; timezone: string; testDate: string | null | undefined; now: Date },
): Promise<LessonSessionContext> {
  const version = (await tx.select().from(deckVersions).where(eq(deckVersions.id, args.deckVersionId)))[0]!;
  const context = lessonContextOf(version);
  const rows = await tx.select().from(childObjectiveProgress).where(and(
    eq(childObjectiveProgress.childId, args.childId), eq(childObjectiveProgress.subjectId, context.subjectId),
  ));
  const initialObjectiveProgress: Record<string, ObjectiveProgressSnapshot> = {};
  for (const row of rows) {
    initialObjectiveProgress[row.objectiveId] = { status: mapStatus(row.status), nextReviewAt: row.nextReviewAt?.toISOString() ?? null };
  }
  return {
    timezone: args.timezone,
    ...(args.testDate === undefined ? {} : { testDate: args.testDate }),
    previousContact: {},
    reservations: [],
    settledChecks: [],
    graderCalls: 0,
    previousObjectiveContact: await previousObjectiveContactSnapshot(tx, args.childId, args.deckVersionId, args.now),
    initialObjectiveProgress,
  };
}

/** Odczyt kontekstu lekcji z sesji (bez utraty pól bazowych). */
export function lessonSessionContextOf(session: { context: Record<string, unknown> }): LessonSessionContext {
  const base = contextOf(session);
  const raw = session.context as Partial<LessonSessionContext>;
  return {
    ...base,
    graderCalls: typeof raw.graderCalls === "number" ? raw.graderCalls : 0,
    previousObjectiveContact: raw.previousObjectiveContact ?? {},
    ...(raw.initialObjectiveProgress === undefined ? {} : { initialObjectiveProgress: raw.initialObjectiveProgress }),
  };
}

/** Ładuje pulę ćwiczeń przypiętej wersji w kolejności pozycji. */
export async function loadExercises(tx: Executor, deckVersionId: string): Promise<LoadedExercise[]> {
  const revisions = await tx
    .select({ id: itemRevisions.id, itemId: itemRevisions.itemId, position: itemRevisions.position, payload: itemRevisions.payload, targetKey: itemRevisions.targetKey })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, deckVersionId))
    .orderBy(asc(itemRevisions.position));

  // Audio odpowiedzi kanonicznej (`target_audio`) przygotowane przy publikacji,
  // gdy przedmiot ma `ttsForAnswers`. Odtwarzane jako wsparcie w ćwiczeniach
  // tekstowych (wym. 4.6); `materializeExercise` dołącza je tylko do tych typów.
  // Liczy się wyłącznie gotowy zasób (`revision_assets.state='approved'` i
  // `media_assets.state='ready'`), identycznie jak słówka rozwiązują audio.
  const revisionIds = revisions.map((r) => r.id);
  const audioRows = revisionIds.length
    ? await tx
        .select({ itemRevisionId: revisionAssets.itemRevisionId, assetId: revisionAssets.assetId })
        .from(revisionAssets)
        .innerJoin(mediaAssets, eq(mediaAssets.id, revisionAssets.assetId))
        .where(
          and(
            inArray(revisionAssets.itemRevisionId, revisionIds),
            eq(revisionAssets.role, "target_audio"),
            eq(revisionAssets.state, "approved"),
            eq(mediaAssets.state, "ready"),
          ),
        )
    : [];
  const audioByRevision = new Map(audioRows.map((a) => [a.itemRevisionId, a.assetId] as const));

  return revisions.map((r) => ({
    revisionId: r.id,
    itemId: r.itemId,
    position: r.position,
    payload: r.payload as unknown as LessonExercisePayload,
    targetKey: r.targetKey,
    audioAssetId: audioByRevision.get(r.id) ?? null,
  }));
}

/** Liczba wydanych i ocenianych zadań (karty nie liczą się do budżetu). */
export async function lessonTaskCounts(tx: Tx, sessionId: string): Promise<{ total: number; assessed: number }> {
  const rows = await tx.select({ exerciseType: sessionTasks.exerciseType }).from(sessionTasks).where(eq(sessionTasks.sessionId, sessionId));
  return { total: rows.length, assessed: rows.filter((r) => r.exerciseType !== "lesson_card").length };
}

/** Wynik oceny per zadanie tej sesji (z `assessments` przez `attempts`). */
async function loadSessionOutcomes(tx: Tx, sessionId: string): Promise<Map<string, LessonSessionOutcome>> {
  const rows = await tx
    .select({ taskId: attempts.taskId, modality: attempts.modality, outcome: assessments.outcome })
    .from(attempts)
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .leftJoin(assessments, eq(assessments.attemptId, attempts.id))
    .where(eq(sessionTasks.sessionId, sessionId));
  const byTask = new Map<string, LessonSessionOutcome>();
  for (const row of rows) {
    let outcome: LessonSessionOutcome;
    if (row.modality === "skip") outcome = "skipped";
    else if (row.modality === "dont_remember") outcome = "dont_remember";
    else if (row.outcome === "correct") outcome = "correct";
    else if (row.outcome === "incorrect") outcome = "incorrect";
    else outcome = "unevaluated";
    byTask.set(row.taskId, outcome);
  }
  return byTask;
}

interface PlannedLesson {
  plan: LessonTaskPlan;
  exercises: LoadedExercise[];
  topic: LessonTopic;
  subject: SubjectModule;
  context: LessonContextShape;
  cardIndexByObjective: Map<string, number>;
}

/** Składa wejście selektora z bazy i wywołuje `selectLessonTask`. */
async function planLessonTask(
  services: Services,
  tx: Tx,
  session: typeof learningSessions.$inferSelect,
  now: Date,
  assessedRemaining: number,
): Promise<PlannedLesson | null> {
  const version = (await tx.select().from(deckVersions).where(eq(deckVersions.id, session.deckVersionId)))[0]!;
  const context = lessonContextOf(version);
  const { subject, topic } = requireTopic(services, context);
  const exercises = await loadExercises(tx, session.deckVersionId);
  if (exercises.length === 0) {
    return null;
  }

  const objectiveById = new Map(topic.objectives.map((o) => [o.id, o] as const));
  const objectiveOrder = topic.objectives.map((o) => o.id).filter((id) => context.objectiveIds.includes(id));
  const cardCountByObjective: Record<string, number> = {};
  for (const id of objectiveOrder) {
    cardCountByObjective[id] = objectiveById.get(id)?.cards.length ?? 0;
  }

  const progressRows = await tx
    .select({ objectiveId: childObjectiveProgress.objectiveId, status: childObjectiveProgress.status, nextReviewAt: childObjectiveProgress.nextReviewAt })
    .from(childObjectiveProgress)
    .where(and(eq(childObjectiveProgress.childId, session.childId), eq(childObjectiveProgress.subjectId, context.subjectId)));
  const progress: Record<string, { status: ProgressStatus; nextReviewAt: string | null }> = {};
  for (const row of progressRows) {
    progress[row.objectiveId] = { status: mapStatus(row.status), nextReviewAt: row.nextReviewAt?.toISOString() ?? null };
  }

  const targetKeys = [...new Set(exercises.map((e) => e.targetKey))];
  const historicalRows = targetKeys.length
    ? await tx
        .select({ targetKey: eventExposures.targetKey })
        .from(eventExposures)
        .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
        .where(and(eq(eventExposures.childId, session.childId), eq(learningEvents.sealed, true), lte(learningEvents.occurredAt, session.startedAt), inArray(eventExposures.targetKey, targetKeys)))
    : [];
  const exposedTargetKeys = new Set(historicalRows.map((r) => r.targetKey));

  const taskRows = await tx
    .select({ id: sessionTasks.id, itemRevisionId: sessionTasks.itemRevisionId, ordinal: sessionTasks.ordinal, exerciseType: sessionTasks.exerciseType, context: sessionTasks.context })
    .from(sessionTasks)
    .where(eq(sessionTasks.sessionId, session.id))
    .orderBy(asc(sessionTasks.ordinal));
  const exerciseByRevision = new Map(exercises.map((e) => [e.revisionId, e] as const));
  const outcomeByTask = await loadSessionOutcomes(tx, session.id);
  const cardIndexByObjective = new Map<string, number>();
  const sessionHistory: LessonSessionTask[] = taskRows.map((row) => {
    const taskContext = row.context as { objectiveId?: string; cardPurpose?: string } | null;
    const exercise = exerciseByRevision.get(row.itemRevisionId);
    const type = row.exerciseType as LessonExerciseType;
    const objectiveId = taskContext?.objectiveId ?? exercise?.payload.objectiveId ?? "";
    const kind: LessonSessionTask["kind"] =
      type === "lesson_card" ? (taskContext?.cardPurpose === "support" ? "support_card" : "card") : "exercise";
    if (kind === "card") {
      cardIndexByObjective.set(objectiveId, (cardIndexByObjective.get(objectiveId) ?? 0) + 1);
    }
    const outcome = outcomeByTask.get(row.id);
    return {
      ordinal: row.ordinal,
      itemId: kind === "exercise" ? exercise?.itemId ?? null : null,
      objectiveId,
      exerciseType: type,
      kind,
      ...(outcome ? { outcome } : {}),
    };
  });

  const lastSeenAt: Record<string, string> = {};
  const issuedRows = await tx
    .select({ itemId: itemRevisions.itemId, latest: max(sessionTasks.issuedAt) })
    .from(sessionTasks)
    .innerJoin(itemRevisions, eq(itemRevisions.id, sessionTasks.itemRevisionId))
    .where(and(eq(sessionTasks.childId, session.childId), inArray(itemRevisions.itemId, exercises.map((exercise) => exercise.itemId))))
    .groupBy(itemRevisions.itemId);
  for (const row of issuedRows) {
    if (row.latest) lastSeenAt[row.itemId] = row.latest.toISOString();
  }

  const sessionContext = lessonSessionContextOf(session);
  const testWindowOpen =
    sessionContext.testDate != null && isTestPreparationWindow({ now: now.toISOString(), testDate: sessionContext.testDate, timezone: sessionContext.timezone });

  const input: LessonScheduleInput = {
    exercises: exercises.map(
      (e): LessonExerciseCandidate => ({ itemId: e.itemId, itemRevisionId: e.revisionId, objectiveId: e.payload.objectiveId, exerciseType: e.payload.exerciseType, targetKey: e.targetKey }),
    ),
    objectiveOrder,
    progress,
    ...(sessionContext.initialObjectiveProgress === undefined ? {} : { initialProgress: sessionContext.initialObjectiveProgress }),
    exposedTargetKeys,
    sessionHistory,
    lastSeenAt,
    cardCountByObjective,
    assessedRemaining,
    testWindowOpen,
    graderAvailable: graderAvailable(services),
    graderCallsLeft: Math.max(0, (services.grader?.maxCallsPerSession ?? GRADER_CALLS_PER_SESSION_FALLBACK) - sessionContext.graderCalls),
    policy: DEFAULT_LESSON_POLICY,
    now: now.toISOString(),
  };

  const plan = selectLessonTask(input);
  if (!plan) {
    return null;
  }
  return { plan, exercises, topic, subject, context, cardIndexByObjective };
}

function lessonTaskDto(session: typeof learningSessions.$inferSelect, task: { id: string; ordinal: number; exerciseType: LessonExerciseType; prompt: TaskPrompt }, assessedBefore: number): TaskDto {
  return {
    taskId: task.id,
    sessionId: session.id,
    ordinal: task.ordinal,
    exerciseType: task.exerciseType,
    direction: null,
    state: "issued",
    prompt: task.prompt,
    remainingAssessed: session.taskBudget - assessedBefore,
  };
}

/**
 * Wydaje kolejne zadanie lekcji pod blokadą sesji (wołane z `nextTask` w
 * `sessions.ts` po wspólnych krokach budżetu i limitu czasu). Dla już wydanego
 * zadania zwraca je idempotentnie; inaczej planuje, materializuje, zapisuje
 * zadanie i jego ekspozycje w tej transakcji i zwraca DTO. `null` kończy sesję.
 */
export async function issueNextLessonTask(
  services: Services,
  tx: Tx,
  session: typeof learningSessions.$inferSelect,
  now: Date,
  assessedRemaining: number,
  nextOrdinal: number,
): Promise<TaskDto | null> {
  const planned = await planLessonTask(services, tx, session, now, assessedRemaining);
  if (!planned) {
    return null;
  }
  const { plan, exercises, topic, subject, context, cardIndexByObjective } = planned;
  const taskId = randomUUID();

  let materialized: MaterializedLessonTask;
  if (plan.kind === "card") {
    const objective = topic.objectives.find((o) => o.id === plan.objectiveId)!;
    const cardIndex = plan.cardPurpose === "support" ? 0 : cardIndexByObjective.get(plan.objectiveId) ?? 0;
    const anchorRevision = exercises.find((e) => e.payload.objectiveId === plan.objectiveId) ?? exercises[0]!;
    materialized = materializeCard(plan, Math.min(cardIndex, objective.cards.length - 1), objective, subject, context.examples[plan.objectiveId] ?? [], anchorRevision.revisionId);
  } else {
    const exercise = exercises.find((e) => e.revisionId === plan.itemRevisionId)!;
    materialized = materializeExercise(plan, taskId, exercise, topic, subject);
  }

  const counts = await lessonTaskCounts(tx, session.id);
  await tx.insert(sessionTasks).values({
    id: taskId,
    sessionId: session.id,
    childId: session.childId,
    deckVersionId: session.deckVersionId,
    itemRevisionId: materialized.itemRevisionId,
    ordinal: nextOrdinal,
    exerciseType: materialized.exerciseType,
    direction: null,
    state: "issued",
    publicPrompt: materialized.prompt as unknown as Record<string, unknown>,
    answerKey: materialized.answerKey,
    context: materialized.context,
    issuedAt: now,
  });
  const anchorItemId = exercises.find((e) => e.revisionId === materialized.itemRevisionId)!.itemId;
  await writeSealedEvent(tx, {
    childId: session.childId,
    taskId,
    itemId: anchorItemId,
    kind: "prompt_issued",
    stepId: `${taskId}:prompt`,
    occurredAt: now,
    exposures: materialized.exposures,
  });
  return lessonTaskDto(session, { id: taskId, ordinal: nextOrdinal, exerciseType: materialized.exerciseType, prompt: materialized.prompt }, counts.assessed);
}

/**
 * Wartości listy zestawów dziecka dla lekcji (zadanie 13, `modules/kid.ts`):
 * `itemCount` = liczba celów lekcji; `independentlyRecalledCount` = liczba celów
 * `mastered`; `recommended` = selektor ma pracę (bez efektów ubocznych).
 */
export async function lessonDeckListValues(
  services: Services,
  exec: Executor,
  args: { childId: string; deckVersionId: string; testDate: string | null; timezone: string; now: Date },
): Promise<{ itemCount: number; independentlyRecalledCount: number; recommended: boolean }> {
  const version = (await exec.select().from(deckVersions).where(eq(deckVersions.id, args.deckVersionId)))[0]!;
  const context = lessonContextOf(version);
  const { topic } = requireTopic(services, context);
  const exercises = await loadExercises(exec, args.deckVersionId);
  const objectiveOrder = topic.objectives.map((o) => o.id).filter((id) => context.objectiveIds.includes(id));

  // Postęp celów: tylko cele z ćwiczeniami w puli liczą się do rekomendacji
  // (cel bez ćwiczeń selektor i tak pomija).
  const objectivesWithExercises = new Set(exercises.map((e) => e.payload.objectiveId));
  const progressRows = await exec
    .select({ objectiveId: childObjectiveProgress.objectiveId, status: childObjectiveProgress.status, nextReviewAt: childObjectiveProgress.nextReviewAt })
    .from(childObjectiveProgress)
    .where(and(eq(childObjectiveProgress.childId, args.childId), eq(childObjectiveProgress.subjectId, context.subjectId)));
  const statusByObjective = new Map<string, ProgressStatus>();
  const dueByObjective = new Map<string, string | null>();
  let masteredCount = 0;
  for (const row of progressRows) {
    const status = mapStatus(row.status);
    statusByObjective.set(row.objectiveId, status);
    dueByObjective.set(row.objectiveId, row.nextReviewAt?.toISOString() ?? null);
    if (status === "mastered" && objectiveOrder.includes(row.objectiveId)) masteredCount += 1;
  }

  // Rekomendacja (odpowiednik `hasScheduledWork` słówek): istnieje cel lekcji
  // nie `mastered` (nowy materiał lub w toku) ALBO należne sprawdzenie celu
  // opanowanego. Dodatkowe utrwalanie nie czyni zestawu rekomendowanym.
  const nowIso = args.now.toISOString();
  const recommended = objectiveOrder.some((id) => {
    if (!objectivesWithExercises.has(id)) return false;
    const status = statusByObjective.get(id);
    if (status === undefined || status === "not_assessed") return true; // nowy materiał
    if (status !== "mastered") return true; // w toku
    const due = dueByObjective.get(id);
    return due !== null && due !== undefined && due <= nowIso; // należne sprawdzenie
  });

  return { itemCount: objectiveOrder.length, independentlyRecalledCount: masteredCount, recommended };
}
