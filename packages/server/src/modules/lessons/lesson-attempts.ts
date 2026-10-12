import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  AttemptInputSchema,
  type AttemptDto,
  type AttemptInput,
  type FeedbackDto,
} from "@learning/contracts";
import type { Services } from "../../config";
import type { Tx } from "../../db/client";
import {
  assessments,
  attempts,
  childObjectiveProgress,
  deckVersions,
  eventExposures,
  itemRevisions,
  itemRevisionSkills,
  learningEvents,
  learningSessions,
  sessionTasks,
} from "../../db/schema";
import { AppError } from "../../errors";
import type { AssistanceKind, Policy, SkillOutcome } from "../../domain/types";
import {
  buildAnswerSegments,
  closestApprovedVariant,
  evaluateChoice as evaluateLessonChoice,
  evaluateSequence,
  gradeFromMatch,
  matchLessonAnswer,
  type LessonAnswerKey,
  type ObjectiveGrade,
} from "../../domain/lessons/evaluate";
import {
  projectObjectiveProgress,
  qualifyLessonAttempt,
  type LessonQualificationContext,
  type ObjectiveHistoryEntry,
} from "../../domain/lessons/progress";
import { loadPolicy } from "../../policies/registry";
import { lockTaskWithSession } from "../events";
import { discloseFeedbackEvent, requestHashOf } from "../attempt-shared";
import { lessonSessionContextOf } from "./lesson-sessions";

/**
 * Przyjęcie i ocena odpowiedzi w lekcji (design „Przyjęcie odpowiedzi” kroki 1–2,
 * „Ocena”, „Kwalifikacja i projekcja celów”). `attempts.ts` deleguje tu zadania
 * `lesson_*`. Współdzieli mechanikę słówek przez `attempt-shared`: hasz treści dla
 * idempotencji i zapieczętowany `feedback_issued` z ekspozycją przed odpowiedzią HTTP.
 *
 * Zakres zadania 13B: ocena DETERMINISTYCZNA (dopasowanie + typy zamknięte + sekwencja).
 * Model oceniający i cache werdyktów to zadanie 15: brak dopasowania bez modelu →
 * `unevaluated` (technical, `verdict='unavailable'`), zadanie zostaje `issued`
 * (ruling progress.md 114, req 6.8). Jedna oceniona odpowiedź kończy zadanie
 * (`answered`); po błędzie cykl wsparcia prowadzi selektor (ruling 113, zadanie 13).
 */

/** Leniwa finalizacja przeterminowanej próby lekcji (jak słówka, arch §9.2a). */
export const LESSON_ATTEMPT_PROCESSING_TIMEOUT_MS = 60_000;

type TaskRow = typeof sessionTasks.$inferSelect;
type SessionRow = typeof learningSessions.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type LessonModality = "choice" | "text" | "dont_remember" | "skip" | "sequence";

/** Prywatny `answer_key` zadania lekcji (materializowany w `lesson-sessions.ts`). */
interface LessonTaskAnswerKey extends LessonAnswerKey {
  objectiveId: string;
  subjectId: string;
  targetKey: string;
  independentCheck?: boolean;
  reason?: string;
  optionValues?: Record<string, string>;
  itemValues?: Record<string, string>;
  segmentValues?: Record<string, string>;
}

/** Zamrożony przy received_at kontekst kwalifikacji próby lekcji (arch §9.2). */
interface FrozenLessonContext {
  receivedAt: string;
  policyVersion: string;
  firstTry: boolean;
  assistance: AssistanceKind[];
  answerPreviouslyExposed: boolean;
  previousSessionContactAt: string | null;
  timezone: string;
}

function keyOf(task: TaskRow): LessonTaskAnswerKey {
  return task.answerKey as unknown as LessonTaskAnswerKey;
}

/** Odwrotność `mapObjectiveStatus`: status domeny → słownik bazy (ruling 97). */
function toDbObjectiveStatus(status: string): string {
  switch (status) {
    case "not_assessed":
      return "unseen";
    case "learning":
      return "practicing";
    default:
      return status; // needs_confirmation / needs_reconfirmation / mastered bez zmian
  }
}

