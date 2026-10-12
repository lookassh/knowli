import { describe, expect, it, vi } from "vitest";
import { AppError, type IntegrationPrincipal } from "@learning/server";
import { handleLearningMcpRequest, type LearningMcpDependencies } from "./learning-mcp-route";
import { IntegrationReadLimiter } from "./integration-read-limiter";

const principal: IntegrationPrincipal = { id: "token-a", scopes: ["learning:read"] };
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const rpc = (method: string, id: number | string | null = 1, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

function makeDeps(overrides: Partial<LearningMcpDependencies> = {}): LearningMcpDependencies {
  return {
    authenticate: vi.fn(async () => principal),
    readOverview: vi.fn(async () => ({ schemaVersion: 1, timezone: "Europe/Warsaw", children: [] })),
    limiter: new IntegrationReadLimiter(),
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
    expect(await response.text()).not.toContain("private database info");
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
});
