import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import {
  AttemptInputSchema,
  UuidSchema,
  type AttemptDto,
  type AttemptInput,
  type FeedbackDto,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  assessments,
  attempts,
  childSkillProgress,
  eventExposures,
  itemRevisions,
  itemRevisionSkills,
  learningEvents,
  learningSessions,
  sessionTasks,
} from "../db/schema";
import { AppError } from "../errors";
import { assessedSkills, evaluateChoice, evaluateNonAnswer, evaluateWritten } from "../domain/evaluate";
import { chooseFeedback } from "../domain/feedback";
import { projectProgress } from "../domain/progress";
import { qualifyAttempt } from "../domain/independence";
import type {
  AnswerKey,
  AssistanceKind,
  EvaluationContext,
  ExerciseType,
  Grade,
  History,
  HistoryEntry,
  Policy,
  Skill,
  SkillGrade,
} from "../domain/types";
import { loadPolicy } from "../policies/registry";
import { lockTaskWithSession, writeSealedEvent, contextOf } from "./events";

/** Leniwa finalizacja przeterminowanych prób processing (arch §9.2a). */
export const ATTEMPT_PROCESSING_TIMEOUT_MS = 60_000;
/** Wersja algorytmyki projekcji zapisywana w child_skill_progress. */
const PROJECTION_VERSION = "proj-1";

/** Zadania, w których ujawnienie angielskiego rozwiązania psuje samodzielność (SPEC §12.5–12.8). */
const RECALL_LIKE: ReadonlySet<string> = new Set(["recall", "spelling", "letter_completion"]);

type AttemptRow = typeof attempts.$inferSelect;
type TaskRow = typeof sessionTasks.$inferSelect;
type SessionRow = typeof learningSessions.$inferSelect;
type AnyModality = AttemptInput["modality"] | "audio";

/** Zamrożony przy received_at kontekst kwalifikacji (arch §9.2), zapisany w próbie. */
interface FrozenContext {
  receivedAt: string;
  policyVersion: string;
  lastExposureAt: string | null;
  firstTry: boolean;
  assistance: AssistanceKind[];
  previousSessionContactAt: string | null;
  timezone: string;
}

function requestHashOf(input: AttemptInput): string {
  const payload =
    input.modality === "choice"
      ? { optionId: input.optionId }
      : input.modality === "text"
        ? { text: input.text }
        : {};
  return createHash("sha256")
    .update(JSON.stringify({ taskId: input.taskId, modality: input.modality, ...payload }))
    .digest("hex");
}

function answerKeyOf(task: TaskRow): AnswerKey {
  return task.answerKey as unknown as AnswerKey;
}

/**
 * Wsparcie użyte w zadaniu przed próbą (SPEC §13.2). Odsłuch w zadaniu ze słuchu
 * to pytanie, nie wsparcie; widoczne litery uzupełniania są podpowiedzią z
 * definicji. Wzorzec w ćwiczeniu wymowy jest oczekiwaną częścią nauki i nie
 * dyskwalifikuje oceny samej wymowy — wsparciem jest tylko tam, gdzie ujawnia
 * rozwiązanie (zadania przypominania i pisowni).
 */
async function assistanceFor(tx: Tx, task: TaskRow): Promise<AssistanceKind[]> {
  const kinds: AssistanceKind[] = [];
  if (task.exerciseType === "letter_completion") {
    kinds.push("visible_letters");
  }
  const disclosures = await tx
    .select({ kind: learningEvents.kind })
    .from(learningEvents)
    .where(and(eq(learningEvents.taskId, task.id), inArray(learningEvents.kind, ["audio_issued", "hint_issued"])));
  for (const row of disclosures) {
    if (row.kind === "hint_issued") {
      kinds.push("answer_reveal");
    } else if (RECALL_LIKE.has(task.exerciseType)) {
      kinds.push("model_audio");
    }
  }
  return [...new Set(kinds)];
}

