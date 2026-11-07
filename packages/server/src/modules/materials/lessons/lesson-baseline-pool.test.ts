import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../errors";
import { createLessonAgentState, withPool } from "../../../domain/lessons/agent/state";
import { agentObjectivesOf } from "../../../domain/lessons/agent/capable";
import { lessonInvariantCheck } from "../../../domain/lessons/agent/status";
import { englishGrammarSubject } from "../../../domain/lessons/subjects/english-grammar/module";
import type { LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import type { ClosedCheckInput, ClosedExerciseChecker, LessonPacketGenerator, LessonPacketInput, RunCostSink } from "../../../ports/ai";
import { GenerationProviderError } from "../../../ports/generation-error";
import { runLessonBaselinePool } from "./lesson-baseline-pool";
import type { LessonPoolAgentRunInput } from "./lesson-pool-agent";

/**
 * Przebieg bazowy (spec etapu 2 §3) na fake'ach portów: bez sieci, bez bazy. Przedmiot gramatyki
 * bez walidatora przedmiotu (stan po etapie 4), temat z dwoma zagadnieniami o typach choice / gap /
 * open_answer — żeby liczby i rekordy testu były krótkie.
 */

const subject: SubjectModule = { ...englishGrammarSubject, validateExercise: () => [] };
const base = englishGrammarSubject.topics.find((topic) => topic.id === "present_simple")!;
const TYPES = ["lesson_card", "lesson_choice", "lesson_gap", "lesson_open_answer"] as const;
const topic: LessonTopic = {
  ...base,
  objectives: base.objectives.slice(0, 2).map((objective) => ({ ...objective, exerciseTypes: [...TYPES] })),
};
const [first, second] = topic.objectives.map((objective) => objective.id) as [string, string];
const NAMES = ["Tom", "Ola", "Ben", "Kasia", "Max", "Zoe", "Leo", "Mia", "Sam", "Ewa", "Jan", "Ada", "Kuba", "Lena", "Olek", "Iga"];

/** Rekord surowy jak z modelu; `n` daje różne zdania (różne imię i dopełnienie). */
function raw(type: string, objectiveId: string, n: number): Record<string, unknown> {
  const name = `${NAMES[n % NAMES.length]}${n >= NAMES.length ? n : ""}`;
  const common = { objectiveId, acceptedAnswers: [], focus: [] };
  if (type === "lesson_choice") {
    return { ...common, exerciseType: type, instructionPl: "Wybierz formę.", stem: `${name} ___ football.`, answer: "plays",
      options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }], correctOption: "a" };
  }
  if (type === "lesson_gap") return { ...common, exerciseType: type, instructionPl: "Uzupełnij.", stem: `${name} ___ a book.`, answer: "reads", hint: "read", focus: ["reads"] };
  return { ...common, exerciseType: "lesson_open_answer", instructionPl: "Przetłumacz.", prompt: `${name} pływa w jeziorze.`, answer: `${name} swims in the lake.`, focus: ["swims"] };
}

class FakeGenerator implements LessonPacketGenerator {
  readonly calls: LessonPacketInput[] = [];
  /** Opóźnienie per typ (ms) — do sprawdzenia, że kolejność zakończenia nie zmienia wyniku. */
  constructor(private readonly options: { delay?: (input: LessonPacketInput) => number; fail?: (input: LessonPacketInput, attempt: number) => Error | undefined; extra?: number; examples?: readonly unknown[] } = {}) {}
  private attempts = new Map<string, number>();
  async generatePacket(input: LessonPacketInput, cost: RunCostSink, _signal?: AbortSignal): Promise<{ exercises: unknown[]; examples?: unknown[] }> {
    this.calls.push(input);
    const key = `${input.objective.id}:${input.type}`;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    const delay = this.options.delay?.(input) ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    cost.record(0.001);
    const error = this.options.fail?.(input, attempt);
    if (error !== undefined) throw error;
    const offset = input.objective.id === first ? 0 : 100;
    const typeOffset = { lesson_choice: 0, lesson_gap: 30, lesson_open_answer: 60 }[input.type] ?? 90;
    const exercises: unknown[] = Array.from({ length: input.count + (this.options.extra ?? 0) }, (_, i) => raw(input.type, input.objective.id, offset + typeOffset + i));
    return { exercises, ...(input.withExamples ? { examples: [...(this.options.examples ?? ["I play football."])] } : {}) };
  }
}

