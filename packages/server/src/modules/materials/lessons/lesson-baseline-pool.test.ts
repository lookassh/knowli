import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../errors";
import { createLessonAgentState, withPool } from "../../../domain/lessons/agent/state";
import { agentObjectivesOf } from "../../../domain/lessons/agent/capable";
import { lessonInvariantCheck } from "../../../domain/lessons/agent/status";
import type { LessonExerciseDraft } from "../../../domain/lessons/types";
import { englishGrammarSubject } from "../../../domain/lessons/subjects/english-grammar/module";
import type { LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import type { ClosedCheckInput, ClosedExerciseChecker, LessonPacketGenerator, LessonPacketInput, RunCostSink } from "../../../ports/ai";
import { GenerationProviderError } from "../../../ports/generation-error";
import { runLessonBaselinePool } from "./lesson-baseline-pool";
import { poolStageCounts } from "./lesson-drafts";
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
  if (type === "lesson_error_fix") return { ...common, exerciseType: type, instructionPl: "Popraw błąd.", statement: `${name} play the piano.`, answer: `${name} plays the piano.`, focus: ["plays"] };
  return { ...common, exerciseType: "lesson_open_answer", instructionPl: "Przetłumacz.", prompt: `${name} pływa w jeziorze.`, answer: `${name} swims in the lake.`, focus: ["swims"] };
}

class FakeGenerator implements LessonPacketGenerator {
  readonly calls: LessonPacketInput[] = [];
  /** Opóźnienie per typ (ms) — do sprawdzenia, że kolejność zakończenia nie zmienia wyniku. */
  constructor(private readonly options: { delay?: (input: LessonPacketInput) => number; fail?: (input: LessonPacketInput, attempt: number) => Error | undefined; extra?: number; shift?: number; examples?: readonly unknown[] } = {}) {}
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
    const offset = (input.objective.id === first ? 0 : 100) + (this.options.shift ?? 0);
    const typeOffset = { lesson_choice: 0, lesson_gap: 30, lesson_open_answer: 60, lesson_error_fix: 200 }[input.type] ?? 90;
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
    expect(result.objectives.map((objective) => [objective.objectiveId, objective.status])).toEqual([[first, "complete"], [second, "complete"]]);
    // Cele etapów 4 / 4 / 3: pula 20 na 2 cele = 10 na cel, podział agenta 4 / 4 / 2, independent podniesiony do minimum z rezerwą.
    const types = result.objectives[0]!.exercises.map((draft) => draft.exerciseType);
    expect(types).toEqual([...Array(4).fill("lesson_choice"), ...Array(4).fill("lesson_gap"), ...Array(3).fill("lesson_open_answer")]);
    expect(result.objectives[0]!.examples).toEqual(["I play football."]);
    expect(generator.calls.map((call) => [call.type, call.count, call.withExamples])).toEqual([
      ["lesson_choice", 7, true], ["lesson_gap", 7, false], ["lesson_open_answer", 6, false],
      ["lesson_choice", 7, true], ["lesson_gap", 7, false], ["lesson_open_answer", 6, false],
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
    expect(checker.calls[0]!.items).toHaveLength(7);
    expect(generator.calls[0]!.pool.ruleBook.lesson).toEqual([]);
    expect(generator.calls[0]!.pool.ruleBook.checks).toEqual([]);
    expect(generator.calls[0]!.pool.exerciseTypes).toEqual(["lesson_choice"]);
  });

