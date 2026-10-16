import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  createDraft,
  deleteChild,
  endSession,
  nextTask,
  publishDraft,
  readRewardActivitySummary,
  authorizeRewardActivityPlayback,
  recordRewardActivitySignal,
  startSession,
  submitAttempt,
  upsertAssignment,
} from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { handleParentApi } from "../../apps/web/src/parent/parent-router";

const { pool } = testDatabase();
afterAll(async () => { await pool.end(); });

describe("rozliczanie aktywności nagrodowej", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("rozlicza potwierdzone sekundy raz, dopiero po ukończeniu prezentacji", async () => {
    const { services, clock } = buildTestServices("2026-10-16T10:00:00.000Z");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const draft = await createDraft(services, { title: "Dni", items: [{
      source: "poniedziałek", target: "Monday", acceptedAnswers: [],
      locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
    }] });
    const revision = (await pool.query<{ id: string }>("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows[0]!;
    const assetId = randomUUID();
    const fingerprint = `reward-${randomUUID()}`;
    await pool.query(`insert into learning_app.media_assets
      (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
      values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake',$5::jsonb)`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`, JSON.stringify({ durationMs: 20_000 })]);
    await pool.query(`insert into learning_app.revision_assets
      (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')`,
    [revision.id, assetId, fingerprint]);
    await pool.query(`insert into learning_app.revision_assets
      (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')`,
    [revision.id, `ill-${randomUUID()}`]);
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
    const task = await nextTask(services, session.sessionId);
    expect(task?.exerciseType).toBe("exposure");
    const streamId = randomUUID();
    const first = await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 1, kind: "interaction" });
    expect(first.paused).toBe(false);
    await expect(recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 2, kind: "takeover" })).rejects.toMatchObject({ code: "conflict" });
    clock.advanceMs(15_000);
    const secondInput = { sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 2, kind: "heartbeat" as const };
    const second = await recordRewardActivitySignal(services, secondInput);
    expect(await recordRewardActivitySignal(services, secondInput)).toEqual(second);
    clock.advanceMs(15_000);
    const replacementStreamId = randomUUID();
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 1, kind: "takeover",
    });
    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 2, kind: "heartbeat",
    });
    await expect(recordRewardActivitySignal(services, { ...secondInput, sequence: 3 })).rejects.toMatchObject({ code: "conflict" });
    clock.advanceMs(61_000);
    const idle = await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 3, kind: "heartbeat",
    });
    expect(idle).toMatchObject({ paused: true, pauseReason: "idle" });
    clock.advanceMs(1_000);
    const resumed = await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 4, kind: "interaction",
    });
    expect(resumed).toMatchObject({ paused: false, pauseReason: null });
    const playbackAuthorization = await authorizeRewardActivityPlayback(services, { sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, assetId });
    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 5, kind: "playback_start", playbackAuthorizationId: playbackAuthorization.authorizationId, playbackAssetId: assetId,
    });
    await expect(recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 6, kind: "playback_start", playbackAuthorizationId: randomUUID(), playbackAssetId: assetId,
    })).rejects.toMatchObject({ code: "conflict" });
    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 6, kind: "heartbeat",
    });
    clock.advanceMs(10_000);
    const pausedPlayback = await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 7, kind: "pause", pauseReason: "background",
    });
    expect(pausedPlayback).toMatchObject({ paused: true, pauseReason: "background" });
    await expect(recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 8, kind: "playback_start", playbackAuthorizationId: playbackAuthorization.authorizationId, playbackAssetId: assetId,
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 8, kind: "playback_end", playbackAuthorizationId: playbackAuthorization.authorizationId, playbackAssetId: assetId,
    })).rejects.toMatchObject({ code: "conflict" });
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 8, kind: "interaction",
    });
    await expect(authorizeRewardActivityPlayback(services, { sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, assetId })).resolves.toHaveProperty("authorizationId");
    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: task!.taskId, streamId: replacementStreamId, sequence: 9, kind: "heartbeat",
    });
    expect((await readRewardActivitySummary(services, child.id)).creditedSeconds).toBe(0);
    await completePresentation(services, { taskId: task!.taskId });
    const report = await readRewardActivitySummary(services, child.id);
    expect(report.creditedSeconds).toBe(95);
    expect(report.sessions).toMatchObject([{ sessionId: session.sessionId, creditedSeconds: 95 }]);
    const skippedTask = await nextTask(services, session.sessionId);
    expect(skippedTask).toBeTruthy();
    const skippedStreamId = randomUUID();
    await recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: skippedTask!.taskId, streamId: skippedStreamId, sequence: 1, kind: "interaction",
    });
    await submitAttempt(services, { taskId: skippedTask!.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    const followingTask = await nextTask(services, session.sessionId);
    expect(followingTask).toBeTruthy();
    await expect(recordRewardActivitySignal(services, {
      sessionId: session.sessionId, taskId: followingTask!.taskId, streamId: randomUUID(), sequence: 1, kind: "interaction",
    })).resolves.toMatchObject({ paused: false });
    const afterSkip = await readRewardActivitySummary(services, child.id);
    expect(afterSkip.creditedSeconds).toBe(95);
    await expect(handleParentApi(
      new Request(`http://localhost/api/v1/parent/reward-activity/${child.id}`), services, ["reward-activity", child.id],
    )).rejects.toMatchObject({ code: "unauthorized" });
    await endSession(services, session.sessionId);
    await deleteChild(services, child.id);
    for (const table of ["reward_activity_streams", "reward_activity_segments", "reward_activity_settlements", "reward_activity_pauses", "reward_activity_playback_authorizations"]) {
      const result = await pool.query(`select count(*)::int as count from learning_app.${table} where child_id = $1`, [child.id]);
      expect(result.rows[0]?.count).toBe(0);
    }
  });
});
