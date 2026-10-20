import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, isNotNull, sql } from "drizzle-orm";
import {
  SessionActivityReportSchema,
  SessionActivityReviewRecordSchema,
  SessionActivityReviewVerdictSchema,
  sessionActivityAward,
  taskActiveMs,
  type SessionActivityReport,
  type SessionActivityResultDto,
  type SessionActivityReviewRecord,
  type SessionActivityReviewVerdict,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  attempts,
  childProfiles,
  learningEvents,
  learningSessions,
  sessionTasks,
} from "../db/schema";
import { AppError } from "../errors";
import type { SessionActivityReviewTask } from "../ports/ai";

/**
 * Ocena aktywności sesji (spec client-reward-time): FE dostarcza JEDEN raport
 * na koniec sesji, serwer dołącza własne zadania i odpowiedzi z bazy, dokładnie
 * raz woła model o listę wykluczonych zadań i wyłącznie kod liczy czas oraz
 * punkty. Szczegółowy JSONB znika po 7 dniach; punkty i krótki wynik zostają.
 *
 * Model nie otrzymuje imion, identyfikatorów ani sekretów — zadania są
 * opisane zerowymi porządkami, a odpowiedzi dziecka są danymi, nie poleceniami.
 */

/** Retencja szczegółowego raportu od pierwszego przyjęcia. */
export const SESSION_ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60_000;
/**
 * Deadline finalizacji od znacznika rozpoczęcia oceny. Po terminie istniejący
 * odczyt kończy krótki wynik technicznym błędem — bez modelu i bez punktów.
 * Musi przewyższać deadline pojedynczego wywołania modelu (20 s) oraz limity
 * transportu klienta, żeby zwykłe powtórzenie nie tworzyło fałszywego błędu.
 */
export const SESSION_ACTIVITY_REVIEW_DEADLINE_MS = 120_000;
/** Rozmiar porcji czyszczenia przeterminowanych raportów. */
const CLEANUP_BATCH = 500;

export type SessionActivityErrorCode =
  | "model_not_configured"
  | "model_timeout"
  | "model_failed"
  | "invalid_verdict"
  | "review_interrupted"
  | "report_expired";

/** Zrzut zadania z bazy serwera — jedyny opis zadań widoczny dla modelu. */
interface StoredTaskSnapshot {
  taskOrdinal: number;
  taskId: string;
  exerciseType: string;
  instruction: string;
  stimulus: string | null;
  options: string[];
  acceptedAnswers: string[];
  attempts: {
    attemptId: string;
    modality: string;
    text: string | null;
    uncertain: boolean;
    supportDisclosedBefore: boolean;
    receivedAt: string;
  }[];
  processingExcluded: number;
}

interface StoredReport {
  fe: SessionActivityReport;
  tasks: StoredTaskSnapshot[];
  verdict?: SessionActivityReviewVerdict;
  errorCode?: SessionActivityErrorCode;
}

type AcceptancePlan =
  | { kind: "stored"; review: SessionActivityReviewRecord }
  | { kind: "already_started" }
  | { kind: "expired" }
  | { kind: "fresh"; stored: StoredReport; reviewTasks: SessionActivityReviewTask[]; facts: { durationSeconds: number } };

async function lockSession(tx: Tx, sessionId: string) {
  const [identity] = await tx.select({ childId: learningSessions.childId }).from(learningSessions).where(eq(learningSessions.id, sessionId));
  if (!identity) throw new AppError("not_found");
  await tx.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, identity.childId)).for("key share");
  const session = (await tx.select().from(learningSessions).where(eq(learningSessions.id, sessionId)).for("update"))[0];
  if (!session) throw new AppError("not_found");
  return session;
}