/** Czy przedmiot ma normalizator (zawsze, gdy przedmiot istnieje w rejestrze). */
function normalizerFor(services: Services, subjectId: string) {
  const subject = services.subjects.getSubject(subjectId);
  if (!subject) {
    throw new AppError("internal", { message: `lesson subject missing: ${subjectId}` });
  }
  return subject.normalizer;
}

/** Tytuł celu z rejestru przedmiotu (dla podsumowania). Brak = malformed version. */
function objectiveTitle(services: Services, subjectId: string, objectiveId: string): string {
  const subject = services.subjects.getSubject(subjectId);
  for (const topic of subject?.topics ?? []) {
    const objective = topic.objectives.find((o) => o.id === objectiveId);
    if (objective) return objective.titlePl;
  }
  // Nigdy nie wpuszczamy surowego id celu do Kid DTO — brak tytułu to znak
  // uszkodzonej/niespójnej wersji lekcji, nie dane do pokazania dziecku.
  throw new AppError("internal", { message: `lesson objective title missing: ${subjectId}/${objectiveId}` });
}

/** Ujawnienie `target_key` ćwiczenia dziecku PRZED wydaniem tego zadania (req 7.2). */
async function answerPreviouslyExposed(tx: Tx, childId: string, targetKey: string, task: TaskRow): Promise<boolean> {
  const rows = await tx
    .select({ eventId: eventExposures.eventId, taskId: learningEvents.taskId })
    .from(eventExposures)
    .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(and(eq(eventExposures.childId, childId), eq(eventExposures.targetKey, targetKey), eq(learningEvents.sealed, true)));
  // Ekspozycje zapisane przy wydaniu TEGO zadania (prompt/feedback tego taskId)
  // się nie liczą — tylko wcześniejsze, z dowolnej sesji/lekcji/kartkówki.
  return rows.some((row) => row.taskId !== task.id);
}

/** Wsparcie użyte w zadaniu przed odpowiedzią (guided options / odsłuch / podpowiedź). */
async function assistanceFor(tx: Tx, task: TaskRow, key: LessonTaskAnswerKey, receivedAt: Date): Promise<AssistanceKind[]> {
  const assistance = new Set<AssistanceKind>();
  // Typy prowadzone (wybór z opcji / segmentów) ujawniają rozwiązanie w prompt'cie.
  if (key.exerciseType === "lesson_choice" || key.exerciseType === "lesson_short_answer" || key.exerciseType === "lesson_notice") {
    assistance.add("options");
  }
  const disclosures = await tx
    .select({ kind: learningEvents.kind, occurredAt: learningEvents.occurredAt })
    .from(learningEvents)
    .where(and(eq(learningEvents.taskId, task.id), eq(learningEvents.sealed, true)));
  for (const row of disclosures) {
    if (row.occurredAt > receivedAt) continue;
    if (row.kind === "hint_issued") assistance.add("hint");
    if (row.kind === "audio_issued") assistance.add("model_audio");
  }
  return [...assistance];
}

/** Tekst rozwiązania własnego zadania pokazywany dziecku (design feedback). */
function correctTextFor(task: TaskRow, key: LessonTaskAnswerKey): string {
  if (key.exerciseType === "lesson_choice" || key.exerciseType === "lesson_short_answer") {
    return key.optionValues?.[key.correctOptionId ?? ""] ?? key.answer;
  }
  if (key.exerciseType === "lesson_notice") {
    return key.segmentValues?.[key.correctOptionId ?? ""] ?? key.answer;
  }
  if (key.exerciseType === "lesson_order") {
    const ids = key.itemIds ?? [];
    const values = key.itemValues ?? {};
    const text = ids.map((id) => values[id]).filter((t): t is string => Boolean(t)).join(" ");
    return text || key.answer;
  }
  return key.answer;
}

interface LessonGradeResult {
  grade: ObjectiveGrade;
  feedback: FeedbackDto;
  /** Ekspozycje feedbacku (klucze celów pokazane dziecku); puste dla not_assessed. */
  exposures: string[];
  /** `details` zapisywane w assessments. */
  details: Record<string, unknown>;
}

