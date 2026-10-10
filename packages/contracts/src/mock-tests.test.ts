import { describe, expect, it } from "vitest";
import { AssignmentPutSchema } from "./decks";

describe("mock test assignment settings", () => {
  it.each([0, 101, 1.5, null])("rejects invalid task count %s", (mockTestTaskCount) => {
    expect(AssignmentPutSchema.safeParse({ testDate: null, mockTestTaskCount }).success).toBe(false);
  });
  it.each([1, 7, 10, 25, 100])("retains configured task count %s", (mockTestTaskCount) => {
    expect(AssignmentPutSchema.parse({ testDate: null, mockTestTaskCount })).toMatchObject({ mockTestTaskCount });
  });
  it.each([[], ["recall", "recall"], ["speech"]].map(testGoals => ({ testGoals })))("rejects invalid goals $testGoals", ({ testGoals }) => {
    expect(AssignmentPutSchema.safeParse({ testDate: null, testGoals }).success).toBe(false);
  });
  it("retains selected goals and explicit disable", () => {
    expect(AssignmentPutSchema.parse({ testDate: null, testGoals: ["recall", "spelling"] })).toHaveProperty("testGoals", ["recall", "spelling"]);
    expect(AssignmentPutSchema.parse({ testDate: null, testGoals: null })).toHaveProperty("testGoals", null);
  });
});
