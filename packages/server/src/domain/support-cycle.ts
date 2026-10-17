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
  currentSessionId?: string,
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
  const lastSessionByRevision = new Map<string, string | undefined>();
  const unresolved = new Map<string, { state: SupportState; skills: Set<Skill> }>();
  const emptyState = (): SupportState => ({ phase: "none", cycleId: null, sourceTaskId: null, retryType: "listening" });

  for (const task of ordered) {
    let prior = states.get(task.itemRevisionId) ?? {
      phase: "none" as const, cycleId: null, sourceTaskId: null, retryType: "listening" as const,
    };
    if (currentSessionId !== undefined) {
      // A consumed cycle limits this session, not the next one's support.
      if (lastSessionByRevision.has(task.itemRevisionId) && lastSessionByRevision.get(task.itemRevisionId) !== task.sessionId) {
        prior = unresolved.get(task.itemRevisionId)?.state ?? emptyState();
        states.set(task.itemRevisionId, prior);
      }
      lastSessionByRevision.set(task.itemRevisionId, task.sessionId);
      const taskAttempts = byTask.get(task.taskId) ?? [];
      const incorrect = taskAttempts.filter((attempt) => attempt.outcomes.some((row) => row.outcome === "incorrect"));
      const pending = unresolved.get(task.itemRevisionId);
      if (taskAttempts.some((attempt) => attempt.modality === "dont_remember") || incorrect.length >= supportAfterFailures) {
        const skills = new Set([...(pending?.skills ?? []), ...incorrect.flatMap((attempt) =>
          attempt.outcomes.filter((row) => row.outcome === "incorrect").map((row) => row.skill),
        )]);
        unresolved.set(task.itemRevisionId, { skills, state: {
          phase: "needed", cycleId: null, sourceTaskId: task.taskId,
          retryType: skills.has("spelling") ? "letter_completion" : "listening",
        } });
      }
      const remaining = unresolved.get(task.itemRevisionId);
      if (remaining) {
        const latestGraded = taskAttempts.findLast((attempt) => attempt.outcomes.some((row) => row.outcome !== "unevaluated"));
        const correct = latestGraded?.outcomes.filter((row) => row.outcome === "correct") ?? [];
        for (const row of correct) remaining.skills.delete(row.skill);
        if (correct.length > 0 && remaining.skills.size === 0) unresolved.delete(task.itemRevisionId);
        else remaining.state.retryType = remaining.skills.has("spelling") ? "letter_completion" : "listening";
      }
    }
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
    if (currentSessionId !== undefined && lastSessionByRevision.get(task.itemRevisionId) !== currentSessionId) {
      states.set(task.itemRevisionId, unresolved.get(task.itemRevisionId)?.state ?? emptyState());
    }
    if (!states.has(task.itemRevisionId)) {
      states.set(task.itemRevisionId, {
        phase: "none", cycleId: null, sourceTaskId: null, retryType: "listening",
      });
    }
  }
  return states;
}
