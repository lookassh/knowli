import { describe, expect, it } from "vitest";
import { requestHashOf } from "./attempt-shared";

const TASK = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";

describe("requestHashOf", () => {
  it("treats a keyword selection as an unordered set", () => {
    const first = requestHashOf({ taskId: TASK, clientAttemptId: CLIENT, modality: "selection", itemIds: [A, B] });
    expect(requestHashOf({ taskId: TASK, clientAttemptId: CLIENT, modality: "selection", itemIds: [B, A] })).toBe(first);
    expect(requestHashOf({ taskId: TASK, clientAttemptId: CLIENT, modality: "selection", itemIds: [A] })).not.toBe(first);
  });

  it("keeps order significant for sequences", () => {
    const first = requestHashOf({ taskId: TASK, clientAttemptId: CLIENT, modality: "sequence", itemIds: [A, B] });
    expect(requestHashOf({ taskId: TASK, clientAttemptId: CLIENT, modality: "sequence", itemIds: [B, A] })).not.toBe(first);
  });
});
