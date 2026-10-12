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
} from "../../domain/lessons/scheduler";
import { DEFAULT_LESSON_POLICY } from "../../domain/lessons/lesson-policy";
import { renderCard } from "../../domain/lessons/card";
import { computeTargetKey } from "../../domain/target-key";
import { isTestPreparationWindow } from "../../domain/test-preparation";
import type { ProgressStatus } from "../../domain/types";
import { contextOf, writeSealedEvent, type SessionContextShape } from "../events";
import { mapObjectiveStatus as mapStatus } from "../../domain/lessons/progress-status";

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
}

/** `lesson_context` zapisany w `deck_versions.lesson_context`. */
interface LessonContextShape {
  subjectId: string;
  topicId: string;
  topicVersion: number;
  objectiveIds: string[];
  examples: Record<string, string[]>;
}

/** Payload rewizji ćwiczenia lekcji (`item_revisions.payload`, payload_version 2). */
interface LessonExercisePayload {
  exerciseType: LessonExerciseType;
  objectiveId: string;
  instructionPl?: string;
  stem?: string;
  statement?: string;
  prompt?: string;
  hint?: string;
  transformId?: string;
  noticeSegments?: string[][];
  answer: string;
  acceptedAnswers: string[];
  focus: string[];
  options?: { id: string; text: string }[];
  correctOption?: string;
  items?: { id: string; text: string }[];
  answerLocale: string;
  promptLocale: string;
}

interface LoadedExercise {
  revisionId: string;
  itemId: string;
  position: number;
  payload: LessonExercisePayload;
  targetKey: string;
  audioAssetId: string | null;
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
  return {
    timezone: args.timezone,
    ...(args.testDate === undefined ? {} : { testDate: args.testDate }),
    previousContact: {},
    reservations: [],
    settledChecks: [],
    graderCalls: 0,
    previousObjectiveContact: await previousObjectiveContactSnapshot(tx, args.childId, args.deckVersionId, args.now),
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
  };
}

