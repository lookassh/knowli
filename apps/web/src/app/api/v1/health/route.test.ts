import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/composition", () => ({
  getServerServices: vi.fn(() => ({ db: { $client: { query } } }) as never),
}));

import { GET } from "./route";

describe("health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    query.mockReset();
  });

  it("answers ok without the E2E readiness header outside E2E", async () => {
    vi.stubEnv("UMIEM_E2E_READY_TOKEN", "");
    query.mockResolvedValue({});
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-umiem-e2e-ready")).toBeNull();
  });

  it("echoes the E2E readiness token so setup can tell its own server from a parallel run's", async () => {
    vi.stubEnv("UMIEM_E2E_READY_TOKEN", "token-123");
    query.mockResolvedValue({});
    const response = await GET();
    expect(response.headers.get("x-umiem-e2e-ready")).toBe("token-123");
  });

  it("reports 503 without the readiness header when the database is down", async () => {
    vi.stubEnv("UMIEM_E2E_READY_TOKEN", "token-123");
    query.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("x-umiem-e2e-ready")).toBeNull();
  });
});