function reportHash(report: SessionActivityReport): string {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

function reviewRecordDto(review: SessionActivityReviewRecord): SessionActivityResultDto {
  return {
    status: review.status === "error" ? "error" : "evaluated",
    pointsAwarded: review.pointsAwarded,
    errorCode: review.errorCode,
  };
}

function errorRecord(
  errorCode: SessionActivityErrorCode,
  facts: { durationSeconds: number; activeSeconds: number },
  now: Date,
): SessionActivityReviewRecord {
  return {
    status: "error",
    durationSeconds: facts.durationSeconds,
    activeSeconds: facts.activeSeconds,
    approvedMilliseconds: null,
    approvedSeconds: null,
    pointsAwarded: 0,
    reason: null,
    evaluatedAt: now.toISOString(),
    errorCode,
  };
}

/** Instrukcja/bodziec/opcje widoczne dla dziecka — jako dane, nie polecenia. */
function describeTaskPrompt(prompt: unknown, exerciseType: string): { instruction: string; stimulus: string | null; options: string[] } {
  const p = prompt as Record<string, unknown> | null;
  const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
  const options = Array.isArray(p?.options)
    ? p!.options.map((option) => text((option as Record<string, unknown>).text)).filter((option): option is string => option !== null)
    : [];
  switch (p?.kind ?? exerciseType) {
    case "exposure":
      return { instruction: "Prezentacja nowego słowa", stimulus: [text(p?.source), text(p?.target)].filter(Boolean).join(" → ") || null, options: [] };
    case "picture_exposure":
      return { instruction: "Prezentacja nowego słowa (obrazek)", stimulus: null, options: [] };
    case "listening":
      return { instruction: "Pytanie słuchowe: wybierz znaczenie", stimulus: null, options };
    case "picture_listening":
      return { instruction: "Pytanie słuchowe z obrazkami: wybierz znaczenie", stimulus: null, options };
    case "reading":
      return { instruction: "Wybierz znaczenie słowa", stimulus: text(p?.text), options };
    case "reverse_recognition":
      return { instruction: "Wybierz angielskie słowo", stimulus: text(p?.prompt), options };
    case "picture_recognition":
      return { instruction: "Wybierz słowo pasujące do obrazka", stimulus: text(p?.source), options };
    case "recall":
      return { instruction: "Przypomnij angielskie słowo", stimulus: text(p?.prompt), options: [] };
    case "picture_recall":
      return { instruction: "Przypomnij słowo do obrazka", stimulus: null, options: [] };
    case "spelling":
      return { instruction: "Zapisz angielskie słowo", stimulus: text(p?.prompt), options: [] };
    case "letter_completion":
      return { instruction: "Uzupełnij brakujące litery", stimulus: text(p?.prompt), options: [] };
    case "speech":
      return { instruction: "Powiedz słowo na głos", stimulus: text(p?.text), options: [] };
    case "picture_speech":
      return { instruction: "Powiedz słowo do obrazka na głos", stimulus: null, options: [] };
    case "lesson_card":
      return { instruction: "Karta lekcji (przeczytanie)", stimulus: text((p?.card as Record<string, unknown> | undefined)?.title), options: [] };
    case "lesson_notice":
      return { instruction: text(p?.instructionPl) ?? "Zauważ różnicę", stimulus: null, options: [] };
    case "lesson_choice":
      return { instruction: text(p?.instructionPl) ?? "Wybierz odpowiedź", stimulus: text(p?.stem), options };
    case "lesson_order":
      return { instruction: text(p?.instructionPl) ?? "Ułóż w kolejności", stimulus: null, options: Array.isArray(p?.items)
        ? p!.items.map((item) => text((item as Record<string, unknown>).text)).filter((item): item is string => item !== null)
        : [] };
    case "lesson_short_answer":
      return { instruction: "Krótka odpowiedź", stimulus: text(p?.question), options };
    case "lesson_gap":
      return { instruction: text(p?.instructionPl) ?? "Uzupełnij lukę", stimulus: text(p?.stemWithGap), options: [] };
    case "lesson_error_fix":
      return { instruction: text(p?.instructionPl) ?? "Popraw zdanie", stimulus: text(p?.statement), options: [] };
    case "lesson_transform":
      return { instruction: text(p?.instructionPl) ?? "Przekształć zdanie", stimulus: text(p?.statement), options: [] };
    case "lesson_open_answer":
      return { instruction: text(p?.instructionPl) ?? "Odpowiedz własnymi słowami", stimulus: text(p?.prompt), options: [] };
    default:
      return { instruction: `Ćwiczenie typu ${exerciseType}`, stimulus: null, options };
  }
}

function answerTextOf(modality: string, answer: Record<string, unknown> | null, promptOptions: Map<string, string>): string | null {
  if (modality === "dont_remember") return "Nie pamiętam";
  if (modality === "skip") return "Pomiń";
  if (modality === "text" && typeof answer?.text === "string") return answer.text.slice(0, 200);
  if (modality === "choice") {
    if (typeof answer?.optionText === "string") return answer.optionText.slice(0, 200);
    if (typeof answer?.optionId === "string") return promptOptions.get(answer.optionId) ?? null;
  }
  if (modality === "sequence" && Array.isArray(answer?.itemIds)) {
    return answer.itemIds.map((id) => (typeof id === "string" ? promptOptions.get(id) ?? "" : "")).filter(Boolean).join(" ").slice(0, 200) || null;
  }
  if (modality === "audio" && typeof answer?.transcript === "string") return answer.transcript.slice(0, 200);
  return null;
}

function uncertainAttempt(attempt: typeof attempts.$inferSelect): boolean {
  const feedback = attempt.feedback as { speech?: { recognition?: unknown } } | null;
  return feedback?.speech?.recognition === "uncertain" || feedback?.speech?.recognition === "no_speech";
}

/** Buduje zrzut zadań/prób z bazy; wyklucza technicznie niedokończone próby. */
async function buildTaskSnapshot(tx: Tx, sessionId: string, report: SessionActivityReport): Promise<StoredTaskSnapshot[]> {
  const tasks = await tx.select().from(sessionTasks).where(eq(sessionTasks.sessionId, sessionId)).orderBy(asc(sessionTasks.ordinal));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const reportByTaskId = new Map(report.tasks.map((task) => [task.taskId, task]));
  for (const task of report.tasks) {
    if (!taskById.has(task.taskId)) {
      throw new AppError("validation", { message: "activity report references a task outside this session" });
    }
  }
  const taskIds = tasks.map((task) => task.id);
  const attemptRows = taskIds.length
    ? await tx.select().from(attempts).where(inArray(attempts.taskId, taskIds)).orderBy(asc(attempts.receivedAt), asc(attempts.attemptNumber))
    : [];
  const taskIdOfAttempt = new Map(attemptRows.map((attempt) => [attempt.id, attempt.taskId]));
  for (const task of report.tasks) {
    for (const attemptId of task.submittedAttempts) {
      // Próba musi należeć do sesji ORAZ do zadania, przy którym ją zgłoszono.
      if (!taskIdOfAttempt.has(attemptId)) {
        throw new AppError("validation", { message: "activity report references an attempt outside this session" });
      }
      if (taskIdOfAttempt.get(attemptId) !== task.taskId) {
        throw new AppError("validation", { message: "activity report lists an attempt under a different task" });
      }
    }
  }
  const disclosureRows = taskIds.length
    ? await tx.select({ taskId: learningEvents.taskId, occurredAt: learningEvents.occurredAt, kind: learningEvents.kind })
      .from(learningEvents)
      .where(and(inArray(learningEvents.taskId, taskIds), inArray(learningEvents.kind, ["hint_issued", "audio_issued"])))
    : [];
  const disclosuresByTask = new Map<string, Date[]>();
  for (const row of disclosureRows) {
    const list = disclosuresByTask.get(row.taskId) ?? [];
    list.push(row.occurredAt);
    disclosuresByTask.set(row.taskId, list);
  }
  const snapshots: StoredTaskSnapshot[] = [];
  for (const task of tasks) {
    const described = describeTaskPrompt(task.publicPrompt, task.exerciseType);
    const promptOptions = new Map<string, string>(
      ((task.publicPrompt as { options?: Array<{ id?: unknown; text?: unknown }> | null })?.options ?? [])
        .filter((option) => typeof option.id === "string" && typeof option.text === "string")
        .map((option) => [option.id as string, option.text as string]),
    );
    const key = task.answerKey as { target?: unknown; acceptedAnswers?: unknown; correctOptionId?: unknown } | null;
    const accepted = [
      ...(typeof key?.target === "string" ? [key.target] : []),
      ...(Array.isArray(key?.acceptedAnswers) ? key.acceptedAnswers.filter((a): a is string => typeof a === "string") : []),
      ...(typeof key?.correctOptionId === "string" ? [promptOptions.get(key.correctOptionId) ?? ""] : []),
    ].filter((value) => value.length > 0);
    const taskAttempts = attemptRows.filter((attempt) => attempt.taskId === task.id);
    const disclosures = (disclosuresByTask.get(task.id) ?? []).sort((a, b) => a.getTime() - b.getTime());
    snapshots.push({
      taskOrdinal: task.ordinal,
      taskId: task.id,
      exerciseType: task.exerciseType,
      instruction: described.instruction,
      stimulus: described.stimulus,
      options: described.options,
      acceptedAnswers: accepted,
      attempts: taskAttempts
        .filter((attempt) => attempt.state === "completed")
        .map((attempt) => ({
          attemptId: attempt.id,
          modality: attempt.modality,
          text: answerTextOf(attempt.modality, attempt.answer, promptOptions),
          uncertain: uncertainAttempt(attempt),
          supportDisclosedBefore: disclosures.some((occurredAt) => occurredAt.getTime() <= attempt.receivedAt.getTime()),
          receivedAt: attempt.receivedAt.toISOString(),
        })),
      processingExcluded: taskAttempts.filter((attempt) => attempt.state === "processing").length,
    });
  }
  return snapshots;
}

function sessionFacts(session: typeof learningSessions.$inferSelect, firstIssuedAt: Date | null) {
  const endedAt = session.endedAt?.getTime() ?? session.startedAt.getTime();
  const durationMs = firstIssuedAt === null ? 0 : Math.max(0, endedAt - firstIssuedAt.getTime());
  return { durationSeconds: Math.floor(durationMs / 1000) };
}

function reviewTasksOf(stored: StoredReport, feTasksByTaskId: Map<string, SessionActivityReport["tasks"][number]>): SessionActivityReviewTask[] {
  return stored.tasks
    .filter((task) => feTasksByTaskId.has(task.taskId))
    .map((task) => {
      const fe = feTasksByTaskId.get(task.taskId)!;
      return {
        taskOrdinal: task.taskOrdinal,
        instruction: task.instruction,
        stimulus: task.stimulus,
        options: task.options,
        acceptedAnswers: task.acceptedAnswers,
        submittedAnswers: task.attempts.map((attempt) => ({
          modality: attempt.modality,
          text: attempt.text,
          uncertain: attempt.uncertain,
          supportDisclosedBefore: attempt.supportDisclosedBefore,
        })),
        editCount: fe.editCount,
        editWindows: fe.editWindows.map((window) => ({ atMs: window.atMs, count: window.count })),
        playbacks: fe.playbacks.map((playback) => ({ fromMs: playback.fromMs, toMs: playback.toMs })),
        pauses: fe.pauses.map((pause) => ({ kind: pause.kind, fromMs: pause.fromMs, toMs: pause.toMs })),
        activeIntervals: fe.activeIntervals,
      };
    });
}

/**
 * Przyjmuje raport (dokładnie raz) i finalizeuje ocenę. Wywołanie modelu jest
 * poza transakcją; transakcje A i B trzymają blokadę sesji, znacznik jednokrotności
 * i wynik. Powtórka zwraca zapisany wynik/błąd bez ponownego modelu i punktów.
 */
export async function reviewSessionActivity(
  services: Services,
  sessionId: string,
  report: SessionActivityReport,
): Promise<SessionActivityResultDto> {
  const parsed = SessionActivityReportSchema.parse(report);
  const hash = reportHash(parsed);
  const plan = await services.db.transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const now = services.clock.now();
    // Fingerprint pierwszego raportu: identyczne ponowienie dostarczenia jest
    // rozpoznawalne także po retencji; odmienne wejście dostaje konflikt.
    if (session.activityReportHash !== null && session.activityReportHash !== hash) {
      throw new AppError("conflict", { message: "a different activity report was already accepted for this session" });
    }
    if (session.activityReview !== null) {
      const saved = SessionActivityReviewRecordSchema.safeParse(session.activityReview);
      if (!saved.success) throw new AppError("conflict", { message: "stored session activity review is invalid" });
      return { kind: "stored", review: saved.data } as AcceptancePlan;
    }
    if (session.activityReviewStartedAt !== null) {
      const startedAt = session.activityReviewStartedAt.getTime();
      if (now.getTime() - startedAt < SESSION_ACTIVITY_REVIEW_DEADLINE_MS) {
        return { kind: "already_started" } as AcceptancePlan;
      }
      const [firstIssued] = await tx.select({ issuedAt: sessionTasks.issuedAt }).from(sessionTasks)
        .where(eq(sessionTasks.sessionId, sessionId)).orderBy(asc(sessionTasks.issuedAt)).limit(1);
      const facts = sessionFacts(session, firstIssued?.issuedAt ?? null);
      const savedReport = (session.activityReport as { fe?: { activeMs?: unknown } } | null)?.fe;
      const activeSeconds = typeof savedReport?.activeMs === "number"
        ? Math.min(Math.floor(savedReport.activeMs / 1000), facts.durationSeconds)
        : 0;
      const record = errorRecord("review_interrupted", { durationSeconds: facts.durationSeconds, activeSeconds }, now);
      await tx.update(learningSessions).set({ activityReview: record }).where(eq(learningSessions.id, sessionId));
      return { kind: "stored", review: record } as AcceptancePlan;
    }
    if (session.activityReportExpiresAt !== null && session.activityReportExpiresAt.getTime() <= now.getTime()) {
      // Legacy sesja sprzed wdrożenia albo raport po retencji — bez oceny i punktów.
      return { kind: "expired" } as AcceptancePlan;
    }

    const stored: StoredReport = { fe: parsed, tasks: await buildTaskSnapshot(tx, sessionId, parsed) };
    const [firstIssued] = await tx.select({ issuedAt: sessionTasks.issuedAt }).from(sessionTasks)
      .where(eq(sessionTasks.sessionId, sessionId)).orderBy(asc(sessionTasks.issuedAt)).limit(1);
    const facts = sessionFacts(session, firstIssued?.issuedAt ?? null);
    const expiresAt = new Date(now.getTime() + SESSION_ACTIVITY_RETENTION_MS);
    await tx.update(learningSessions).set({
      activityReportHash: hash,
      activityReviewStartedAt: now,
      activityReportExpiresAt: expiresAt,
      ...(parsed.tasks.length > 0 ? { activityReport: stored as unknown as Record<string, unknown> } : {}),
    }).where(eq(learningSessions.id, sessionId));

    if (parsed.tasks.length === 0) {
      // Pusta sesja/anulowana kartkówka przed pierwszym zadaniem: normalny wynik
      // 0 sekund i 0 punktów, bez wywołania modelu.
      const record: SessionActivityReviewRecord = {
        status: "evaluated",
        durationSeconds: facts.durationSeconds,
        activeSeconds: 0,
        approvedMilliseconds: 0,
        approvedSeconds: 0,
        pointsAwarded: 0,
        reason: "Sesja bez zadań.",
        evaluatedAt: now.toISOString(),
        errorCode: null,
      };
      await tx.update(learningSessions).set({ activityReview: record }).where(eq(learningSessions.id, sessionId));
      return { kind: "stored", review: record } as AcceptancePlan;
    }
    return {
      kind: "fresh",
      stored,
      reviewTasks: reviewTasksOf(stored, new Map(parsed.tasks.map((task) => [task.taskId, task]))),
      facts,
    } as AcceptancePlan;
  });

  if (plan.kind === "stored") return reviewRecordDto(plan.review);
  if (plan.kind === "already_started") {
    return { status: "already_started", pointsAwarded: 0, errorCode: null };
  }
  if (plan.kind === "expired") {
    return { status: "error", pointsAwarded: 0, errorCode: "report_expired" };
  }

  const finalize = (record: SessionActivityReviewRecord, verdict?: SessionActivityReviewVerdict, errorCode?: SessionActivityErrorCode) =>
    finalizeSessionActivity(services, sessionId, record, verdict, errorCode);

  const facts = { durationSeconds: plan.facts.durationSeconds, activeSeconds: Math.min(Math.floor(plan.stored.fe.activeMs / 1000), plan.facts.durationSeconds) };
  if (!services.sessionActivity) {
    return reviewRecordDto(await finalize(errorRecord("model_not_configured", facts, services.clock.now()), undefined, "model_not_configured"));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), services.sessionActivity.timeoutMs);
  let raw: unknown;
  try {
    raw = await services.sessionActivity.provider.review({ tasks: plan.reviewTasks }, controller.signal);
  } catch (error) {
    clearTimeout(timer);
    const code: SessionActivityErrorCode = (error as { name?: unknown })?.name === "AbortError" ? "model_timeout" : "model_failed";
    return reviewRecordDto(await finalize(errorRecord(code, facts, services.clock.now()), undefined, code));
  }
  clearTimeout(timer);
  const verdict = SessionActivityReviewVerdictSchema.safeParse(raw);
  if (!verdict.success) {
    return reviewRecordDto(await finalize(errorRecord("invalid_verdict", facts, services.clock.now()), undefined, "invalid_verdict"));
  }
  const ordinals = new Set(plan.stored.tasks.map((task) => task.taskOrdinal));
  const excluded = new Set<number>();
  for (const exclusion of verdict.data.excludedTasks) {
    if (!ordinals.has(exclusion.taskOrdinal) || excluded.has(exclusion.taskOrdinal)) {
      return reviewRecordDto(await finalize(errorRecord("invalid_verdict", facts, services.clock.now()), undefined, "invalid_verdict"));
    }
    excluded.add(exclusion.taskOrdinal);
  }
  // Wyłącznie kod liczy czas: suma unii przedziałów zadań niewykluczonych.
  const ordinalByTaskId = new Map(plan.stored.tasks.map((task) => [task.taskId, task.taskOrdinal]));
  const approvedMilliseconds = plan.stored.fe.tasks
    .filter((task) => !excluded.has(ordinalByTaskId.get(task.taskId) ?? -1))
    .reduce((total, task) => total + taskActiveMs(task), 0);
  const evaluatedAt = services.clock.now().toISOString();
  const record: SessionActivityReviewRecord = {
    status: "evaluated",
    durationSeconds: facts.durationSeconds,
    activeSeconds: facts.activeSeconds,
    approvedMilliseconds,
    approvedSeconds: Math.floor(approvedMilliseconds / 1000),
    pointsAwarded: 0,
    reason: verdict.data.reason,
    evaluatedAt,
    errorCode: null,
  };
  return reviewRecordDto(await finalize(record, verdict.data));
}

