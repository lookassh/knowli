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

/** Jeden slot zamrożonego planu kartkówki LEKCJI (prompt/klucz materializowane raz). */
export interface LessonMockSlot {
  taskId: string; itemId: string; itemRevisionId: string; objectiveId: string;
  exerciseType: string; targetKey: string; prompt: TaskPrompt; answerKey: Record<string, unknown>;
}

/**
 * Snapshot planu kartkówki LEKCJI zapisany w `learning_sessions.mock_test_plan`.
 * Dyskryminowany `kind:"lesson"` od `MockTestPlanSnapshot` słówek (brak `kind`
 * ⇒ słówka). Współdzieli kolumnę, więc CHECK `learning_sessions_mode_plan` i
 * trigger immutability obowiązują bez zmiany (zadanie 17, migracja 0008).
 */
export interface LessonMockTestPlanSnapshot {
  kind: "lesson"; version: 1; requestedTaskCount: number; objectiveIds: string[]; slots: LessonMockSlot[];
}
