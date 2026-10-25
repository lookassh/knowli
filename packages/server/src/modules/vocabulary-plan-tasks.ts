import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { learningSessions, sessionTasks } from "../db/schema";
import type { TrainingSessionPlanSnapshot, TrainingSessionSlot } from "../domain/training-session-plan";
import { contextOf, writeSealedEvent } from "./events";
import { recordTaskSkillFacts } from "./skill-projections";

export type VocabularyPlanSession = Readonly<Pick<
  typeof learningSessions.$inferSelect,
  "id" | "childId" | "deckVersionId" | "policyId" | "microphoneEnabled" | "context"
>>;

export interface IssuedVocabularyPlanSlot {
  readonly slot: TrainingSessionSlot;
  readonly assessedBefore: number;
}

/** Issues one immutable vocabulary-plan slot, participating in the caller's transaction. */
export async function issueNextVocabularyPlanTask(
  tx: Tx,
  session: VocabularyPlanSession,
  plan: TrainingSessionPlanSnapshot,
  now: Date,
  nextOrdinal: number,
  assessedBefore: number,
): Promise<IssuedVocabularyPlanSlot | null> {
  let ordinal = nextOrdinal;
  let assessed = assessedBefore;
  const context = contextOf(session);
  let slot = plan.slots[ordinal];

  while (slot && (context.microphoneDisabledTaskIds.includes(slot.taskId) ||
    (!session.microphoneEnabled && (slot.exerciseType === "speech" || (slot.exerciseType === "recall" && !context.canRead))))) {
    await tx.insert(sessionTasks).values({
      id: slot.taskId, sessionId: session.id, childId: session.childId, deckVersionId: session.deckVersionId,
      itemRevisionId: slot.itemRevisionId, ordinal, exerciseType: slot.exerciseType, direction: slot.direction,
      state: "skipped", publicPrompt: slot.prompt as unknown as Record<string, unknown>, answerKey: slot.answerKey,
      context: { reason: slot.reason, skipped: "microphone_unavailable" }, issuedAt: now,
    });
    ordinal += 1;
    if (slot.assessed) assessed += 1;
    slot = plan.slots[ordinal];
  }
  if (!slot || assessed >= plan.taskBudget) return null;

  await tx.insert(sessionTasks).values({
    id: slot.taskId, sessionId: session.id, childId: session.childId, deckVersionId: session.deckVersionId,
    itemRevisionId: slot.itemRevisionId, ordinal, exerciseType: slot.exerciseType, direction: slot.direction,
    state: "issued", publicPrompt: slot.prompt as unknown as Record<string, unknown>, answerKey: slot.answerKey,
    context: {
      reason: slot.reason,
      ...(slot.supportCycleId ? { supportCycleId: slot.supportCycleId } : {}),
      ...(slot.skillAtIssue ? { skillAtIssue: slot.skillAtIssue } : {}),
      ...(slot.statusAtIssue !== undefined ? { statusAtIssue: slot.statusAtIssue } : {}),
      ...(slot.assessmentSkills ? { assessmentSkills: slot.assessmentSkills } : {}),
    },
    issuedAt: now,
  });
  await recordTaskSkillFacts(tx, {
    childId: session.childId,
    itemRevisionId: slot.itemRevisionId,
    policyId: session.policyId,
    exerciseType: slot.exerciseType,
    issuedAt: now,
  });
  await writeSealedEvent(tx, {
    childId: session.childId, taskId: slot.taskId, itemId: slot.itemId, kind: "prompt_issued",
    stepId: `${slot.taskId}:prompt`, occurredAt: now, exposures: [...slot.revealsTargetKeys],
  });
  if (JSON.stringify(context.reservations) !== JSON.stringify(slot.keepsReservations)) {
    await tx.update(learningSessions).set({ context: { ...context, reservations: [...slot.keepsReservations] } })
      .where(eq(learningSessions.id, session.id));
  }
  return { slot, assessedBefore: assessed };
}
