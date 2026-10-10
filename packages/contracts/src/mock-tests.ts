import { z } from "zod";
import { DaySchema, InstantSchema, UuidSchema, SkillStatusSchema } from "./common";

export const TestGoalSchema = z.enum(["recall", "spelling", "listening"]);
export type TestGoal = z.infer<typeof TestGoalSchema>;
export const TestGoalsSchema = z.array(TestGoalSchema).min(1).max(3).refine(goals => new Set(goals).size === goals.length);
export const MockTestTaskCountSchema = z.number().int().min(1).max(100);
export const MockTestOutcomeSchema = z.enum(["correct", "incorrect", "skipped", "unassessed", "not_tested"]);
export type MockTestOutcome = z.infer<typeof MockTestOutcomeSchema>;
const count = z.number().int().nonnegative();
export const MockTestSkillReportDtoSchema = z.object({
  skill: TestGoalSchema, totalItems: count, independentCorrect: count, practiceNeeded: count,
  correctNotIndependent: count, notTested: count, skipped: count, unassessed: count,
});
export type MockTestSkillReportDto = z.infer<typeof MockTestSkillReportDtoSchema>;
export const MockTestReportRowSchema = z.object({
  itemId: UuidSchema, source: z.string(), target: z.string(), skill: TestGoalSchema,
  outcome: MockTestOutcomeSchema, independent: z.boolean(), reason: z.string().nullable(), masteryStatus: SkillStatusSchema,
});
export type MockTestReportRow = z.infer<typeof MockTestReportRowSchema>;
export const MockTestReportDtoSchema = z.object({
  deckTitle: z.string(), deckVersionNumber: z.number().int().positive(),
  sessionId: UuidSchema, childId: UuidSchema, deckId: UuidSchema, deckVersionId: UuidSchema,
  testDate: DaySchema.nullable(), testGoals: TestGoalsSchema, requestedTaskCount: MockTestTaskCountSchema,
  taskBudget: count, state: z.enum(["completed", "ended"]), complete: z.boolean(),
  startedAt: InstantSchema, endedAt: InstantSchema,
  skills: z.array(MockTestSkillReportDtoSchema), rows: z.array(MockTestReportRowSchema),
});
export type MockTestReportDto = z.infer<typeof MockTestReportDtoSchema>;
export const MockTestSummaryDtoSchema = z.object({
  sessionId: UuidSchema, deckId: UuidSchema, state: z.enum(["completed", "ended"]), complete: z.boolean(),
  taskBudget: count, answeredCount: count,
  solutions: z.array(z.object({
    taskId: UuidSchema, source: z.string(), target: z.string(), audioAssetId: UuidSchema.nullable(),
    results: z.array(z.object({ skill: TestGoalSchema, outcome: MockTestOutcomeSchema })),
  })),
});
export type MockTestSummaryDto = z.infer<typeof MockTestSummaryDtoSchema>;
