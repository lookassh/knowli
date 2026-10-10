import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMockTestPlan } from "./mock-test-plan";
import type { MockTestCandidate } from "./mock-test-types";
function candidates(n: number): MockTestCandidate[] {
  return Array.from({ length: n }, (_, position) => ({ itemId: randomUUID(), itemRevisionId: randomUUID(), position,
    source: `znaczenie ${position}`, target: `word${position}`, targetKey: `key${position}`, acceptedAnswers: [], known: true,
    audioAssetId: randomUUID(), skills: { recall: { skillVersionId: randomUUID(), priority: 0 }, spelling: { skillVersionId: randomUUID(), priority: 1 }, listening: { skillVersionId: randomUUID(), priority: 0 } } }));
}
describe("mock test plan", () => {
  it.each([1, 7, 10, 25, 100])("uses configured count %i with mixed goals", requestedTaskCount => {
    const plan = buildMockTestPlan({ testGoals: ["recall", "spelling", "listening"], testDate: null, requestedTaskCount, candidates: candidates(50), newId: randomUUID });
    expect(plan.slots).toHaveLength(requestedTaskCount);
    expect(plan.slots.filter(s => s.exerciseType === "recall")).toHaveLength(Math.ceil(requestedTaskCount / 2));
    expect(plan.slots.filter(s => s.exerciseType === "listening")).toHaveLength(Math.floor(requestedTaskCount / 2));
    const firstAudio = plan.slots.findIndex(s => s.exerciseType === "listening");
    if (firstAudio >= 0) expect(plan.slots.slice(firstAudio).every(s => s.exerciseType === "listening")).toBe(true);
    expect(new Set(plan.slots.map(s => `${s.itemId}:${s.exerciseType}`)).size).toBe(requestedTaskCount);
    expect(plan.scope).toHaveLength(50);
  });
  it("one written answer has two goals and insufficient audio transfers slots", () => {
    const pool = candidates(20).map(c => ({ ...c, audioAssetId: null }));
    const plan = buildMockTestPlan({ testGoals: ["recall", "spelling", "listening"], testDate: null, requestedTaskCount: 7, candidates: pool, newId: randomUUID });
    expect(plan.slots).toHaveLength(7);
    expect(plan.slots.every(s => s.goals.join(",") === "recall,spelling")).toBe(true);
    expect(plan.scope[0]!.unavailable.listening).toBe("missing_audio");
  });
  it("keeps unknown material and duplicate meanings out of listening", () => {
    const pool = candidates(3).map(c => ({ ...c, source: "to samo" }));
    pool[0]!.known = false;
    const plan = buildMockTestPlan({ testGoals: ["listening"], testDate: null, requestedTaskCount: 10, candidates: pool, newId: randomUUID });
    expect(plan.slots).toEqual([]);
    expect(plan.scope).toHaveLength(3);
    expect(plan.scope[0]!.unavailable.listening).toBe("not_known");
    expect(plan.scope[1]!.unavailable.listening).toBe("insufficient_options");
  });
  it("prioritizes unchecked skills then difficulties and preserves singleton writing", () => {
    const pool = candidates(3);
    pool[0]!.skills.recall!.priority = 2;
    pool[1]!.skills.recall!.priority = 1;
    const p = buildMockTestPlan({ testGoals: ["recall"], testDate: null, requestedTaskCount: 2, candidates: pool, newId: randomUUID });
    expect(p.slots.map(s => s.itemId)).toEqual([pool[2]!.itemId, pool[1]!.itemId]);
    expect(buildMockTestPlan({ testGoals: ["spelling"], testDate: null, requestedTaskCount: 10, candidates: pool.slice(0, 1), newId: randomUUID }).slots).toHaveLength(1);
  });
});