/** Ostatnie ujawnienie rozwiązania elementu — także w innym ćwiczeniu (SPEC §18.1). */
async function lastExposureAt(tx: Tx, childId: string, targetKey: string): Promise<string | null> {
  const [row] = await tx
    .select({ latest: max(learningEvents.occurredAt) })
    .from(eventExposures)
    .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
    .where(and(eq(eventExposures.childId, childId), eq(eventExposures.targetKey, targetKey)));
  return row?.latest?.toISOString() ?? null;
}

async function targetKeyOf(tx: Tx, task: TaskRow): Promise<string> {
  const row = (
    await tx
      .select({ targetKey: itemRevisions.targetKey })
      .from(itemRevisions)
      .where(eq(itemRevisions.id, task.itemRevisionId))
  )[0];
  return row?.targetKey ?? "";
}

/** Rozwiązanie własnego zadania pokazywane dziecku w feedbacku (SPEC §16). */
function correctTextOf(task: TaskRow, key: AnswerKey): string {
  if (key.correctOptionId !== undefined) {
    const options = (task.publicPrompt.options as { id: string; text: string }[] | undefined) ?? [];
    return options.find((o) => o.id === key.correctOptionId)?.text ?? key.target;
  }
  return key.target;
}

function optionTextOf(task: TaskRow, optionId: string): string {
  const options = (task.publicPrompt.options as { id: string; text: string }[] | undefined) ?? [];
  return options.find((o) => o.id === optionId)?.text ?? "";
}

function gradeOf(input: AttemptInput, key: AnswerKey, ctx: EvaluationContext): Grade {
  switch (input.modality) {
    case "text":
      return evaluateWritten(input.text, key, ctx);
    case "choice":
      return evaluateChoice(input.optionId, key, ctx);
    case "dont_remember":
      return evaluateNonAnswer("dont_remember", key, ctx);
    case "skip":
      return evaluateNonAnswer("skip", key, ctx);
    case "audio":
      // nieosiągalne: ścieżka audio przechodzi przez submitSpeechAttempt
      throw new AppError("validation", { message: "speech attempts require the audio path" });
  }
}

/**
 * Przejście stanu zadania po próbie (arch §9.1a): poprawna odpowiedź kończy,
 * pierwszy błąd zostawia drugą próbę, „Nie pamiętam” i drugi błąd kończą
 * z kierunkiem na wsparcie, „Pomiń” zamyka bez oceny. Próby bez oceny
 * (techniczne, niejednoznaczne) nie są błędem wiedzy i nie zamykają zadania.
 */
function nextTaskState(modality: AnyModality, grade: Grade, attemptNumber: number): "issued" | "answered" | "skipped" {
  if (modality === "skip") {
    return "skipped";
  }
  const values = Object.values(grade.skills);
  const anyCorrect = values.some((s) => s.outcome === "correct");
  const anyIncorrect = values.some((s) => s.outcome === "incorrect");
  if (anyCorrect && !anyIncorrect) {
    return "answered";
  }
  if (modality === "dont_remember") {
    return "answered";
  }
  if (anyIncorrect && attemptNumber >= 2) {
    return "answered";
  }
  return "issued";
}

function dbOutcome(outcome: SkillGrade["outcome"]): "correct" | "incorrect" | "unassessed" {
  return outcome === "unevaluated" ? "unassessed" : outcome;
}

/** Projekcja domenowa → statusy child_skill_progress (zadanie 5 vs schemat). */
function dbStatus(status: string): string {
  switch (status) {
    case "not_assessed":
      return "unseen";
    case "learning":
      return "practicing";
    default:
      return status;
  }
}

/** Historia ocen jednej wersji kryteriów — źródło projekcji (SPEC §20, §18). */
async function historyForSkill(tx: Tx, skillVersionId: string, skill: Skill): Promise<History> {
  const rows = await tx
    .select({
      receivedAt: attempts.receivedAt,
      policyId: attempts.policyId,
      outcome: assessments.outcome,
      reason: assessments.reason,
      independent: assessments.independent,
      confirmationEligible: assessments.confirmationEligible,
      details: assessments.details,
    })
    .from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .where(and(eq(assessments.skillVersionId, skillVersionId), eq(assessments.skill, skill)))
    .orderBy(asc(attempts.receivedAt), asc(attempts.id));
  return rows.map((row) => ({
    receivedAt: row.receivedAt.toISOString(),
    policyVersion: row.policyId,
    skill,
    outcome: row.outcome === "unassessed" ? "unevaluated" : (row.outcome as "correct" | "incorrect"),
    ...(row.reason === null ? {} : { reason: row.reason as HistoryEntry["reason"] }),
    independent: row.independent,
    confirmationEligible: row.confirmationEligible,
    details: row.details as HistoryEntry["details"],
  }));
}

