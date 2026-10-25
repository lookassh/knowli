import { describe, expect, it } from "vitest";
import { runWorkerSlots, selectFairWorkerWork, workerAttemptKey, workerIdFromAttemptKey, type WorkKind } from "./worker-schedule";

const limits: Record<WorkKind, number> = { deck: 2, lesson: 2, tts: 2, illustration: 1 };

describe("selectFairWorkerWork", () => {
  it("rotates across queues while respecting the process-wide task limit", () => {
    const queues = {
      deck: ["d1", "d2"], lesson: ["l1", "l2"], tts: ["t1", "t2"], illustration: ["i1", "i2"],
    };
    const first = selectFairWorkerWork(queues, limits, 2, 0);
    expect(first.work).toEqual([{ kind: "deck", value: "d1" }, { kind: "lesson", value: "l1" }]);
    const second = selectFairWorkerWork(queues, limits, 2, first.nextCursor);
    expect(second.work).toEqual([{ kind: "tts", value: "t1" }, { kind: "illustration", value: "i1" }]);
  });

  it("never schedules more than one image and fills available slots from other queues", () => {
    const selected = selectFairWorkerWork({
      deck: ["d1", "d2"], lesson: ["l1"], tts: ["t1"], illustration: ["i1", "i2"],
    }, limits, 4, 3);
    expect(selected.work.filter((item) => item.kind === "illustration")).toHaveLength(1);
    expect(selected.work).toHaveLength(4);
  });

  it("returns fewer tasks when all due queues are empty", () => {
    const selected = selectFairWorkerWork({ deck: [], lesson: [], tts: [], illustration: [] }, limits, 2, 0);
    expect(selected.work).toEqual([]);
  });

  it("refills a free slot while another task from the same pass is still running", async () => {
    const queue = ["A", "B", "C"];
    const started: string[] = [];
    let finishA!: () => void;
    let finishB!: () => void;
    const heldA = new Promise<void>((resolve) => { finishA = resolve; });
    const heldB = new Promise<void>((resolve) => { finishB = resolve; });
    const run = runWorkerSlots<string>({
      concurrency: 2,
      loadNext: async (active) => {
        const next = queue.find((key) => !active.some((item) => item.key === key));
        if (next) queue.splice(queue.indexOf(next), 1);
        return next ? { key: next, kind: "lesson" as const, value: next } : undefined;
      },
      execute: async ({ value }) => {
        started.push(value);
        if (value === "A") await heldA;
        if (value === "B") await heldB;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    finishB();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refilledBeforeAFinished = started.includes("C");
    finishA();
    expect(await run).toBe(3);
    expect(refilledBeforeAFinished).toBe(true);
  });

  it("polls an unused slot for newly enqueued work while another task is held", async () => {
    const queue = ["A"];
    const started: string[] = [];
    let finishA!: () => void;
    const heldA = new Promise<void>((resolve) => { finishA = resolve; });
    const run = runWorkerSlots<string>({
      concurrency: 2,
      refillPollMs: 5,
      loadNext: async (active, seenKeys) => {
        const next = queue.find((key) => !seenKeys.has(key) && !active.some((item) => item.key === key));
        if (next) queue.splice(queue.indexOf(next), 1);
        return next ? { key: next, kind: "tts" as const, value: next } : undefined;
      },
      execute: async ({ value }) => {
        started.push(value);
        if (value === "A") await heldA;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.push("B");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedBeforeAFinished = started.includes("B");
    finishA();
    expect(await run).toBe(2);
    expect(startedBeforeAFinished).toBe(true);
  });

  it("retries a due attempt in a free slot while another task remains held", async () => {
    const queue = [
      { id: "A", attempt: 0 },
      { id: "B", attempt: 0 },
    ];
    const started: string[] = [];
    let finishB!: () => void;
    let announceRetry!: () => void;
    const heldB = new Promise<void>((resolve) => { finishB = resolve; });
    const retryStarted = new Promise<void>((resolve) => { announceRetry = resolve; });
    const run = runWorkerSlots<{ id: string; attempt: number }>({
      concurrency: 2,
      loadNext: async (active, seenKeys) => {
        const next = queue.find(({ id, attempt }) =>
          !seenKeys.has(workerAttemptKey(id, attempt)) && !active.some((item) => item.value.id === id),
        );
        if (next) queue.splice(queue.indexOf(next), 1);
        return next ? {
          key: workerAttemptKey(next.id, next.attempt),
          kind: "lesson" as const,
          value: next,
        } : undefined;
      },
      execute: async ({ value }) => {
        started.push(`${value.id}:${value.attempt}`);
        if (value.id === "A" && value.attempt === 0) {
          queue.push({ id: "A", attempt: 1 });
          return;
        }
        if (value.id === "A" && value.attempt === 1) announceRetry();
        if (value.id === "B") await heldB;
      },
    });
    await retryStarted;
    expect(started).toContain("A:1");
    expect(started).not.toContain("B:1");
    finishB();
    expect(await run).toBe(3);
    expect(workerIdFromAttemptKey(workerAttemptKey("run-id", 2))).toBe("run-id");
  });

  it("observes a manual retry that resets the same attempt key during a held task", async () => {
    const queue = [
      { id: "A", attempt: 0 },
      { id: "B", attempt: 0 },
    ];
    let attemptsA = 0;
    let finishB!: () => void;
    let announceManualRetry!: () => void;
    const heldB = new Promise<void>((resolve) => { finishB = resolve; });
    const manualRetryStarted = new Promise<void>((resolve) => { announceManualRetry = resolve; });
    const run = runWorkerSlots<{ id: string; attempt: number }>({
      concurrency: 2,
      refillPollMs: 5,
      loadNext: async (active, seenKeys) => {
        const next = queue.find(({ id, attempt }) =>
          !seenKeys.has(workerAttemptKey(id, attempt)) && !active.some((item) => item.value.id === id),
        );
        if (next) queue.splice(queue.indexOf(next), 1);
        return next ? { key: workerAttemptKey(next.id, next.attempt), kind: "lesson" as const, value: next } : undefined;
      },
      execute: async ({ value }) => {
        if (value.id === "A") {
          attemptsA += 1;
          if (attemptsA === 1) {
            // Parent retry resets the attempts field to zero, so its key is A:0 again.
            setTimeout(() => queue.push({ id: "A", attempt: 0 }), 0);
          } else {
            announceManualRetry();
          }
        } else if (value.id === "B") {
          await heldB;
        }
      },
    });
    await manualRetryStarted;
    expect(attemptsA).toBe(2);
    finishB();
    expect(await run).toBe(3);
  });
});
