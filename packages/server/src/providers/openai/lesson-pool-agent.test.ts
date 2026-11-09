import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, JSONParseError, NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LessonPacketInput, LessonPoolInput, RunCostSink } from "../../ports/ai";
import { MAX_LESSON_TEXT_LENGTH } from "@learning/contracts";
import { GenerationProviderError } from "../../ports/generation-error";
import { currentUsageScope, withUsageScope, type UsageEvent, type UsageScope } from "../../ports/usage";
import { createTestRecorder } from "../usage/test-recorder";
import {
  AiSdkExerciseChecker,
  AiSdkLessonPoolAgent,
  OPENROUTER_BASE_URL,
  openRouterCostOf,
  toGenerationProviderError,
  type AiSdkLessonAgentOptions,
} from "./lesson-pool-agent";

/**
 * Testy produkcyjnego adaptera AI SDK przebiegu bazowego (generator paczek i kontrola zadań
 * zamkniętych): model zastępuje `MockLanguageModelV4` z `ai/test` albo zaślepiony `fetch` — bez sieci
 * i bez kluczy. Sprawdza kontrakt adaptera: surowe rekordy bez zmian, koszt i zapis kosztów każdego
 * żądania, przerwanie sygnałem, mapowanie błędów na `GenerationProviderError`, opcje dostawcy, jawny
 * klucz i host.
 */

type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>;
type GenerateResult = Awaited<ReturnType<Extract<NonNullable<MockOptions["doGenerate"]>, (...args: never[]) => unknown>>>;

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function textResult(text: string, cost = 0.002): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: USAGE,
    providerMetadata: { openrouter: { usage: { cost } } },
    warnings: [],
  };
}

const POOL: LessonPoolInput = {
  subjectId: "subject",
  subjectTitle: "Subject",
  answerLocale: "en-GB",
  answerMaxLength: MAX_LESSON_TEXT_LENGTH,
  promptLocale: "pl-PL",
  promptProfile: { generationRole: "role", gradingRole: "grade", almostDefinition: "almost" },
  exerciseTypes: ["lesson_card", "lesson_choice", "lesson_match", "lesson_gap"],
  transforms: [],
  objectives: [{ id: "subject.topic.animals", descriptionEn: "Animals", exerciseTypes: ["lesson_choice", "lesson_match", "lesson_gap"], errorCategories: [] }],
  material: "cat — kot",
  countPerObjective: 6,
  stageCounts: { guided: 2, productive: 2, independent: 2 },
  graderAvailable: false,
  ruleBook: { general: [{ id: "field.empty", text: "EMPTY-RULE." }], types: [] },
};

function recordingCost(log: string[]): RunCostSink & { values: (number | null)[] } {
  const values: (number | null)[] = [];
  return {
    values,
    record(usd) {
      values.push(usd);
      log.push(`cost:${usd}`);
    },
  };
}

describe("openRouterCostOf", () => {
  const meta = (cost: unknown) => ({ openrouter: { usage: { cost } } }) as never;

  it("koszt liczbowy ≥ 0 przechodzi, brak, nie-liczba i wartość ujemna to nieznany", () => {
    expect(openRouterCostOf(meta(0.0123))).toBe(0.0123);
    expect(openRouterCostOf(meta(0))).toBe(0);
    expect(openRouterCostOf(meta(-0.01))).toBeNull();
    expect(openRouterCostOf(meta(Number.NaN))).toBeNull();
    expect(openRouterCostOf(meta("0.01"))).toBeNull();
    expect(openRouterCostOf(undefined)).toBeNull();
  });
});

function checkerOf(model: MockLanguageModelV4, extra: Partial<AiSdkLessonAgentOptions> = {}): AiSdkExerciseChecker {
  return new AiSdkExerciseChecker({ apiKey: "", model: "test-model", effort: "low", languageModel: model, ...extra });
}

/** Prompt (system + user) wysłany do modelu w pierwszym wywołaniu. */
function sentPrompt(model: MockLanguageModelV4): string {
  return JSON.stringify(model.doGenerateCalls[0]?.prompt);
}

// ---------------------------------------------------------------------------------------------
// Błędy, koszty, opcje dostawcy, klucz i host

function agentOptions(languageModel: AiSdkLessonAgentOptions["languageModel"], extra: Partial<AiSdkLessonAgentOptions> = {}): AiSdkLessonAgentOptions {
  return { apiKey: "", model: "test-model", effort: "low", ...(languageModel === undefined ? {} : { languageModel }), ...extra };
}