/**
 * Ocena deterministyczna odpowiedzi + feedback + ekspozycje (design „Ocena”,
 * tabela mapowania). `no_match` bez modelu → unevaluated/unavailable → not_assessed.
 */
function gradeLessonAnswer(
  input: Extract<AttemptInput, { modality: LessonModality }>,
  task: TaskRow,
  key: LessonTaskAnswerKey,
  services: Services,
): LessonGradeResult {
  const objectiveId = key.objectiveId;
  const correctText = correctTextFor(task, key);

  // „Pomiń” → próba bez ocen (jak słówka): nie ma ObjectiveGrade.
  if (input.modality === "skip") {
    return { grade: { outcome: "unevaluated", verdict: "unavailable" }, feedback: { kind: "not_assessed" }, exposures: [], details: { objectiveId, verdict: "skipped" } };
  }

  if (input.modality === "dont_remember") {
    return {
      grade: { outcome: "incorrect", reason: "dont_remember", verdict: "closed_incorrect" },
      feedback: { kind: "incorrect", correctText },
      exposures: [key.targetKey],
      details: { objectiveId, verdict: "dont_remember" },
    };
  }

  if (input.modality === "choice") {
    const correct = evaluateLessonChoice(input.optionId, key);
    if (correct) {
      return { grade: { outcome: "correct", verdict: "closed_correct" }, feedback: { kind: "great" }, exposures: [key.targetKey], details: { objectiveId, verdict: "closed_correct" } };
    }
    return { grade: { outcome: "incorrect", verdict: "closed_incorrect" }, feedback: { kind: "incorrect", correctText }, exposures: [key.targetKey], details: { objectiveId, verdict: "closed_incorrect" } };
  }

  if (input.modality === "sequence") {
    const correct = evaluateSequence(input.itemIds, key);
    if (correct) {
      return { grade: { outcome: "correct", verdict: "closed_correct" }, feedback: { kind: "great" }, exposures: [key.targetKey], details: { objectiveId, verdict: "closed_correct" } };
    }
    return { grade: { outcome: "incorrect", verdict: "closed_incorrect" }, feedback: { kind: "incorrect", correctText }, exposures: [key.targetKey], details: { objectiveId, verdict: "closed_incorrect" } };
  }

  // text: luka / error_fix / transform / open_answer → dopasowanie deterministyczne
  const normalizer = normalizerFor(services, key.subjectId);
  const match = matchLessonAnswer(input.text, key, normalizer);
  const grade = gradeFromMatch(match);
  if (grade === null) {
    // brak dopasowania, brak modelu w tym zadaniu → nieocenione (technical)
    return {
      grade: { outcome: "unevaluated", reason: "technical", verdict: "unavailable" },
      feedback: { kind: "not_assessed" },
      exposures: [],
      details: { objectiveId, verdict: "unavailable" },
    };
  }
  if (match.kind === "minor_typo") {
    const variant = closestApprovedVariant(input.text, key, normalizer);
    const segments = buildAnswerSegments(input.text, [match.typoToken]);
    const feedback: FeedbackDto = {
      kind: "lesson_almost",
      correctText: variant,
      ...(segments ? { answerSegments: segments } : {}),
    };
    return { grade, feedback, exposures: [key.targetKey], details: { objectiveId, verdict: "minor_typo", typoToken: match.typoToken } };
  }
  // exact
  return { grade, feedback: { kind: "great" }, exposures: [key.targetKey], details: { objectiveId, verdict: "exact" } };
}

function dbOutcome(outcome: SkillOutcome): "correct" | "incorrect" | "unassessed" {
  return outcome === "unevaluated" ? "unassessed" : outcome;
}

/**
 * Przejście stanu zadania lekcji po ocenie (ruling 113): jedna oceniona
 * odpowiedź (poprawna albo błędna) kończy zadanie (`answered`); `skip` →
 * `skipped`; brak oceny (`unevaluated`) zostawia `issued` (retry / „Pomiń”).
 */
function nextLessonTaskState(modality: LessonModality, outcome: SkillOutcome): "issued" | "answered" | "skipped" {
  if (modality === "skip") return "skipped";
  if (outcome === "unevaluated") return "issued";
  return "answered";
}