  it("passes the lesson material to the check only when the subject needs it (stage 5b)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const plain = new FakeChecker();
    await run(new FakeGenerator(), plain);
    expect(plain.calls.length).toBeGreaterThan(0);
    expect(plain.calls.every((call) => !("material" in call))).toBe(true);
    const needsMaterial: SubjectModule = { ...subject, agentPolicy: { ...subject.agentPolicy, checkerNeedsMaterial: true } };
    const withMaterial = new FakeChecker();
    await runLessonBaselinePool(
      { generator: new FakeGenerator(), checker: withMaterial, subjects: { getSubject: () => needsMaterial }, policy: {} },
      runInput(),
      new AbortController().signal,
    );
    expect(withMaterial.calls.length).toBeGreaterThan(0);
    expect(withMaterial.calls.every((call) => call.material === "Tom plays football.")).toBe(true);
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
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => logs.push(line));
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
    expect(twinned.rejections.filter((entry) => entry.code === "lesson_pool")).toEqual([expect.objectContaining({ objectiveId: first, exerciseType: "lesson_gap", detail: "" })]);
    const ruleIds = twinned.rejections.find((entry) => entry.code === "lesson_pool")!.ruleIds;
    expect(ruleIds.length).toBeGreaterThan(0);
    // Dziennik podaje identyfikatory reguł odrzuceń z typem ćwiczenia (bez treści).
    expect(logs.some((line) => line.includes(` rules=${ruleIds.map((rule) => `lesson_gap/${rule}:1`).join(",")} `))).toBe(true);
  });

  it("keeps only the stage target and never lets overflow remove other exercises", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await run(new FakeGenerator());
    const counts = result.objectives[0]!.exercises.reduce<Record<string, number>>((acc, draft) => ({ ...acc, [draft.exerciseType]: (acc[draft.exerciseType] ?? 0) + 1 }), {});
    expect(counts).toEqual({ lesson_choice: 4, lesson_gap: 4, lesson_open_answer: 3 });
    expect(result.rejections.some((entry) => entry.code === "lesson_pool")).toBe(false);
  });

  it("fills each packet's share before any reserve, so the first type of a stage does not crowd out the second", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mixed: LessonTopic = { ...topic, objectives: topic.objectives.map((objective) => ({ ...objective, exerciseTypes: [...TYPES, "lesson_error_fix"] })) };
    const result = await run(new FakeGenerator(), undefined, { objectiveSource: { source: "catalog", topic: mixed } });
    const types = result.objectives[0]!.exercises.map((draft) => draft.exerciseType);
    // Productive 4 = gap 2 + error_fix 2 (udziały), choć gap ma zapas.
    expect(types.filter((type) => type === "lesson_gap")).toHaveLength(2);
    expect(types.filter((type) => type === "lesson_error_fix")).toHaveLength(2);
  });

  it("does not retry a refusal and does not retry once the budget is spent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const refusal = new FakeGenerator({ fail: (input) => (input.type === "lesson_gap" ? new GenerationProviderError("refusal") : undefined) });
    await run(refusal);
    expect(refusal.calls.filter((call) => call.type === "lesson_gap")).toHaveLength(2);
    const spent = new FakeGenerator({ fail: (input) => (input.type === "lesson_gap" ? new GenerationProviderError("transient") : undefined) });
    await run(spent, new FakeChecker(), {}, { runBudgetUsd: 0.001, concurrency: 1 });
    expect(spent.calls.filter((call) => call.type === "lesson_gap").length).toBeLessThanOrEqual(1);
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

  it("aborts the run on a code error instead of failing the objective", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const buggy = new FakeGenerator({ fail: (input) => (input.type === "lesson_gap" ? new TypeError("bug") : undefined) });
    await expect(run(buggy)).rejects.toThrow(TypeError);
  });

  it("starts no further paid call after a code error and rejects only when all work has stopped", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Jedno miejsce w semaforze: pozostałe 5 paczek czeka w kolejce, gdy pierwsza rzuca błąd kodu.
    let started = 0;
    const buggy = new FakeGenerator({ fail: () => ((started += 1) === 1 ? new TypeError("bug") : undefined) });
    await expect(run(buggy, undefined, {}, { concurrency: 1 })).rejects.toThrow(TypeError);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(buggy.calls).toHaveLength(1);
  });

  it("does not retry a rate limit once the budget ran out during the wait", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const isFirstGap = (input: LessonPacketInput) => input.objective.id === first && input.type === "lesson_gap";
    const generator = new FakeGenerator({
      delay: (input) => (isFirstGap(input) ? 0 : 1_000),
      fail: (input, attempt) => (isFirstGap(input) && attempt === 1 ? new GenerationProviderError("rate_limit", { retryAfterMs: 5_000 }) : undefined),
    });
    // 0,001 USD przy błędzie 429, potem trzy równoległe paczki po 0,001 w trakcie czekania — budżet 0,0025 wyczerpany przed ponowieniem.
    const pending = run(generator, new FakeChecker(), {}, { runBudgetUsd: 0.0025, concurrency: 4 });
    await vi.advanceTimersByTimeAsync(6_000);
    await pending;
    expect(generator.calls.filter(isFirstGap)).toHaveLength(1);
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
    expect(result.rejections.filter((entry) => entry.code === "check_unknown")).toHaveLength(14);
    expect(result.objectives.every((objective) => !objective.exercises.some((draft) => draft.exerciseType === "lesson_choice"))).toBe(true);
  });

  it("rejects inputs the baseline does not support", async () => {
    const generator = new FakeGenerator();
    await expect(run(generator, undefined, { objectiveSource: { source: "input", dynamicTopic: { titlePl: "Temat", objectives: [] } } })).rejects.toBeInstanceOf(AppError);
    await expect(run(generator, undefined, { target: { mode: "add", objectiveId: "english_grammar.present_simple.nope", count: 2 } })).rejects.toBeInstanceOf(AppError);
    expect(generator.calls).toHaveLength(0);
  });

  it("counts the objective status with the write limits (target count of the pool)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Pula 40 = 20 na cel; generator oddaje po jednym ćwiczeniu mniej niż udział — minimum publikacji zostaje, cel liczbowy nie.
    const result = await run(new FakeGenerator({ extra: -4 }), undefined, { poolSize: 40 });
    expect(result.objectives[0]!.status).toBe("incomplete");
    expect(result.objectives[0]!.missing).toEqual(expect.arrayContaining([expect.stringMatching(/^exercises: \d+ of 20$/u)]));
  });

  it("resumes: skips settled objectives, keeps their exercises fixed and rejects a new exercise repeating them", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const previous = await run(new FakeGenerator());
    const fixed = previous.objectives[0]!.exercises;
    // Drugie zagadnienie dostaje jako pierwszą odpowiedź otwartą zdanie z `fixed` (ofiara albo duplikat).
    const inner = new FakeGenerator();
    const repeating: LessonPacketGenerator = {
      generatePacket: async (input, cost, signal) => {
        const out = await inner.generatePacket(input, cost, signal);
        if (input.type !== "lesson_open_answer") return out;
        const copy = fixed.find((draft) => draft.exerciseType === "lesson_open_answer")!;
        return { ...out, exercises: [{ ...copy, objectiveId: second }, ...out.exercises.slice(1)] };
      },
    };
    const result = await run(repeating, undefined, { skipObjectives: [first], fixed, initialExamples: { [first]: ["I play football."] } });
    expect(inner.calls.every((call) => call.objective.id === second)).toBe(true);
    expect(result.objectives.map((objective) => objective.objectiveId)).toEqual([second]);
    expect(result.rejections.filter((entry) => entry.objectiveId === second && ["lesson_pool", "leak_victim", "leak_source"].includes(entry.code))).toHaveLength(1);
    expect(result.objectives[0]!.exercises.some((draft) => fixed.includes(draft))).toBe(false);
  });

  it("adds N exercises to one objective: packets from the add plan, no examples, draft and story as exposure sources", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const draft = await run(new FakeGenerator());
    const fixed = draft.objectives.flatMap((objective) => objective.exercises);
    const examples = Object.fromEntries(draft.objectives.map((objective) => [objective.objectiveId, objective.examples]));
    const inner = new FakeGenerator({ shift: 500 });
    const story: LessonPacketGenerator = {
      generatePacket: async (input, cost, signal) => {
        const out = await inner.generatePacket(input, cost, signal);
        if (input.type !== "lesson_open_answer") return out;
        const [head, ...rest] = out.exercises as Record<string, unknown>[];
        return { ...out, exercises: [{ ...head!, answer: "Story line." }, ...rest] };
      },
    };
    const result = await run(story, undefined, {
      fixed,
      initialExamples: examples,
      examplesFixed: true,
      extraExposureSources: ["Story line."],
      target: { mode: "add", objectiveId: second, count: 3 },
    });
    const split = poolStageCounts(subject, topic.objectives[1]!.exerciseTypes, 3);
    expect(inner.calls.every((call) => call.objective.id === second && !call.withExamples)).toBe(true);
    expect(inner.calls.map((call) => call.type)).toEqual(
      (["lesson_choice", "lesson_gap", "lesson_open_answer"] as const).filter((_type, index) => [split.guided, split.productive, split.independent][index]! > 0),
    );
    expect(inner.calls[0]!.pool.avoidSentences).toEqual(expect.arrayContaining([fixed.find((item) => item.exerciseType === "lesson_open_answer")!.answer]));
    const added = result.objectives[0]!.exercises;
    expect(added).toHaveLength(3);
    expect(added.some((item) => fixed.includes(item) || item.answer === "Story line.")).toBe(false);
    expect(result.objectives[0]!.status).toBe("complete");
  });

  it("rejects an added exercise that duplicates a later-stage draft exercise", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Szkic ma ćwiczenie samodzielne; nowe ćwiczenie etapu prowadzonego go powtarza — ofiarą byłoby `fixed`.
    const independent: LessonExerciseDraft = { ...(raw("lesson_open_answer", second, 900) as unknown as LessonExerciseDraft) };
    const guided: LessonExerciseDraft = { ...independent, exerciseType: "lesson_choice", stem: "___ swims in the lake.", answer: independent.answer, options: [{ id: "a", text: independent.answer }, { id: "b", text: "x" }], correctOption: "a" } as LessonExerciseDraft;
    const generator: LessonPacketGenerator = {
      generatePacket: async (input) => ({ exercises: input.type === "lesson_choice" ? [guided] : [] }),
    };
    const checker = new FakeChecker(() => ({ answers: [independent.answer] }));
    const result = await run(generator, checker, { fixed: [independent], examplesFixed: true, target: { mode: "add", objectiveId: second, count: 3 } });
    expect(result.objectives[0]!.exercises).toEqual([]);
    expect(result.rejections.some((entry) => ["lesson_pool", "leak_victim", "leak_source"].includes(entry.code))).toBe(true);
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

describe("runLessonBaselinePool: dynamic topics and multi-field checks (stage 5a)", () => {
  const LEFT = ["coat", "hat", "scarf", "boots", "dress", "shirt", "skirt", "socks"];
  /** Przedmiot z tematem dynamicznym: zagadnienia z danych, typy card / match / gap / open_answer. */
  const dynamicSubject: SubjectModule = {
    ...subject,
    id: "dynamic_test",
    exerciseTypes: [...subject.exerciseTypes, "lesson_match"],
    buildDynamicTopic: (data) => ({
      id: "dynamic",
      version: 1,
      titlePl: data.titlePl,
      extraErrorCategories: [],
      transforms: [],
      objectives: data.objectives.map((objective) => ({
        id: objective.id,
        titlePl: objective.titlePl,
        descriptionEn: objective.descriptionEn,
        cards: objective.cards.map((card) => ({ title: card.title, body: card.body })),
        errorCategories: [],
        hints: {},
        exerciseTypes: ["lesson_card", "lesson_match", "lesson_gap", "lesson_open_answer"],
      })),
    }),
  };
  const dynamicTopic = {
    titlePl: "Ubrania",
    objectives: [
      { id: "dynamic_test.d1.clothes", titlePl: "Ubrania", descriptionEn: "Clothes words.", cards: [{ title: "Słowa", body: "coat — płaszcz" }] },
      { id: "dynamic_test.d1.more", titlePl: "Więcej", descriptionEn: "More clothes.", cards: [{ title: "Słowa", body: "hat — kapelusz" }] },
    ],
  };
  const [d1, d2] = dynamicTopic.objectives.map((objective) => objective.id) as [string, string];

  function rawMatch(objectiveId: string, n: number): Record<string, unknown> {
    const lefts = [0, 1, 2].map((i) => `${LEFT[(n + i) % LEFT.length]}${n}`);
    return {
      objectiveId,
      exerciseType: "lesson_match",
      instructionPl: "Połącz w pary.",
      acceptedAnswers: [],
      focus: [],
      pairs: lefts.map((left, i) => ({ left, right: `pl ${n}-${i}` })),
      answer: lefts.join(", "),
    };
  }

  class DynamicGenerator implements LessonPacketGenerator {
    readonly calls: LessonPacketInput[] = [];
    async generatePacket(input: LessonPacketInput, cost: RunCostSink): Promise<{ exercises: unknown[]; examples?: unknown[] }> {
      this.calls.push(input);
      cost.record(0.001);
      const offset = (input.objective.id === d1 ? 0 : 100) + ({ lesson_match: 0, lesson_gap: 30 }[input.type as string] ?? 60);
      const exercises = Array.from({ length: input.count }, (_, i) =>
        input.type === "lesson_match" ? rawMatch(input.objective.id, offset + i) : raw(input.type, input.objective.id, offset + i),
      );
      return { exercises, ...(input.withExamples ? { examples: [`Example ${input.objective.id}.`] } : {}) };
    }
  }

  /** Kontrola z kluczem fake'a: prawa strona „pl n-i” należy do i-tej lewej strony ćwiczenia n. */
  function keyChecker(corrupt: (view: string) => boolean = () => false): ClosedExerciseChecker & { calls: ClosedCheckInput[] } {
    const calls: ClosedCheckInput[] = [];
    return {
      calls,
      checkClosed: async (input, cost) => {
        calls.push(input);
        cost.record(0.0005);
        return {
          results: input.items.map(({ view }) => {
            const left = /Field: (\S+)/u.exec(view)?.[1];
            if (left === undefined) return { answers: ["plays"] };
            const n = Number(/(\d+)$/u.exec(left)![1]);
            const lefts = /Left \(in this order\): (.*)/u.exec(view)![1]!.split(" | ");
            const right = `pl ${n}-${lefts.indexOf(left)}`;
            return { answers: corrupt(view) ? [right, "pl x"] : [right] };
          }),
        };
      },
    };
  }

  const dynamicRun = (generator: LessonPacketGenerator, checker: ClosedExerciseChecker, input: Partial<LessonPoolAgentRunInput> = {}) =>
    runLessonBaselinePool(
      { generator, checker, subjects: { getSubject: (id: string) => (id === dynamicSubject.id ? dynamicSubject : undefined) } },
      runInput({ subjectId: dynamicSubject.id, objectiveSource: { source: "input", dynamicTopic }, ...input }),
      new AbortController().signal,
    );

  it("builds a dynamic topic and reports it to the objectives hook", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resolved: unknown[] = [];
    const generator = new DynamicGenerator();
    const result = await dynamicRun(generator, keyChecker(), { onObjectivesResolved: async (value) => void resolved.push(value) });
    expect(resolved).toEqual([expect.objectContaining({ dynamicTopic })]);
    expect(result.objectives.map((objective) => [objective.objectiveId, objective.status])).toEqual([[d1, "complete"], [d2, "complete"]]);
    expect(new Set(generator.calls.map((call) => call.type))).toEqual(new Set(["lesson_match", "lesson_gap", "lesson_open_answer"]));
  });

  it("sends one check item per field and maps results back to each exercise", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Pierwsze ćwiczenie match pierwszego zagadnienia ma pole z drugą poprawną odpowiedzią.
    const checker = keyChecker((view) => view.includes("Left (in this order): coat0 |") && view.includes("Field: coat0 "));
    const result = await dynamicRun(new DynamicGenerator(), checker);
    const matchCall = checker.calls.find((call) => call.items.some((item) => item.view.includes("Field:")))!;
    expect(matchCall.contract).toBe("choice");
    expect(matchCall.items.length % 3).toBe(0);
    expect(result.rejections.filter((entry) => entry.code === "check_wrong_set")).toHaveLength(1);
    expect(result.objectives[0]!.exercises.some((draft) => draft.pairs?.[0]?.left === "coat0")).toBe(false);
    expect(result.objectives[0]!.exercises.some((draft) => draft.exerciseType === "lesson_match")).toBe(true);
  });

  it("rejects only the exercises whose field results are missing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const inner = keyChecker();
    const checker: ClosedExerciseChecker = {
      checkClosed: async (input, cost, signal) => {
        const { results } = await inner.checkClosed(input, cost, signal);
        return { results: results.slice(0, 4) };
      },
    };
    const result = await dynamicRun(new DynamicGenerator(), checker);
    const unknown = result.rejections.filter((entry) => entry.code === "check_unknown");
    // 4 wyniki: pierwsze ćwiczenie paczki (3 pola) ocenione, kolejne bez kompletu wyników.
    expect(unknown.length).toBeGreaterThan(0);
    expect(result.rejections.filter((entry) => entry.code === "check_wrong_set")).toHaveLength(0);
    for (const objective of result.objectives) expect(objective.exercises.filter((draft) => draft.exerciseType === "lesson_match")).toHaveLength(1);
  });

  it("resumes an agent checkpoint of a dynamic topic without the examples call", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const previous = await dynamicRun(new DynamicGenerator(), keyChecker());
    const generator = new DynamicGenerator();
    const result = await dynamicRun(generator, keyChecker(), {
      fixed: previous.objectives[0]!.exercises,
      skipObjectives: [d1],
      initialExamples: { [d1]: ["Plan example one."], [d2]: ["Plan example two."] },
      examplesFixed: true,
    });
    expect(generator.calls.every((call) => call.objective.id === d2 && !call.withExamples)).toBe(true);
    expect(result.objectives.map((objective) => objective.objectiveId)).toEqual([d2]);
    expect(result.objectives[0]!.examples).toEqual(["Plan example two."]);
  });

  it("runs the subject's sanitize before validation", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const strict: SubjectModule = {
      ...subject,
      id: "strict_test",
      validateExercise: (draft) =>
        draft.exerciseType === "lesson_open_answer" && draft.instructionPl !== "Fixed."
          ? [{ rule: "lesson.test", field: "instructionPl", pl: "x" } as never]
          : [],
      agentPolicy: {
        ...subject.agentPolicy,
        sanitize: (draft) => ({ draft: draft.exerciseType === "lesson_open_answer" ? { ...draft, instructionPl: "Fixed." } : draft, removed: [] }),
      },
    };
    const result = await runLessonBaselinePool(
      { generator: new FakeGenerator(), checker: new FakeChecker(), subjects: { getSubject: (id: string) => (id === strict.id ? strict : undefined) } },
      runInput({ subjectId: strict.id }),
      new AbortController().signal,
    );
    expect(result.objectives[0]!.exercises.filter((draft) => draft.exerciseType === "lesson_open_answer")).toHaveLength(3);
    expect(result.rejections.filter((entry) => entry.code === "rule_exercise")).toHaveLength(0);
  });
});