function apiError(statusCode: number | undefined, extra: { responseHeaders?: Record<string, string>; isRetryable?: boolean } = {}): APICallError {
  return new APICallError({
    message: "SECRET-PROMPT failed",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: { messages: ["SECRET-PROMPT"] },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseBody: "SECRET-BODY",
    ...extra,
  });
}

function throwingModel(error: () => unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error();
    },
  });
}

/** Rekorder z zakresem kosztów z chwili zapisu (zakres dokłada recorder produkcyjny). */
function scopedRecorder() {
  const events: { event: UsageEvent; scope: UsageScope | undefined }[] = [];
  return {
    events,
    record(event: UsageEvent) {
      events.push({ event, scope: currentUsageScope() });
    },
    flush: async () => {},
  };
}

function chatCompletion(content: string, cost = 0.0042) {
  return {
    id: "gen-1",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15, cost },
  };
}

/** Zaślepiony `fetch`: kolejne odpowiedzi z listy, zapis adresu, nagłówków i ciała każdego żądania. */
function stubFetch(responses: readonly (() => Response)[]) {
  const calls: { url: string; headers: Headers; body: unknown }[] = [];
  const fetchStub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const next = responses[calls.length - 1];
    if (next === undefined) throw new Error("unexpected request");
    return next();
  };
  return { calls, fetch: fetchStub as typeof fetch };
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Paczka jednego typu (jedno zagadnienie, bez przykładów kart). */
const PACKET: LessonPacketInput = {
  pool: { ...POOL, exerciseTypes: ["lesson_choice"], objectives: [{ ...POOL.objectives[0]!, exerciseTypes: ["lesson_choice"] }] },
  objective: { id: "subject.topic.animals", title: "Zwierzęta", cards: [{ title: "Słowa", body: "cat — kot" }] },
  type: "lesson_choice",
  count: 2,
  withExamples: false,
  timeoutMs: 60_000,
};

const CLOSED = { contract: "choice" as const, items: [{ view: "A" }], timeoutMs: 60_000 };

describe("mapowanie błędów (toGenerationProviderError, spec §4)", () => {
  const signal = new AbortController().signal;

  it.each([
    [401, "configuration"],
    [402, "configuration"],
    [403, "configuration"],
    [408, "transient"],
    [500, "transient"],
    [503, "transient"],
    [400, "output"],
    [422, "output"],
  ] as const)("APICallError %i → %s, status zachowany, bez cause i treści", (status, kind) => {
    const mapped = toGenerationProviderError(apiError(status), signal);
    expect(mapped).toBeInstanceOf(GenerationProviderError);
    expect(mapped).toMatchObject({ kind, status });
    expect((mapped as Error).cause).toBeUndefined();
    expect(JSON.stringify({ ...(mapped as object), message: (mapped as Error).message })).not.toMatch(/SECRET/u);
  });

  it("429 → rate_limit z retryAfterMs z nagłówka retry-after", () => {
    expect(toGenerationProviderError(apiError(429, { responseHeaders: { "retry-after": "7" } }), signal)).toMatchObject({
      kind: "rate_limit",
      status: 429,
      retryAfterMs: 7000,
    });
    const withoutHeader = toGenerationProviderError(apiError(429), signal) as GenerationProviderError;
    expect(withoutHeader.kind).toBe("rate_limit");
    expect(withoutHeader.retryAfterMs).toBeUndefined();
  });

  it("błąd sieci (bez statusu) i isRetryable → transient", () => {
    expect(toGenerationProviderError(apiError(undefined, { isRetryable: true }), signal)).toMatchObject({ kind: "transient" });
    expect(toGenerationProviderError(apiError(409, { isRetryable: true }), signal)).toMatchObject({ kind: "transient", status: 409 });
  });

  it("NoObjectGeneratedError, NoOutputGeneratedError i błąd JSON → output bez cause", () => {
    const errors = [
      new NoObjectGeneratedError({
        message: "SECRET",
        text: "SECRET",
        response: { id: "r", timestamp: new Date(0), modelId: "m" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
        finishReason: "stop",
      }),
      new NoOutputGeneratedError({ message: "SECRET" }),
      new JSONParseError({ text: "SECRET{", cause: new Error("SECRET") }),
    ];
    for (const error of errors) {
      const mapped = toGenerationProviderError(error, signal);
      expect(mapped, error.name).toBeInstanceOf(GenerationProviderError);
      expect(mapped).toMatchObject({ kind: "output" });
      expect((mapped as Error).cause).toBeUndefined();
      expect((mapped as Error).message).not.toMatch(/SECRET/u);
    }
  });

  it("przerwany sygnał → signal.reason bez zmian, nawet dla błędu SDK", () => {
    const controller = new AbortController();
    const reason = new Error("run_timeout");
    controller.abort(reason);
    expect(toGenerationProviderError(apiError(500), controller.signal)).toBe(reason);
    expect(toGenerationProviderError(new Error("AbortError"), controller.signal)).toBe(reason);
  });

  it("błąd spoza SDK przechodzi bez zmian", () => {
    const bug = new TypeError("cannot read properties of undefined");
    expect(toGenerationProviderError(bug, signal)).toBe(bug);
    const plain = new Error("provider down");
    expect(toGenerationProviderError(plain, signal)).toBe(plain);
  });

  it("adapter rzuca zmapowany błąd z wywołania modelu (generator, kontrola)", async () => {
    await expect(
      new AiSdkLessonPoolAgent(agentOptions(throwingModel(() => apiError(401)))).generatePacket(PACKET, recordingCost([]), signal),
    ).rejects.toMatchObject({ name: "GenerationProviderError", kind: "configuration", status: 401 });
    await expect(new AiSdkExerciseChecker(agentOptions(throwingModel(() => apiError(422)))).checkClosed(CLOSED, recordingCost([]), signal)).rejects.toMatchObject({
      kind: "output",
      status: 422,
    });
  });

  it("odpowiedź kontroli niezgodna ze schematem wyniku → output", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [textResult("not json at all")] });
    await expect(new AiSdkExerciseChecker(agentOptions(model)).checkClosed(CLOSED, recordingCost([]), new AbortController().signal)).rejects.toMatchObject({
      name: "GenerationProviderError",
      kind: "output",
    });
  });
});

