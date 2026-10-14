import { describe, expect, it } from "vitest";
import { selectFairWorkerWork, type WorkKind } from "./worker-schedule";

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
});