class FakeChecker implements ClosedExerciseChecker {
  readonly calls: ClosedCheckInput[] = [];
  constructor(private readonly answer: (view: string, index: number) => unknown = () => ({ answers: ["plays"] })) {}
  async checkClosed(input: ClosedCheckInput, cost: RunCostSink): Promise<{ results: unknown[] }> {
    this.calls.push(input);
    cost.record(0.0005);
    return { results: input.items.map((item, index) => this.answer(item.view, index)) };
  }
}

function runInput(overrides: Partial<LessonPoolAgentRunInput> = {}): LessonPoolAgentRunInput {
  return {
    runId: "run-1",
    subjectId: subject.id,
    deckId: "deck-1",
    objectiveSource: { source: "catalog", topic },
    topicTitle: "Present Simple",
    material: "Tom plays football.",
    poolSize: 20,
    graderAvailable: true,
    fixed: [],
    draftExamples: {},
    skipObjectives: [],
    familyScope: null,
    initialSpentUsd: 0,
    ...overrides,
  };
}

const deps = (generator: LessonPacketGenerator, checker: ClosedExerciseChecker = new FakeChecker(), policy = {}) => ({
  generator,
  checker,
  subjects: { getSubject: (id: string) => (id === subject.id ? subject : undefined) },
  policy,
});