/** Przelicza i zapisuje projekcję jednej umiejętności w tej samej transakcji. */
async function updateProjection(
  tx: Tx,
  childId: string,
  skillVersionId: string,
  skill: Skill,
  policy: Policy,
  now: Date,
  receivedAt: Date,
): Promise<void> {
  const history = await historyForSkill(tx, skillVersionId, skill);
  const existing = (
    await tx
      .select({ skillVersionId: childSkillProgress.skillVersionId })
      .from(childSkillProgress)
      .where(and(eq(childSkillProgress.childId, childId), eq(childSkillProgress.skillVersionId, skillVersionId)))
  )[0];
  // sama próba techniczna nie tworzy wiersza „ćwiczonego” — umiejętność
  // pozostaje nie sprawdzona, dopóki nie ma wiarygodnej oceny (SPEC §15)
  if (!existing && !history.some((entry) => entry.outcome !== "unevaluated")) {
    return;
  }
  const progress = projectProgress(history, policy, now.toISOString());
  const projected = progress.skills[skill];
  if (!projected) {
    return;
  }
  const nextReviewAt = projected.nextReviewAt === null ? null : new Date(projected.nextReviewAt);
  await tx
    .insert(childSkillProgress)
    .values({
      childId,
      skillVersionId,
      status: dbStatus(projected.status),
      independentSuccessStreak: projected.streak,
      lastReviewedAt: receivedAt,
      nextReviewAt,
      delayedConfirmationAt: null,
      projectionVersion: PROJECTION_VERSION,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [childSkillProgress.childId, childSkillProgress.skillVersionId],
      set: {
        status: dbStatus(projected.status),
        independentSuccessStreak: projected.streak,
        lastReviewedAt: receivedAt,
        nextReviewAt,
        delayedConfirmationAt: null,
        projectionVersion: PROJECTION_VERSION,
        updatedAt: now,
      },
    });
}

/** Ujawnienie feedbacku: ekspozycja celu zapisana przed odpowiedzią HTTP (arch §9.2). */
async function discloseFeedback(
  tx: Tx,
  task: TaskRow,
  childId: string,
  itemId: string,
  feedback: FeedbackDto,
  targetKey: string,
  now: Date,
): Promise<string> {
  const prior = await tx
    .select({ id: learningEvents.id })
    .from(learningEvents)
    .where(and(eq(learningEvents.taskId, task.id), eq(learningEvents.kind, "feedback_issued")));
  const stepId = `${task.id}:f${prior.length + 1}`;
  await writeSealedEvent(tx, {
    childId,
    taskId: task.id,
    itemId,
    kind: "feedback_issued",
    stepId,
    occurredAt: now,
    // oceniona próba pokazuje rozwiązanie własnego zadania (własna poprawna
    // odpowiedź albo correctText); „Pomiń”/brak oceny niczego nie ujawnia
    exposures: feedback.kind === "not_assessed" ? [] : [targetKey],
  });
  return stepId;
}

/**
 * Jednokrotna finalizacja próby: oceny per umiejętność, projekcje, przejście
 * zadania, rezerwacja i ujawnienie feedbacku — wszystko w jednej transakcji
 * (arch §9.2). CAS stanu processing → completed chroni przed podwójną
 * finalizacją; blokada sesji serializuje równoległych klientów.
 */
