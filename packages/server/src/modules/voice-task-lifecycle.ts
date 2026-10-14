import { and, eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { attempts, itemRevisions, learningSessions, sessionTasks } from "../db/schema";
import { computeTargetKey } from "../domain/target-key";
import { contextOf, lockTaskWithSession } from "./events";

export type DisabledVoiceTaskResult = "waiting" | "skipped" | "unchanged";

/** Closes an issued voice task disabled by the parent without creating an assessment. */
export async function completeDisabledVoiceTask(tx: Tx, sessionId: string, taskId: string): Promise<DisabledVoiceTaskResult> {
  const { task, session } = await lockTaskWithSession(tx, taskId);
  if (task.sessionId !== sessionId || !contextOf(session).microphoneDisabledTaskIds.includes(taskId) || task.state !== "issued") {
    return "unchanged";
  }
  if (task.exerciseType !== "recall" && task.exerciseType !== "speech") return "unchanged";
  const [processing] = await tx.select({ id: attempts.id }).from(attempts)
    .where(and(eq(attempts.taskId, taskId), eq(attempts.state, "processing")));
  if (processing) return "waiting";

  await tx.update(sessionTasks).set({ state: "skipped" }).where(eq(sessionTasks.id, taskId));
  const [revision] = await tx.select({ targetKey: itemRevisions.targetKey })
    .from(itemRevisions).where(eq(itemRevisions.id, task.itemRevisionId));
  const key = revision?.targetKey;
  const context = contextOf(session);
  const reservations = key ? context.reservations.filter((reserved) => reserved !== key) : context.reservations;
  const settledChecks = key ? [...new Set([...context.settledChecks, key])] : context.settledChecks;
  await tx.update(learningSessions).set({ context: { ...context, reservations, settledChecks } as unknown as Record<string, unknown> })
    .where(eq(learningSessions.id, sessionId));
  return "skipped";
}

