import { AppError } from "../../../errors";
import { agentObjectivesOf } from "../../../domain/lessons/agent/capable";
import { lessonRulesStep, snapshotOf, submitExamples } from "../../../domain/lessons/agent/admission";
import { orderedEntries, type LessonAgentState } from "../../../domain/lessons/agent/state";
import { objectiveStatusFor } from "../../../domain/lessons/agent/status";
import { closedCheckContract, closedCheckItems, closedCheckVerdict } from "../../../domain/lessons/closed-check";
import { bucketOf, packetPlan, packetPlanForTargets, type PacketBucket, type PacketPlan } from "../../../domain/lessons/packet-plan";
import { validateLessonExerciseIssues } from "../../../domain/lessons/pool-validation";
import type { SubjectRegistry } from "../../../domain/lessons/registry";
import type { AgentObjective, LearningObjective, LessonExerciseDraft, LessonExerciseType, LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import type { ClosedExerciseChecker, LessonPacketGenerator, LessonPacketInput, RunCostSink } from "../../../ports/ai";
import { GenerationProviderError, type GenerationProviderErrorKind } from "../../../ports/generation-error";
import { deadlineSignal, Semaphore, untilAborted } from "./lesson-agent-timers";
import { buildPoolInput, listenChoiceAllowance, objectiveBatchCounts, poolStageCounts } from "./lesson-drafts";
import { lessonAvoidSentences } from "./lesson-pool-agent-input";
import {
  emptyLessonPoolAgentStats,
  objectivesToRun,
  poolStartState,
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
 * co `runLessonPoolAgent`, także wznowienie (`fixed`, `skipObjectives`) i „dodaj N” (etap 4). Worker
 * woła go dla przedmiotu z `baselinePool`. Bez bazy i identyfikatorów przedmiotów.
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
  const source = input.objectiveSource;
  if (source.source === "input" && subject.buildDynamicTopic === undefined) {
    throw new AppError("validation", { message: `subject ${subject.id} has no dynamic topics` });
  }
  // Temat z katalogu albo dynamiczny (etap zagadnień lub punkt kontrolny), złożony jak u agenta.
  const topic = source.source === "catalog" ? source.topic : subject.buildDynamicTopic!(source.dynamicTopic);
  const target = input.target;
  if (target?.mode === "add" && !topic.objectives.some((objective) => objective.id === target.objectiveId)) {
    // Przed wywołaniami: nieznane zagadnienie nie zapisuje nic i nie woła dostawcy.
    throw new AppError("validation", { message: `unknown objective ${target.objectiveId}` });
  }
  return { subject, topic };
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
    const dynamicTopic = input.objectiveSource.source === "input" ? input.objectiveSource.dynamicTopic : undefined;
    await input.onObjectivesResolved?.({ ...(dynamicTopic === undefined ? {} : { dynamicTopic }), spentUsd: cost.spentUsd });
    signal.throwIfAborted();
    const objectives = agentObjectivesOf(topic);
    const counts = objectiveBatchCounts(input.poolSize, topic.objectives.length, subject);
    // Stan startowy jak u agenta: `fixed` (szkic albo zagadnienia z punktu kontrolnego), przykłady, źródła ujawnień,
    // limity zapisu (`lessonAgentLimits`; `maxExercises` nie działa — przyjmowanie nie woła kroku limitów).
    const start = poolStartState({ subject, topic, objectives, input });
    const { ctx, addMode, promptTargets } = start;
    const avoidSentences = lessonAvoidSentences(subject, topic, start.state);
    const examplesFixed = input.examplesFixed ?? false;
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
          // Oczyszczenie przedmiotu (np. stałe polecenie tłumaczenia) przed walidacją, jak przy przyjmowaniu agenta.
          const draft = subject.agentPolicy.sanitize?.(parsed.draft, { material: input.material }).draft ?? parsed.draft;
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
        // Ćwiczenie bez widoku (słuchanie bez zdania nagrania) odpada przed kontrolą; ćwiczenie z przypisaniem
        // to jedna pozycja na pole, a jego werdykt bierze swój wycinek wyników.
        const checkable = valid.flatMap((draft) => {
          const views = closedCheckItems(draft, topic);
          if (views === null) reject(objectiveId, draft.exerciseType, "blind", "check_unknown");
          return views === null ? [] : [{ draft, views }];
        });
        if (checkable.length === 0) return { kind: "done", drafts: [], examples: generated.examples };
        const items = checkable.flatMap(({ views }) => views.map((view) => ({ view })));
        const checked = await callModel(checkerSlots, () =>
          deps.checker.checkClosed({ contract, items, timeoutMs: policy.checkerTimeoutMs }, sink, runDeadline.signal),
        );
        if (checked === STOPPED) return { kind: "stopped" };
        stats.checkerCalls += 1;
        const passed: LessonExerciseDraft[] = [];
        let offset = 0;
        for (const { draft, views } of checkable) {
          const verdict = closedCheckVerdict(draft, checked.results.slice(offset, offset + views.length), subject.normalizer);
          offset += views.length;
          if (verdict.pass) passed.push(draft);
          else reject(objectiveId, draft.exerciseType, "blind", verdict.code);
        }
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

    const runObjective = async (objective: AgentObjective): Promise<ObjectiveOutcome> => {
      const position = topic.objectives.findIndex((item) => item.id === objective.id);
      const catalogObjective = topic.objectives[position]!;
      // „Dodaj N”: liczby z braków etapów + N, bez podnoszenia do minimum i bez notice; pula: cele etapów z `packetPlan`.
      const plan =
        promptTargets !== undefined
          ? packetPlanForTargets(catalogObjective, promptTargets.stages, false, promptTargets.listenAllowance)
          : packetPlan(subject, catalogObjective, poolStageCounts(subject, catalogObjective.exerciseTypes, counts[position]!), listenChoiceAllowance(subject, catalogObjective, []));
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
      const outcomes = await allSettledOrThrow(plan.packets.map((packet, packetIndex) => runPacket(catalogObjective, packet, !examplesFixed && packetIndex === 0, sink)));
      const failed = outcomes.find((outcome) => outcome.kind === "failed");
      if (failed !== undefined) {
        return { objective, plan, packets: [], examples: undefined, failure: agentFailureOf(failed.error), calls, spentUsd: spent };
      }
      const packets = outcomes.map((outcome) => (outcome.kind === "done" ? outcome.drafts : []));
      return { objective, plan, packets, examples: outcomes[0]?.kind === "done" ? outcomes[0].examples : undefined, calls, spentUsd: spent };
    };

    const outcomes = await allSettledOrThrow(objectivesToRun(objectives, input).map((objective) => runObjective(objective)));
    signal.throwIfAborted();

    // Walidacja puli: przyjęcie po kolei w kolejności lekcji, z limitem kubełka, krokami 3–4 przyjmowania agenta
    // (kandydat odpada także, gdy czyni nową ofiarą inne ćwiczenie, również `fixed`).
    // Najpierw udział każdej paczki, potem zapasy w tej samej kolejności — zapas pierwszego typu nie wypycha drugiego.
    let state: LessonAgentState = start.state;
    let before = snapshotOf(state, ctx);
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
        const step = lessonRulesStep(state, id, draft, before, ctx);
        if (!step.ok) {
          reject(id, draft.exerciseType, step.rejection.kind, step.rejection.code, step.rejection.ruleIds);
          continue;
        }
        state = step.state;
        before = step.snapshot;
        used[bucket] += 1;
        stats.accepted += 1;
      }
    }
    // Przykłady kart po ćwiczeniach wszystkich zagadnień: linia ujawniająca odpowiedź odpada, ćwiczenie zostaje.
    for (const outcome of outcomes) {
      if (!examplesFixed && outcome.failure === undefined) state = submitExamples(state, outcome.objective.id, Array.isArray(outcome.examples) ? outcome.examples : [], ctx).state;
    }

    const settledList: SettledObjective[] = outcomes.map((outcome) => {
      const id = outcome.objective.id;
      const status = objectiveStatusFor(state, id, ctx, addMode);
      // Tylko ćwiczenia tej próby (bez `fixed`), jak `poolExercises` agenta.
      const exercises = orderedEntries(state).filter((entry) => entry.objectiveId === id && entry.id !== null).map((entry) => entry.draft);
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
      const rules = new Map<string, number>();
      for (const entry of base.rejections) {
        codes.set(entry.code, (codes.get(entry.code) ?? 0) + 1);
        for (const rule of entry.ruleIds) rules.set(`${entry.exerciseType}/${rule}`, (rules.get(`${entry.exerciseType}/${rule}`) ?? 0) + 1);
      }
      const counted = (counts: Map<string, number>) => (counts.size === 0 ? "-" : [...counts].map(([key, count]) => `${key}:${count}`).join(","));
      // Dziennik bez treści: liczby, kody, typ z identyfikatorem reguły i człon identyfikatora zagadnienia.
      console.log(
        `[lesson-baseline] run=${input.runId} obj=${slugOf(id)} status=${settled.status}${outcome.failure === undefined ? "" : ` error=${outcome.failure.errorCode}`} ` +
          `ordered=${outcome.plan.packets.reduce((sum, packet) => sum + packet.count, 0)} accepted=${exercises.length} overflow=${overflow.get(id) ?? 0} ` +
          `rejected=${counted(codes)} rules=${counted(rules)} calls=${outcome.calls} costUsd=${outcome.spentUsd.toFixed(4)}`,
      );
      return settled;
    });
    for (const settled of settledList) {
      await input.onObjectiveSettled?.(settled);
      signal.throwIfAborted();
    }
    return { objectives: settledList, stats, rejections, spentUsd: cost.spentUsd, unknownCostCalls: cost.unknownCalls };
  } finally {
    runDeadline.dispose();
  }
}
