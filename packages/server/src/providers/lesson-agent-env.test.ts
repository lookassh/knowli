import { afterEach, describe, expect, it, vi } from "vitest";
import { isLessonAgentAvailable, type LessonAgentDeps } from "../config";
import { withConfigDefaults } from "../config-defaults";
import { createProductionSubjectRegistry } from "../domain/lessons/subjects";
import { englishGrammarSubject } from "../domain/lessons/subjects/english-grammar/module";
import { runLessonBaselinePool } from "../modules/materials/lessons/lesson-baseline-pool";
import type { LessonPacketInput } from "../ports/ai";
import { FakeExerciseChecker, FakeLessonPoolAgent } from "./fake-lesson-agent";
import { lessonAgentDepsFromEnv } from "./lesson-agent-env";
import { createTestRecorder } from "./usage/test-recorder";

const never = new AbortController().signal;
const GRAMMAR_TOPIC = englishGrammarSubject.topics.find((candidate) => candidate.id === "present_simple")!;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Zależności generowania z env, gdy test oczekuje dostępnego generatora. */
function available(deps: ReturnType<typeof lessonAgentDepsFromEnv>): LessonAgentDeps {
  if (!isLessonAgentAvailable(deps)) throw new Error("expected available lesson agent");
  return deps;
}

/** Paczka jednego typu pierwszego zagadnienia gramatyki (fake czyta tylko materiał, zdania do unikania i cel). */
const PACKET = {
  pool: { material: "Tom plays football.", avoidSentences: [], exerciseTypes: ["lesson_gap"] },
  objective: { id: GRAMMAR_TOPIC.objectives[0]!.id, title: "x", cards: [] },
  type: "lesson_gap",
  count: 1,
  withExamples: false,
  timeoutMs: 1,
} as unknown as LessonPacketInput;

/** Paczka z fake'a w trybie fake workera; `done` po rozstrzygnięciu. */
function packetRun(deps: LessonAgentDeps) {
  const state = { done: false };
  const run = deps.agent.generatePacket(PACKET, { record: () => undefined }, never).then((result) => {
    state.done = true;
    return result;
  });
  return { run, state };
}