const run = (generator: LessonPacketGenerator, checker?: ClosedExerciseChecker, input?: Partial<LessonPoolAgentRunInput>, policy = {}) =>
  runLessonBaselinePool(deps(generator, checker, policy), runInput(input), new AbortController().signal);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runLessonBaselinePool", () => {
  it("builds both objectives from packets in lesson order and marks them complete", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const generator = new FakeGenerator();
    const result = await run(generator);
    expect(result.planStatus).toBe("not_needed");
    expect(result.objectives.map((objective) => [objective.objectiveId, objective.status])).toEqual([[first, "complete"], [second, "complete"]]);
    // Cele etapów 4 / 4 / 3: pula 20 na 2 cele = 10 na cel, podział agenta 4 / 4 / 2, independent podniesiony do minimum z rezerwą.
    const types = result.objectives[0]!.exercises.map((draft) => draft.exerciseType);
    expect(types).toEqual([...Array(4).fill("lesson_choice"), ...Array(4).fill("lesson_gap"), ...Array(3).fill("lesson_open_answer")]);
    expect(result.objectives[0]!.examples).toEqual(["I play football."]);
    expect(generator.calls.map((call) => [call.type, call.count, call.withExamples])).toEqual([
      ["lesson_choice", 6, true], ["lesson_gap", 6, false], ["lesson_open_answer", 5, false],
      ["lesson_choice", 6, true], ["lesson_gap", 6, false], ["lesson_open_answer", 5, false],
    ]);
    expect(result.stats.accepted).toBe(22);
  });

  it("sends one closed check per closed packet only, with card sentences in the avoid list", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const checker = new FakeChecker();
    const generator = new FakeGenerator();
    await run(generator, checker);
    expect(checker.calls).toHaveLength(2);
    expect(checker.calls[0]!.contract).toBe("choice");
    expect(checker.calls[0]!.items).toHaveLength(6);
    expect(generator.calls[0]!.pool.ruleBook.lesson).toEqual([]);
    expect(generator.calls[0]!.pool.ruleBook.checks).toEqual([]);
    expect(generator.calls[0]!.pool.exerciseTypes).toEqual(["lesson_choice"]);
  });

  it("drops records of another type, over the order and rejected by the check", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => logs.push(line));
    const checker = new FakeChecker((_view, index) => (index === 0 ? { answers: ["plays", "play"] } : { answers: ["plays"] }));
    const result = await run(new FakeGenerator({ extra: 1 }), checker);
    const codes = result.rejections.map((entry) => entry.code);
    expect(codes.filter((code) => code === "over_count")).toHaveLength(6);
    expect(codes.filter((code) => code === "check_wrong_set")).toHaveLength(2);
    expect(result.objectives.every((objective) => objective.status === "complete")).toBe(true);
    // Dziennik bez treści ćwiczeń.
    expect(logs.join("\n")).not.toMatch(/football|book|lake/u);
    expect(logs.some((line) => line.startsWith("[lesson-baseline] run=run-1 obj="))).toBe(true);
  });

  it("gives the same result whatever order the packets finish in", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const forward = await run(new FakeGenerator({ delay: (input) => (input.type === "lesson_choice" ? 1 : 15) }));
    const backward = await run(new FakeGenerator({ delay: (input) => (input.type === "lesson_choice" ? 15 : 1) }));
    expect(backward.objectives.map((objective) => objective.exercises)).toEqual(forward.objectives.map((objective) => objective.exercises));
  });

  it("drops a later duplicate stimulus and a card example that reveals an open answer", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Pierwsza odpowiedź otwarta pierwszego zagadnienia to zdanie o „Kuba60” (n = 60).
    const leaky = await run(new FakeGenerator({ examples: ["Kuba60 swims in the lake.", "I play football."] }));
    expect(leaky.objectives[0]!.examples).toEqual(["I play football."]);
    expect(leaky.objectives[0]!.exercises.filter((draft) => draft.exerciseType === "lesson_open_answer")).toHaveLength(3);
    // Dwa ćwiczenia o tym samym bodźcu w paczce: późniejsze odpada.
    const inner = new FakeGenerator();
    const twin: LessonPacketGenerator = {
      generatePacket: async (input, cost, signal) => {
        const out = await inner.generatePacket(input, cost, signal);
        if (input.objective.id !== first || input.type !== "lesson_gap") return out;
        return { ...out, exercises: [out.exercises[0], ...out.exercises.slice(0, -1)] };
      },
    };
    const twinned = await run(twin);
    expect(twinned.rejections.filter((entry) => entry.code === "lesson_pool")).toEqual([expect.objectContaining({ objectiveId: first, exerciseType: "lesson_gap" })]);
  });

  it("keeps only the stage target and never lets overflow remove other exercises", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await run(new FakeGenerator());
    const counts = result.objectives[0]!.exercises.reduce<Record<string, number>>((acc, draft) => ({ ...acc, [draft.exerciseType]: (acc[draft.exerciseType] ?? 0) + 1 }), {});
    expect(counts).toEqual({ lesson_choice: 4, lesson_gap: 4, lesson_open_answer: 3 });
    expect(result.rejections.some((entry) => entry.code === "lesson_pool")).toBe(false);
  });

  it("retries technical errors once and fails the objective after the second error", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const kind of ["transient", "timeout", "output"] as const) {
      const once = await run(new FakeGenerator({ fail: (input, attempt) => (input.type === "lesson_gap" && attempt === 1 ? new GenerationProviderError(kind) : undefined) }));
      expect(once.objectives.map((objective) => objective.status)).toEqual(["complete", "complete"]);
    }
    const twice = await run(new FakeGenerator({ fail: (input) => (input.objective.id === first && input.type === "lesson_gap" ? new GenerationProviderError("transient") : undefined) }));
    expect(twice.objectives[0]).toMatchObject({ status: "failed", exercises: [] });
    expect(twice.objectives[0]!.failure?.errorCode).toBeDefined();
    expect(twice.objectives[1]!.status).toBe("complete");
    const config = new FakeGenerator({ fail: (input) => (input.type === "lesson_gap" ? new GenerationProviderError("configuration") : undefined) });
    const configured = await run(config);
    expect(configured.objectives.every((objective) => objective.status === "failed")).toBe(true);
    expect(config.calls.filter((call) => call.type === "lesson_gap")).toHaveLength(2);
  });

  it("waits retryAfterMs (capped) before retrying a rate limit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const generator = new FakeGenerator({ fail: (input, attempt) => (input.type === "lesson_gap" && attempt === 1 ? new GenerationProviderError("rate_limit", { retryAfterMs: 5_000 }) : undefined) });
    const pending = run(generator);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(generator.calls.filter((call) => call.type === "lesson_gap")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await pending;
    expect(generator.calls.filter((call) => call.type === "lesson_gap")).toHaveLength(4);
    expect(result.objectives.map((objective) => objective.status)).toEqual(["complete", "complete"]);
  });

  it("stops starting calls when the budget is spent and leaves the objective incomplete", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const generator = new FakeGenerator();
    const result = await run(generator, new FakeChecker(), {}, { runBudgetUsd: 0.0025, concurrency: 1 });
    expect(result.objectives[1]!.status).toBe("incomplete");
    expect(result.objectives[1]!.exercises).toEqual([]);
  });

  it("rethrows a cancellation during the check and keeps nothing unchecked", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const controller = new AbortController();
    const checker: ClosedExerciseChecker = {
      checkClosed: () => {
        controller.abort(new Error("cancelled"));
        return new Promise(() => undefined);
      },
    };
    await expect(runLessonBaselinePool(deps(new FakeGenerator(), checker), runInput(), controller.signal)).rejects.toThrow("cancelled");
  });

  it("drops a whole closed packet when the check returns a result of another length", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const checker: ClosedExerciseChecker = { checkClosed: async (input) => ({ results: input.items.map(() => undefined) }) };
    const result = await run(new FakeGenerator(), checker);
    expect(result.rejections.filter((entry) => entry.code === "check_unknown")).toHaveLength(12);
    expect(result.objectives.every((objective) => !objective.exercises.some((draft) => draft.exerciseType === "lesson_choice"))).toBe(true);
  });

  it("rejects inputs the baseline does not support", async () => {
    const generator = new FakeGenerator();
    await expect(run(generator, undefined, { objectiveSource: { source: "planner" } })).rejects.toBeInstanceOf(AppError);
    await expect(run(generator, undefined, { target: { mode: "add", objectiveId: first, count: 2 } })).rejects.toBeInstanceOf(AppError);
    const fixed = { exerciseType: "lesson_gap" as const, objectiveId: first, stem: "x ___", answer: "y", acceptedAnswers: [], focus: [] };
    await expect(run(generator, undefined, { fixed: [fixed] })).rejects.toBeInstanceOf(AppError);
    expect(generator.calls).toHaveLength(0);
  });

  it("calls the hooks and returns a lesson that passes the pool invariant", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resolved = vi.fn(async () => undefined);
    const settled: string[] = [];
    const result = await run(new FakeGenerator(), undefined, { onObjectivesResolved: resolved, onObjectiveSettled: async (item) => void settled.push(item.objectiveId) });
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([first, second]);
    let state = createLessonAgentState({ topic, objectives: agentObjectivesOf(topic), fixed: [], examples: {}, fixedSources: {} });
    let n = 1;
    for (const objective of result.objectives) state = withPool(state, objective.objectiveId, objective.exercises.map((draft) => ({ id: `ex${n++}`, draft })));
    const limits = new Map(result.objectives.map((objective) => [objective.objectiveId, { targetCount: 0, listenAllowance: 0, maxExercises: 99 }]));
    expect(lessonInvariantCheck(state, { subject, material: "", limits })).toEqual([]);
  });
});
