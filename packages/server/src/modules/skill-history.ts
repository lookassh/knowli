import { and, asc, eq, or, sql } from "drizzle-orm";
import type { Executor } from "../db/client";
import { assessments, attempts, sessionTasks } from "../db/schema";
import type { History, HistoryEntry, Skill } from "../domain/types";
import { qualifyProjectionEvidence } from "../domain/projection-evidence";

export interface HistoryScope {
  childId: string;
  skillVersionId: string;
  skill: Skill;
}

export function skillHistoryKey(scope: HistoryScope): string {
  return `${scope.childId}:${scope.skillVersionId}:${scope.skill}`;
}

export async function readSkillHistory(exec: Executor, scope: HistoryScope): Promise<History> {
  return (await readSkillHistories(exec, [scope])).get(skillHistoryKey(scope)) ?? [];
}

/** Reads all requested histories with one scoped query, never crossing child boundaries. */
export async function readSkillHistories(
  exec: Executor,
  scopes: readonly HistoryScope[],
): Promise<ReadonlyMap<string, History>> {
  const unique = [...new Map(scopes.map((scope) => [skillHistoryKey(scope), scope])).values()];
  if (unique.length === 0) return new Map();
  const rows = await exec
    .select({
      childId: assessments.childId,
      skillVersionId: assessments.skillVersionId,
      skill: assessments.skill,
      receivedAt: attempts.receivedAt,
      policyId: attempts.policyId,
      outcome: assessments.outcome,
      reason: assessments.reason,
      independent: assessments.independent,
      confirmationEligible: assessments.confirmationEligible,
      details: assessments.details,
      attemptId: attempts.id,
      exerciseType: sessionTasks.exerciseType,
      publicPrompt: sessionTasks.publicPrompt,
      audioIssuedBeforeAnswer: sql<boolean>`exists (
        select 1 from learning_app.learning_events e
         where e.task_id = ${attempts.taskId}
           and e.kind = 'audio_issued' and e.sealed = true
           and e.occurred_at <= ${attempts.receivedAt}
      )`,
    })
    .from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .where(or(...unique.map((scope) => and(
      eq(assessments.childId, scope.childId),
      eq(assessments.skillVersionId, scope.skillVersionId),
      eq(assessments.skill, scope.skill),
    ))))
    .orderBy(asc(attempts.receivedAt), asc(attempts.id));

  const requested = new Map(unique.map((scope) => [skillHistoryKey(scope), scope]));
  const histories = new Map<string, History>();
  for (const row of rows) {
    const scope: HistoryScope = {
      childId: row.childId,
      skillVersionId: row.skillVersionId,
      skill: row.skill as Skill,
    };
    const key = skillHistoryKey(scope);
    if (!requested.has(key)) continue;
    const entry: HistoryEntry = {
      receivedAt: row.receivedAt.toISOString(),
      policyVersion: row.policyId,
      skill: scope.skill,
      outcome: row.outcome === "unassessed" ? "unevaluated" : (row.outcome as "correct" | "incorrect"),
      ...(row.reason === null ? {} : { reason: row.reason as HistoryEntry["reason"] }),
      independent: row.independent,
      confirmationEligible: row.confirmationEligible,
      details: row.details as HistoryEntry["details"],
    };
    const prompt = row.publicPrompt as { options?: { text?: string }[] };
    const distinctChoiceCount = Array.isArray(prompt.options)
      ? new Set(prompt.options.map((option) => (option.text ?? "").normalize("NFC").trim().toLocaleLowerCase())).size
      : null;
    const qualified = qualifyProjectionEvidence([{
      entry,
      exerciseType: row.exerciseType as import("../domain/types").ExerciseType,
      distinctChoiceCount,
      audioIssuedBeforeAnswer: row.audioIssuedBeforeAnswer,
    }])[0]!;
    histories.set(key, [...(histories.get(key) ?? []), qualified]);
  }
  return histories;
}
