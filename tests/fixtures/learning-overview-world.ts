import { randomBytes, randomUUID } from "node:crypto";
import { completePresentation, createChild, issueIntegrationToken, nextTask, startSession, submitAttempt, upsertAssignment, type Services } from "@learning/server";
import { mockTestDeck } from "../integration/mock-test-helpers";
import type { testDatabase } from "../integration/helpers";

export async function learningOverviewWorld(services: Services, pool: ReturnType<typeof testDatabase>["pool"], advanceClock: (ms: number) => void) {
  const source = await mockTestDeck(services, 1, false);
  const sibling = await createChild(services, { displayName: "Kuba", avatarKey: "owl" });
  await upsertAssignment(services, source.childId, source.deckId, "2026-10-15", {
    testGoals: ["recall", "spelling"],
    mockTestTaskCount: 1,
  });

  const session = await startSession(services, {
    childId: source.childId,
    deckId: source.deckId,
    microphoneEnabled: false,
  });
  const first = (await nextTask(services, session.sessionId))!;
  await completePresentation(services, { taskId: first.taskId });
  const task = (await nextTask(services, session.sessionId))!;
  advanceClock(30_000);
  await submitAttempt(services, {
    taskId: task.taskId,
    clientAttemptId: randomUUID(),
    modality: "skip",
  });

  const tokenId = randomUUID();
  const token = `umiem_${tokenId}_${randomBytes(32).toString("base64url")}`;
  await issueIntegrationToken(services, "test overview", token);
  return { ...source, siblingId: sibling.id, sessionId: session.sessionId, token };
}