describe("koszty żądań (UsageRecorder i RunCostSink, spec §4)", () => {
  it("usage ok raz na żądanie dla każdej operacji; zdarzenie ma zakres runu", async () => {
    const usage = scopedRecorder();
    const signal = new AbortController().signal;
    await withUsageScope({ generationRunId: "run-1" }, async () => {
      const packetModel = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ exercises: [] }), 0.01)] });
      await new AiSdkLessonPoolAgent(agentOptions(packetModel, { usage })).generatePacket(PACKET, recordingCost([]), signal);
      const closedModel = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ results: [{ answers: ["a"] }] }), 0.004)] });
      await new AiSdkExerciseChecker(agentOptions(closedModel, { usage })).checkClosed(CLOSED, recordingCost([]), signal);
    });

    const ok = (operation: string, providerCostUsd: number): UsageEvent => ({
      feature: "lesson_generation",
      operation,
      provider: "openrouter",
      model: "test-model",
      outcome: "ok",
      httpStatus: 200,
      inputTokens: 10,
      outputTokens: 5,
      providerCostUsd,
    });
    expect(usage.events.map((entry) => entry.event)).toEqual([ok("packet_generate", 0.01), ok("check_closed", 0.004)]);
    expect(usage.events.every((entry) => entry.scope?.generationRunId === "run-1")).toBe(true);
  });

  it("brak usage.cost w metadanych → zdarzenie ok bez providerCostUsd, RunCostSink null", async () => {
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    const result = textResult(JSON.stringify({ exercises: [] }));
    const model = new MockLanguageModelV4({ doGenerate: [{ ...result, providerMetadata: undefined }] });
    await new AiSdkLessonPoolAgent(agentOptions(model, { usage })).generatePacket(PACKET, cost, new AbortController().signal);
    expect(cost.values).toEqual([null]);
    expect(usage.events).toHaveLength(1);
    expect(usage.events[0]).not.toHaveProperty("providerCostUsd");
    expect(usage.events[0]).toMatchObject({ outcome: "ok", operation: "packet_generate", inputTokens: 10, outputTokens: 5 });
  });

  it("błąd HTTP: recordHttpError z httpStatus, RunCostSink 0", async () => {
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    await expect(
      new AiSdkExerciseChecker(agentOptions(throwingModel(() => apiError(500)), { usage })).checkClosed(CLOSED, cost, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "transient" });
    expect(cost.values).toEqual([0]);
    expect(usage.events).toEqual([
      { feature: "lesson_generation", operation: "check_closed", provider: "openrouter", model: "test-model", outcome: "failed", httpStatus: 500 },
    ]);
  });

  it("brak odpowiedzi: recordTransportFailure, RunCostSink null", async () => {
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    await expect(
      new AiSdkLessonPoolAgent(agentOptions(throwingModel(() => apiError(undefined, { isRetryable: true })), { usage })).generatePacket(
        PACKET,
        cost,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "transient" });
    expect(cost.values).toEqual([null]);
    expect(usage.events).toEqual([{ feature: "lesson_generation", operation: "packet_generate", provider: "openrouter", model: "test-model", outcome: "failed" }]);
  });

  it("przerwanie w trakcie żądania: signal.reason, RunCostSink null, porażka transportu", async () => {
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    const controller = new AbortController();
    const reason = new Error("run_deadline");
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        controller.abort(reason);
        return new Promise<GenerateResult>(() => undefined);
      },
    });
    await expect(new AiSdkExerciseChecker(agentOptions(model, { usage })).checkClosed(CLOSED, cost, controller.signal)).rejects.toBe(reason);
    expect(cost.values).toEqual([null]);
    expect(usage.events).toEqual([{ feature: "lesson_generation", operation: "check_closed", provider: "openrouter", model: "test-model", outcome: "failed" }]);
  });

  it("przerwany sygnał przed startem odrzuca wywołanie bez żądania", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [textResult("unused")] });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(new AiSdkLessonPoolAgent(agentOptions(model)).generatePacket(PACKET, recordingCost([]), controller.signal)).rejects.toThrow("cancelled");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("providerOptions (spec §4, §5)", () => {
  it("wysiłek i routing dostawcy trafiają do providerOptions.openrouter każdego wywołania", async () => {
    const provider = { data_collection: "deny", order: ["x"], require_parameters: true };
    const agentModel = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ exercises: [] }))] });
    await new AiSdkLessonPoolAgent(agentOptions(agentModel, { effort: "medium", provider })).generatePacket(PACKET, recordingCost([]), new AbortController().signal);
    const checkerModel = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ results: [{ answers: ["a"] }] }))] });
    await new AiSdkExerciseChecker(agentOptions(checkerModel, { provider })).checkClosed(CLOSED, recordingCost([]), new AbortController().signal);
    expect(agentModel.doGenerateCalls[0]!.providerOptions).toEqual({ openrouter: { reasoning: { effort: "medium" }, provider } });
    expect(checkerModel.doGenerateCalls[0]!.providerOptions).toEqual({ openrouter: { reasoning: { effort: "low" }, provider } });
  });

  it("effort none → bez reasoning; bez routingu → bez provider", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ results: [{ answers: ["a"] }] }))] });
    await new AiSdkExerciseChecker(agentOptions(model, { effort: "none" })).checkClosed(CLOSED, recordingCost([]), new AbortController().signal);
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual({ openrouter: {} });
  });
});

