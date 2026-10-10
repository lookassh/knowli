import { randomUUID } from "node:crypto";
import { createChild, createDraft, endSession, publishDraft, startSession, upsertAssignment, type Services, type createDatabase } from "@learning/server";
import { writeSealedEvent } from "../../packages/server/src/modules/events";
import { sessionTasks } from "../../packages/server/src/db/schema";
import { computeTargetKey } from "../../packages/server/src/domain/target-key";


export async function mockTestDeck(services: Services, pool: ReturnType<typeof createDatabase>["pool"], count = 4, known = true) {

  const child = await createChild(services, { displayName: "Kartkówka", avatarKey: "fox" });
  const title = `Próba ${randomUUID().slice(0, 8)}`;
  const draft = await createDraft(services, { title, items: Array.from({ length: count }, (_, i) => ({
    source: `znaczenie ${i}`, target: i === 0 ? "Monday" : `word${i}`, acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" as const,
  })) });
  const revisions = (await pool.query<{ id: string; itemId: string; payload: { source: string; target: string } }>(
    `select id,item_id as "itemId",payload from learning_app.item_revisions where deck_version_id=$1 order by position`, [draft.id])).rows;
  for (const revision of revisions) {
    const assetId = randomUUID(), fingerprint = randomUUID();
    await pool.query(`insert into learning_app.media_assets (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model)
      values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake')`, [assetId, fingerprint, `blob/${assetId}`, fingerprint]);
    await pool.query(`insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state)
      values ($1,'target_audio',$2,$3,'approved')`, [revision.id, assetId, fingerprint]);
    await pool.query(`insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state)
      values ($1,'illustration',null,$2,'omitted')`, [revision.id, randomUUID()]);
  }
  await publishDraft(services, draft.id, 1);
  await upsertAssignment(services, child.id, draft.deckId, null);
  if (known) {
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
    await services.db.transaction(async tx => {
      for (const [ordinal, revision] of revisions.entries()) {
        const taskId = randomUUID(), payload = revision.payload as { source: string; target: string };
        await tx.insert(sessionTasks).values({ id: taskId, sessionId: session.sessionId, childId: child.id,
          deckVersionId: draft.id, itemRevisionId: revision.id, ordinal, exerciseType: "exposure", state: "completed",
          publicPrompt: { kind: "exposure", source: payload.source, target: payload.target }, answerKey: {}, issuedAt: services.clock.now() });
        await writeSealedEvent(tx, { childId: child.id, taskId, itemId: revision.itemId, kind: "prompt_issued",
          stepId: `${taskId}:prompt`, occurredAt: services.clock.now(), exposures: [computeTargetKey(payload.target, "en-GB")] });
      }
    });
    await endSession(services, session.sessionId);
  }
  return { childId: child.id, deckId: draft.deckId, versionId: draft.id, title, revisions };
}