/** Ładuje pulę ćwiczeń przypiętej wersji w kolejności pozycji. */
export async function loadExercises(tx: Executor, deckVersionId: string): Promise<LoadedExercise[]> {
  const revisions = await tx
    .select({ id: itemRevisions.id, itemId: itemRevisions.itemId, position: itemRevisions.position, payload: itemRevisions.payload, targetKey: itemRevisions.targetKey })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, deckVersionId))
    .orderBy(asc(itemRevisions.position));
  return revisions.map((r) => ({
    revisionId: r.id,
    itemId: r.itemId,
    position: r.position,
    payload: r.payload as unknown as LessonExercisePayload,
    targetKey: r.targetKey,
    audioAssetId: null,
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
    .where(eq(sessionTasks.sessionId, session.id))
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

interface MaterializedLessonTask {
  exerciseType: LessonExerciseType;
  prompt: TaskPrompt;
  answerKey: Record<string, unknown>;
  exposures: string[];
  context: Record<string, unknown>;
  itemRevisionId: string;
}

/** Tasowanie zdeterminowane ziarnem (id zadania): mulberry32 na haszu id. */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Polecenie przekształcenia z tematu, gdy payload go nie niesie. */
function transformInstruction(topic: LessonTopic, payload: LessonExercisePayload): string | undefined {
  if (payload.exerciseType !== "lesson_transform" || !payload.transformId) return undefined;
  return topic.transforms.find((t) => t.id === payload.transformId)?.instructionPl;
}

/** Składa kartę (prezentacja): treść karty tematu z przykładami lekcji. */
function materializeCard(
  plan: Extract<LessonTaskPlan, { kind: "card" }>,
  cardIndex: number,
  objective: LearningObjective,
  subject: SubjectModule,
  context: LessonContextShape,
  firstExerciseRevisionId: string,
): MaterializedLessonTask {
  const examples = context.examples[objective.id] ?? [];
  const rendered = renderCard(objective.cards[cardIndex]!, examples);
  return {
    exerciseType: "lesson_card",
    prompt: { kind: "lesson_card", card: rendered },
    answerKey: { exerciseType: "lesson_card", objectiveId: objective.id, subjectId: subject.id, cardPurpose: plan.cardPurpose },
    // Karta ujawnia przykłady → ekspozycje kluczy przykładów (znormalizowane w answerLocale).
    exposures: examples.map((example) => computeTargetKey(example, subject.answerLocale)),
    context: { objectiveId: objective.id, cardPurpose: plan.cardPurpose, cardIndex },
    itemRevisionId: firstExerciseRevisionId,
  };
}

/**
 * Składa publiczny prompt (bez odpowiedzi, wariantów, focus, celu, kategorii),
 * prywatny `answer_key` i listę ekspozycji dla ćwiczenia. Czysta poza
 * `randomUUID` (nieznaczące id opcji/klocków/segmentów) i zdeterminowanym
 * tasowaniem na ziarnie `taskId`.
 */
function materializeExercise(
  plan: Extract<LessonTaskPlan, { kind: "exercise" }>,
  taskId: string,
  exercise: LoadedExercise,
  topic: LessonTopic,
  subject: SubjectModule,
): MaterializedLessonTask {
  const payload = exercise.payload;
  const objective = topic.objectives.find((o) => o.id === payload.objectiveId);
  const instructionPl = payload.instructionPl ?? transformInstruction(topic, payload) ?? objective?.titlePl ?? "";

  const baseKey: Record<string, unknown> = {
    exerciseType: payload.exerciseType,
    objectiveId: payload.objectiveId,
    subjectId: subject.id,
    targetKey: exercise.targetKey,
    answer: payload.answer,
    acceptedAnswers: payload.acceptedAnswers,
    focus: payload.focus,
    independentCheck: plan.independentCheck,
    reason: plan.reason,
  };
  const taskContext: Record<string, unknown> = { reason: plan.reason, objectiveId: payload.objectiveId, independentCheck: plan.independentCheck };
  const common = { exerciseType: payload.exerciseType, itemRevisionId: exercise.revisionId, context: taskContext } as const;

  switch (payload.exerciseType) {
    case "lesson_notice": {
      const segments = (payload.noticeSegments ?? []).map((sentence) => sentence.map((text) => ({ id: randomUUID(), text })));
      const flat = segments.flat();
      const correct = flat.find((s) => s.text === payload.correctOption);
      const prompt: TaskPrompt = {
        kind: "lesson_notice",
        instructionPl,
        segments,
        ...(exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {}),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), segmentValues: Object.fromEntries(flat.map((s) => [s.id, s.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_choice": {
      const options = seededShuffle((payload.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, correct: o.text === payload.correctOption })), taskId);
      const correct = options.find((o) => o.correct);
      const prompt: TaskPrompt = {
        kind: "lesson_choice",
        instructionPl,
        stem: payload.stem ?? "",
        options: options.map((o) => ({ id: o.id, text: o.text })),
        ...(exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {}),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_short_answer": {
      const options = seededShuffle((payload.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, correct: o.text === payload.correctOption })), taskId);
      const correct = options.find((o) => o.correct);
      const prompt: TaskPrompt = {
        kind: "lesson_short_answer",
        question: payload.prompt ?? payload.stem ?? instructionPl,
        options: options.map((o) => ({ id: o.id, text: o.text })),
        ...(exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {}),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_order": {
      const canonical = (payload.items ?? []).map((item) => ({ id: randomUUID(), text: item.text }));
      const shuffled = seededShuffle(canonical, taskId);
      const prompt: TaskPrompt = { kind: "lesson_order", instructionPl, items: shuffled.map((item) => ({ id: item.id, text: item.text })) };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, itemIds: canonical.map((item) => item.id), itemValues: Object.fromEntries(canonical.map((item) => [item.id, item.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_gap": {
      const prompt: TaskPrompt = { kind: "lesson_gap", instructionPl, stemWithGap: payload.stem ?? "", ...(payload.hint ? { hint: payload.hint } : {}) };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_error_fix": {
      const prompt: TaskPrompt = { kind: "lesson_error_fix", instructionPl, statement: payload.statement ?? "" };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_transform": {
      const prompt: TaskPrompt = { kind: "lesson_transform", instructionPl, statement: payload.statement ?? "" };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_open_answer": {
      const prompt: TaskPrompt = { kind: "lesson_open_answer", instructionPl, prompt: payload.prompt ?? "" };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    default:
      throw new AppError("internal", { message: `cannot materialize lesson type ${payload.exerciseType}` });
  }
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
    materialized = materializeCard(plan, Math.min(cardIndex, objective.cards.length - 1), objective, subject, context, anchorRevision.revisionId);
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
  const { subject, topic } = requireTopic(services, context);
  const exercises = await loadExercises(exec, args.deckVersionId);
  const objectiveOrder = topic.objectives.map((o) => o.id).filter((id) => context.objectiveIds.includes(id));
  const cardCountByObjective: Record<string, number> = {};
  for (const o of topic.objectives) {
    if (objectiveOrder.includes(o.id)) cardCountByObjective[o.id] = o.cards.length;
  }

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

  void cardCountByObjective;
  void subject;
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
