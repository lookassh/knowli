import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, createDrizzleUsageRecorder } from "@learning/server";
import { shutdownWorker } from "./shutdown";

describe("shutdownWorker", () => {
  it("shutdown flushes usage before closing pool", async () => {
    const order: string[] = [];
    // Każdy krok kończy się dopiero po mikrozadaniu: następny nie może ruszyć przed jego końcem.
    const step = (name: string) => async () => {
      order.push(`${name}:start`);
      await Promise.resolve();
      order.push(`${name}:end`);
    };

    await shutdownWorker({
      loop: { stop: step("loop.stop") },
      usage: { record: () => {}, flush: step("usage.flush") },
      pool: { end: step("pool.end") },
    });

    expect(order).toEqual([
      "loop.stop:start", "loop.stop:end",
      "usage.flush:start", "usage.flush:end",
      "pool.end:start", "pool.end:end",
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the pool even when flushing usage fails and logs only the step and code", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    await shutdownWorker({
      loop: { stop: async () => { order.push("loop.stop"); } },
      usage: { record: () => {}, flush: async () => { throw Object.assign(new Error("flush failed: secret payload"), { code: "57P01" }); } },
      pool: { end: async () => { order.push("pool.end"); } },
    });
    expect(order).toEqual(["loop.stop", "pool.end"]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith("[worker] shutdown step failed", { step: "usage.flush", code: "57P01" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret payload");
  });

  it("logs a failed loop stop by error class when there is no code", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    await shutdownWorker({
      loop: { stop: async () => { throw new TypeError("loop exploded"); } },
      usage: { record: () => {}, flush: async () => { order.push("usage.flush"); } },
      pool: { end: async () => { order.push("pool.end"); } },
    });
    expect(order).toEqual(["usage.flush", "pool.end"]);
    expect(errors).toHaveBeenCalledWith("[worker] shutdown step failed", { step: "loop.stop", code: "TypeError" });
  });

  it("finishes in bounded time when the database accepts connections but never answers (#410)", async () => {
    // Zawieszona baza: TCP przyjmuje połączenie i milczy (bez odpowiedzi na startup).
    const sockets: Socket[] = [];
    const server: Server = createServer((socket) => { sockets.push(socket); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const { db, pool } = createDatabase(`postgres://u:p@127.0.0.1:${port}/x`, { connectionTimeoutMillis: 300 });
      const logged: string[] = [];
      const usage = createDrizzleUsageRecorder({
        db, clock: { now: () => new Date() }, prices: {}, log: (code) => logged.push(code), flushTimeoutMs: 50,
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      usage.record({ feature: "answer_grading", provider: "openrouter", outcome: "ok" });

      const started = Date.now();
      await shutdownWorker({ loop: { stop: async () => {} }, usage, pool });

      expect(Date.now() - started).toBeLessThan(3000);
      expect(logged).toContain("usage_flush_timeout");
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);

  it("stops waiting for pool.end after its deadline and logs only the step and code", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await shutdownWorker({
      loop: { stop: async () => {} },
      usage: { record: () => {}, flush: async () => {} },
      // Klient zajęty zapytaniem do zamrożonej bazy: pula nigdy się nie zamyka.
      pool: { end: () => new Promise<void>(() => {}) },
      poolEndTimeoutMs: 20,
    });
    expect(errors).toHaveBeenCalledExactlyOnceWith("[worker] shutdown step failed", { step: "pool.end", code: "timeout" });
  });
});