async function finalizeAttemptRow(
  tx: Tx,
  task: TaskRow,
  session: SessionRow,
  itemId: string,
  attempt: AttemptRow,
  modality: AnyModality,
  grade: Grade,
  policy: Policy,
  targetKey: string,
  now: Date,
): Promise<AttemptDto> {
  const key = answerKeyOf(task);
  const correctText = correctTextOf(task, key);
  const feedback: FeedbackDto = chooseFeedback(grade, correctText);
  const chosenText =
    modality === "choice"
      ? ((attempt.answer as { optionText?: string } | null)?.optionText ?? "")
      : modality === "audio"
        ? ((attempt.answer as { transcript?: string | null } | null)?.transcript ?? null)
        : null;

  if (modality !== "skip") {
    const skillRows = await tx
      .select({ skill: itemRevisionSkills.skill, skillVersionId: itemRevisionSkills.skillVersionId })
      .from(itemRevisionSkills)
      .where(eq(itemRevisionSkills.itemRevisionId, task.itemRevisionId));
    const versionBySkill = new Map(skillRows.map((row) => [row.skill as Skill, row.skillVersionId]));

    for (const [skill, skillGrade] of Object.entries(grade.skills) as [Skill, SkillGrade][]) {
      const skillVersionId = versionBySkill.get(skill);
      if (!skillVersionId) {
        throw new AppError("internal", { message: `missing skill version for ${skill}` });
      }
      const details: Record<string, unknown> = { ...(skillGrade.details ?? {}) };
      if (chosenText !== null && skillGrade.outcome === "incorrect") {
        // konkretna pomyłka z zachowaniem kierunku (SPEC §21); „Nie pamiętam”,
        // próby techniczne i niepewne rozpoznanie pary nie tworzą — dla mowy
        // transkrypcja trafia tutaj tylko przy wiarygodnym rozpoznaniu
        details.confusion = { expected: correctText, answered: chosenText };
      }
      await tx.insert(assessments).values({
        childId: session.childId,
        attemptId: attempt.id,
        itemRevisionId: task.itemRevisionId,
        skill,
        skillVersionId,
        outcome: dbOutcome(skillGrade.outcome),
        ...(skillGrade.reason === undefined ? {} : { reason: skillGrade.reason }),
        independent: skillGrade.independent,
        confirmationEligible: skillGrade.confirmationEligible,
        details,
      });
      await updateProjection(tx, session.childId, skillVersionId, skill, policy, now, attempt.receivedAt);
    }
  }

  const taskState = nextTaskState(modality, grade, attempt.attemptNumber);
  if (taskState !== "issued") {
    await tx.update(sessionTasks).set({ state: taskState }).where(eq(sessionTasks.id, task.id));
  }

  const completed = await tx
    .update(attempts)
    .set({ state: "completed", completedAt: now, feedback: feedback as unknown as Record<string, unknown> })
    .where(and(eq(attempts.id, attempt.id), eq(attempts.state, "processing")))
    .returning();
  if (completed.length === 0) {
    throw new AppError("conflict", { message: "attempt is already finalized" });
  }

  const stepId = await discloseFeedback(tx, task, session.childId, itemId, feedback, targetKey, now);
  const freshTask = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, task.id)))[0]!;

  // rezerwacja sprawdzenia zwalniana po rozliczeniu albo po ocenionej próbie,
  // której feedback ujawnił rozwiązanie (arch §9.3; próba techniczna zostawia)
  const assessedAny = Object.values(grade.skills).some((s) => s.outcome !== "unevaluated");
  if (RECALL_LIKE.has(task.exerciseType) && (taskState !== "issued" || assessedAny)) {
    const context = contextOf(session);
    const reservations = context.reservations.filter((k) => k !== targetKey);
    const settledChecks = [...new Set([...context.settledChecks, targetKey])];
    await tx
      .update(learningSessions)
      .set({ context: { ...context, reservations, settledChecks } as unknown as Record<string, unknown> })
      .where(eq(learningSessions.id, session.id));
  }

  return {
    attemptId: attempt.id,
    taskId: task.id,
    state: "completed",
    modality: modality as AttemptDto["modality"],
    feedback,
    taskState: freshTask.state as AttemptDto["taskState"],
    stepId,
    receivedAt: attempt.receivedAt.toISOString(),
    completedAt: now.toISOString(),
  };
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

