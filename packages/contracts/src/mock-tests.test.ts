import { describe, expect, it } from "vitest";
import { AssignmentPutSchema } from "./decks";
import { MockTestReportDtoSchema } from "./mock-tests";

const baseReport = {
  deckTitle: "Zestaw", deckVersionNumber: 1,
  sessionId: "11111111-1111-4111-8111-111111111111",
  childId: "22222222-2222-4222-8222-222222222222",
  deckId: "33333333-3333-4333-8333-333333333333",
  deckVersionId: "44444444-4444-4444-8444-444444444444",
  testDate: null, requestedTaskCount: 10, taskBudget: 0, state: "completed" as const, complete: true,
  startedAt: "2026-10-12T00:00:00.000Z", endedAt: "2026-10-12T00:10:00.000Z",
  skills: [], rows: [],
};

describe("vocabulary MockTestReportDto.testGoals is vocabulary-only", () => {
  it("accepts vocabulary goals", () => {
    expect(MockTestReportDtoSchema.safeParse({ ...baseReport, testGoals: ["recall", "spelling"] }).success).toBe(true);
  });
  it("rejects the lesson goal in a vocabulary report", () => {
    expect(MockTestReportDtoSchema.safeParse({ ...baseReport, testGoals: ["lesson"] }).success).toBe(false);
  });
});

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
