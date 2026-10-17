import type { ExerciseType, Skill, SkillOutcome } from "./types";

export interface SupportTask {
  taskId: string; itemRevisionId: string; sessionId?: string; ordinal: number; exerciseType: ExerciseType;
  state: "issued" | "answered" | "completed" | "skipped"; reason: string; supportCycleId?: string;
}
export interface SupportAttempt {
  attemptId: string; taskId: string; modality: string;
  outcomes: readonly { skill: Skill; outcome: SkillOutcome }[];
}
export interface SupportState {
  phase: "none" | "needed" | "waiting" | "retry_due" | "settled";
  cycleId: string | null; sourceTaskId: string | null; retryType: "listening" | "letter_completion";
}

export function deriveSupportStates(
  tasks: readonly SupportTask[],
  attempts: readonly SupportAttempt[],
  supportAfterFailures: number,
): ReadonlyMap<string, SupportState> {
  const byTask = new Map<string, SupportAttempt[]>();
  for (const attempt of attempts) {
    const rows = byTask.get(attempt.taskId) ?? [];
    rows.push(attempt);
    byTask.set(attempt.taskId, rows);
  }
  const ordered = [...tasks].sort((a, b) => a.ordinal - b.ordinal || a.taskId.localeCompare(b.taskId));
  const states = new Map<string, SupportState>();
  const lastDifficultyTask = new Map<string, string>();
  const settledSessionByRevision = new Map<string, string | undefined>();

  for (const task of ordered) {
    const prior = states.get(task.itemRevisionId) ?? {
      phase: "none" as const, cycleId: null, sourceTaskId: null, retryType: "listening" as const,
    };
    if (task.reason === "support") {
      const sourceTaskId = task.supportCycleId ?? prior.sourceTaskId ?? lastDifficultyTask.get(task.itemRevisionId) ?? null;
      states.set(task.itemRevisionId, {
        phase: "waiting", cycleId: task.supportCycleId ?? sourceTaskId, sourceTaskId,
        retryType: prior.retryType,
      });
      continue;
    }
    if (task.reason === "retry-after-support") {
      if (task.state !== "issued") settledSessionByRevision.set(task.itemRevisionId, task.sessionId);
      states.set(task.itemRevisionId, {
        phase: task.state === "issued" ? "retry_due" : "settled",
        cycleId: task.supportCycleId ?? prior.cycleId,
        sourceTaskId: task.supportCycleId ?? prior.sourceTaskId,
        retryType: prior.retryType,
      });
      continue;
    }
    if (prior.phase === "waiting" || prior.phase === "retry_due") continue;
    if (prior.phase === "settled") {
      if (settledSessionByRevision.get(task.itemRevisionId) === task.sessionId) continue;
      states.set(task.itemRevisionId, {
        phase: "none", cycleId: null, sourceTaskId: null, retryType: "listening",
      });
    }

    const taskAttempts = byTask.get(task.taskId) ?? [];
    const incorrect = taskAttempts.filter((attempt) => attempt.outcomes.some((row) => row.outcome === "incorrect"));
    const gaveUp = taskAttempts.some((attempt) => attempt.modality === "dont_remember");
    if (gaveUp || incorrect.length >= supportAfterFailures) {
      const spellingWasIncorrect = incorrect.some((attempt) => attempt.outcomes.some(
        (row) => row.skill === "spelling" && row.outcome === "incorrect",
      ));
      states.set(task.itemRevisionId, {
        phase: "needed", cycleId: null, sourceTaskId: task.taskId,
        retryType: spellingWasIncorrect ? "letter_completion" : "listening",
      });
      lastDifficultyTask.set(task.itemRevisionId, task.taskId);
    }
  }
  for (const task of ordered) {
    if (!states.has(task.itemRevisionId)) {
      states.set(task.itemRevisionId, {
        phase: "none", cycleId: null, sourceTaskId: null, retryType: "listening",
      });
    }
  }
  return states;
}