/** Historia ocen celu dziecka (bieżąca wersja polityki filtruje projektor). */
async function objectiveHistory(tx: Tx, childId: string, objectiveId: string): Promise<ObjectiveHistoryEntry[]> {
  const rows = await tx
    .select({
      receivedAt: attempts.receivedAt,
      policyId: attempts.policyId,
      itemId: itemRevisions.itemId,
      outcome: assessments.outcome,
      reason: assessments.reason,
      independent: assessments.independent,
      confirmationEligible: assessments.confirmationEligible,
      objectiveId: assessments.details,
    })
    .from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .innerJoin(itemRevisions, eq(itemRevisions.id, assessments.itemRevisionId))
    .where(and(eq(assessments.childId, childId), eq(assessments.skill, "objective")));

  // Wersja polityki wyprowadzona WPROST z zapisanego rekordu polityki (join przez
  // loadPolicy), a nie z założenia `policyId === version`. Gdyby id i version
  // kiedykolwiek się rozjechały, projektor nadal filtruje po PRAWDZIWEJ wersji
  // zamiast po cichu odrzucić całą historię. Cache per policyId w tej pętli.
  const versionByPolicyId = new Map<string, string>();
  const resolveVersion = async (policyId: string): Promise<string> => {
    const cached = versionByPolicyId.get(policyId);
    if (cached !== undefined) return cached;
    const version = (await loadPolicy(tx, policyId)).version;
    versionByPolicyId.set(policyId, version);
    return version;
  };

  const relevant = rows.filter(
    (row) => (row.objectiveId as { objectiveId?: string } | null)?.objectiveId === objectiveId,
  );
  const entries: ObjectiveHistoryEntry[] = [];
  for (const row of relevant) {
    entries.push({
      receivedAt: row.receivedAt.toISOString(),
      policyVersion: await resolveVersion(row.policyId),
      objectiveId,
      itemId: row.itemId,
      outcome: row.outcome === "unassessed" ? "unevaluated" : (row.outcome as SkillOutcome),
      ...(row.reason ? { reason: row.reason } : {}),
      independent: row.independent,
      confirmationEligible: row.confirmationEligible,
    });
  }
  return entries;
}

/** Interfejs wyniku wstępu przyjęcia odpowiedzi lekcji. */
interface LessonAttemptStart {
  task: TaskRow;
  session: SessionRow;
  itemId: string;
  policy: Policy;
  key: LessonTaskAnswerKey;
  frozen: FrozenLessonContext;
  attemptNumber: number;
  requestHash: string;
  receivedAt: Date;
}

/**
 * Wspólny wstęp (arch §9.1a, §9.2): blokada sesji, idempotencja, leniwa
 * finalizacja, walidacje stanu, zamrożenie kontekstu kwalifikacji. Zwraca
 * `{ kind: 'dto' }` dla idempotentnego/istniejącego wyniku albo `{ kind: 'fresh' }`.
 */