/**
 * Transakcja B: zapis wyniku i naliczenie punktów atomowo albo nic.
 * Kolejność blokad: profil (FOR UPDATE) PRZED sesją — transakcje przyjęcia
 * raportu biorą profil tylko FOR KEY SHARE, więc ta kolejność nie tworzy cyklu.
 */
async function finalizeSessionActivity(
  services: Services,
  sessionId: string,
  record: SessionActivityReviewRecord,
  verdict?: SessionActivityReviewVerdict,
  errorCode?: SessionActivityErrorCode,
): Promise<SessionActivityReviewRecord> {
  try {
    return await services.db.transaction(async (tx) => {
      const [identity] = await tx.select({ childId: learningSessions.childId }).from(learningSessions).where(eq(learningSessions.id, sessionId));
      if (!identity) throw new AppError("not_found");
      const profileLock = record.status === "evaluated"
        ? await tx.select({ rewardPoints: childProfiles.rewardPoints, remainder: childProfiles.rewardRemainderMs })
            .from(childProfiles).where(eq(childProfiles.id, identity.childId)).for("update")
        : [];
      const session = (await tx.select().from(learningSessions).where(eq(learningSessions.id, sessionId)).for("update"))[0];
      if (!session) throw new AppError("not_found");
      if (session.activityReview !== null) {
        // Spóźniona odpowiedź modelu nie nadpisuje zapisanego wyniku/błędu.
        const saved = SessionActivityReviewRecordSchema.safeParse(session.activityReview);
        if (!saved.success) throw new AppError("conflict", { message: "stored session activity review is invalid" });
        return saved.data;
      }
      const now = services.clock.now();
      if (session.activityReviewStartedAt !== null
        && now.getTime() - session.activityReviewStartedAt.getTime() >= SESSION_ACTIVITY_REVIEW_DEADLINE_MS) {
        const expired = errorRecord("review_interrupted", { durationSeconds: record.durationSeconds, activeSeconds: record.activeSeconds }, now);
        await tx.update(learningSessions).set({ activityReview: expired }).where(eq(learningSessions.id, sessionId));
        return expired;
      }
      let finalRecord = record;
      if (record.status === "evaluated") {
        const [profile] = profileLock;
        if (!profile) throw new AppError("not_found");
        const approved = record.approvedMilliseconds ?? 0;
        // Arytmetyka punktów wyłącznie z kontraktu (1 pkt / pełna minuta,
        // reszta przenoszona między sesjami) — bez zdublowanej logiki inline.
        const award = sessionActivityAward(approved, profile.remainder);
        finalRecord = { ...record, pointsAwarded: award.pointsAwarded };
        await tx.update(childProfiles).set({
          rewardPoints: profile.rewardPoints + award.pointsAwarded,
          rewardRemainderMs: award.remainderMs,
        }).where(eq(childProfiles.id, session.childId));
      }
      await tx.update(learningSessions).set({
        activityReview: finalRecord,
        ...(session.activityReport !== null && (verdict !== undefined || errorCode !== undefined)
          ? {
              activityReport: {
                ...(session.activityReport as Record<string, unknown>),
                ...(verdict !== undefined ? { verdict } : {}),
                ...(errorCode !== undefined ? { errorCode } : {}),
              },
            }
          : {}),
      }).where(eq(learningSessions.id, sessionId));
      return finalRecord;
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") {
      // Profil usunięty w trakcie oceny: brak finalizacji i nagrody.
      return errorRecord("review_interrupted", { durationSeconds: record.durationSeconds, activeSeconds: record.activeSeconds }, services.clock.now());
    }
    throw error;
  }
}

/** Wynik zapisany w sesji (do podpięcia do podsumowania bez ponownej oceny). */
export async function readSessionActivityResult(services: Services, sessionId: string): Promise<SessionActivityResultDto | null> {
  const [row] = await services.db.select({ review: learningSessions.activityReview }).from(learningSessions).where(eq(learningSessions.id, sessionId));
  if (!row?.review) return null;
  const saved = SessionActivityReviewRecordSchema.safeParse(row.review);
  if (!saved.success) return null;
  return reviewRecordDto(saved.data);
}

/** Czy szczegóły raportu są jeszcze w okresie retencji (widok rodzica). */
export function activityDetailsAvailable(session: { activityReportExpiresAt: Date | null }, now: Date): boolean {
  return session.activityReportExpiresAt !== null && session.activityReportExpiresAt.getTime() > now.getTime();
}

/**
 * Worker: czyści wygasły JSONB raportu w ograniczonych partiach. Zostaje krótki
 * wynik, punkty, fingerprint i znacznik jednokrotności. Nie ocenia i nie woła
 * modelu. Zwraca liczbę oczyszczonych wierszy.
 */
export async function cleanupExpiredActivityReports(services: Services, batchSize = CLEANUP_BATCH): Promise<number> {
  const now = services.clock.now();
  let cleaned = 0;
  for (;;) {
    const rows = await services.db.select({ id: learningSessions.id }).from(learningSessions)
      .where(and(isNotNull(learningSessions.activityReportExpiresAt), lt(learningSessions.activityReportExpiresAt, now), sql`${learningSessions.activityReport} is not null`))
      .limit(batchSize);
    if (rows.length === 0) return cleaned;
    for (const row of rows) {
      await services.db.update(learningSessions)
        .set({ activityReport: null })
        .where(and(eq(learningSessions.id, row.id), isNotNull(learningSessions.activityReportExpiresAt), lt(learningSessions.activityReportExpiresAt, now)));
    }
    cleaned += rows.length;
    if (rows.length < batchSize) return cleaned;
  }
}
