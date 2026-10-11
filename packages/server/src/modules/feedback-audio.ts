import { and, desc, eq } from "drizzle-orm";
import { FeedbackAudioDtoSchema, FeedbackDtoSchema, type FeedbackAudioDto } from "@learning/contracts";
import type { Services } from "../config";
import { AppError } from "../errors";
import { computeTargetKey } from "../domain/target-key";
import { feedbackExposureKeys } from "../domain/feedback";
import {
  deckVersions, attempts, itemRevisions, learningEvents, learningSessions,
  mediaAssets, revisionAssets, sessionTasks,
} from "../db/schema";
import { contextOf, lockTaskWithSession, writeSealedEvent } from "./events";

const RECALL_LIKE = new Set(["recall", "spelling", "letter_completion"]);

/** Autoryzuje odsłuch z bieżącej karty wyniku pod wspólną blokadą sesji. */
export async function authorizeFeedbackAudio(services: Services, attemptId: string): Promise<FeedbackAudioDto> {
  const candidate = (await services.db.select().from(attempts).where(eq(attempts.id, attemptId)))[0];
  if (!candidate) throw new AppError("not_found");

  return services.db.transaction(async (tx) => {
    const { task, session, itemId } = await lockTaskWithSession(tx, candidate.taskId);
    const attempt = (await tx.select().from(attempts).where(eq(attempts.id, attemptId)))[0];
    if (!attempt || attempt.taskId !== task.id) throw new AppError("not_found");
    if (session.state !== "active" || session.mode === "mock_test") throw new AppError("conflict");
    if (task.state !== "issued" && task.state !== "answered") throw new AppError("conflict");

    const latestTask = (await tx.select({ id: sessionTasks.id })
      .from(sessionTasks).where(eq(sessionTasks.sessionId, session.id))
      .orderBy(desc(sessionTasks.ordinal)).limit(1))[0];
    if (latestTask?.id !== task.id) throw new AppError("conflict");

    const latestAttempt = (await tx.select({ id: attempts.id })
      .from(attempts).where(eq(attempts.taskId, task.id))
      .orderBy(desc(attempts.attemptNumber)).limit(1))[0];
    if (latestAttempt?.id !== attempt.id || attempt.state !== "completed" || attempt.modality !== "audio") {
      throw new AppError("conflict");
    }

    const parsedFeedback = FeedbackDtoSchema.safeParse(attempt.feedback);
    const feedback = parsedFeedback.success ? parsedFeedback.data : null;
    const speech = feedback?.speech;
    const canonical = (task.answerKey as { target?: unknown }).target;
    const revision = (await tx.select({ locale: deckVersions.targetLocale })
      .from(itemRevisions).innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
      .where(eq(itemRevisions.id, task.itemRevisionId)))[0];
    if (!revision || typeof canonical !== "string" || !speech || !["matched", "different"].includes(speech.recognition) ||
        typeof speech.referenceText !== "string" ||
        computeTargetKey(speech.referenceText, revision.locale) !== computeTargetKey(canonical, revision.locale)) {
      throw new AppError("conflict");
    }

    const asset = (await tx.select({ id: mediaAssets.id })
      .from(revisionAssets).innerJoin(mediaAssets, eq(mediaAssets.id, revisionAssets.assetId))
      .where(and(
        eq(revisionAssets.itemRevisionId, task.itemRevisionId),
        eq(revisionAssets.role, "target_audio"),
        eq(revisionAssets.state, "approved"),
        eq(mediaAssets.kind, "tts"),
        eq(mediaAssets.state, "ready"),
      )))[0];
    if (!asset) throw new AppError("conflict");

    const targetKey = computeTargetKey(canonical, revision.locale);
    const prior = await tx.select({ id: learningEvents.id }).from(learningEvents)
      .where(and(eq(learningEvents.taskId, task.id), eq(learningEvents.kind, "feedback_issued")));
    const stepId = task.id + ":f" + (prior.length + 1);
    await writeSealedEvent(tx, {
      childId: session.childId,
      taskId: task.id,
      itemId,
      kind: "feedback_issued",
      stepId,
      occurredAt: services.clock.now(),
      exposures: feedbackExposureKeys(feedback!, targetKey, revision.locale),
    });

    if (RECALL_LIKE.has(task.exerciseType)) {
      const context = contextOf(session);
      const reservations = context.reservations.filter((key) => key !== targetKey);
      const settledChecks = [...new Set([...context.settledChecks, targetKey])];
      if (reservations.length !== context.reservations.length || settledChecks.length !== context.settledChecks.length) {
        await tx.update(learningSessions)
          .set({ context: { ...context, reservations, settledChecks } as unknown as Record<string, unknown> })
          .where(eq(learningSessions.id, session.id));
      }
    }
    return FeedbackAudioDtoSchema.parse({ attemptId, taskId: task.id, stepId, audioAssetId: asset.id });
  });
}