async function startLessonAttempt(
  tx: Tx,
  services: Services,
  valid: Extract<AttemptInput, { modality: LessonModality }>,
): Promise<{ kind: "dto"; dto: AttemptDto } | ({ kind: "fresh" } & LessonAttemptStart)> {
  const { task, session, itemId } = await lockTaskWithSession(tx, valid.taskId);
  const now = services.clock.now();
  const requestHash = requestHashOf(valid);

  const existing = (
    await tx.select().from(attempts).where(and(eq(attempts.childId, task.childId), eq(attempts.clientAttemptId, valid.clientAttemptId)))
  )[0];
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError("conflict", { message: "clientAttemptId reused with different answer" });
    }
    await lazyFinalizeStale(tx, services, task, session, itemId, now);
    const fresh = (await tx.select().from(attempts).where(eq(attempts.id, existing.id)))[0]!;
    const state = await rereadTaskState(tx, task.id);
    if (fresh.state === "completed" && fresh.feedback) {
      const stepId = await discloseLessonFeedback(tx, task, itemId, fresh.feedback as FeedbackDto, now);
      return { kind: "dto", dto: dtoOf(fresh, state, stepId) };
    }
    return { kind: "dto", dto: dtoOf(fresh, state) };
  }

  await lazyFinalizeStale(tx, services, task, session, itemId, now);

  if (session.state !== "active") {
    throw new AppError("conflict", { message: "session is closed" });
  }
  if (task.state !== "issued") {
    throw new AppError("conflict", { message: "task is no longer issued" });
  }
  const key = keyOf(task);
  // Walidacja modalności vs typ ćwiczenia.
  assertModalityMatchesExercise(valid.modality, key.exerciseType);

  const processing = (
    await tx.select().from(attempts).where(and(eq(attempts.taskId, task.id), eq(attempts.state, "processing")))
  )[0];
  if (processing) {
    return { kind: "dto", dto: dtoOf(processing, await rereadTaskState(tx, task.id)) };
  }

  const priorAttempts = await tx.select({ id: attempts.id }).from(attempts).where(eq(attempts.taskId, task.id));
  const attemptNumber = priorAttempts.length + 1;
  const policy = await loadPolicy(tx, session.policyId);
  const sessionContext = lessonSessionContextOf(session);
  const frozen: FrozenLessonContext = {
    receivedAt: now.toISOString(),
    policyVersion: policy.version,
    firstTry: attemptNumber === 1,
    assistance: await assistanceFor(tx, task, key, now),
    answerPreviouslyExposed: await answerPreviouslyExposed(tx, task.childId, key.targetKey, task),
    previousSessionContactAt: sessionContext.previousObjectiveContact[key.objectiveId] ?? null,
    timezone: sessionContext.timezone,
  };

  return { kind: "fresh", task, session, itemId, policy, key, frozen, attemptNumber, requestHash, receivedAt: now };
}

/** Modalność musi pasować do typu ćwiczenia (jak walidacja słówek). */
function assertModalityMatchesExercise(modality: LessonModality, exerciseType: string): void {
  if (modality === "skip" || modality === "dont_remember") return;
  const CHOICE_TYPES = ["lesson_choice", "lesson_short_answer", "lesson_notice"];
  const TEXT_TYPES = ["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"];
  const ok =
    (modality === "choice" && CHOICE_TYPES.includes(exerciseType)) ||
    (modality === "sequence" && exerciseType === "lesson_order") ||
    (modality === "text" && TEXT_TYPES.includes(exerciseType));
  if (!ok) {
    throw new AppError("validation", { message: "attempt modality does not match exercise" });
  }
}

function dtoOf(attempt: AttemptRow, taskState: string, stepId: string | null = null): AttemptDto {
  return {
    attemptId: attempt.id,
    taskId: attempt.taskId,
    state: attempt.state as "processing" | "completed",
    modality: attempt.modality as AttemptDto["modality"],
    feedback: (attempt.feedback as FeedbackDto | null) ?? null,
    taskState: taskState as AttemptDto["taskState"],
    stepId,
    receivedAt: attempt.receivedAt.toISOString(),
    completedAt: attempt.completedAt?.toISOString() ?? null,
  };
}

async function rereadTaskState(tx: Tx, taskId: string): Promise<string> {
  const row = (await tx.select({ state: sessionTasks.state }).from(sessionTasks).where(eq(sessionTasks.id, taskId)))[0]!;
  return row.state;
}

/** Zapis ekspozycji feedbacku lekcji przed odpowiedzią HTTP (jak słówka). */
async function discloseLessonFeedback(tx: Tx, task: TaskRow, itemId: string, feedback: FeedbackDto, now: Date): Promise<string> {
  const key = keyOf(task);
  // not_assessed niczego nie ujawnia; w pozostałych pokazujemy rozwiązanie
  // własnego zadania (target_key celu) oraz, przy minor_typo, wariant correctText.
  const exposures = feedback.kind === "not_assessed" ? [] : [key.targetKey];
  return discloseFeedbackEvent(tx, { task, childId: task.childId, itemId, exposures, now });
}

/**
 * Finalizuje świeżą próbę lekcji w jednej transakcji: ocena, assessments
 * (skill=`objective`), projekcja celu, przejście zadania, ekspozycja feedbacku.
 */