/**
 * Wynik rozpoczęcia próby: istniejąca/processing odpowiedź klienta albo komplet
 * danych świeżej próby z zamrożonym kontekstem (wspólne dla odpowiedzi pisemnych
 * i ścieżki mowy z zadania 8).
 */
export type AttemptStart =
  | { kind: "dto"; dto: AttemptDto }
  | {
      kind: "fresh";
      task: TaskRow;
      session: SessionRow;
      itemId: string;
      policy: Policy;
      frozen: FrozenContext;
      key: AnswerKey;
      targetKey: string;
      attemptNumber: number;
      requestHash: string;
      receivedAt: Date;
    };

/**
 * Wspólny wstęp przyjęcia odpowiedzi (arch §9.1a, §9.2): blokada sesji,
 * idempotencja clientAttemptId, leniwa finalizacja przeterminowanych prób,
 * walidacje stanu i zamrożenie kontekstu kwalifikacji przy received_at.
 */
export async function startAttempt(
  tx: Tx,
  services: Services,
  valid: AttemptInput,
): Promise<AttemptStart> {
  const { task, session, itemId } = await lockTaskWithSession(tx, valid.taskId);
  const now = services.clock.now();

  const existing = (
    await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.childId, task.childId), eq(attempts.clientAttemptId, valid.clientAttemptId)))
  )[0];
  if (existing) {
    if (existing.requestHash !== requestHashOf(valid)) {
      throw new AppError("conflict", { message: "clientAttemptId reused with different answer" });
    }
    await lazyFinalizeProcessing(tx, task, session, itemId, now);
    const fresh = (await tx.select().from(attempts).where(eq(attempts.id, existing.id)))[0]!;
    const state = await rereadTaskState(tx, task.id);
    if (fresh.state === "completed" && fresh.feedback) {
      const stepId = await discloseFeedback(
        tx,
        task,
        task.childId,
        itemId,
        fresh.feedback as FeedbackDto,
        await targetKeyOf(tx, task),
        now,
      );
      return { kind: "dto", dto: dtoOf(fresh, state, stepId) };
    }
    return { kind: "dto", dto: dtoOf(fresh, state) };
  }

  // leniwa finalizacja najpierw: zwalnia jedyną próbę processing zadania
  await lazyFinalizeProcessing(tx, task, session, itemId, now);

  if (session.state !== "active") {
    throw new AppError("conflict", { message: "session is closed" });
  }
  if (task.exerciseType === "exposure") {
    throw new AppError("validation", { message: "presentation tasks take no attempts" });
  }
  if (task.state !== "issued") {
    throw new AppError("conflict", { message: "task is no longer issued" });
  }

  // świeża próba processing (audio) nie uruchamia drugiej analizy — klient
  // dostaje ten sam rekord do odpytywania (arch §9.2a)
  const processing = (
    await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.taskId, task.id), eq(attempts.state, "processing")))
  )[0];
  if (processing) {
    return { kind: "dto", dto: dtoOf(processing, await rereadTaskState(tx, task.id)) };
  }

  const priorAttempts = await tx.select({ id: attempts.id }).from(attempts).where(eq(attempts.taskId, task.id));
  const attemptNumber = priorAttempts.length + 1;

  const policy = await loadPolicy(tx, session.policyId);
  const targetKey = await targetKeyOf(tx, task);
  const sessionContext = contextOf(session);
  const frozen: FrozenContext = {
    receivedAt: now.toISOString(),
    policyVersion: policy.version,
    lastExposureAt: RECALL_LIKE.has(task.exerciseType)
      ? await lastExposureAt(tx, task.childId, targetKey)
      : null,
    firstTry: attemptNumber === 1,
    assistance: await assistanceFor(tx, task),
    previousSessionContactAt: sessionContext.previousContact[itemId] ?? null,
    timezone: sessionContext.timezone,
  };

  return {
    kind: "fresh",
    task,
    session,
    itemId,
    policy,
    frozen,
    key: answerKeyOf(task),
    targetKey,
    attemptNumber,
    requestHash: requestHashOf(valid),
    receivedAt: now,
  };
}

