import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "../../db/client";
import { assessments, attempts, learningEvents, sessionTasks } from "../../db/schema";
import type { History, HistoryEntry, Skill } from "../../domain/types";
import { qualifyProjectionEvidence } from "../../domain/projection-evidence";

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

/** Reads exact requested histories, then their scoped audio evidence, without per-assessment scans. */
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
      taskId: attempts.taskId,
    })
    .from(assessments)
    .innerJoin(attempts, eq(attempts.id, assessments.attemptId))
    .innerJoin(sessionTasks, eq(sessionTasks.id, attempts.taskId))
    .where(sql`(${assessments.childId}, ${assessments.skillVersionId}, ${assessments.skill}) in (
      select requested.child_id, requested.skill_version_id, requested.skill
      from unnest(
        ${sql.param(unique.map(scope => scope.childId))}::uuid[],
        ${sql.param(unique.map(scope => scope.skillVersionId))}::uuid[],
        ${sql.param(unique.map(scope => scope.skill))}::text[]
      ) as requested(child_id, skill_version_id, skill)
    )`)
    .orderBy(asc(attempts.receivedAt), asc(attempts.id), asc(assessments.skill));

  const taskIds = [...new Set(rows.map((row) => row.taskId))];
  const audioRows = taskIds.length === 0
    ? []
    : await exec
      .select({
        taskId: learningEvents.taskId,
        firstAudioAt: sql<Date>`min(${learningEvents.occurredAt})`,
      })
      .from(learningEvents)
      .where(and(
        sql`${learningEvents.taskId} = any(${sql.param(taskIds)}::uuid[])`,
        eq(learningEvents.kind, "audio_issued"),
        eq(learningEvents.sealed, true),
      ))
      .groupBy(learningEvents.taskId);
  const firstAudioAtByTask = new Map(audioRows.map((row) => [row.taskId, row.firstAudioAt]));

  const requested = new Map(unique.map((scope) => [skillHistoryKey(scope), scope]));
  const histories = new Map<string, HistoryEntry[]>();
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
    const prompt = row.publicPrompt as { options?: { text?: string; labelPl?: string }[] } | null;
    const distinctChoiceCount = Array.isArray(prompt?.options)
      ? new Set(prompt.options.map((option) => (option?.text ?? option?.labelPl ?? "").normalize("NFC").trim().toLocaleLowerCase())).size
      : null;
    const qualified = qualifyProjectionEvidence([{
      entry,
      exerciseType: row.exerciseType as import("../../domain/types").ExerciseType,
      distinctChoiceCount,
      audioIssuedBeforeAnswer: firstAudioAtByTask.get(row.taskId) !== undefined
        && new Date(firstAudioAtByTask.get(row.taskId)!).getTime() <= row.receivedAt.getTime(),
    }])[0]!;
    const list = histories.get(key);
    if (list) list.push(qualified);
    else histories.set(key, [qualified]);
  }
  return histories;
}