describe("jawny klucz i host OpenRouter (zaślepiony fetch)", () => {
  const KEYS = ["OPENROUTER_API_KEY", "UMIEM_LLM_API_KEY", "UMIEM_LESSON_AGENT_API_KEY"] as const;
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });

  function withoutEnvKeys(): void {
    for (const name of KEYS) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  }

  it("klucz i baseURL jawne: host openrouter.ai, ścieżka /api/v1/chat/completions, Bearer z opcji; koszt z odpowiedzi", async () => {
    withoutEnvKeys();
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    const stub = stubFetch([jsonResponse(chatCompletion(JSON.stringify({ results: [{ answers: ["cat"] }] }), 0.0042))]);
    const checker = new AiSdkExerciseChecker({ apiKey: "test-key", model: "vendor/checker", effort: "low", provider: { data_collection: "deny" }, usage, fetch: stub.fetch });

    const result = await checker.checkClosed(CLOSED, cost, new AbortController().signal);

    expect(result.results).toEqual([{ answers: ["cat"] }]);
    expect(stub.calls).toHaveLength(1);
    const url = new URL(stub.calls[0]!.url);
    expect(url.host).toBe("openrouter.ai");
    expect(url.pathname).toBe("/api/v1/chat/completions");
    expect(stub.calls[0]!.headers.get("authorization")).toBe("Bearer test-key");
    expect(stub.calls[0]!.body).toMatchObject({ model: "vendor/checker", reasoning: { effort: "low" }, provider: { data_collection: "deny" } });
    expect(OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(cost.values).toEqual([0.0042]);
    expect(usage.events).toEqual([
      {
        feature: "lesson_generation",
        operation: "check_closed",
        provider: "openrouter",
        model: "vendor/checker",
        outcome: "ok",
        httpStatus: 200,
        inputTokens: 11,
        outputTokens: 4,
        providerCostUsd: 0.0042,
      },
    ]);
  });

  it("maxRetries 0: odpowiedź 500 → dokładnie jedno żądanie, transient, koszt 0", async () => {
    withoutEnvKeys();
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    const stub = stubFetch([jsonResponse({ error: { message: "upstream", code: 500 } }, 500), jsonResponse(chatCompletion("{}"))]);
    await expect(
      new AiSdkExerciseChecker({ apiKey: "test-key", model: "vendor/checker", effort: "low", usage, fetch: stub.fetch }).checkClosed(CLOSED, cost, new AbortController().signal),
    ).rejects.toMatchObject({ name: "GenerationProviderError", kind: "transient", status: 500 });
    expect(stub.calls).toHaveLength(1);
    expect(cost.values).toEqual([0]);
    expect(usage.events.map((event) => [event.outcome, event.httpStatus])).toEqual([["failed", 500]]);
  });

  it("429 z retry-after przez prawdziwy klient → rate_limit z retryAfterMs", async () => {
    withoutEnvKeys();
    const stub = stubFetch([jsonResponse({ error: { message: "slow down", code: 429 } }, 429, { "retry-after": "7" })]);
    await expect(
      new AiSdkLessonPoolAgent({ apiKey: "test-key", model: "vendor/generator", effort: "low", fetch: stub.fetch }).generatePacket(PACKET, recordingCost([]), new AbortController().signal),
    ).rejects.toMatchObject({ kind: "rate_limit", status: 429, retryAfterMs: 7000 });
    expect(stub.calls).toHaveLength(1);
  });

  it("błąd sieci (fetch failed) → transient, porażka transportu, koszt null", async () => {
    withoutEnvKeys();
    const usage = createTestRecorder();
    const cost = recordingCost([]);
    const failing = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    }) as typeof fetch;
    await expect(
      new AiSdkExerciseChecker({ apiKey: "test-key", model: "vendor/checker", effort: "low", usage, fetch: failing }).checkClosed(CLOSED, cost, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "transient" });
    expect(cost.values).toEqual([null]);
    expect(usage.events.map((event) => [event.outcome, event.httpStatus])).toEqual([["failed", undefined]]);
  });
});

