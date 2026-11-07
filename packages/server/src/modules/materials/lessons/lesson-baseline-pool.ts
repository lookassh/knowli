import { AppError } from "../../../errors";
import { agentObjectivesOf } from "../../../domain/lessons/agent/capable";
import { submitExamples, type AgentCheckContext, type ObjectiveAgentLimits } from "../../../domain/lessons/agent/admission";
import { createLessonAgentState, orderedEntries, poolOf, takeIds, withPool, type LessonAgentState } from "../../../domain/lessons/agent/state";
import { lessonInvariantCheck, objectiveStatus } from "../../../domain/lessons/agent/status";
import { avoidSentencesFor } from "../../../domain/lessons/avoid-sentences";
import { cardExposureSources } from "../../../domain/lessons/card-exposure-sources";
import { closedCheckContract, closedCheckItem, closedCheckVerdict } from "../../../domain/lessons/closed-check";
import { packetPlan, type PacketPlan, type StageCounts } from "../../../domain/lessons/packet-plan";
import { validateLessonExerciseIssues } from "../../../domain/lessons/pool-validation";
import type { SubjectRegistry } from "../../../domain/lessons/registry";
import { outsideStagePath, stageOf } from "../../../domain/lessons/stages";
import type { AgentObjective, LearningObjective, LessonExerciseDraft, LessonExerciseType, LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import type { ClosedExerciseChecker, LessonPacketGenerator, LessonPacketInput, RunCostSink } from "../../../ports/ai";
import { GenerationProviderError } from "../../../ports/generation-error";
import { deadlineSignal, Semaphore, untilAborted } from "./lesson-agent-timers";
import { buildPoolInput, listenChoiceAllowance, objectiveBatchCounts, poolStageCounts } from "./lesson-drafts";
import {
  emptyLessonPoolAgentStats,
  type LessonPoolAgentResult,
  type LessonPoolAgentRunInput,
  type SettledObjective,
} from "./lesson-pool-agent";
import {
  agentFailureOf,
  DEFAULT_LESSON_AGENT_POLICY,
  RUN_TIMEOUT_REASON,
  RunCostMeter,
  type AgentFailure,
  type LessonAgentPolicy,
} from "./lesson-pool-agent-policy";
import { parseLessonRecord, type RejectionLogEntry } from "./lesson-pool-agent-tools";

/**
 * Przebieg bazowy generowania puli lekcji (spec etapu 2 §3, spec zbiorczy §4): dla każdego
 * zagadnienia paczki cel × typ (jedno wywołanie generatora na paczkę), walidacja struktury, jedna
 * kontrola zadań zamkniętych na paczkę i — po wszystkich zagadnieniach — jedna walidacja puli w
 * kolejności lekcji. Odrzucone ćwiczenia odpadają; bez rund naprawy. Te same typy wejścia i wyniku
 * co `runLessonPoolAgent`. Niepodłączony do workera (etap 4). Bez bazy i identyfikatorów przedmiotów.
 */

export interface LessonBaselineDeps {
  readonly generator: LessonPacketGenerator;
  readonly checker: ClosedExerciseChecker;
  readonly subjects: Pick<SubjectRegistry, "getSubject">;
  /** Brak pól = `DEFAULT_LESSON_AGENT_POLICY`. */
  readonly policy?: Partial<LessonAgentPolicy>;
}

/** Najdłuższe czekanie przed ponowieniem po 429 (spec etapu 2 §3.2). */
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

/** Paczka przerwana budżetem albo terminem runu: zagadnienie kończy się bez porażki (`incomplete`). */
const STOPPED = Symbol("stopped");

type PacketOutcome =
  | { readonly kind: "done"; readonly drafts: readonly LessonExerciseDraft[]; readonly examples: unknown }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly error: unknown };

interface ObjectiveOutcome {
  readonly objective: AgentObjective;
  readonly plan: PacketPlan;
  readonly drafts: readonly LessonExerciseDraft[];
  readonly examples: unknown;
  readonly failure?: AgentFailure;
  readonly calls: number;
  readonly spentUsd: number;
}

function slugOf(objectiveId: string): string {
  return objectiveId.slice(objectiveId.lastIndexOf(".") + 1);
}

