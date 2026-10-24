import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, LearningOverviewDtoSchema } from "@learning/contracts";
import { AppError, getLearningOverview, type Services } from "@learning/server";
import { IntegrationReadLimiter } from "./integration-read-limiter";
import { handleLearningMcpRequest, type LearningMcpDependencies } from "./learning-mcp-route";
import { handleLearningOverviewRequest } from "./learning-overview-orpc";

vi.mock("@learning/server", async (load) => {
  const actual = await load<typeof import("@learning/server")>();
  return { ...actual, getLearningOverview: vi.fn() };
});

const services = { clock: { now: () => new Date("2026-10-11T12:00:00Z") } } as Services;
const principal = { id: "token-id", scopes: ["learning:read"] };
const childId = "11111111-1111-4111-8111-111111111111";
/** Minimalne DTO spełniające superRefine LearningOverviewDtoSchema (children: []). */
const payload = {
  schemaVersion: 1,
  learningTimeDefinition: { method: "activity_intervals_v1", maxGapSeconds: 120 },
  generatedAt: "2026-10-11T12:00:00.000Z",
  timezone: "Europe/Warsaw",
  period: { from: "2026-10-05", to: "2026-10-11", days: 7 },
  plannedTestsPeriod: { from: "2026-10-11", to: "2026-10-24", days: 14 },
  children: [],
};

function call(path: string, init?: RequestInit, limiter?: IntegrationReadLimiter): Promise<Response> {
  return handleLearningOverviewRequest(
    new Request(`https://local/api/v1/integrations${path}`, init),
    services,
    limiter,
  );
}

async function expectError(response: Response, status: number, code: string, retryable: boolean) {
  expect(response.status).toBe(status);
  const body = ApiErrorSchema.parse(await response.json());
  expect(body.code).toBe(code);
  expect(body.retryable).toBe(retryable);
  return body;
}

beforeEach(() => vi.clearAllMocks());