async function finalizeLessonAttempt(
  tx: Tx,
  services: Services,
  start: LessonAttemptStart,
  valid: Extract<AttemptInput, { modality: LessonModality }>,
): Promise<AttemptDto> {
  const { task, session, itemId, policy, key, frozen, attemptNumber, requestHash, receivedAt } = start;
  const result = gradeLessonAnswer(valid, task, key, services);
  const qualification = qualifyLessonAttempt({
    receivedAt: frozen.receivedAt,
    policy,
    firstTry: frozen.firstTry,
    assistance: frozen.assistance,
    answerPreviouslyExposed: frozen.answerPreviouslyExposed,
    previousSessionContactAt: frozen.previousSessionContactAt,
    timezone: frozen.timezone,
  } satisfies LessonQualificationContext);

  const answer =
    valid.modality === "text"
      ? { text: valid.text }
      : valid.modality === "choice"
        ? { optionId: valid.optionId, optionText: key.optionValues?.[valid.optionId] ?? key.segmentValues?.[valid.optionId] ?? "" }
        : valid.modality === "sequence"
          ? { itemIds: valid.itemIds }
          : null;

  const attemptId = randomUUID();
  await tx.insert(attempts).values({
    id: attemptId,
    childId: task.childId,
    taskId: task.id,
    itemRevisionId: task.itemRevisionId,
    clientAttemptId: valid.clientAttemptId,
    requestHash,
    attemptNumber,
    modality: valid.modality,
    state: "processing",
    answer,
    context: frozen as unknown as Record<string, unknown>,
    policyId: session.policyId,
    receivedAt,
  });

  // Oceny: skip nie tworzy ocen (jak słówka); pozostałe modalności tworzą jedną
  // ocenę celu (skill=objective) z `details` i kwalifikacją.
  if (valid.modality !== "skip") {
    const skillRow = (
      await tx
        .select({ skillVersionId: itemRevisionSkills.skillVersionId })
        .from(itemRevisionSkills)
        .where(and(eq(itemRevisionSkills.itemRevisionId, task.itemRevisionId), eq(itemRevisionSkills.skill, "objective")))
    )[0];
    if (!skillRow) {
      throw new AppError("internal", { message: "missing objective skill version" });
    }
    await tx.insert(assessments).values({
      childId: task.childId,
      attemptId,
      itemRevisionId: task.itemRevisionId,
      skill: "objective",
      skillVersionId: skillRow.skillVersionId,
      outcome: dbOutcome(result.grade.outcome),
      ...(result.grade.reason ? { reason: result.grade.reason } : {}),
      independent: qualification.independent,
      confirmationEligible: qualification.confirmationEligible,
      details: result.details,
    });

    // Projekcja celu w tej samej transakcji (tylko gdy oceniono — unevaluated jest neutralne).
    if (result.grade.outcome !== "unevaluated") {
      await projectAndUpsertObjective(tx, services, task, key, policy, receivedAt);
    }
  }

  const taskState = nextLessonTaskState(valid.modality, result.grade.outcome);
  if (taskState !== "issued") {
    await tx.update(sessionTasks).set({ state: taskState }).where(eq(sessionTasks.id, task.id));
  }

  const feedback = valid.modality === "skip" ? null : result.feedback;
  const completed = await tx
    .update(attempts)
    .set({ state: "completed", completedAt: receivedAt, feedback: feedback as unknown as Record<string, unknown> })
    .where(and(eq(attempts.id, attemptId), eq(attempts.state, "processing")))
    .returning();
  if (completed.length === 0) {
    throw new AppError("conflict", { message: "attempt is already finalized" });
  }

  const stepId = feedback === null ? null : await discloseLessonFeedback(tx, task, itemId, feedback, receivedAt);
  const freshTask = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, task.id)))[0]!;
  return {
    attemptId,
    taskId: task.id,
    state: "completed",
    modality: valid.modality,
    feedback,
    taskState: freshTask.state as AttemptDto["taskState"],
    stepId,
    receivedAt: receivedAt.toISOString(),
    completedAt: receivedAt.toISOString(),
  };
}