/**
 * Przyjmuje odpowiedź dziecka (arch §9.1a, §9.2). Kontekst kwalifikacji zamraża
 * się przy received_at pod blokadą sesji; dla odpowiedzi pisemnych cała ocena,
 * projekcja i ujawnienie feedbacku są jedną transakcją. `clientAttemptId`
 * zabezpiecza retry transportowy; ten sam klucz z inną treścią daje 409.
 */
export async function submitAttempt(services: Services, input: AttemptInput): Promise<AttemptDto> {
  const valid = AttemptInputSchema.parse(input);
  if (valid.modality === "audio") {
    // bajty nagrania nie podróżują w JSON — ścieżka mowy jest osobna (arch §11)
    throw new AppError("validation", { message: "speech attempts require the audio path" });
  }
  return services.db.transaction(async (tx) => {
    const started = await startAttempt(tx, services, valid);
    if (started.kind !== "fresh") {
      return started.dto;
    }
    const ctx: EvaluationContext = { ...started.frozen, policy: started.policy };
    const grade = gradeOf(valid, started.key, ctx);

    const answer =
      valid.modality === "text"
        ? { text: valid.text }
        : valid.modality === "choice"
          ? { optionId: valid.optionId, optionText: optionTextOf(started.task, valid.optionId) }
          : null;
    const attemptId = randomUUID();
    await tx.insert(attempts).values({
      id: attemptId,
      childId: started.task.childId,
      taskId: started.task.id,
      itemRevisionId: started.task.itemRevisionId,
      clientAttemptId: valid.clientAttemptId,
      requestHash: started.requestHash,
      attemptNumber: started.attemptNumber,
      modality: valid.modality,
      state: "processing",
      answer,
      context: started.frozen as unknown as Record<string, unknown>,
      policyId: started.session.policyId,
      receivedAt: started.receivedAt,
    });
    const attempt = (await tx.select().from(attempts).where(eq(attempts.id, attemptId)))[0]!;
    return finalizeAttemptRow(
      tx,
      started.task,
      started.session,
      started.itemId,
      attempt,
      valid.modality,
      grade,
      started.policy,
      started.targetKey,
      started.receivedAt,
    );
  });
}

/**
 * Odczyt próby (arch §12). Rozlicza leniwe processing starsze niż 60 s;
 * ponowne wydanie feedbacku zapisuje kolejne ujawnienie przed odpowiedzią.
 */
export async function readAttempt(services: Services, attemptId: string): Promise<AttemptDto> {
  const id = UuidSchema.parse(attemptId);
  return services.db.transaction(async (tx) => {
    const attempt = (await tx.select().from(attempts).where(eq(attempts.id, id)))[0];
    if (!attempt) {
      throw new AppError("not_found");
    }
    const { task, session, itemId } = await lockTaskWithSession(tx, attempt.taskId);
    const now = services.clock.now();

    await lazyFinalizeProcessing(tx, task, session, itemId, now);

    const fresh = (await tx.select().from(attempts).where(eq(attempts.id, id)))[0]!;
    const freshTask = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, task.id)))[0]!;
    if (fresh.state === "completed" && fresh.feedback) {
      const stepId = await discloseFeedback(
        tx,
        freshTask,
        fresh.childId,
        itemId,
        fresh.feedback as FeedbackDto,
        await targetKeyOf(tx, freshTask),
        now,
      );
      return dtoOf(fresh, freshTask.state, stepId);
    }
    return dtoOf(fresh, freshTask.state);
  });
}

/**
 * Zachowany wynik ścieżki mowy zapisywany w answer (SPEC §20, §26): potrzebna
 * transkrypcja i identyfikacja providerów — nigdy surowe odpowiedzi usług
 * ani bajty nagrania.
 */
export interface AttemptAnswerPatch {
  transcript: string | null;
  sttProvider: string | null;
  pronunciationProvider: string | null;
}

/**
 * Finalizacja próby z gotową oceną — ścieżka oceny mowy (zadanie 8) i testów
 * awarii. Idempotentna: ponowne wywołanie dla próby completed zwraca jej wynik.
 * `answer` uzupełnia rekord przetworzonej próby w tej samej transakcji.
 */
