import { ORPCError } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";
import { ApiCallError } from "./api";
import { createParentQueryClient, httpStatusOf, shouldRetryQuery } from "./query-client";

function orpcError(status: number): ORPCError<string, unknown> {
  return new ORPCError("UNAUTHORIZED", { data: { envelope: { code: "unauthorized" }, status } });
}

describe("httpStatusOf", () => {
  it("reads the status of normalized and raw client errors", () => {
    expect(httpStatusOf(new ApiCallError("x", "unauthorized", 401))).toBe(401);
    expect(httpStatusOf(orpcError(409))).toBe(409);
  });

  it("has no status for network failures", () => {
    expect(httpStatusOf(new TypeError("Failed to fetch"))).toBeUndefined();
  });
});

describe("shouldRetryQuery", () => {
  it("does not retry client errors", () => {
    expect(shouldRetryQuery(0, orpcError(401))).toBe(false);
    expect(shouldRetryQuery(0, new ApiCallError("x", "not_found", 404))).toBe(false);
  });

  it("retries network failures and server errors a limited number of times", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(1, orpcError(503))).toBe(true);
    expect(shouldRetryQuery(2, orpcError(503))).toBe(false);
  });
});

describe("createParentQueryClient", () => {
  it("reports an expired session from a query", async () => {
    const onAuthExpired = vi.fn();
    const client = createParentQueryClient(onAuthExpired);
    await client
      .fetchQuery({ queryKey: ["q"], queryFn: () => Promise.reject(orpcError(401)) })
      .catch(() => undefined);
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
  });

  it("reports an expired session from a mutation without retrying it", async () => {
    const onAuthExpired = vi.fn();
    const mutationFn = vi.fn(() => Promise.reject(new ApiCallError("x", "unauthorized", 401)));
    const client = createParentQueryClient(onAuthExpired);
    await client.getMutationCache().build(client, { mutationFn }).execute(undefined).catch(() => undefined);
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
  });

  it("runs mutations offline instead of pausing them until the network returns", () => {
    const client = createParentQueryClient(vi.fn());
    expect(client.getDefaultOptions().mutations).toMatchObject({ retry: false, networkMode: "always" });
  });

  it("ignores other errors", async () => {
    const onAuthExpired = vi.fn();
    const client = createParentQueryClient(onAuthExpired);
    await client
      .fetchQuery({ queryKey: ["q"], queryFn: () => Promise.reject(orpcError(403)) })
      .catch(() => undefined);
    expect(onAuthExpired).not.toHaveBeenCalled();
  });
});
