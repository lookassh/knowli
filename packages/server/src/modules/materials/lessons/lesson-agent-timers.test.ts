import { afterEach, describe, expect, it, vi } from "vitest";
import { deadlineSignal, Semaphore } from "./lesson-agent-timers";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("Semaphore i deadlineSignal", () => {
  it("najwyżej `limit` zadań naraz, kolejka FIFO", async () => {
    const semaphore = new Semaphore(2);
    const gate = deferred();
    const order: number[] = [];
    const runs = [1, 2, 3, 4].map((n) =>
      semaphore.run(async () => {
        order.push(n);
        await gate.promise;
        return n;
      }),
    );
    await flush();
    expect(order).toEqual([1, 2]);
    gate.resolve();
    expect(await Promise.all(runs)).toEqual([1, 2, 3, 4]);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(semaphore.maxConcurrent).toBe(2);
  });

  it("błąd zadania zwalnia miejsce", async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await semaphore.run(async () => "ok")).toBe("ok");
  });

  it("termin przerywa z podanym powodem; dispose zdejmuje zegar", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = deadlineSignal(parent.signal, 1_000, "checker_timeout");
    await vi.advanceTimersByTimeAsync(999);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe("checker_timeout");
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);

    const second = deadlineSignal(parent.signal, 1_000, "checker_timeout");
    parent.abort("cancelled");
    expect(second.signal.reason).toBe("cancelled");
    second.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