export async function finalizeAttempt(
  services: Services,
  attemptId: string,
  grade: Grade,
  answer?: AttemptAnswerPatch,
): Promise<AttemptDto> {
  const id = UuidSchema.parse(attemptId);
  return services.db.transaction(async (tx) => {
    const taskRef = (await tx.select({ taskId: attempts.taskId }).from(attempts).where(eq(attempts.id, id)))[0];
    if (!taskRef) {
      throw new AppError("not_found");
    }
    const { task, session, itemId } = await lockTaskWithSession(tx, taskRef.taskId);
    // odczyt dopiero pod blokadą sesji — równoległy finalizer mógł już zatwierdzić
    const attempt = (await tx.select().from(attempts).where(eq(attempts.id, id)))[0];
    if (!attempt) {
      throw new AppError("not_found");
    }
    const now = services.clock.now();
    const targetKey = await targetKeyOf(tx, task);

    if (attempt.state === "completed") {
      const freshTask = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, task.id)))[0]!;
      if (attempt.feedback) {
        const stepId = await discloseFeedback(
          tx,
          freshTask,
          attempt.childId,
          itemId,
          attempt.feedback as FeedbackDto,
          targetKey,
          now,
        );
        return dtoOf(attempt, freshTask.state, stepId);
      }
      return dtoOf(attempt, freshTask.state);
    }

    if (answer) {
      await tx
        .update(attempts)
        .set({
          answer: {
            transcript: answer.transcript === null ? null : answer.transcript.slice(0, 200),
            stt: answer.sttProvider,
            pronunciation: answer.pronunciationProvider,
          } as unknown as Record<string, unknown>,
        })
        .where(and(eq(attempts.id, id), eq(attempts.state, "processing")));
    }
    const current = answer
      ? (await tx.select().from(attempts).where(eq(attempts.id, id)))[0]!
      : attempt;

    const policy = await loadPolicy(tx, attempt.policyId);
    return finalizeAttemptRow(
      tx,
      task,
      session,
      itemId,
      current,
      current.modality as AnyModality,
      grade,
      policy,
      targetKey,
      now,
    );
  });
}

/**
 * Leniwa finalizacja: próby processing starsze niż 60 s zamieniają się w
 * nieocenione (technical) bez osobnego joba w tle (arch §9.2a). Zadanie
 * pozostaje issued — błąd techniczny nie jest błędem wiedzy.
 */
async function lazyFinalizeProcessing(
  tx: Tx,
  task: TaskRow,
  session: SessionRow,
  itemId: string,
  now: Date,
): Promise<void> {
  const stale = await tx
    .select()
    .from(attempts)
    .where(and(eq(attempts.taskId, task.id), eq(attempts.state, "processing")));
  for (const attempt of stale) {
    if (now.getTime() - attempt.receivedAt.getTime() <= ATTEMPT_PROCESSING_TIMEOUT_MS) {
      continue;
    }
    const policy = await loadPolicy(tx, attempt.policyId);
    const targetKey = await targetKeyOf(tx, task);
    const frozen = attempt.context as Partial<FrozenContext>;
    const qualification = qualifyAttempt({
      receivedAt: attempt.receivedAt.toISOString(),
      policy,
      lastExposureAt: frozen.lastExposureAt ?? null,
      firstTry: frozen.firstTry ?? attempt.attemptNumber === 1,
      assistance: frozen.assistance ?? [],
      previousSessionContactAt: frozen.previousSessionContactAt ?? null,
      timezone: frozen.timezone ?? "Europe/Warsaw",
    });
    const skills: Partial<Record<Skill, SkillGrade>> = {};
    for (const skill of assessedSkills(task.exerciseType as ExerciseType)) {
      skills[skill] = {
        outcome: "unevaluated",
        reason: "technical",
        independent: false,
        confirmationEligible: false,
      };
    }
    await finalizeAttemptRow(
      tx,
      task,
      session,
      itemId,
      attempt,
      attempt.modality as AnyModality,
      { skills, attempt: qualification },
      policy,
      targetKey,
      now,
    );
  }
}