/** Projekcja celu z historii ocen i upsert `child_objective_progress`. */
async function projectAndUpsertObjective(
  tx: Tx,
  services: Services,
  task: TaskRow,
  key: LessonTaskAnswerKey,
  policy: Policy,
  now: Date,
): Promise<void> {
  const history = await objectiveHistory(tx, task.childId, key.objectiveId);
  const projection = projectObjectiveProgress(history, policy, now.toISOString())[key.objectiveId];
  if (!projection) return;
  const topicId = await objectiveTopicId(tx, task, key, services);
  const lastIndependentAt = history
    .filter((h) => h.independent && h.outcome === "correct")
    .map((h) => h.receivedAt)
    .sort()
    .at(-1);
  await tx
    .insert(childObjectiveProgress)
    .values({
      childId: task.childId,
      subjectId: key.subjectId,
      objectiveId: key.objectiveId,
      topicId,
      status: toDbObjectiveStatus(projection.status),
      streak: projection.streak,
      ...(projection.nextReviewAt ? { nextReviewAt: new Date(projection.nextReviewAt) } : {}),
      ...(lastIndependentAt ? { lastIndependentAt: new Date(lastIndependentAt) } : {}),
      projectionVersion: policy.version,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [childObjectiveProgress.childId, childObjectiveProgress.subjectId, childObjectiveProgress.objectiveId],
      set: {
        status: toDbObjectiveStatus(projection.status),
        streak: projection.streak,
        nextReviewAt: projection.nextReviewAt ? new Date(projection.nextReviewAt) : null,
        ...(lastIndependentAt ? { lastIndependentAt: new Date(lastIndependentAt) } : {}),
        projectionVersion: policy.version,
        updatedAt: now,
      },
    });
}

/** Temat celu z `lesson_context` wersji (dla klucza child_objective_progress). */
async function objectiveTopicId(tx: Tx, task: TaskRow, key: LessonTaskAnswerKey, services: Services): Promise<string> {
  const version = (await tx.select({ lessonContext: deckVersions.lessonContext }).from(deckVersions).where(eq(deckVersions.id, task.deckVersionId)))[0];
  const topicId = (version?.lessonContext as { topicId?: string } | null)?.topicId;
  if (topicId) return topicId;
  // zapas: znajdź temat zawierający cel w rejestrze
  const subject = services.subjects.getSubject(key.subjectId);
  for (const topic of subject?.topics ?? []) {
    if (topic.objectives.some((o) => o.id === key.objectiveId)) return topic.id;
  }
  // Brak topic_id to niespójna wersja lekcji — nie zapisujemy pustego klucza
  // do child_objective_progress, tylko sygnalizujemy błąd.
  throw new AppError("internal", { message: `lesson topic missing for objective: ${key.subjectId}/${key.objectiveId}` });
}

/** Leniwa finalizacja przeterminowanej próby processing lekcji (arch §9.2a). */
async function lazyFinalizeStale(tx: Tx, services: Services, task: TaskRow, session: SessionRow, itemId: string, now: Date): Promise<void> {
  void services;
  void session;
  const stale = await tx.select().from(attempts).where(and(eq(attempts.taskId, task.id), eq(attempts.state, "processing")));
  for (const attempt of stale) {
    if (now.getTime() - attempt.receivedAt.getTime() <= LESSON_ATTEMPT_PROCESSING_TIMEOUT_MS) continue;
    // technical: żadnej oceny wiedzy; zadanie zostaje issued; feedback not_assessed bez ekspozycji
    const completed = await tx
      .update(attempts)
      .set({ state: "completed", completedAt: now, feedback: { kind: "not_assessed" } as unknown as Record<string, unknown> })
      .where(and(eq(attempts.id, attempt.id), eq(attempts.state, "processing")))
      .returning();
    if (completed.length === 0) continue;
    await discloseLessonFeedback(tx, task, itemId, { kind: "not_assessed" }, now);
  }
}