describe("lessonAgentDepsFromEnv", () => {
  it("tryb fake bez klucza → fake'i: generator, kontrola zamkniętych, polityka z env, bez ostrzeżeń", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = withConfigDefaults({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_LESSON_AGENT_CONCURRENCY: "5" });
    const deps = available(lessonAgentDepsFromEnv(env, createTestRecorder()));
    expect(deps.agent).toBeInstanceOf(FakeLessonPoolAgent);
    expect(deps.checker).toBeInstanceOf(FakeExerciseChecker);
    expect(deps.policy).toMatchObject({ concurrency: 5, checkerConcurrency: 4 });
    const checked = await deps.checker.checkClosed({ contract: "choice", items: [{ view: "Wybierz.\nOptions: plays | playsx" }], timeoutMs: 1 }, { record: () => undefined }, never);
    expect(checked.results).toEqual([{ answers: ["plays"] }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tryb fake: przebieg lekcji bez historii wywołań, z zerowym kosztem i bez zdarzeń kosztów", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const usage = createTestRecorder();
    const deps = available(lessonAgentDepsFromEnv(withConfigDefaults({ UMIEM_FAKE_PROVIDERS: "1" }), usage));
    const result = await runLessonBaselinePool(
      { generator: deps.agent, checker: deps.checker, subjects: createProductionSubjectRegistry(), policy: deps.policy },
      {
        runId: "run-1",
        subjectId: englishGrammarSubject.id,
        deckId: "42",
        objectiveSource: { source: "catalog", topic: GRAMMAR_TOPIC },
        topicTitle: GRAMMAR_TOPIC.titlePl,
        material: "Tom plays football. Ola reads books. They swim every day.",
        poolSize: 60,
        fixed: [],
        draftExamples: {},
        skipObjectives: [],
        familyScope: null,
        initialSpentUsd: 0,
      },
      never,
    );
    const agent = deps.agent as FakeLessonPoolAgent;
    expect(result.objectives.length).toBeGreaterThan(0);
    expect(result.objectives.every((objective) => objective.exercises.length > 0)).toBe(true);
    // record: false — worker nie gromadzi historii wywołań fake'a
    expect(agent.packetCalls).toHaveLength(0);
    // stepCostUsd: 0 — paczki fake'a nie zużywają budżetu runu (koszt znany, nie szacunek)
    expect(result.spentUsd).toBe(0);
    expect(usage.events).toEqual([]);
  });

  it("tryb fake: opóźnienie paczki z UMIEM_FAKE_LESSON_DELAY_MS (przed UMIEM_FAKE_DELAY_MS)", async () => {
    vi.useFakeTimers();
    const env = withConfigDefaults({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_FAKE_LESSON_DELAY_MS: "200", UMIEM_FAKE_DELAY_MS: "5000" });
    const { run, state } = packetRun(available(lessonAgentDepsFromEnv(env)));
    await vi.advanceTimersByTimeAsync(199);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.done).toBe(true);
    expect((await run).exercises).toHaveLength(1);
  });

  it("tryb fake: bez UMIEM_FAKE_LESSON_DELAY_MS opóźnienie z UMIEM_FAKE_DELAY_MS", async () => {
    vi.useFakeTimers();
    const { run, state } = packetRun(available(lessonAgentDepsFromEnv({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_FAKE_DELAY_MS: "300" })));
    await vi.advanceTimersByTimeAsync(299);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(state.done).toBe(true);
  });

  it("tryb fake: nieliczbowe opóźnienie → bez opóźnienia", async () => {
    vi.useFakeTimers();
    const { run, state } = packetRun(available(lessonAgentDepsFromEnv({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_FAKE_LESSON_DELAY_MS: "abc" })));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.done).toBe(true);
    await run;
  });

  it("bez klucza poza trybem fake → niedostępny, bez logu", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = lessonAgentDepsFromEnv(withConfigDefaults({}));
    expect(deps).toEqual({ unavailable: "no_openrouter_key" });
    expect(isLessonAgentAvailable(deps)).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("pozostawione UMIEM_LESSON_AGENT_SUBJECTS nie zmienia wyniku", () => {
    expect(lessonAgentDepsFromEnv(withConfigDefaults({ UMIEM_LESSON_AGENT_SUBJECTS: "english_grammar" }))).toEqual({ unavailable: "no_openrouter_key" });
    expect(isLessonAgentAvailable(lessonAgentDepsFromEnv(withConfigDefaults({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_LESSON_AGENT_SUBJECTS: "history" })))).toBe(true);
  });

  it("klucz w kształcie OpenAI to błąd z nazwą zmiennej", () => {
    expect(() => lessonAgentDepsFromEnv(withConfigDefaults({ UMIEM_LESSON_AGENT_API_KEY: "sk-proj-x" }))).toThrow(/UMIEM_LESSON_AGENT_API_KEY/u);
  });

  it("z kluczem → instancje adaptera AI SDK z modelami z env", () => {
    const env = withConfigDefaults({
      OPENROUTER_API_KEY: "sk-or-v1-test",
      UMIEM_LESSON_AGENT_MODEL: "google/gemini-test",
      UMIEM_LESSON_AGENT_CHECKER_MODEL: "deepseek/deepseek-test",
      UMIEM_LESSON_AGENT_CONCURRENCY: "2",
    });
    const deps = available(lessonAgentDepsFromEnv(env, createTestRecorder()));
    expect(deps).not.toHaveProperty("subjects");
    // Adapter bez importu w teście: jedynym importerem adaptera jest lesson-agent-env.ts (test architektury).
    expect(deps.agent.constructor.name).toBe("AiSdkLessonPoolAgent");
    expect(deps.agent).toMatchObject({ name: "ai-sdk-openrouter", model: "google/gemini-test" });
    expect(deps.checker.constructor.name).toBe("AiSdkExerciseChecker");
    expect(deps.checker).toMatchObject({ model: "deepseek/deepseek-test" });
    expect(deps.policy).toMatchObject({ concurrency: 2 });
  });
});
