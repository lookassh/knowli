import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { learningSessions, sessionTasks } from "../db/schema";
import type { TrainingSessionSlot } from "../domain/training-session-plan";
import { contextOf, writeSealedEvent } from "./events";
import { recordTaskSkillFacts } from "./skill-projections";

export type VocabularyTaskSession = Readonly<Pick<
  typeof learningSessions.$inferSelect,
  "id" | "childId" | "deckVersionId" | "policyId" | "context"
>>;

export type VocabularyTaskSnapshot = Readonly<Omit<TrainingSessionSlot, "assessed">>;

/** Writes the complete learning record for an issued vocabulary task in the caller's transaction. */
export async function issueVocabularyTask(
  tx: Tx,
  session: VocabularyTaskSession,
  task: VocabularyTaskSnapshot,
  now: Date,
): Promise<void> {
  await tx.insert(sessionTasks).values({
    id: task.taskId,
    sessionId: session.id,
    childId: session.childId,
    deckVersionId: session.deckVersionId,
    itemRevisionId: task.itemRevisionId,
    ordinal: task.ordinal,
    exerciseType: task.exerciseType,
    direction: task.direction,
    state: "issued",
    publicPrompt: task.prompt as unknown as Record<string, unknown>,
    answerKey: task.answerKey,
    context: {
      reason: task.reason,
      ...(task.supportCycleId ? { supportCycleId: task.supportCycleId } : {}),
      ...(task.skillAtIssue ? { skillAtIssue: task.skillAtIssue } : {}),
      ...(task.statusAtIssue !== undefined ? { statusAtIssue: task.statusAtIssue } : {}),
      ...(task.assessmentSkills ? { assessmentSkills: task.assessmentSkills } : {}),
    },
    issuedAt: now,
  });
  await recordTaskSkillFacts(tx, {
    childId: session.childId,
    itemRevisionId: task.itemRevisionId,
    policyId: session.policyId,
    exerciseType: task.exerciseType,
    issuedAt: now,
  });
  await writeSealedEvent(tx, {
    childId: session.childId,
    taskId: task.taskId,
    itemId: task.itemId,
    kind: "prompt_issued",
    stepId: `${task.taskId}:prompt`,
    occurredAt: now,
    exposures: [...task.revealsTargetKeys],
  });
  const context = contextOf(session);
  if (JSON.stringify(context.reservations) !== JSON.stringify(task.keepsReservations)) {
    await tx.update(learningSessions)
      .set({ context: { ...context, reservations: [...task.keepsReservations] } })
      .where(eq(learningSessions.id, session.id));
  }
}
