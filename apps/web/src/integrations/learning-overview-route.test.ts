import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "@learning/server";
import { getLearningOverview } from "@learning/server";
import { IntegrationReadLimiter, handleLearningOverviewRequest } from "./learning-overview-route";
import { handleLearningMcpRequest, type LearningMcpDependencies } from "./learning-mcp-route";

vi.mock("@learning/server", async (load) => {
  const actual = await load<typeof import("@learning/server")>();
  return { ...actual, getLearningOverview: vi.fn() };
});

const services = { clock: { now: () => new Date("2026-10-11T12:00:00Z") } } as Services;
const principal = { id: "token-id", scopes: ["learning:read"] };
const payload = { schemaVersion: 1, timezone: "Europe/Warsaw", children: [] };

describe("learning overview HTTP boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a private no-store JSON response and passes parsed query", async () => {
    vi.mocked(getLearningOverview).mockResolvedValue(payload as never);
    const response = await handleLearningOverviewRequest(new Request("https://local/api/v1/integrations/learning-overview?days=3", {
      headers: { authorization: "Bearer umiem_secret" },
    }), services, new IntegrationReadLimiter());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(payload);
    expect(getLearningOverview).toHaveBeenCalledWith(services, { days: 3, upcomingTestDays: 14 }, "umiem_secret", expect.any(Function));
  });

  it("rejects cookies, malformed/duplicate query values, and hides internal driver details", async () => {
    const cookie = await handleLearningOverviewRequest(new Request("https://local/api?days=3", { headers: { cookie: "parent_session=x" } }), services, new IntegrationReadLimiter());
    const duplicate = await handleLearningOverviewRequest(new Request("https://local/api?days=3&days=4", { headers: { authorization: "Bearer secret" } }), services, new IntegrationReadLimiter());
    expect(cookie.status).toBe(401);
    expect(duplicate.status).toBe(400);
    expect(cookie.headers.get("cache-control")).toContain("no-store");

    vi.mocked(getLearningOverview).mockRejectedValue(Object.assign(new Error("select * from family; token=very-secret"), { code: "57014" }));
    const internal = await handleLearningOverviewRequest(new Request("https://local/api", { headers: { authorization: "Bearer very-secret" } }), services, new IntegrationReadLimiter());
    const body = await internal.text();
    expect(internal.status).toBe(503);
    expect(body).not.toContain("select");
    expect(body).not.toContain("very-secret");
  });

  it("enforces a per-token minute window and reports Retry-After", async () => {
    const limiter = new IntegrationReadLimiter(60);
    const now = Date.parse("2026-10-11T12:00:00Z");
    for (let i = 0; i < 60; i += 1) limiter.consume(principal, now);
    expect(() => limiter.consume(principal, now)).toThrow();
    expect(limiter.retryAfterSeconds(principal, now)).toBe(60);
    limiter.consume(principal, now + 60_000);
  });

  it("shares one per-token limit across the REST and MCP read endpoints", async () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    const limiter = new IntegrationReadLimiter(1);
    vi.mocked(getLearningOverview).mockImplementation(async (_services, _query, _token, onAuthenticated) => {
      onAuthenticated?.(principal as never);
      return payload as never;
    });
    const rest = await handleLearningOverviewRequest(new Request("https://local/api/v1/integrations/learning-overview", {
      headers: { authorization: "Bearer shared-token" },
    }), services, limiter);
    expect(rest.status).toBe(200);

    const mcpDependencies: LearningMcpDependencies = {
      authenticate: vi.fn(async () => principal as never),
      readOverview: vi.fn(async () => payload),
      limiter,
      allowedOrigins: new Set(),
      now: () => now,
      requestId: () => "request-id",
    };
    const mcp = await handleLearningMcpRequest(new Request("https://local/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer shared-token", "content-type": "application/json",
        accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" },
      } }),
    }), mcpDependencies);

    expect(mcp.status).toBe(429);
    expect((await mcp.json()).error.code).toBe(-32029);
    expect(mcpDependencies.readOverview).not.toHaveBeenCalled();
  });
});
