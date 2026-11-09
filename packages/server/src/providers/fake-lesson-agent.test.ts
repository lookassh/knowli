import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCostSink } from "../ports/ai";
import { englishGrammarSubject } from "../domain/lessons/subjects/english-grammar/module";
import type { SubjectModule } from "../domain/lessons/types";
import type { LessonPoolAgentRunInput } from "../modules/materials/lessons/lesson-pool-agent";
import { runLessonBaselinePool } from "../modules/materials/lessons/lesson-baseline-pool";
import { FakeExerciseChecker, FakeLessonPoolAgent } from "./fake-lesson-agent";
import { FAKE_SLOW_DELAY_MS, FAKE_SLOW_MARKER } from "./fake-lesson-pool";
import { createTestRecorder } from "./usage/test-recorder";

function costSink(log: string[] = []): RunCostSink & { readonly values: (number | null)[] } {
  const values: (number | null)[] = [];
  return {
    values,
    record(usd) {
      values.push(usd);
      log.push(`cost:${usd}`);
    },
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CLOSED = { contract: "choice" as const, items: [{ view: "Wybierz.\nOptions: plays | playsx" }], timeoutMs: 1 };

describe("FakeExerciseChecker", () => {
  const signal = () => new AbortController().signal;

  it("zapisuje wywołania i koszt (domyślnie 0, null = nieznany)", async () => {
    const checker = new FakeExerciseChecker({});
    const cost = costSink();
    await checker.checkClosed(CLOSED, cost, signal());
    expect(checker.closedCalls).toEqual([CLOSED]);
    expect(cost.values).toEqual([0]);

    const nullSink = costSink();
    await new FakeExerciseChecker({ costUsd: null }).checkClosed(CLOSED, nullSink, signal());
    expect(nullSink.values).toEqual([null]);
  });

  it("gate wstrzymuje wywołania do rozwiązania obietnicy, a maxConcurrent liczy równoległość", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const checker = new FakeExerciseChecker({ gate });
    const cost = costSink();
    let done = 0;
    const calls = [1, 2, 3].map(() => checker.checkClosed(CLOSED, cost, signal()).then(() => void done++));
    await delay(10);
    expect(done).toBe(0);
    expect(checker.maxConcurrent).toBe(3);
    open();
    await Promise.all(calls);
    expect(done).toBe(3);
    expect(checker.maxConcurrent).toBe(3);
  });

  it("gate odrzuca signal.reason, gdy wywołanie zostanie przerwane w oczekiwaniu", async () => {
    const checker = new FakeExerciseChecker({ gate: new Promise<void>(() => undefined) });
    const controller = new AbortController();
    const reason = new Error("aborted-at-gate");
    const call = checker.checkClosed(CLOSED, costSink(), controller.signal);
    controller.abort(reason);
    await expect(call).rejects.toBe(reason);
  });

  it("wywołanie z już przerwanym sygnałem odrzuca signal.reason bez zapisu kosztu", async () => {
    const checker = new FakeExerciseChecker({});
    const controller = new AbortController();
    const reason = new Error("checker-pre-aborted");
    controller.abort(reason);
    const cost = costSink();
    await expect(checker.checkClosed(CLOSED, cost, controller.signal)).rejects.toBe(reason);
    expect(cost.values).toEqual([]);
  });

  it("gate nie zostawia nasłuchów abort na wspólnym, nieprzerwanym sygnale", async () => {
    const controller = new AbortController();
    const shared = controller.signal;
    const added = vi.spyOn(shared, "addEventListener");
    const removed = vi.spyOn(shared, "removeEventListener");
    const checker = new FakeExerciseChecker({ gate: Promise.resolve() });
    for (let index = 0; index < 20; index += 1) {
      await checker.checkClosed(CLOSED, costSink(), shared);
    }
    const listenersAdded = added.mock.calls.filter(([type]) => type === "abort").length;
    const listenersRemoved = removed.mock.calls.filter(([type]) => type === "abort").length;
    expect(listenersAdded).toBe(20);
    expect(listenersRemoved).toBe(listenersAdded);
  });
});

describe("fake przebiegu bazowego (etap 4 #358)", () => {
  // Stan po etapie 4: gramatyka bez walidatora przedmiotu.
  const grammar: SubjectModule = { ...englishGrammarSubject, validateExercise: () => [] };
  const deps = (agent: FakeLessonPoolAgent, checker = new FakeExerciseChecker()) => ({
    generator: agent,
    checker,
    subjects: { getSubject: (id: string) => (id === grammar.id ? grammar : undefined) },
  });
  const input = (topicId: string, overrides: Partial<LessonPoolAgentRunInput> = {}): LessonPoolAgentRunInput => {
    const topic = grammar.topics.filter((item) => item.id === topicId).sort((a, b) => b.version - a.version)[0]!;
    return {
      runId: "run-fake",
      subjectId: grammar.id,
      deckId: "deck-fake",
      objectiveSource: { source: "catalog", topic },
      topicTitle: topic.titlePl,
      material: "Tom plays football. Ola reads books. They swim every day.",
      poolSize: 60,
      graderAvailable: true,
      fixed: [],
      draftExamples: {},
      skipObjectives: [],
      familyScope: null,
      initialSpentUsd: 0,
      ...overrides,
    };
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it.each(["present_simple", "present_continuous", "to_be"])("buduje kompletną lekcję %s bez odrzuceń, a „dodaj 3” dodaje 3", async (topicId) => {
    const agent = new FakeLessonPoolAgent({ generate: {}, stepCostUsd: 0 });
    const result = await runLessonBaselinePool(deps(agent), input(topicId), new AbortController().signal);
    expect(result.rejections).toEqual([]);
    expect(result.objectives.every((objective) => objective.status === "complete")).toBe(true);
    const fixed = result.objectives.flatMap((objective) => objective.exercises);
    const examples = Object.fromEntries(result.objectives.map((objective) => [objective.objectiveId, objective.examples]));
    const objectiveId = result.objectives[0]!.objectiveId;
    const added = await runLessonBaselinePool(
      deps(agent),
      input(topicId, { fixed, initialExamples: examples, examplesFixed: true, target: { mode: "add", objectiveId, count: 3 } }),
      new AbortController().signal,
    );
    expect(added.rejections).toEqual([]);
    expect(added.objectives[0]!.exercises).toHaveLength(3);
  });

  it("odczytuje klucz ćwiczeń fake'a z widoku kontroli", async () => {
    const checker = new FakeExerciseChecker();
    const views = [
      "Wybierz.\nOptions: plays | playsx",
      "Listen and choose: ___ (1).\nOptions: orange | plays\nRecording (transcript): Listen and choose: plays (1).",
      "Wskaż słowo.\nSentence 1: plays one\nSentence 2: two three",
    ];
    const choice = await checker.checkClosed({ contract: "choice", items: views.map((view) => ({ view })), timeoutMs: 1 }, costSink(), new AbortController().signal);
    expect(choice.results).toEqual([{ answers: ["plays"] }, { answers: ["plays"] }, { answers: ["plays"] }]);
    const order = await checker.checkClosed({ contract: "order", items: [{ view: "x" }], timeoutMs: 1 }, costSink(), new AbortController().signal);
    expect(order.results).toEqual([{ verdict: "yes" }]);
    const unknown = await new FakeExerciseChecker({ closed: "unknown" }).checkClosed({ contract: "choice", items: [{ view: views[0]! }], timeoutMs: 1 }, costSink(), new AbortController().signal);
    expect(unknown.results).toEqual([{ answers: null }]);
  });

  it("gra scenariusz paczki i zapisuje koszt jako packet_generate", async () => {
    const recorder = createTestRecorder();
    const agent = new FakeLessonPoolAgent({ packets: { third_person_s: [{ throw: new Error("boom") }] }, stepCostUsd: 0.01, usage: recorder });
    const packet = { pool: { material: "Tom plays.", avoidSentences: [] }, objective: { id: "english_grammar.present_simple.third_person_s", title: "x", cards: [] }, type: "lesson_gap", count: 2, withExamples: false, timeoutMs: 1 } as unknown as Parameters<FakeLessonPoolAgent["generatePacket"]>[0];
    const sink = costSink();
    await expect(agent.generatePacket(packet, sink, new AbortController().signal)).rejects.toThrow("boom");
    const second = await agent.generatePacket(packet, sink, new AbortController().signal);
    expect(second.exercises).toHaveLength(2);
    expect(sink.values).toEqual([0.01, 0.01]);
    expect(recorder.events.map((event) => event.operation)).toEqual(["packet_generate", "packet_generate"]);
  });

  it("gra kroki paczki gate, hang, stall i build", async () => {
    const packet = { pool: { material: "Tom plays.", avoidSentences: [] }, objective: { id: "english_grammar.present_simple.third_person_s", title: "x", cards: [] }, type: "lesson_gap", count: 2, withExamples: false, timeoutMs: 1 } as unknown as Parameters<FakeLessonPoolAgent["generatePacket"]>[0];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached = false;
    const built = { exercises: [{ exerciseType: "lesson_gap" }] };
    let seen: unknown;
    const agent = new FakeLessonPoolAgent({
      packets: {
        third_person_s: [
          { gate, onReached: () => (reached = true) },
          { gate: new Promise<void>(() => undefined) },
          { hang: true },
          { stall: true },
          { build: (input) => ((seen = input), built) },
        ],
      },
      stepCostUsd: 0.01,
    });
    const sink = costSink();
    const first = agent.generatePacket(packet, sink, new AbortController().signal);
    await vi.waitFor(() => expect(reached).toBe(true));
    expect(sink.values).toEqual([0.01]);
    release();
    expect((await first).exercises).toHaveLength(2);

    const gated = new AbortController();
    const second = agent.generatePacket(packet, costSink(), gated.signal);
    gated.abort(new Error("stop gate"));
    await expect(second).rejects.toThrow("stop gate");

    const hung = new AbortController();
    const third = agent.generatePacket(packet, costSink(), hung.signal);
    hung.abort(new Error("stop hang"));
    await expect(third).rejects.toThrow("stop hang");

    const stalledCall = new AbortController();
    const fourth = agent.generatePacket(packet, costSink(), stalledCall.signal);
    stalledCall.abort(new Error("stop stall"));
    const winner = await Promise.race([fourth.then(() => "done", () => "rejected"), new Promise((resolve) => setTimeout(() => resolve("still running"), 30))]);
    expect(winner).toBe("still running");

    expect(await agent.generatePacket(packet, costSink(), new AbortController().signal)).toBe(built);
    expect(seen).toBe(packet);
  });

  it("wstrzymuje każdą paczkę materiału z FAKE_SLOW_MARKER", async () => {
    vi.useFakeTimers();
    try {
      const agent = new FakeLessonPoolAgent({ generate: {} });
      const packet = { pool: { material: `Tom plays. ${FAKE_SLOW_MARKER}`, avoidSentences: [] }, objective: { id: "english_grammar.present_simple.negative", title: "x", cards: [] }, type: "lesson_gap", count: 1, withExamples: false, timeoutMs: 1 } as unknown as Parameters<FakeLessonPoolAgent["generatePacket"]>[0];
      let done = false;
      const pending = agent.generatePacket(packet, costSink(), new AbortController().signal).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(FAKE_SLOW_DELAY_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