describe("learning overview oRPC boundary", () => {
  it("returns a no-store DTO for a valid Bearer and passes coerced query with the raw token", async () => {
    vi.mocked(getLearningOverview).mockResolvedValue(payload as never);

    const response = await call("/learning-overview?days=3", { headers: { authorization: "Bearer umiem_secret" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(LearningOverviewDtoSchema.parse(await response.json())).toEqual(payload);
    expect(getLearningOverview).toHaveBeenCalledWith(services, { days: 3, upcomingTestDays: 14 }, "umiem_secret", expect.any(Function));
  });

  it("defaults query bounds and forwards a valid childId", async () => {
    vi.mocked(getLearningOverview).mockResolvedValue(payload as never);

    const response = await call(`/learning-overview?childId=${childId}`, { headers: { authorization: "Bearer t" } });

    expect(response.status).toBe(200);
    expect(getLearningOverview).toHaveBeenCalledWith(services, { days: 7, upcomingTestDays: 14, childId }, "t", expect.any(Function));
  });

  it("rejects missing, malformed and invalid Bearer credentials with 401 no-store envelopes", async () => {
    const missing = await call("/learning-overview");
    await expectError(missing, 401, "unauthorized", false);
    expect(missing.headers.get("cache-control")).toBe("no-store, max-age=0");

    const malformed = await call("/learning-overview", { headers: { authorization: "Token abc" } });
    await expectError(malformed, 401, "unauthorized", false);

    const cookieOnly = await call("/learning-overview", { headers: { cookie: "parent_session=x" } });
    await expectError(cookieOnly, 401, "unauthorized", false);

    vi.mocked(getLearningOverview).mockRejectedValue(new AppError("unauthorized"));
    const invalidToken = await call("/learning-overview", { headers: { authorization: "Bearer revoked" } });
    await expectError(invalidToken, 401, "unauthorized", false);
    expect(getLearningOverview).toHaveBeenCalledTimes(1);
  });

  it("keeps Bearer precedence over query validation like the legacy handler", async () => {
    const response = await call("/learning-overview?days=abc", { headers: { authorization: "Token abc" } });
    await expectError(response, 401, "unauthorized", false);
    expect(getLearningOverview).not.toHaveBeenCalled();
  });

  it("rejects malformed query values with a 400 validation envelope", async () => {
    const cases = [
      "/learning-overview?days=abc",
      "/learning-overview?days=",
      "/learning-overview?days=3&days=4",
      "/learning-overview?days=32",
      "/learning-overview?upcomingTestDays=0",
      `/learning-overview?childId=not-a-uuid`,
      "/learning-overview?unknown=1",
    ];
    for (const path of cases) {
      const response = await call(path, { headers: { authorization: "Bearer t" } });
      await expectError(response, 400, "validation", false);
    }
    expect(getLearningOverview).not.toHaveBeenCalled();
  });

  it("answers non-GET methods with a 404 not_found envelope regardless of credentials", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      const anonymous = await call("/learning-overview", { method });
      await expectError(anonymous, 404, "not_found", false);
      const bearer = await call("/learning-overview", { method, headers: { authorization: "Bearer t" } });
      await expectError(bearer, 404, "not_found", false);
    }
    expect(getLearningOverview).not.toHaveBeenCalled();
  });

  it("surfaces a use-case not_found for an unknown child as 404", async () => {
    vi.mocked(getLearningOverview).mockRejectedValue(new AppError("not_found"));
    const response = await call(`/learning-overview?childId=${childId}`, { headers: { authorization: "Bearer t" } });
    await expectError(response, 404, "not_found", false);
  });

  it("enforces a per-token minute window on the REST boundary and reports Retry-After", async () => {
    vi.mocked(getLearningOverview).mockImplementation(async (_services, _query, _token, onAuthenticated) => {
      onAuthenticated?.(principal as never);
      return payload as never;
    });
    const limiter = new IntegrationReadLimiter(1);

    const first = await call("/learning-overview", { headers: { authorization: "Bearer t" } }, limiter);
    expect(first.status).toBe(200);

    const second = await call("/learning-overview", { headers: { authorization: "Bearer t" } }, limiter);
    await expectError(second, 429, "rate_limited", true);
    expect(second.headers.get("retry-after")).toBe("60");
    expect(second.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("maps driver failures to learning_summary_unavailable without leaking internals", async () => {
    vi.mocked(getLearningOverview).mockRejectedValue(Object.assign(new Error("select * from family; token=very-secret"), { code: "57014" }));

    const response = await call("/learning-overview", { headers: { authorization: "Bearer very-secret" } });
    const raw = await response.text();
    // Jedyna świadoma dywergencja od legacy: retryable pochodzi ze wspólnej
    // koperty oRPC/withApi (true tylko dla rate_limited/internal), a nie z
    // profilu AppError (true). Status 503 i kod bez zmian; Hermes czyta status.
    expect(response.status).toBe(503);
    expect(ApiErrorSchema.parse(JSON.parse(raw))).toMatchObject({ code: "learning_summary_unavailable", retryable: false });
    expect(raw).not.toContain("select");
    expect(raw).not.toContain("very-secret");
  });

  it("shares one per-token limit across the REST and MCP read endpoints", async () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    const limiter = new IntegrationReadLimiter(1);
    vi.mocked(getLearningOverview).mockImplementation(async (_services, _query, _token, onAuthenticated) => {
      onAuthenticated?.(principal as never);
      return payload as never;
    });
    const rest = await call("/learning-overview", { headers: { authorization: "Bearer shared-token" } }, limiter);
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

  it("keeps the limiter window semantics (minute bucket, Retry-After, reset)", () => {
    const limiter = new IntegrationReadLimiter(60);
    const now = Date.parse("2026-10-11T12:00:00Z");
    for (let i = 0; i < 60; i += 1) limiter.consume(principal, now);
    expect(() => limiter.consume(principal, now)).toThrow();
    expect(limiter.retryAfterSeconds(principal, now)).toBe(60);
    limiter.consume(principal, now + 60_000);
  });
});
