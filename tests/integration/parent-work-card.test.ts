import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { completePresentation, createChild, createDraft, endSession, loginParent, nextTask, publishDraft, readParentWorkCard, recordRewardActivitySignal, setupParent, startSession, submitAttempt, upsertAssignment } from "@learning/server";
import { handleParentApi } from "../../apps/web/src/parent/parent-router";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { randomUUID } from "node:crypto";

const { pool } = testDatabase();
afterAll(async () => { await pool.end(); });

describe("parent work card", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("splits settled activity by the stored timezone without a daily-round report", async () => {
    const { services, clock } = buildTestServices("2026-10-16T21:59:45.000Z");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const draft = await createDraft(services, { title: "Dni", items: [
      { source: "poniedziałek", target: "Monday", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" },
      { source: "wtorek", target: "Tuesday", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" },
    ] });
    const revisions = (await pool.query<{ id: string }>("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows;
    for (const revision of revisions) {
      const assetId = randomUUID(), fingerprint = `work-card-${randomUUID()}`;
      await pool.query(`insert into learning_app.media_assets
        (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
        values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake',$5::jsonb)`,
      [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`, JSON.stringify({ durationMs: 20_000 })]);
      await pool.query(`insert into learning_app.revision_assets
        (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')`, [revision.id, assetId, fingerprint]);
      await pool.query(`insert into learning_app.revision_assets
        (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')`, [revision.id, `ill-${randomUUID()}`]);
    }
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
    const task = await nextTask(services, session.sessionId);
    expect(task?.exerciseType).toBe("exposure");
    const streamId = randomUUID();
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 1, kind: "interaction" });
    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task!.taskId, streamId, sequence: 2, kind: "heartbeat" });
    clock.advanceMs(15_000);
    await completePresentation(services, { taskId: task!.taskId });

    const beforeMidnight = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    const afterMidnight = await readParentWorkCard(services, { childId: child.id, date: "2026-10-17" });
    expect(beforeMidnight).toMatchObject({ creditedSeconds: 15, sessions: [{ deckTitle: "Dni", creditedSeconds: 15, steps: [{ state: "completed" }] },] });
    expect(afterMidnight.creditedSeconds).toBe(15);
    let dontRememberTask = await nextTask(services, session.sessionId);
    for (let i = 0; i < 6 && dontRememberTask?.exerciseType === "exposure"; i++) {
      await completePresentation(services, { taskId: dontRememberTask.taskId });
      dontRememberTask = await nextTask(services, session.sessionId);
    }
    expect(dontRememberTask).toBeTruthy();
    await submitAttempt(services, { taskId: dontRememberTask!.taskId, clientAttemptId: randomUUID(), modality: "dont_remember" });
    let skippedTask = await nextTask(services, session.sessionId);
    for (let i = 0; i < 6 && skippedTask?.exerciseType === "exposure"; i++) {
      await completePresentation(services, { taskId: skippedTask.taskId });
      skippedTask = await nextTask(services, session.sessionId);
    }
    if (skippedTask) await submitAttempt(services, { taskId: skippedTask.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    const responses = await readParentWorkCard(services, { childId: child.id, date: "2026-10-17" });
    expect(responses.sessions[0]?.steps.flatMap(step => step.responses.map(response => response.modality))).toEqual(expect.arrayContaining(["dont_remember", "skip"]));
    expect(responses.sessions[0]?.steps.flatMap(step => step.responses.filter(response => response.modality === "dont_remember").map(response => response.assessment))).toEqual(["none"]);
    await endSession(services, session.sessionId);
    expect((await readParentWorkCard(services, { childId: child.id, date: "2026-10-15" })).sessions).toEqual([]);
  });

  it("requires Parent Mode, rejects invalid input, and never returns another child's data", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "work-card-pin");
    const { token } = await loginParent(services, "work-card-pin");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    await expect(handleParentApi(new Request(`http://localhost/api/v1/parent/work-card?childId=${child.id}&date=2026-10-16`), services, ["work-card"]))
      .rejects.toMatchObject({ code: "unauthorized" });
    await expect(readParentWorkCard(services, { childId: child.id, date: "16.10.2026" })).rejects.toMatchObject({ name: "ZodError" });
    const response = await handleParentApi(
      new Request(`http://localhost/api/v1/parent/work-card?childId=${child.id}&date=2026-10-16`, { headers: { cookie: `parent_session=${token}` } }),
      services,
      ["work-card"],
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ childId: child.id, date: "2026-10-16", sessions: [], creditedSeconds: 0 });
    const other = await createChild(services, { displayName: "Jan", avatarKey: "bear" });
    expect(await readParentWorkCard(services, { childId: other.id, date: "2026-10-16" })).toMatchObject({ childId: other.id, sessions: [], creditedSeconds: 0 });
    await expect(readParentWorkCard(services, { childId: randomUUID(), date: "2026-10-16" }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("returns every pending Xbox request and only terminal requests for the selected source date", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const snapshots = [
      { status: "pending", day: "2026-10-14", block: 1, requested: "2026-10-14T10:00:00Z" },
      { status: "fulfilled", day: "2026-10-14", block: 2, requested: "2026-10-14T11:00:00Z" },
      { status: "rejected", day: "2026-10-15", block: 1, requested: "2026-10-15T11:00:00Z" },
    ] as const;
    for (const snapshot of snapshots) {
      const blockId = randomUUID();
      await pool.query(`insert into learning_app.reward_activity_xbox_blocks
        (id, child_id, timezone, local_date, block_number, credited_seconds_at_creation)
        values ($1,$2,'Europe/Warsaw',$3,$4,$5)`,
      [blockId, child.id, snapshot.day, snapshot.block, snapshot.block * 1800]);
      await pool.query(`insert into learning_app.reward_activity_xbox_requests
        (id, child_id, block_id, status, timezone_snapshot, local_date_snapshot, block_number_snapshot,
         credited_seconds_snapshot, requested_at)
        values ($1,$2,$3,$4,'Europe/Warsaw',$5,$6,$7,$8)`,
      [randomUUID(), child.id, blockId, snapshot.status, snapshot.day, snapshot.block, snapshot.block * 1800, snapshot.requested]);
    }

    const sourceDay = await readParentWorkCard(services, { childId: child.id, date: "2026-10-14" });
    expect(sourceDay.xboxRequests.map(request => request.status)).toEqual(["pending", "fulfilled"]);
    const anotherDay = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    expect(anotherDay.xboxRequests.map(request => request.status)).toEqual(["pending"]);
  });
});