/**
 * Przyjmuje odpowiedź dziecka na zadanie lekcji (design „Przyjęcie odpowiedzi”).
 * Walidacja wejścia, idempotencja i blokada sesji wspólne ze słówkami; ocena,
 * projekcja celu i ujawnienie feedbacku to jedna transakcja.
 */
export async function submitLessonAttempt(services: Services, input: AttemptInput): Promise<AttemptDto> {
  const valid = AttemptInputSchema.parse(input);
  if (valid.modality === "audio") {
    throw new AppError("validation", { message: "speech attempts require the audio path" });
  }
  return services.db.transaction(async (tx) => {
    const started = await startLessonAttempt(tx, services, valid as Extract<AttemptInput, { modality: LessonModality }>);
    if (started.kind === "dto") {
      return started.dto;
    }
    return finalizeLessonAttempt(tx, services, started, valid as Extract<AttemptInput, { modality: LessonModality }>);
  });
}

/**
 * Odczyt próby lekcji (arch §12). Rozlicza leniwe processing; ponowne wydanie
 * feedbacku zapisuje kolejne ujawnienie przed odpowiedzią (jak słówka).
 */
export async function readLessonAttempt(services: Services, attempt: AttemptRow): Promise<AttemptDto> {
  return services.db.transaction(async (tx) => {
    const { task, session, itemId } = await lockTaskWithSession(tx, attempt.taskId);
    const now = services.clock.now();
    await lazyFinalizeStale(tx, services, task, session, itemId, now);
    const fresh = (await tx.select().from(attempts).where(eq(attempts.id, attempt.id)))[0]!;
    const freshTask = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, task.id)))[0]!;
    if (fresh.state === "completed" && fresh.feedback) {
      const stepId = await discloseLessonFeedback(tx, freshTask, itemId, fresh.feedback as FeedbackDto, now);
      return dtoOf(fresh, freshTask.state, stepId);
    }
    return dtoOf(fresh, freshTask.state);
  });
}

/**
 * Podsumowanie sesji lekcji per cel (req 7.7): dla każdego celu ćwiczonego w
 * sesji — liczba wykonanych ocenianych ćwiczeń i liczba poprawnych. Bez procentów,
 * bez statusów technicznych, bez kategorii błędów. `skip` i `unevaluated` liczą się
 * do „practiced”? Nie: „practiced” to oceniane próby (correct+incorrect+dont_remember);
 * `unevaluated`/`skip` nie są dowodem pracy nad regułą.
 */
export async function buildLessonSummaryObjectives(
  services: Services,
  tx: Tx,
  sessionId: string,
): Promise<{ objectiveId: string; titlePl: string; practiced: number; correct: number }[]> {
  const rows = await tx
    .select({ details: assessments.details, outcome: assessments.outcome, reason: assessments.reason })
    .from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .where(and(eq(sessionTasks.sessionId, sessionId), eq(assessments.skill, "objective"), eq(attempts.state, "completed")))
    .orderBy(asc(attempts.receivedAt));
  const version = (await tx.select({ lessonContext: deckVersions.lessonContext }).from(deckVersions)
    .innerJoin(learningSessions, eq(learningSessions.deckVersionId, deckVersions.id))
    .where(eq(learningSessions.id, sessionId)))[0];
  const subjectId = (version?.lessonContext as { subjectId?: string } | null)?.subjectId;
  if (!subjectId) {
    throw new AppError("internal", { message: `lesson session without subjectId: ${sessionId}` });
  }

  const byObjective = new Map<string, { practiced: number; correct: number }>();
  for (const row of rows) {
    const objectiveId = (row.details as { objectiveId?: string } | null)?.objectiveId;
    if (!objectiveId) continue;
    if (row.outcome === "unassessed") continue; // nieocenione nie liczy się jako praca nad regułą
    const entry = byObjective.get(objectiveId) ?? { practiced: 0, correct: 0 };
    entry.practiced += 1;
    if (row.outcome === "correct") entry.correct += 1;
    byObjective.set(objectiveId, entry);
  }
  return [...byObjective].map(([objectiveId, counts]) => ({
    objectiveId,
    titlePl: objectiveTitle(services, subjectId, objectiveId),
    practiced: counts.practiced,
    correct: counts.correct,
  }));
}
