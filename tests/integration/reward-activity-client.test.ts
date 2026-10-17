import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createChild, createDraft, nextTask, publishDraft, readRewardActivitySummary, startSession, upsertAssignment } from "@learning/server";
import { createKidApiClient } from "../../packages/kid-ui/src/api/client";
import { handleKidApi } from "../../apps/web/src/kid/kid-router";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();
afterAll(async () => { await pool.end(); });

describe("Kid API client reward-activity transport", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("sends activity and playback authorization through the real Kid router and settles credited time", async () => {
    const { services, clock } = buildTestServices("2026-10-16T10:00:00.000Z");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const draft = await createDraft(services, { title: "Client API reward test", items: [{
      source: "kot", target: "cat", acceptedAnswers: [],
      locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
    }] });
    const revision = (await pool.query<{ id: string }>("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows[0]!;
    const assetId = randomUUID();
    const fingerprint = `reward-client-${randomUUID()}`;
    await pool.query(`insert into learning_app.media_assets
      (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
      values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake','{"durationMs":20000}'::jsonb)`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`]);
    await pool.query(`insert into learning_app.revision_assets
      (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')`,
    [revision.id, assetId, fingerprint]);
    await pool.query(`insert into learning_app.revision_assets
      (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')`,
    [revision.id, `illustration-${randomUUID()}`]);
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
    const task = await nextTask(services, session.sessionId);
    const requestedPaths: string[] = [];
    const api = createKidApiClient({
      baseUrl: "http://localhost",
      fetchImpl: async (input, init) => {
        const url = new URL(String(input), "http://localhost");
        requestedPaths.push(url.pathname);
        return handleKidApi(new Request(url, init), services, url.pathname.replace("/api/v1/kid/", "").split("/"));
      },
    });

    const streamId = randomUUID();
    await api.signalRewardActivity({ sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 1, kind: "takeover" });
    const authorization = await api.authorizeRewardActivityPlayback({
      sessionId: session.sessionId, taskId: task!.taskId, streamId, assetId,
    });
    await api.signalRewardActivity({
      sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 2, kind: "playback_start",
      playbackAuthorizationId: authorization.authorizationId, playbackAssetId: assetId,
    });
    clock.advanceMs(15_000);
    await api.signalRewardActivity({
      sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 3, kind: "playback_end",
      playbackAuthorizationId: authorization.authorizationId, playbackAssetId: assetId,
    });
    await api.completePresentation(task!.taskId);

    expect(requestedPaths).toEqual([
      `/api/v1/kid/tasks/${task!.taskId}/activity`,
      `/api/v1/kid/tasks/${task!.taskId}/activity/playback-authorization`,
      `/api/v1/kid/tasks/${task!.taskId}/activity`,
      `/api/v1/kid/tasks/${task!.taskId}/activity`,
      `/api/v1/kid/tasks/${task!.taskId}/complete-presentation`,
    ]);
    expect((await readRewardActivitySummary(services, child.id)).creditedSeconds).toBe(15);
  });
});
