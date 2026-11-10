import { describe, expect, it, vi } from "vitest";
import { AppError, type IntegrationPrincipal } from "@learning/server";
import sampleOverview from "../../../../docs/superpowers/specs/2026-10-11-hermes-learning-overview.example.json";
import { handleLearningMcpRequest, type LearningMcpDependencies } from "./learning-mcp-route";
import { IntegrationReadLimiter } from "./integration-read-limiter";

const principal: IntegrationPrincipal = { id: "token-a", scopes: ["learning:read"] };
const writer: IntegrationPrincipal = { id: "token-w", scopes: ["lessons:write"] };
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const rpc = (method: string, id: number | string | null = 1, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

function makeDeps(overrides: Partial<LearningMcpDependencies> = {}): LearningMcpDependencies {
  return {
    authenticate: vi.fn(async () => principal),
    readOverview: vi.fn(async () => ({ schemaVersion: 1, timezone: "Europe/Warsaw", children: [] })),
    lessonAuthoring: () => ({
      catalog: vi.fn(async () => ({})),
      validate: vi.fn(async () => ({ ok: true, exercises: [], coverage: [], exposureLeaks: [], story: [] })),
      create: vi.fn(async () => ({ deckId: requestId, draftId: requestId, editNumber: 1, coverage: [], exposureLeaks: [] })),
      get: vi.fn(async () => ({})),
      replace: vi.fn(async () => ({})),
    }),
    limiter: new IntegrationReadLimiter(),
    writeLimiter: new IntegrationReadLimiter(10, 3_600_000),
    allowedOrigins: new Set(),
    now: () => 1_000,
    makeServer: undefined,
    requestId: () => requestId,
    ...overrides,
  } as LearningMcpDependencies;
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/mcp", {
    method: "POST",
    headers: { authorization: "Bearer umiem_token", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Streamable HTTP MCP boundary", () => {
  it("requires bearer auth and returns private headers without exposing auth errors", async () => {
    const deps = makeDeps({ authenticate: vi.fn(async () => { throw new AppError("unauthorized", { message: "private database info" }); }) });
    const response = await handleLearningMcpRequest(post(rpc("initialize")), deps);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    const body = await response.json();
    expect(body).not.toContain("private database info");
    expect(typeof body.error.code).toBe("number");
  });

  it("checks Origin before authentication or reading the request body", async () => {
    const authenticate = vi.fn(async () => principal);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("not read")); controller.close(); } });
    const response = await handleLearningMcpRequest(new Request("https://app.example/api/mcp", {
      method: "POST", headers: { origin: "https://evil.example", authorization: "Bearer token", "content-type": "application/json" }, body, duplex: "half",
    } as RequestInit & { duplex: "half" }), makeDeps({ authenticate, allowedOrigins: new Set(["https://family.example"]) }));
    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("allows absent Origin for server clients and rejects batches and oversized streamed bodies", async () => {
    const deps = makeDeps();
    const batch = await handleLearningMcpRequest(post([rpc("initialize")]), deps);
    expect(batch.status).toBe(400);
    const bytes = new Uint8Array(16_385).fill(32);
    const streamed = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    const large = await handleLearningMcpRequest(new Request("https://app.example/api/mcp", {
      method: "POST", headers: { authorization: "Bearer umiem_token", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: streamed, duplex: "half",
    } as RequestInit & { duplex: "half" }), deps);
    expect(large.status).toBe(413);
    expect(deps.readOverview).not.toHaveBeenCalled();
  });

  it("counts each authenticated HTTP request once and rejects unsupported methods", async () => {
    const limiter = new IntegrationReadLimiter(1);
    const deps = makeDeps({ limiter });
    const init = await handleLearningMcpRequest(post(rpc("initialize")), deps);
    expect(init.status).toBe(200);
    const ping = await handleLearningMcpRequest(post(rpc("ping")), deps);
    expect(ping.status).toBe(429);
    expect(ping.headers.get("retry-after")).toBeTruthy();
    const get = await handleLearningMcpRequest(new Request("https://app.example/api/mcp", { method: "GET", headers: { authorization: "Bearer umiem_token" } }), makeDeps());
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("keeps concurrent requests with the same JSON-RPC id isolated by bearer token", async () => {
    const readOverview = vi.fn(async (_query, rawToken: string) => ({
      ...sampleOverview,
      children: sampleOverview.children.map((child) => ({ ...child, childName: rawToken })),
    }));
    const deps = makeDeps({
      authenticate: vi.fn(async (rawToken) => ({ ...principal, id: rawToken })),
      readOverview,
    });
    const body = rpc("tools/call", "shared-id", {
      name: "umiem_get_learning_overview", arguments: { days: 7, upcomingTestDays: 14 },
    });
    const cases = [
      { token: "token-a", request: post(body, { authorization: "Bearer token-a" }) },
      { token: "token-b", request: post(body, { authorization: "Bearer token-b" }) },
    ];
    const responses = await Promise.all(cases.map(({ request }) => handleLearningMcpRequest(request, deps)));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(readOverview.mock.calls.map(([, rawToken]) => rawToken).sort()).toEqual(["token-a", "token-b"]);
    const payloads = await Promise.all(responses.map(async (response) => response.json()));
    expect(payloads.map((payload) => payload.id)).toEqual(["shared-id", "shared-id"]);
    expect(payloads.map((payload, index) => [cases[index]!.token, payload.result.structuredContent.children[0].childName]))
      .toEqual([["token-a", "token-a"], ["token-b", "token-b"]]);
  });

  it("bounds the full JSON-RPC response even when nested content requires heavy escaping", async () => {
    const overview = JSON.parse(JSON.stringify(sampleOverview)) as typeof sampleOverview;
    overview.children[0]!.childName = '"'.repeat(800_000);
    const response = await handleLearningMcpRequest(post(rpc("tools/call", 7, {
      name: "umiem_get_learning_overview", arguments: { days: 7, upcomingTestDays: 14 },
    })), makeDeps({ readOverview: vi.fn(async () => overview) }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(7);
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain('"'.repeat(100));
  });

  it("lists only the tools of the token scope and answers 403 to a tool of the other scope", async () => {
    const reader = makeDeps();
    const readTools = await (await handleLearningMcpRequest(post(rpc("tools/list")), reader)).json();
    expect(readTools.result.tools.map(({ name }: { name: string }) => name)).toEqual(["umiem_get_learning_overview"]);
    const forbiddenWrite = await handleLearningMcpRequest(post(rpc("tools/call", 1, { name: "lesson_catalog", arguments: {} })), reader);
    expect(forbiddenWrite.status).toBe(403);

    const author = makeDeps({ authenticate: vi.fn(async () => writer) });
    const writeTools = await (await handleLearningMcpRequest(post(rpc("tools/list")), author)).json();
    expect(writeTools.result.tools.map(({ name }: { name: string }) => name).sort())
      .toEqual(["lesson_catalog", "lesson_draft_append", "lesson_draft_create", "lesson_draft_get", "lesson_draft_replace", "lesson_validate"]);
    const forbiddenRead = await handleLearningMcpRequest(post(rpc("tools/call", 1, { name: "umiem_get_learning_overview", arguments: {} })), author);
    expect(forbiddenRead.status).toBe(403);
    expect(author.readOverview).not.toHaveBeenCalled();
  });

  it("limits lesson writes per token per hour separately from dry runs and accepts larger bodies only for lessons:write", async () => {
    const author = makeDeps({ authenticate: vi.fn(async () => writer), writeLimiter: new IntegrationReadLimiter(1, 3_600_000) });
    // Wejście zgodne ze schematem: złe wejście odpada na walidacji przed limitem i niczego nie kosztuje.
    const create = rpc("tools/call", 1, { name: "lesson_draft_create", arguments: {
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", subjectId: "english_grammar", topicId: "present_continuous",
      objectiveIds: ["english_grammar.present_continuous.affirmative"], material: "Fikcyjny materiał.", examples: {},
      exercises: [{ exerciseType: "lesson_gap", objectiveId: "english_grammar.present_continuous.affirmative", stem: "I ___ (eat) now.", answer: "am eating", acceptedAnswers: [], focus: ["am", "eating"] }],
    } });
    const invalid = rpc("tools/call", 3, { name: "lesson_draft_create", arguments: {} });
    const rejected = await (await handleLearningMcpRequest(post(invalid), author)).json();
    expect(JSON.parse(rejected.result.content[0].text)).toMatchObject({ code: "validation" });
    expect((await handleLearningMcpRequest(post(create), author)).status).toBe(200);
    const limited = await handleLearningMcpRequest(post(create), author);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(60);
    expect((await handleLearningMcpRequest(post(rpc("tools/call", 2, { name: "lesson_validate", arguments: { exercises: [] } })), author)).status).toBe(200);

    const padded = (bytes: number) => post(rpc("tools/list", 1, { _meta: { pad: " ".repeat(bytes) } }));
    expect((await handleLearningMcpRequest(padded(100_000), author)).status).toBe(200);
    expect((await handleLearningMcpRequest(padded(512 * 1024), author)).status).toBe(413);
    expect((await handleLearningMcpRequest(padded(100_000), makeDeps())).status).toBe(413);
  });

  it("counts only successful writes: a rule-rejected create keeps the slot, then replace shares the exhausted hourly limit", async () => {
    const objectiveId = "english_grammar.present_continuous.affirmative";
    const exercises = [{ exerciseType: "lesson_gap", objectiveId, stem: "I ___ (eat) now.", answer: "am eating", acceptedAnswers: [], focus: ["am", "eating"] }];
    const create = vi.fn(async () => ({ deckId: requestId, draftId: requestId, editNumber: 1, coverage: [], exposureLeaks: [] }));
    create.mockRejectedValueOnce(new AppError("validation", { details: { exercises: [{ index: 0, issues: [{ rule: "gap.focus", field: "focus", pl: "x" }] }] } }));
    const replace = vi.fn(async () => ({ deckId: requestId, draftId: requestId, editNumber: 2, coverage: [], exposureLeaks: [] }));
    const author = makeDeps({
      authenticate: vi.fn(async () => writer),
      writeLimiter: new IntegrationReadLimiter(1, 3_600_000),
      lessonAuthoring: () => ({ catalog: vi.fn(), validate: vi.fn(), get: vi.fn(), create, replace, append: vi.fn() }),
    });
    const createCall = rpc("tools/call", 1, { name: "lesson_draft_create", arguments: {
      clientRequestId: requestId, subjectId: "english_grammar", topicId: "present_continuous",
      objectiveIds: [objectiveId], material: "Fikcyjny materiał.", examples: {}, exercises,
    } });

    const rejected = await (await handleLearningMcpRequest(post(createCall), author)).json();
    expect(JSON.parse(rejected.result.content[0].text)).toMatchObject({ code: "validation" });
    const created = await (await handleLearningMcpRequest(post(createCall), author)).json();
    expect(created.result.isError).toBeUndefined();

    const replaceCall = rpc("tools/call", 2, { name: "lesson_draft_replace", arguments: { deckId: requestId, expectedEditNumber: 1, exercises } });
    const limited = await handleLearningMcpRequest(post(replaceCall), author);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });
});
