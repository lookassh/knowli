import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Services } from "../../../config";
import { deckVersions, generationRuns } from "../../../db/schema";
import { AppError } from "../../../errors";
import { agentObjectivesOf, asAgentCapable } from "../../../domain/lessons/agent/capable";
import { finalLessonCheck } from "../../../domain/lessons/agent/status";
import { cardExposureSources } from "../../../domain/lessons/card-exposure-sources";
import { resolveLessonTopic, validateDynamicTopicData } from "../../../domain/lessons/topic-resolution";
import type { DynamicTopicData, LessonExerciseDraft, LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import { MAX_AUTOMATIC_ATTEMPTS, requireGeneration } from "../generation-runtime";
import {
  emptyLessonAgentProgress,
  LessonAgentCheckpointLostError,
  parseLessonAgentProgress,
  saveLessonAgentCheckpoint,
  summarizeLessonAgentProgress,
  type LessonAgentProgress,
} from "./lesson-agent-checkpoint";
import {
  acceptedInLessonOrder,
  generationGapsOf,
  lessonAgentRunInputFor,
  lessonAgentRunOutcome,
  lessonCatalogTopic,
  mergeAttemptIntoProgress,
  mergeGenerationGaps,
  outcomeObjectivesOf,
  type LessonAgentOutcome,
  type LessonGenerationGap,
} from "./lesson-agent-outcome";
import {
  failLessonPoolValidation,
  finalizeLessonPoolWrite,
  generateDynamicObjectives,
  lessonRunIsCurrent,
  markLessonRun,
  mergeExamples,
  orderedDraftExercises,
  type LessonContext,
  type LessonPoolWriteContext,
  type LessonRunIdentity,
  type LessonRunInput,
} from "./lesson-drafts";
import { classifyLessonGenerationFailure, lessonRetryDelayMs } from "./lesson-generation-errors";
import { LessonGenerationCancelledError, withLessonGenerationControl, type LessonGenerationControl } from "./lesson-generation-control";
import { DEFAULT_LESSON_GENERATION_POLICY } from "./lesson-generation-policy";
import { kindsOf, lessonAgentLimits, runLessonPoolAgent, type LessonPoolAgentResult, type SettledObjective } from "./lesson-pool-agent";
import { DEFAULT_LESSON_AGENT_POLICY } from "./lesson-pool-agent-policy";

/**
 * Ścieżka agenta w `executeLessonGeneration` (spec etapu 2a §7–§10): próba runu puli lekcji generowana
 * kierownikiem `runLessonPoolAgent` z punktem kontrolnym w wierszu runu, wynik próby z funkcji czystych
 * (`lesson-agent-outcome.ts`) i wspólny zapis do szkicu (`finalizeLessonPoolWrite`, bez krytyka).
 * Granica transakcji: zapis do szkicu i podsumowanie punktu kontrolnego w jednej transakcji; zapisy
 * postępu w trakcie — osobno, pod strażą tożsamości próby. Logi `[lesson-agent]` bez treści ćwiczeń,
 * materiału, kart i tematów zdań.
 */

/** Rezerwa na zapis do szkicu przed terminem kontrolera (termin kierownika przychodzi wcześniej o tyle). */
export const AGENT_FINALIZATION_RESERVE_MS = 30_000;

/** Szkic wersji czytany przed próbą (zapis i tak sprawdza numer edycji pod blokadą). */
interface DraftView {
  readonly exercises: readonly LessonExerciseDraft[];
  readonly examples: Readonly<Record<string, string[]>>;
  readonly dynamicTopic?: DynamicTopicData;
  readonly storySentences?: readonly string[];
}

/** Wynik próby do rozliczenia: postęp po scaleniu z wynikiem kierownika i decyzja z tabeli §9. */
interface AttemptResult {
  readonly progress: LessonAgentProgress;
  readonly outcome: LessonAgentOutcome;
}

/** Wydatek kierownika (zawiera `initialSpentUsd`) przeniesiony do postępu: budżet = licznik, łącznie + przyrost. */
function withSpend(progress: LessonAgentProgress, spentUsd: number): Pick<LessonAgentProgress, "budgetSpentUsd" | "totalSpentUsd"> {
  const delta = Math.max(0, spentUsd - progress.budgetSpentUsd);
  return { budgetSpentUsd: progress.budgetSpentUsd + delta, totalSpentUsd: progress.totalSpentUsd + delta };
}

/** Wynik kierownika z jednym rozliczonym zagadnieniem (zapis postępu w haku `onObjectiveSettled`). */
function settledResult(settled: SettledObjective): LessonPoolAgentResult {
  return {
    planStatus: "not_needed",
    objectives: [settled],
    stats: { submitted: 0, accepted: 0, rejectedByKind: {}, checkUnavailable: 0, checkerCalls: 0, invariantViolations: 0, refused: 0 },
    rejections: [],
    spentUsd: settled.spentUsd,
    unknownCostCalls: 0,
  };
}

/** Nowe przykłady kart pełnej generacji: własne przykłady zagadnienia z postępu, inaczej przykłady planu. */
function newExamplesOf(progress: LessonAgentProgress, objectiveOrder: readonly string[]): Record<string, string[]> {
  const examples: Record<string, string[]> = {};
  for (const objectiveId of objectiveOrder) {
    const own = progress.objectives[objectiveId]?.examples ?? [];
    const list = own.length > 0 ? own : (progress.planExamples?.[objectiveId] ?? []);
    if (list.length > 0) examples[objectiveId] = [...list];
  }
  return examples;
}

/** Kontekst z bieżącymi lukami generowania; pusta lista usuwa pole. */
function withGenerationGaps(next: LessonContext, gaps: readonly LessonGenerationGap[]): LessonContext {
  const { generationGaps: _previous, ...rest } = next;
  return gaps.length === 0 ? rest : { ...rest, generationGaps: [...gaps] };
}

/**
 * Postęp z punktu kontrolnego z tematem sprawdzonym regułami katalogu jak przy pierwszej próbie
 * (`parseLessonAgentProgress` sprawdza tylko obwiednię). Zły temat = brak postępu (start od zera).
 */
function validatedProgress(subject: SubjectModule, progress: LessonAgentProgress | undefined, runId: string): LessonAgentProgress | undefined {
  const dynamicTopic = progress?.dynamicTopic;
  if (dynamicTopic === undefined) return progress;
  let errors: string[];
  try {
    errors = validateDynamicTopicData(subject, dynamicTopic);
  } catch {
    errors = ["invalid"];
  }
  if (errors.length === 0) return progress;
  console.log(`[lesson-agent] run=${runId} checkpoint=invalid topic`);
  return undefined;
}

export async function executeLessonAgentGeneration(
  services: Services,
  args: {
    run: typeof generationRuns.$inferSelect;
    attempts: number;
    subject: SubjectModule;
    input: LessonRunInput;
    runStartedAtMs: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  const deps = requireGeneration(services);
  const agentDeps = deps.lessonAgent;
  if (agentDeps === undefined) throw new AppError("internal", { message: "lesson agent not configured" });
  const { attempts, subject, input, signal } = args;
  const runId = args.run.id;
  const run: LessonRunIdentity = { runId, attempts, expectedEditNumber: args.run.expectedEditNumber!, deckVersionId: args.run.deckVersionId! };
  const regenerate = input.regenerate;
  const mode: "pool" | "add" = regenerate === undefined ? "pool" : "add";
  const addObjectiveId = regenerate?.objectiveId;
  const executionPolicy = deps.lessonExecution ?? DEFAULT_LESSON_GENERATION_POLICY;
  const runDeadlineAtMs = args.runStartedAtMs + executionPolicy.runTimeoutMs;
  const budgetUsd = { ...DEFAULT_LESSON_AGENT_POLICY, ...agentDeps.policy }.runBudgetUsd;

  // Postęp czytany po przejęciu (wiersz runu sprzed claimu mógł nie widzieć „Ponów”).
  const [checkpointRow] = await services.db.select({ agentCheckpoint: generationRuns.agentCheckpoint })
    .from(generationRuns).where(eq(generationRuns.id, runId));
  const start = validatedProgress(subject, parseLessonAgentProgress(checkpointRow?.agentCheckpoint, runId), runId);
  // Najświeższa znana wartość postępu: zapis best-effort przy wyjściu (przynajmniej wydatek budżetu).
  let latest: LessonAgentProgress = start ?? emptyLessonAgentProgress();
  const save = async (progress: LessonAgentProgress): Promise<void> => {
    latest = progress;
    await saveLessonAgentCheckpoint(services.db, run, progress);
  };
  const saveBestEffort = async (): Promise<void> => {
    try {
      await saveLessonAgentCheckpoint(services.db, run, latest);
    } catch {
      // run nie jest już bieżącą próbą albo baza jest niedostępna — postęp tej próby przepada
    }
  };

  const [version] = await services.db.select({ lessonContext: deckVersions.lessonContext })
    .from(deckVersions).where(eq(deckVersions.id, run.deckVersionId));
  const draftContext = (version?.lessonContext ?? {}) as unknown as Partial<LessonContext>;
  const draft: DraftView = {
    exercises: mode === "add" ? await orderedDraftExercises(services.db, run.deckVersionId) : [],
    examples: draftContext.examples ?? {},
    ...(draftContext.dynamicTopic === undefined ? {} : { dynamicTopic: draftContext.dynamicTopic }),
    ...(draftContext.story === undefined ? {} : { storySentences: [...draftContext.story.sentences] }),
  };
  const catalogTopic = subject.buildDynamicTopic === undefined ? resolveLessonTopic(services.subjects, input)?.topic : undefined;

  /** Temat lekcji do zapisu: dogenerowanie — temat runu albo szkicu; pula — temat z postępu albo runu; inaczej katalog. */
  const lessonTopicOf = (progress: LessonAgentProgress): { topic: LessonTopic; dynamicTopic?: DynamicTopicData } => {
    const dynamicTopic = mode === "add" ? (input.dynamicTopic ?? draft.dynamicTopic) : (progress.dynamicTopic ?? input.dynamicTopic);
    if (subject.buildDynamicTopic !== undefined) {
      if (dynamicTopic === undefined) throw new AppError("validation", { message: "lesson topic unresolved" });
      return { topic: subject.buildDynamicTopic(dynamicTopic), dynamicTopic };
    }
    if (catalogTopic === undefined) throw new AppError("validation", { message: "lesson topic unresolved" });
    return { topic: lessonCatalogTopic(catalogTopic, input.objectiveIds) };
  };

  /** Ćwiczenia liczone jako przyjęte (§9): dogenerowanie — wyłącznie nowe ćwiczenia zagadnienia. */
  const acceptedCount = (progress: LessonAgentProgress): number =>
    mode === "add"
      ? (progress.objectives[addObjectiveId!]?.exercises.length ?? 0)
      : Object.values(progress.objectives).reduce((sum, entry) => sum + entry.exercises.length, 0);

  /** Kontrola końcowa na całości i wspólny zapis do szkicu (§10), bez krytyka, z podsumowaniem w tej samej transakcji. */
  const finalize = async (progress: LessonAgentProgress): Promise<void> => {
    const { topic, dynamicTopic } = lessonTopicOf(progress);
    const lessonOrder = topic.objectives.map((objective) => objective.id);
    const accepted = acceptedInLessonOrder(progress, mode === "add" ? [addObjectiveId!] : lessonOrder);
    const newExamples = mode === "add" ? {} : newExamplesOf(progress, lessonOrder);
    const capable = asAgentCapable(subject);
    const check = finalLessonCheck({
      subject: capable,
      topic,
      objectives: agentObjectivesOf(topic, kindsOf(dynamicTopic)),
      material: input.material,
      fixed: draft.exercises,
      accepted: accepted.map((exercise) => ({ objectiveId: exercise.objectiveId, draft: exercise })),
      // Zdania i przykłady kart są źródłami ujawnień tak jak w kierowniku.
      examples: mergeExamples(cardExposureSources(subject, topic), mode === "add" ? draft.examples : newExamples),
      limits: lessonAgentLimits(capable, topic, input.poolSize),
    });
    if (check.removed > 0) console.log(`[lesson-agent] run=${runId} final_check removed=${check.removed}`);
    const gaps = generationGapsOf(progress, lessonOrder, regenerate === undefined ? "pool" : { add: { objectiveId: regenerate.objectiveId, count: regenerate.count } });
    const context: LessonPoolWriteContext = {
      ...(mode === "pool" && dynamicTopic !== undefined ? { dynamicTopic } : {}),
      newExamples,
      // Usunięcia po przyjęciu (bezpiecznik kierownika i kontrola końcowa), nie odrzucenia w pętli agenta.
      rejectedCount: progress.removedAfterAcceptance + check.removed,
      rejectedReasons: {},
      droppedObjectiveCount: progress.droppedObjectiveCount ?? 0,
    };
    const written = await finalizeLessonPoolWrite(services, {
      run,
      subject,
      topicVersion: input.topicVersion,
      regenerate: mode === "add",
      existingDrafts: draft.exercises,
      accepted: check.kept,
      context,
      extendContext: (next) => withGenerationGaps(next, mergeGenerationGaps(next.generationGaps, gaps, mode, addObjectiveId)),
      onSuccessTransaction: async (tx) => {
        await tx.update(generationRuns)
          .set({ agentCheckpoint: summarizeLessonAgentProgress(progress, attempts) as unknown as Record<string, unknown> })
          .where(eq(generationRuns.id, runId));
      },
      finalizationDeadlineAtMs: runDeadlineAtMs,
      ...(signal === undefined ? {} : { signal }),
    });
    console.log(`[lesson-agent] run=${runId} write=${written} kept=${check.kept.length} gaps=${gaps.length} durationMs=${Date.now() - args.runStartedAtMs}`);
  };

  /** Rozliczenie próby (§9): log zakończenia, potem zapis do szkicu albo zapis postępu i stan runu. */
  const settle = async ({ progress, outcome }: AttemptResult): Promise<void> => {
    const statuses = Object.values(progress.objectives).map((entry) => entry.status);
    const count = (status: string) => statuses.filter((value) => value === status).length;
    console.log(
      `[lesson-agent] run=${runId} outcome=${outcome.kind}${outcome.kind === "finalize" ? "" : ` error=${outcome.errorCode}`} complete=${count("complete")} incomplete=${count("incomplete")} failed=${count("failed")} accepted=${acceptedCount(progress)} spentUsd=${progress.totalSpentUsd.toFixed(4)} attempt=${attempts}`,
    );
    if (outcome.kind === "finalize") {
      await finalize(progress);
      return;
    }
    if (outcome.kind === "failed" && outcome.errorCode === "validation") {
      // Jak `failValidation` potoku: liczniki trafiają do kontekstu szkicu (raport krytyka bez zmian). Postęp
      // zostaje do „Ponów” z licznikami wyzerowanymi w tej samej transakcji — kolejny zapis do szkicu doliczy
      // tylko nowe usunięcia, nie te już policzone w kontekście.
      const counted: LessonAgentProgress = { ...progress, removedAfterAcceptance: 0, droppedObjectiveCount: 0 };
      latest = counted;
      await failLessonPoolValidation(services, {
        run,
        context: {
          newExamples: {},
          rejectedCount: progress.removedAfterAcceptance,
          rejectedReasons: {},
          droppedObjectiveCount: progress.droppedObjectiveCount ?? 0,
        },
        onTransaction: (tx) => saveLessonAgentCheckpoint(tx, run, counted),
      });
      return;
    }
    await save(progress);
    if (outcome.kind === "requeue") {
      const delay = lessonRetryDelayMs(attempts, outcome.retryAfterMs, Math.random);
      const nextAttemptAt = new Date(services.clock.now().getTime() + delay);
      console.log(`[lesson-agent] run=${runId} retryDelayMs=${delay} nextAttemptAt=${nextAttemptAt.toISOString()}`);
      await markLessonRun(services.db, services.clock, run, "queued", outcome.errorCode, nextAttemptAt);
    } else {
      await markLessonRun(services.db, services.clock, run, "failed", outcome.errorCode);
    }
  };

  /** Próba pod kontrolerem: etap zagadnień (szkoła), kierownik z hakami zapisu postępu, scalenie i wynik. */
  const attempt = async (control: LessonGenerationControl): Promise<AttemptResult> => {
    let begin = start ?? emptyLessonAgentProgress();
    const inputArgs = {
      runId,
      attempts,
      expectedEditNumber: run.expectedEditNumber,
      attemptNonce: randomUUID(),
      subject,
      input,
      graderAvailable: services.generation?.graderAvailable === true,
      draft,
      ...(catalogTopic === undefined ? {} : { catalogTopic }),
    };
    let runInput = lessonAgentRunInputFor({ ...inputArgs, progress: start });
    if ("needsObjectives" in runInput) {
      // Wynik etapu zagadnień trafia do punktu kontrolnego: wznowienie nie woła go ponownie.
      const stage = await generateDynamicObjectives(deps.llm, control, subject, input);
      console.log(`[lesson-agent] run=${runId} objectives_stage objectives=${stage.data.objectives.length} dropped=${stage.droppedObjectiveCount}`);
      begin = { ...begin, dynamicTopic: stage.data, droppedObjectiveCount: stage.droppedObjectiveCount };
      await save(begin);
      runInput = lessonAgentRunInputFor({ ...inputArgs, progress: begin });
    }
    if ("needsObjectives" in runInput) throw new AppError("internal", { message: "objectives stage did not resolve the topic" });
    if ("nothingToAdd" in runInput) return { progress: begin, outcome: { kind: "finalize" } };

    const remainingMs = control.deadlineAtMs - (agentDeps.finalizationReserveMs ?? AGENT_FINALIZATION_RESERVE_MS) - Date.now();
    const emptyAttempt: LessonPoolAgentResult = {
      planStatus: "not_needed",
      objectives: [],
      stats: { submitted: 0, accepted: 0, rejectedByKind: {}, checkUnavailable: 0, checkerCalls: 0, invariantViolations: 0, refused: 0 },
      rejections: [],
      spentUsd: begin.budgetSpentUsd,
      unknownCostCalls: 0,
    };
    const outcomeFor = (progress: LessonAgentProgress, result: LessonPoolAgentResult): LessonAgentOutcome =>
      lessonAgentRunOutcome({
        planStatus: result.planStatus,
        ...(result.planFailure === undefined ? {} : { planFailure: result.planFailure }),
        objectives: outcomeObjectivesOf(progress, result),
        accepted: acceptedCount(progress),
        budgetExhausted: result.spentUsd >= budgetUsd,
        attempts,
        maxAttempts: MAX_AUTOMATIC_ATTEMPTS,
      });
    if (remainingMs <= 0) {
      // Bez czasu na kierownika: wynik z samego postępu. Termin zastępuje tylko „nic nie przyjęto” (wiersz 7);
      // wyczerpany budżet (wiersz 1) i wspólny kod dostawcy z punktu kontrolnego (wiersz 6) zostają.
      console.log(`[lesson-agent] run=${runId} no_time_for_agent remainingMs=${remainingMs}`);
      const outcome = outcomeFor(begin, emptyAttempt);
      const timedOut = outcome.kind === "failed" && outcome.errorCode === "validation" && begin.budgetSpentUsd < budgetUsd;
      return { progress: begin, outcome: timedOut ? { kind: "failed", errorCode: "provider_timeout" } : outcome };
    }

    console.log(
      `[lesson-agent] run=${runId} start mode=${mode} attempt=${attempts} resumed=${Object.keys(begin.objectives).length} pool=${input.poolSize} remainingMs=${remainingMs}`,
    );
    // Kopia robocza do zapisów w trakcie; scalenie wyniku liczy się od `begin` (inaczej wydatek i histogram dwa razy).
    let working = begin;
    const result = await control.run((agentSignal) =>
      runLessonPoolAgent(
        {
          agent: agentDeps.agent,
          checker: agentDeps.checker,
          subjects: services.subjects,
          policy: { ...agentDeps.policy, runTimeoutMs: remainingMs },
        },
        {
          ...runInput,
          onObjectivesResolved: async (resolved) => {
            const planExamples = Object.fromEntries(Object.entries(resolved.planExamples).map(([id, list]) => [id, [...list]]));
            working = {
              ...working,
              ...(resolved.dynamicTopic === undefined ? {} : { dynamicTopic: resolved.dynamicTopic }),
              ...(Object.keys(planExamples).length === 0 ? {} : { planExamples }),
              ...withSpend(working, resolved.spentUsd),
            };
            await save(working);
          },
          onObjectiveSettled: async (settled) => {
            working = mergeAttemptIntoProgress(working, settledResult(settled), mode, addObjectiveId);
            await save(working);
          },
        },
        agentSignal,
      ),
    );
    const merged = mergeAttemptIntoProgress(begin, result, mode, addObjectiveId);
    // Temat i przykłady planu zna tylko kopia robocza (hak planu), nie wynik kierownika.
    const progress: LessonAgentProgress = {
      ...merged,
      ...(merged.dynamicTopic === undefined && working.dynamicTopic !== undefined ? { dynamicTopic: working.dynamicTopic } : {}),
      ...(working.planExamples === undefined ? {} : { planExamples: working.planExamples }),
    };
    latest = progress;
    return { progress, outcome: outcomeFor(progress, result) };
  };

  try {
    if (attempts > MAX_AUTOMATIC_ATTEMPTS) {
      // Wyczerpane próby przed startem (np. `shutdown` w ostatniej): zapis części bez wywołań modelu.
      if (start !== undefined && acceptedCount(start) >= 1) {
        console.log(`[lesson-agent] run=${runId} attempts_exhausted: finalize from checkpoint attempt=${attempts}`);
        await settle({ progress: start, outcome: { kind: "finalize" } });
      } else {
        await markLessonRun(services.db, services.clock, run, "failed", "attempts_exhausted");
      }
      return;
    }
    const result = await withLessonGenerationControl(
      {
        ...executionPolicy,
        ...(signal === undefined ? {} : { signal }),
        assertCurrent: () => lessonRunIsCurrent(services.db, run),
      },
      attempt,
    );
    await settle(result);
  } catch (error) {
    if (error instanceof LessonGenerationCancelledError && error.reason === "shutdown") {
      await saveBestEffort();
      await markLessonRun(services.db, services.clock, run, "queued", null, null);
      return;
    }
    if (error instanceof LessonGenerationCancelledError || error instanceof LessonAgentCheckpointLostError) {
      // Edycja rodzica (także podbicie numeru edycji bez anulowania runów) albo „Ponów” w trakcie:
      // run nie zostaje w `running` (CAS na próbie; po „Ponów” bez zmian).
      console.log(`[lesson-agent] run=${runId} superseded attempt=${attempts}`);
      await markLessonRun(services.db, services.clock, run, "superseded", null);
      return;
    }
    const failure = classifyLessonGenerationFailure(error);
    console.error(`[lesson-agent] run=${runId} error code=${failure.errorCode} retryable=${failure.retryable} attempt=${attempts}`);
    await saveBestEffort();
    if (!failure.retryable) {
      await markLessonRun(services.db, services.clock, run, "failed", failure.errorCode);
    } else if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      await markLessonRun(services.db, services.clock, run, "failed", "attempts_exhausted");
    } else {
      const delay = lessonRetryDelayMs(attempts, failure.retryAfterMs, Math.random);
      const nextAttemptAt = new Date(services.clock.now().getTime() + delay);
      console.log(`[lesson-agent] run=${runId} retryDelayMs=${delay} nextAttemptAt=${nextAttemptAt.toISOString()}`);
      await markLessonRun(services.db, services.clock, run, "queued", failure.errorCode, nextAttemptAt);
    }
  }
}