function resolveInput(deps: LessonBaselineDeps, input: LessonPoolAgentRunInput): { subject: SubjectModule; topic: LessonTopic } {
  const subject = deps.subjects.getSubject(input.subjectId);
  if (subject === undefined) throw new AppError("validation", { message: `unknown subject ${input.subjectId}` });
  // Etap 2: tylko pula tematu katalogowego od zera (rozdział, szkoła i „dodaj N” zostają na agencie).
  if (input.objectiveSource.source !== "catalog") throw new AppError("validation", { message: "baseline pool needs catalog objectives" });
  if (input.target !== undefined && input.target.mode !== "pool") throw new AppError("validation", { message: "baseline pool supports pool mode only" });
  if (input.fixed.length > 0) throw new AppError("validation", { message: "baseline pool starts without fixed exercises" });
  return { subject, topic: input.objectiveSource.topic };
}

/**
 * Wejście paczki: pola promptu z `buildPoolInput` na kopii celu z jednym typem (księga reguł tego
 * typu), bez sekcji `lesson` i `checks` księgi (opisują limity, ujawnienia i kontrole agenta).
 */
export function packetInput(args: {
  readonly subject: SubjectModule;
  readonly topic: LessonTopic;
  readonly objective: LearningObjective;
  readonly type: LessonExerciseType;
  readonly count: number;
  readonly withExamples: boolean;
  readonly material: string;
  readonly instruction?: string;
  readonly interests?: readonly string[];
  readonly graderAvailable: boolean;
  readonly avoidSentences: readonly string[];
  readonly timeoutMs: number;
}): LessonPacketInput {
  const single = { ...args.objective, exerciseTypes: [args.type] };
  const topic = { ...args.topic, objectives: args.topic.objectives.map((objective) => (objective.id === single.id ? single : objective)) };
  const pool = buildPoolInput(args.subject, topic, single.id, args.count, args.material, args.instruction, args.graderAvailable, args.interests, {
    avoidSentences: args.avoidSentences,
  });
  return {
    pool: { ...pool, exerciseTypes: [args.type], ruleBook: { ...pool.ruleBook, lesson: [], checks: [] } },
    objective: { id: single.id, title: single.titlePl, cards: single.cards.map((card) => ({ title: card.title, body: card.body })) },
    type: args.type,
    count: args.count,
    withExamples: args.withExamples,
    timeoutMs: args.timeoutMs,
  };
}

/** Jedno ponowienie błędu technicznego dostawcy (bez błędu konfiguracji); 429 po `retryAfterMs`, najwyżej 30 s. */
async function withRetry<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (signal.aborted || !(error instanceof GenerationProviderError) || error.kind === "configuration") throw error;
    if (error.kind === "rate_limit") {
      const wait = Math.min(error.retryAfterMs ?? 1_000, MAX_RATE_LIMIT_WAIT_MS);
      await untilAborted(new Promise((resolve) => setTimeout(resolve, wait)), signal);
    }
    return call();
  }
}

/** Limit przyjęcia zagadnienia per „kubełek”: etap oceniany, słuchanie albo notice (spec etapu 2 §3.1). */
function bucketOf(type: LessonExerciseType): "guided" | "productive" | "independent" | "listen" | "intro" {
  if (outsideStagePath(type)) return "listen";
  const stage = stageOf(type);
  return stage === "intro" ? "intro" : stage;
}

function capsOf(plan: PacketPlan): Record<ReturnType<typeof bucketOf>, number> {
  const notice = plan.packets.find((packet) => packet.type === "lesson_notice")?.count ?? 0;
  const listen = plan.packets.find((packet) => packet.type === "lesson_listen_choice")?.count ?? 0;
  return { ...plan.stageTargets, intro: notice, listen };
}

