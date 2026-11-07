import { AppError } from "../../../errors";
import { agentObjectivesOf } from "../../../domain/lessons/agent/capable";
import { submitExamples, type AgentCheckContext, type ObjectiveAgentLimits } from "../../../domain/lessons/agent/admission";
import { createLessonAgentState, orderedEntries, poolOf, takeIds, withPool, type LessonAgentState } from "../../../domain/lessons/agent/state";
import { lessonInvariantCheck, objectiveStatus } from "../../../domain/lessons/agent/status";
import { avoidSentencesFor } from "../../../domain/lessons/avoid-sentences";
import { cardExposureSources } from "../../../domain/lessons/card-exposure-sources";
import { closedCheckContract, closedCheckItem, closedCheckVerdict } from "../../../domain/lessons/closed-check";
import { bucketOf, packetPlan, type PacketBucket, type PacketPlan, type StageCounts } from "../../../domain/lessons/packet-plan";
import { validateLessonExerciseIssues } from "../../../domain/lessons/pool-validation";
import type { SubjectRegistry } from "../../../domain/lessons/registry";
import type { AgentObjective, LearningObjective, LessonExerciseDraft, LessonExerciseType, LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import type { ClosedExerciseChecker, LessonPacketGenerator, LessonPacketInput, RunCostSink } from "../../../ports/ai";
import { GenerationProviderError, type GenerationProviderErrorKind } from "../../../ports/generation-error";
import { deadlineSignal, Semaphore, untilAborted } from "./lesson-agent-timers";
import { buildPoolInput, listenChoiceAllowance, objectiveBatchCounts, poolStageCounts } from "./lesson-drafts";
import {
  emptyLessonPoolAgentStats,
  slugOf,
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
  /** Ćwiczenia po kontrolach, per paczka planu (ten sam indeks). */
  readonly packets: readonly (readonly LessonExerciseDraft[])[];
  readonly examples: unknown;
  readonly failure?: AgentFailure;
  readonly calls: number;
  readonly spentUsd: number;
}

function resolveInput(deps: LessonBaselineDeps, input: LessonPoolAgentRunInput): { subject: SubjectModule; topic: LessonTopic } {
  const subject = deps.subjects.getSubject(input.subjectId);
  if (subject === undefined) throw new AppError("validation", { message: `unknown subject ${input.subjectId}` });
  // Etap 2: tylko pula tematu katalogowego od zera (rozdział, szkoła i „dodaj N” zostają na agencie).
  if (input.objectiveSource.source !== "catalog") throw new AppError("validation", { message: "baseline pool needs catalog objectives" });
  if (input.target !== undefined && input.target.mode !== "pool") throw new AppError("validation", { message: "baseline pool supports pool mode only" });
  if (input.fixed.length > 0) throw new AppError("validation", { message: "baseline pool starts without fixed exercises" });
  // Wznowienia i przykłady z zewnątrz obsłuży dopiero etap 4 — odrzucenie zamiast cichego pominięcia.
  const resumed =
    input.skipObjectives.length > 0 ||
    Object.keys(input.draftExamples).length > 0 ||
    Object.keys(input.initialExamples ?? {}).length > 0 ||
    input.examplesFixed !== undefined ||
    (input.extraExposureSources?.length ?? 0) > 0;
  if (resumed) throw new AppError("validation", { message: "baseline pool does not support resume inputs yet" });
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

/** Błędy techniczne z jednym ponowieniem (spec etapu 2 §3.2); błąd konfiguracji i pozostałe — bez ponowienia. */
const RETRIED: ReadonlySet<GenerationProviderErrorKind> = new Set(["rate_limit", "transient", "timeout", "output"]);

/** Czekanie przerywane sygnałem (zegar zdejmowany także przy przerwaniu). */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Jedno ponowienie błędu technicznego; 429 po `retryAfterMs` (najwyżej 30 s); bez ponowienia po wyczerpaniu budżetu (także w trakcie czekania). */
async function withRetry<T>(call: () => Promise<T>, signal: AbortSignal, exhausted: () => boolean): Promise<T | typeof STOPPED> {
  try {
    return await call();
  } catch (error) {
    if (signal.aborted || !(error instanceof GenerationProviderError) || !RETRIED.has(error.kind) || exhausted()) throw error;
    if (error.kind === "rate_limit") await pause(Math.min(error.retryAfterMs ?? 1_000, MAX_RATE_LIMIT_WAIT_MS), signal);
    if (exhausted()) return STOPPED;
    return call();
  }
}

/** Jak `Promise.all`, ale odrzuca dopiero po zakończeniu wszystkich zadań — żadne wywołanie nie zostaje w tle. */
async function allSettledOrThrow<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed !== undefined) throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
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
  // Błąd kodu w jednej paczce zatrzymuje pozostałe (bez nowych płatnych wywołań), zanim run zgłosi błąd.
  const crash = new AbortController();
  const runDeadline = deadlineSignal(AbortSignal.any([signal, crash.signal]), policy.runTimeoutMs, RUN_TIMEOUT_REASON);
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
    // Równoległość żądań: generowanie jak zagadnienia agenta, kontrola jak checker agenta; budżet sprawdzany po zajęciu miejsca.
    const generatorSlots = new Semaphore(policy.concurrency);
    const checkerSlots = new Semaphore(policy.checkerConcurrency);

    /** Wywołanie modelu z miejscem w semaforze, budżetem, terminem runu i jednym ponowieniem. */
    const callModel = <T>(slots: Semaphore, call: () => Promise<T>): Promise<T | typeof STOPPED> =>
      slots.run(async () => {
        if (cost.exhausted() || runDeadline.signal.aborted) return STOPPED;
        try {
          return await withRetry(() => untilAborted(call(), runDeadline.signal), runDeadline.signal, () => cost.exhausted());
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (runDeadline.signal.aborted) return STOPPED;
          // Przed zwolnieniem miejsca w semaforze — czekające wywołanie widzi już przerwanie.
          if (!(error instanceof GenerationProviderError)) crash.abort(error);
          throw error;
        }
      });

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
        const generated = await callModel(generatorSlots, () => deps.generator.generatePacket(request, sink, runDeadline.signal));
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
        if (contract === null) return { kind: "done", drafts: valid, examples: generated.examples };
        // Ćwiczenie bez widoku (słuchanie bez zdania nagrania) odpada przed kontrolą: wyniki odpowiadają pozycjom 1:1.
        const checkable = valid.flatMap((draft) => {
          const view = closedCheckItem(draft, topic);
          if (view === null) reject(objectiveId, draft.exerciseType, "blind", "check_unknown");
          return view === null ? [] : [{ draft, view }];
        });
        if (checkable.length === 0) return { kind: "done", drafts: [], examples: generated.examples };
        const checked = await callModel(checkerSlots, () =>
          deps.checker.checkClosed({ contract, items: checkable.map(({ view }) => ({ view })), timeoutMs: policy.checkerTimeoutMs }, sink, runDeadline.signal),
        );
        if (checked === STOPPED) return { kind: "stopped" };
        stats.checkerCalls += 1;
        const passed: LessonExerciseDraft[] = [];
        checkable.forEach(({ draft }, index) => {
          const verdict = closedCheckVerdict(draft, checked.results[index], subject.normalizer);
          if (verdict.pass) passed.push(draft);
          else reject(objectiveId, draft.exerciseType, "blind", verdict.code);
        });
        return { kind: "done", drafts: passed, examples: generated.examples };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        // Tylko błąd usługi oznacza cel jako nieudany; błąd kodu przerywa run (jak u agenta).
        if (!(error instanceof GenerationProviderError)) {
          crash.abort(error);
          throw error;
        }
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
      const outcomes = await allSettledOrThrow(plan.packets.map((packet, packetIndex) => runPacket(catalogObjective, packet, packetIndex === 0, sink)));
      const failed = outcomes.find((outcome) => outcome.kind === "failed");
      if (failed !== undefined) {
        return { objective, plan, packets: [], examples: undefined, failure: agentFailureOf(failed.error), calls, spentUsd: spent };
      }
      const packets = outcomes.map((outcome) => (outcome.kind === "done" ? outcome.drafts : []));
      return { objective, plan, packets, examples: outcomes[0]?.kind === "done" ? outcomes[0].examples : undefined, calls, spentUsd: spent };
    };

    const outcomes = await allSettledOrThrow(objectives.map((objective, index) => runObjective(objective, index)));
    signal.throwIfAborted();

    // Walidacja puli: przyjęcie po kolei w kolejności lekcji, z limitem kubełka; kandydat łamiący walidację odpada.
    // Najpierw udział każdej paczki, potem zapasy w tej samej kolejności — zapas pierwszego typu nie wypycha drugiego.
    const limits = new Map<string, ObjectiveAgentLimits>(
      outcomes.map((outcome) => [outcome.objective.id, { targetCount: 0, listenAllowance: outcome.plan.caps.listen, maxExercises: Number.POSITIVE_INFINITY }]),
    );
    const ctx: AgentCheckContext = { subject, material: input.material, limits };
    let state: LessonAgentState = createLessonAgentState({ topic, objectives, fixed: [], examples: {}, fixedSources: cardExposureSources(subject, topic) });
    const overflow = new Map<string, number>();
    for (const outcome of outcomes) {
      const id = outcome.objective.id;
      const caps = outcome.plan.caps;
      const used: Record<PacketBucket, number> = { guided: 0, productive: 0, independent: 0, intro: 0, listen: 0 };
      const shares = outcome.packets.map((drafts, index) => drafts.slice(0, outcome.plan.packets[index]!.share));
      const reserves = outcome.packets.map((drafts, index) => drafts.slice(outcome.plan.packets[index]!.share));
      for (const draft of [...shares.flat(), ...reserves.flat()]) {
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
    }
    // Przykłady kart po ćwiczeniach wszystkich zagadnień: linia ujawniająca odpowiedź odpada, ćwiczenie zostaje.
    for (const outcome of outcomes) {
      if (outcome.failure === undefined) state = submitExamples(state, outcome.objective.id, Array.isArray(outcome.examples) ? outcome.examples : [], ctx).state;
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
