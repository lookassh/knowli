import type { TestGoal, TaskPrompt, MockTestReportRow } from "@learning/contracts";
import type { AnswerKey } from "./types";
export type { MockTestReportRow };
export interface MockTestCandidate {
  itemId: string; itemRevisionId: string; position: number; source: string; target: string; targetKey: string;
  acceptedAnswers: string[]; known: boolean; audioAssetId: string | null;
  skills: Partial<Record<TestGoal, { skillVersionId: string; priority: 0 | 1 | 2 }>>;
}
export interface MockTestSlot {
  taskId: string; itemId: string; itemRevisionId: string; targetKey: string;
  audioAssetId: string | null;
  exerciseType: "recall" | "listening"; goals: TestGoal[]; prompt: TaskPrompt; answerKey: AnswerKey;
}
export interface MockTestScopeItem {
  itemId: string; itemRevisionId: string; position: number; source: string; target: string;
  skills: Partial<Record<TestGoal, string>>;
  unavailable: Partial<Record<TestGoal, string>>;
}
export interface MockTestPlanSnapshot {
  version: 1; testGoals: TestGoal[]; testDate: string | null; requestedTaskCount: number;
  scope: MockTestScopeItem[]; slots: MockTestSlot[];
}