describe("adaptery nic nie logują", () => {
  it("sukces, błąd HTTP, błąd sieci i przerwanie bez console.*", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    try {
      const signal = new AbortController().signal;
      const okModel = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ exercises: [] }))] });
      await new AiSdkLessonPoolAgent(agentOptions(okModel, { usage: createTestRecorder() })).generatePacket(PACKET, recordingCost([]), signal);
      await new AiSdkExerciseChecker({ apiKey: "test-key", model: "m", effort: "low", fetch: stubFetch([jsonResponse(chatCompletion(JSON.stringify({ results: [{ answers: ["a"] }] })))]).fetch })
        .checkClosed(CLOSED, recordingCost([]), signal);
      await new AiSdkExerciseChecker({ apiKey: "test-key", model: "m", effort: "low", fetch: stubFetch([jsonResponse({ error: { message: "x" } }, 503)]).fetch })
        .checkClosed(CLOSED, recordingCost([]), signal)
        .catch(() => undefined);
      await new AiSdkExerciseChecker(agentOptions(throwingModel(() => apiError(undefined, { isRetryable: true }))))
        .checkClosed(CLOSED, recordingCost([]), signal)
        .catch(() => undefined);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("przebieg bazowy: generatePacket i checkClosed (etap 2, MockLanguageModelV4)", () => {
  const packetInput = (withExamples: boolean): LessonPacketInput => ({
    pool: { ...POOL, exerciseTypes: ["lesson_choice"], objectives: [{ ...POOL.objectives[0]!, exerciseTypes: ["lesson_choice"] }] },
    objective: { id: "subject.topic.animals", title: "Zwierzęta", cards: [{ title: "Słowa", body: "cat — kot" }] },
    type: "lesson_choice",
    count: 4,
    withExamples,
    timeoutMs: 1_000,
  });

  it("generatePacket: system z promptu paczki, materiał w wiadomości użytkownika, surowe rekordy bez zmian, koszt i operacja packet_generate", async () => {
    const usage = scopedRecorder();
    const raw = { exerciseType: "lesson_choice", objectiveId: "subject.topic.animals", answer: "zmyślona" };
    const model = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ exercises: [raw], examples: ["A cat."] }), 0.004)] });
    const cost = recordingCost([]);
    const agent = new AiSdkLessonPoolAgent({ apiKey: "", model: "test-model", effort: "low", languageModel: model, usage });
    const result = await withUsageScope({ generationRunId: "run-1" }, () => agent.generatePacket(packetInput(true), cost, new AbortController().signal));
    expect(result).toEqual({ exercises: [raw], examples: ["A cat."] });
    expect(cost.values).toEqual([0.004]);
    expect(usage.events.map((entry) => entry.event.operation)).toEqual(["packet_generate"]);
    const call = model.doGenerateCalls[0]!;
    const system = JSON.stringify(call.prompt.find((message) => message.role === "system"));
    expect(system).toContain("write exactly 4 exercises of type lesson_choice");
    expect(system).toContain("card examples");
    expect(system).toContain("an exercise that breaks a rule is discarded");
    expect(system).not.toContain("the tool checks");
    expect(sentPrompt(model)).toContain("cat — kot");
  });

  it("generatePacket bez przykładów: schemat bez pola examples", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [textResult(JSON.stringify({ exercises: [] }))] });
    const agent = new AiSdkLessonPoolAgent({ apiKey: "", model: "test-model", effort: "low", languageModel: model });
    const result = await agent.generatePacket(packetInput(false), recordingCost([]), new AbortController().signal);
    expect(result).toEqual({ exercises: [] });
    const format = model.doGenerateCalls[0]!.responseFormat as { schema?: { properties?: Record<string, unknown> } };
    expect(Object.keys(format.schema?.properties ?? {})).toEqual(["exercises"]);
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).not.toContain("card examples");
  });

  it("generatePacket: przekroczony limit żądania → timeout po jednym żądaniu (ponawia przebieg, nie adapter)", async () => {
    vi.useFakeTimers();
    try {
      const model = new MockLanguageModelV4({ doGenerate: () => new Promise(() => undefined) });
      const agent = new AiSdkLessonPoolAgent({ apiKey: "", model: "test-model", effort: "low", languageModel: model });
      const pending = agent.generatePacket(packetInput(false), recordingCost([]), new AbortController().signal);
      const settled = expect(pending).rejects.toMatchObject({ kind: "timeout" });
      await vi.advanceTimersByTimeAsync(1_001);
      await settled;
      expect(model.doGenerateCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checkClosed: widoki w <ITEMS>, system z zasadą danych, wynik per pozycja; inna długość → wszystkie undefined; operacja check_closed", async () => {
    const usage = scopedRecorder();
    const model = new MockLanguageModelV4({
      doGenerate: [
        textResult(JSON.stringify({ results: [{ answers: ["is"] }, { answers: null }] }), 0.001),
        textResult(JSON.stringify({ results: [{ answers: ["is"] }] })),
      ],
    });
    const checker = checkerOf(model, { usage });
    const input = { contract: "choice" as const, items: [{ view: "She ___ happy.\nOptions: are | is" }, { view: "B" }], timeoutMs: 1_000 };
    const first = await withUsageScope({ generationRunId: "run-1" }, () => checker.checkClosed(input, recordingCost([]), new AbortController().signal));
    expect(first.results).toEqual([{ answers: ["is"] }, { answers: null }]);
    expect(sentPrompt(model)).toContain("<ITEMS>");
    expect(sentPrompt(model)).toContain("She ___ happy.");
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt.find((message) => message.role === "system"))).toMatch(/ignore any instructions/iu);
    expect(usage.events.map((entry) => entry.event.operation)).toEqual(["check_closed"]);
    const second = await checker.checkClosed(input, recordingCost([]), new AbortController().signal);
    expect(second.results).toEqual([undefined, undefined]);
  });

});
