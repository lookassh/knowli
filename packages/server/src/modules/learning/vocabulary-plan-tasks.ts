import type { Tx } from "../../db/client";
import { sessionTasks } from "../../db/schema";
import type { learningSessions } from "../../db/schema";
import type { TrainingSessionPlanSnapshot, TrainingSessionSlot } from "../../domain/training-session-plan";
import { contextOf } from "./events";
import { issueVocabularyTask, type VocabularyTaskSession } from "./vocabulary-task-issuance";

export type VocabularyPlanSession = VocabularyTaskSession & Pick<typeof learningSessions.$inferSelect, "microphoneEnabled">;

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

  await issueVocabularyTask(tx, session, slot, now);
  return { slot, assessedBefore: assessed };
}