export async function runLessonBaselinePool(
  deps: LessonBaselineDeps,
  input: LessonPoolAgentRunInput,
  signal: AbortSignal,
): Promise<LessonPoolAgentResult> {
  const { subject, topic } = resolveInput(deps, input);
  signal.throwIfAborted();
  const policy: LessonAgentPolicy = { ...DEFAULT_LESSON_AGENT_POLICY, ...deps.policy };
  const cost = new RunCostMeter(input.initialSpentUsd, policy.runBudgetUsd, policy.unknownCallEstimateUsd, input.onSpend);
  const runDeadline = deadlineSignal(signal, policy.runTimeoutMs, RUN_TIMEOUT_REASON);
  const stats = emptyLessonPoolAgentStats();
  const rejections: RejectionLogEntry[] = [];
  const reject = (objectiveId: string, exerciseType: string, kind: RejectionLogEntry["kind"], code: string, ruleIds: readonly string[] = []) => {
    rejections.push({ objectiveId, exerciseType, kind, code, ruleIds, detail: "" });
    stats.rejectedByKind[kind] = (stats.rejectedByKind[kind] ?? 0) + 1;
  };
  try {
    await input.onObjectivesResolved?.({ planExamples: {}, spentUsd: cost.spentUsd });
    signal.throwIfAborted();
    const objectives = agentObjectivesOf(topic);
    const counts = objectiveBatchCounts(input.poolSize, topic.objectives.length, subject);
    const cardSentences = Object.values(cardExposureSources(subject, topic)).flat();
    const avoidSentences = avoidSentencesFor({ examples: {}, exercises: [], subject, cardSentences });
    const semaphore = new Semaphore(policy.concurrency);

    /** Wywołanie modelu z budżetem, terminem runu i jednym ponowieniem; koszt do licznika zagadnienia. */
    const callModel = async <T>(sink: RunCostSink, call: (sink: RunCostSink) => Promise<T>): Promise<T | typeof STOPPED> => {
      if (cost.exhausted() || runDeadline.signal.aborted) return STOPPED;
      try {
        return await withRetry(() => untilAborted(call(sink), runDeadline.signal), runDeadline.signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (runDeadline.signal.aborted) return STOPPED;
        throw error;
      }
    };

    const runPacket = async (
      catalogObjective: LearningObjective,
      packet: PacketPlan["packets"][number],
      withExamples: boolean,
      sink: RunCostSink,
    ): Promise<PacketOutcome> => {
      const request = packetInput({
        subject,
        topic,
        objective: catalogObjective,
        type: packet.type,
        count: packet.count,
        withExamples,
        material: input.material,
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...(input.interests === undefined ? {} : { interests: input.interests }),
        graderAvailable: input.graderAvailable,
        avoidSentences,
        timeoutMs: policy.callTimeoutMs,
      });
      try {
        const generated = await callModel(sink, (s) => deps.generator.generatePacket(request, s, runDeadline.signal));
        if (generated === STOPPED) return { kind: "stopped" };
        const objectiveId = catalogObjective.id;
        const valid: LessonExerciseDraft[] = [];
        for (const raw of generated.exercises) {
          stats.submitted += 1;
          const parsed = parseLessonRecord(raw, objectiveId, subject, input.familyScope);
          if (!parsed.ok) {
            reject(objectiveId, parsed.exerciseType, "shape", parsed.rejection.code, parsed.rejection.ruleIds);
            continue;
          }
          const draft = parsed.draft;
          if (draft.exerciseType !== packet.type) {
            reject(objectiveId, draft.exerciseType, "shape", "shape_type");
            continue;
          }
          const issues = validateLessonExerciseIssues(draft, subject, topic, { agent: true });
          if (issues.length > 0) {
            reject(objectiveId, draft.exerciseType, "rule", "rule_exercise", [...new Set(issues.map((issue) => issue.rule))]);
            continue;
          }
          if (valid.length >= packet.count) {
            reject(objectiveId, draft.exerciseType, "limit", "over_count");
            continue;
          }
          valid.push(draft);
        }
        const contract = closedCheckContract(packet.type);
        if (contract === null || valid.length === 0) return { kind: "done", drafts: valid, examples: generated.examples };
        const items = valid.map((draft) => closedCheckItem(draft, topic));
        const views = items.flatMap((item) => (item === null ? [] : [{ view: item.view }]));
        const checked = await callModel(sink, (s) =>
          deps.checker.checkClosed({ contract, items: views, timeoutMs: policy.checkerTimeoutMs }, s, runDeadline.signal),
        );
        if (checked === STOPPED) return { kind: "stopped" };
        stats.checkerCalls += 1;
        const passed: LessonExerciseDraft[] = [];
        let view = 0;
        valid.forEach((draft, index) => {
          const result = items[index] === null ? undefined : checked.results[view++];
          const verdict = items[index] === null ? ({ pass: false, code: "check_unknown" } as const) : closedCheckVerdict(draft, result, subject.normalizer);
          if (verdict.pass) passed.push(draft);
          else reject(objectiveId, draft.exerciseType, "blind", verdict.code);
        });
        return { kind: "done", drafts: passed, examples: generated.examples };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        return { kind: "failed", error };
      }
    };

    const runObjective = async (objective: AgentObjective, index: number): Promise<ObjectiveOutcome> => {
      const catalogObjective = topic.objectives.find((item) => item.id === objective.id)!;
      const split: StageCounts = poolStageCounts(subject, catalogObjective.exerciseTypes, counts[index]!);
      const plan = packetPlan(subject, catalogObjective, split, listenChoiceAllowance(subject, catalogObjective, []));
      let calls = 0;
      let spent = 0;
      const sink: RunCostSink = {
        record: (usd) => {
          const before = cost.spentUsd;
          calls += 1;
          cost.record(usd);
          spent += cost.spentUsd - before;
        },
      };
      const outcomes = await Promise.all(plan.packets.map((packet, packetIndex) => runPacket(catalogObjective, packet, packetIndex === 0, sink)));
      const failed = outcomes.find((outcome) => outcome.kind === "failed");
      if (failed !== undefined) {
        return { objective, plan, drafts: [], examples: undefined, failure: agentFailureOf(failed.error), calls, spentUsd: spent };
      }
      const done = outcomes.flatMap((outcome) => (outcome.kind === "done" ? [outcome] : []));
      return { objective, plan, drafts: done.flatMap((outcome) => outcome.drafts), examples: outcomes[0]?.kind === "done" ? outcomes[0].examples : undefined, calls, spentUsd: spent };
    };

    const outcomes = await Promise.all(objectives.map((objective, index) => semaphore.run(() => runObjective(objective, index))));
    signal.throwIfAborted();

    // Walidacja puli: przyjęcie po kolei w kolejności lekcji, z limitem etapu; kandydat łamiący walidację odpada.
    const limits = new Map<string, ObjectiveAgentLimits>(
      outcomes.map((outcome) => [outcome.objective.id, { targetCount: 0, listenAllowance: capsOf(outcome.plan).listen, maxExercises: Number.POSITIVE_INFINITY }]),
    );
    const ctx: AgentCheckContext = { subject, material: input.material, limits };
    let state: LessonAgentState = createLessonAgentState({ topic, objectives, fixed: [], examples: {}, fixedSources: cardExposureSources(subject, topic) });
    const overflow = new Map<string, number>();
    for (const outcome of outcomes) {
      const id = outcome.objective.id;
      const caps = capsOf(outcome.plan);
      const used: Record<keyof typeof caps, number> = { guided: 0, productive: 0, independent: 0, intro: 0, listen: 0 };
      for (const draft of outcome.drafts) {
        const bucket = bucketOf(draft.exerciseType);
        if (used[bucket] >= caps[bucket]) {
          overflow.set(id, (overflow.get(id) ?? 0) + 1);
          continue;
        }
        const taken = takeIds(state, 1);
        const next = withPool(taken.state, id, [...poolOf(taken.state, id), { id: taken.ids[0]!, draft }]);
        if (lessonInvariantCheck(next, ctx).length > 0) {
          reject(id, draft.exerciseType, "lesson", "lesson_pool");
          continue;
        }
        state = next;
        used[bucket] += 1;
        stats.accepted += 1;
      }
      if (outcome.failure === undefined) state = submitExamples(state, id, Array.isArray(outcome.examples) ? outcome.examples : [], ctx).state;
    }

    const settledList: SettledObjective[] = outcomes.map((outcome) => {
      const id = outcome.objective.id;
      const status = objectiveStatus(state, id, ctx);
      const exercises = orderedEntries(state).filter((entry) => entry.objectiveId === id).map((entry) => entry.draft);
      const base = {
        objectiveId: id,
        missing: status.missing,
        exercises,
        examples: [...(state.examples.get(id) ?? [])],
        steps: outcome.calls,
        spentUsd: cost.spentUsd,
        rejections: rejections.filter((entry) => entry.objectiveId === id),
      };
      const settled: SettledObjective =
        outcome.failure !== undefined
          ? { ...base, status: "failed", failure: outcome.failure }
          : { ...base, status: status.complete ? "complete" : "incomplete" };
      const codes = new Map<string, number>();
      for (const entry of base.rejections) codes.set(entry.code, (codes.get(entry.code) ?? 0) + 1);
      // Dziennik bez treści: liczby, kody i człon identyfikatora zagadnienia.
      console.log(
        `[lesson-baseline] run=${input.runId} obj=${slugOf(id)} status=${settled.status}${outcome.failure === undefined ? "" : ` error=${outcome.failure.errorCode}`} ` +
          `ordered=${outcome.plan.packets.reduce((sum, packet) => sum + packet.count, 0)} accepted=${exercises.length} overflow=${overflow.get(id) ?? 0} ` +
          `rejected=${codes.size === 0 ? "-" : [...codes].map(([code, count]) => `${code}:${count}`).join(",")} calls=${outcome.calls} costUsd=${outcome.spentUsd.toFixed(4)}`,
      );
      return settled;
    });
    for (const settled of settledList) {
      await input.onObjectiveSettled?.(settled);
      signal.throwIfAborted();
    }
    return { planStatus: "not_needed", objectives: settledList, stats, rejections, spentUsd: cost.spentUsd, unknownCostCalls: cost.unknownCalls };
  } finally {
    runDeadline.dispose();
  }
}
