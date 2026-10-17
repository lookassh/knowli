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
  listKidDecks,
  listKidProfiles,
  loginParent,
  authorizeRewardActivityPlayback,
  recordRewardActivitySignal,
  startSession,
  submitAttempt,
  upsertAssignment,
  setupParent,
} from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { handleParentApi } from "../../apps/web/src/parent/parent-router";
import { handleKidApi } from "../../apps/web/src/kid/kid-router";

const { pool } = testDatabase();
afterAll(async () => { await pool.end(); });

async function seedCreditedDay(
  services: ReturnType<typeof buildTestServices>["services"],
  childId: string,
  minutesByDay: Array<{ day: string; minutes: number }>,
): Promise<void> {
  const draft = await createDraft(services, { title: `Xbox ${randomUUID()}`, items: [{
    source: "kot", target: "cat", acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
  }] });
  const revision = (await pool.query<{ id: string }>("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows[0]!;
  const assetId = randomUUID();
  const fingerprint = `xbox-${randomUUID()}`;
  await pool.query(`insert into learning_app.media_assets
    (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
    values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake','{"durationMs":20000}'::jsonb)`,
  [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`]);
  await pool.query(`insert into learning_app.revision_assets
    (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')`,
  [revision.id, assetId, fingerprint]);
  await pool.query(`insert into learning_app.revision_assets
    (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')`,
  [revision.id, `xbox-ill-${randomUUID()}`]);
  await publishDraft(services, draft.id, 1);
  await upsertAssignment(services, childId, draft.deckId, null);
  const session = await startSession(services, { childId, deckId: draft.deckId, microphoneEnabled: false });
  const task = await nextTask(services, session.sessionId);
  const taskId = task!.taskId;
  const settlementId = randomUUID();
  const streamId = randomUUID();
  const completionRef = randomUUID();
  const totalMilliseconds = minutesByDay.reduce((sum, entry) => sum + entry.minutes * 60_000, 0);
  const points = Math.floor(totalMilliseconds / 60_000);
  await pool.query(`insert into learning_app.reward_activity_streams
    (id,child_id,session_id,task_id,policy_version,last_sequence,last_signal_at,last_interaction_at,active)
    values ($1,$2,$3,$4,'1',1,$5,$5,false)`,
  [streamId, childId, session.sessionId, taskId, services.clock.now()]);
  await pool.query(`insert into learning_app.reward_activity_settlements
    (id,child_id,session_id,task_id,completion_ref,kind,settled_at,deck_id,credited_milliseconds,awarded_points,remainder_milliseconds,timezone)
    values ($1,$2,$3,$4,$5,'presentation',$6,$7,$8,$9,0,'Europe/Warsaw')`,
  [settlementId, childId, session.sessionId, taskId, completionRef, services.clock.now(), draft.deckId, totalMilliseconds, points]);
  for (const [index, entry] of minutesByDay.entries()) {
    const start = new Date(`${entry.day}T08:00:00.000Z`);
    await pool.query(`insert into learning_app.reward_activity_segments
      (id,stream_id,child_id,session_id,task_id,started_at,ended_at,settlement_ref)
      values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), streamId, childId, session.sessionId, taskId,
      new Date(start.getTime() + index * 3_600_000), new Date(start.getTime() + index * 3_600_000 + entry.minutes * 60_000), settlementId]);
  }
}

describe("rozliczanie aktywności nagrodowej", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("nie buforuje odpowiedzi profili i zestawów dziecka", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const profiles = await handleKidApi(new Request("http://localhost/api/v1/kid/profiles"), services, ["profiles"]);
    const decks = await handleKidApi(new Request(`http://localhost/api/v1/kid/decks?childId=${child.id}`), services, ["decks"]);
    expect(profiles.headers.get("Cache-Control")).toBe("no-store");
    expect(decks.headers.get("Cache-Control")).toBe("no-store");
  });

  it("pokazuje gotowe bloki wyłącznie z jednego dnia i nie zmienia salda przy niepełnym bloku", async () => {
    const { services } = buildTestServices("2026-10-16T10:00:00.000Z");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    await seedCreditedDay(services, child.id, [
      { day: "2026-10-14", minutes: 20 },
      { day: "2026-10-15", minutes: 10 },
    ]);

    const before = (await listKidProfiles(services))[0]!;
    expect(before.rewards).toMatchObject({ earnedPoints: 30, pointsToUse: 30, readyXboxPacks: 0 });
    await expect(handleKidApi(new Request(`http://localhost/api/v1/kid/profiles/${child.id}/xbox-request`, {
      method: "POST", headers: { Origin: "http://localhost" },
    }), services, ["profiles", child.id, "xbox-request"])).rejects.toMatchObject({ code: "conflict" });
    expect(await listKidProfiles(services)).toMatchObject([{ rewards: { earnedPoints: 30, pointsToUse: 30, readyXboxPacks: 0, xboxRequest: null } }]);
    const blocks = await pool.query("select count(*)::int as count from learning_app.reward_activity_xbox_blocks where child_id=$1", [child.id]);
    expect(blocks.rows[0]?.count).toBe(0);
  });

  it("nie pokazuje pakietu bez punktów dla czasu rozliczonego przed wprowadzeniem punktów", async () => {
    const { services } = buildTestServices("2026-10-16T10:00:00.000Z");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    await seedCreditedDay(services, child.id, [{ day: "2026-10-14", minutes: 30 }]);
    await pool.query("update learning_app.reward_activity_settlements set awarded_points=0 where child_id=$1", [child.id]);

    expect((await listKidProfiles(services))[0]?.rewards).toMatchObject({ earnedPoints: 0, pointsToUse: 0, readyXboxPacks: 0 });
    await expect(handleKidApi(new Request(`http://localhost/api/v1/kid/profiles/${child.id}/xbox-request`, {
      method: "POST", headers: { Origin: "http://localhost" },
    }), services, ["profiles", child.id, "xbox-request"])).rejects.toMatchObject({ code: "conflict" });
  });

  it("rezerwuje jeden najstarszy blok atomowo i powtarzalnie, odejmując saldo, ale zachowując dorobek", async () => {
    const { services } = buildTestServices("2026-10-16T10:00:00.000Z");
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const child30 = await createChild(services, { displayName: "Ada", avatarKey: "cat" });
    const child60 = await createChild(services, { displayName: "Jan", avatarKey: "owl" });
    await seedCreditedDay(services, child.id, [{ day: "2026-10-14", minutes: 60 }, { day: "2026-10-15", minutes: 30 }]);
    await seedCreditedDay(services, child30.id, [{ day: "2026-10-14", minutes: 30 }]);
    await seedCreditedDay(services, child60.id, [{ day: "2026-10-14", minutes: 60 }]);

    const profilesBefore = await listKidProfiles(services);
    const before = profilesBefore.find((profile) => profile.childId === child.id)!;
    expect(before.rewards).toMatchObject({ earnedPoints: 90, pointsToUse: 90, readyXboxPacks: 3, xboxRequest: null });
    expect(profilesBefore.find((profile) => profile.childId === child30.id)?.rewards).toMatchObject({ readyXboxPacks: 1 });
    expect(profilesBefore.find((profile) => profile.childId === child60.id)?.rewards).toMatchObject({ readyXboxPacks: 2 });
    const request = () => handleKidApi(new Request(`http://localhost/api/v1/kid/profiles/${child.id}/xbox-request`, {
      method: "POST", headers: { Origin: "http://localhost" },
    }), services, ["profiles", child.id, "xbox-request"]);
    const [firstResponse, parallelResponse] = await Promise.all([request(), request()]);
    const first = await firstResponse.json();
    const parallel = await parallelResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(parallelResponse.status).toBe(200);
    expect(parallel.requestId).toBe(first.requestId);
    expect(first).toMatchObject({ status: "pending", localDate: "2026-10-14", blockNumber: 1, pointsCost: 30, xboxMinutes: 15 });
    await expect((await request()).json()).resolves.toMatchObject({ requestId: first.requestId });
    expect((await listKidProfiles(services)).find((profile) => profile.childId === child.id)?.rewards).toMatchObject({
      earnedPoints: 90, pointsToUse: 60, readyXboxPacks: 2,
      xboxRequest: { requestId: first.requestId, status: "pending", pointsCost: 30, xboxMinutes: 15 },
    });
    expect((await listKidProfiles(services)).find((profile) => profile.childId === child30.id)?.rewards)
      .toMatchObject({ earnedPoints: 30, pointsToUse: 30, readyXboxPacks: 1, xboxRequest: null });
    const rows = await pool.query("select count(*)::int as count from learning_app.reward_activity_xbox_requests where child_id=$1", [child.id]);
    expect(rows.rows[0]?.count).toBe(1);
    const snapshot = await pool.query<{ timezone_snapshot: string; local_date_snapshot: string; block_number_snapshot: number; credited_seconds_snapshot: number; points_cost: number; xbox_minutes: number }>(
      "select timezone_snapshot, local_date_snapshot, block_number_snapshot, credited_seconds_snapshot, points_cost, xbox_minutes from learning_app.reward_activity_xbox_requests where id=$1",
      [first.requestId],
    );
    expect(snapshot.rows[0]).toMatchObject({
      timezone_snapshot: "Europe/Warsaw", local_date_snapshot: "2026-10-14",
      block_number_snapshot: 1, credited_seconds_snapshot: 3600, points_cost: 30, xbox_minutes: 15,
    });
    await deleteChild(services, child.id);
    for (const table of ["reward_activity_xbox_blocks", "reward_activity_xbox_requests"]) {
      const childRows = await pool.query(`select count(*)::int as count from learning_app.${table} where child_id=$1`, [child.id]);
      expect(childRows.rows[0]?.count).toBe(0);
    }
  });

  it("pozwala rodzicowi potwierdzić lub odrzucić zgłoszenie idempotentnie pod Parent Mode", async () => {
    const { services } = buildTestServices("2026-10-16T10:00:00.000Z");
    const fulfilledChild = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const rejectedChild = await createChild(services, { displayName: "Ada", avatarKey: "cat" });
    await seedCreditedDay(services, fulfilledChild.id, [{ day: "2026-10-14", minutes: 60 }]);
    await seedCreditedDay(services, rejectedChild.id, [{ day: "2026-10-15", minutes: 30 }]);
    await setupParent(services, "xbox-parent-pin");
    const { token } = await loginParent(services, "xbox-parent-pin");

    const requestPack = async (childId: string) => {
      const response = await handleKidApi(new Request(`http://localhost/api/v1/kid/profiles/${childId}/xbox-request`, {
        method: "POST", headers: { Origin: "http://localhost" },
      }), services, ["profiles", childId, "xbox-request"]);
      return response.json() as Promise<{ requestId: string }>;
    };
    const fulfilledRequest = await requestPack(fulfilledChild.id);
    const rejectedRequest = await requestPack(rejectedChild.id);
    const decide = (requestId: string, decision: "fulfilled" | "rejected", authenticated = true, origin = "http://localhost") => handleParentApi(
      new Request(`http://localhost/api/v1/parent/xbox-requests/${requestId}/decision`, {
        method: "POST",
        headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json", ...(authenticated ? { Cookie: `parent_session=${token}` } : {}) },
        body: JSON.stringify({ decision }),
      }), services, ["xbox-requests", requestId, "decision"],
    );

    await expect(decide(fulfilledRequest.requestId, "fulfilled", false)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(decide(fulfilledRequest.requestId, "fulfilled", true, "https://attacker.example")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decide(randomUUID(), "fulfilled")).rejects.toMatchObject({ code: "not_found" });
    const cardBefore = await handleParentApi(new Request(`http://localhost/api/v1/parent/work-card?childId=${fulfilledChild.id}&date=2026-10-14`, {
      headers: { Cookie: `parent_session=${token}` },
    }), services, ["work-card"]);
    expect(await cardBefore.json()).toMatchObject({
      date: "2026-10-14", xboxRequests: [{ requestId: fulfilledRequest.requestId, status: "pending", localDate: "2026-10-14", blockNumber: 1 }],
    });

    const confirmations = await Promise.all([
      decide(fulfilledRequest.requestId, "fulfilled"),
      decide(fulfilledRequest.requestId, "fulfilled"),
    ]);
    expect(await Promise.all(confirmations.map(response => response.json()))).toMatchObject([
      { requestId: fulfilledRequest.requestId, status: "fulfilled" },
      { requestId: fulfilledRequest.requestId, status: "fulfilled" },
    ]);
    await expect(decide(fulfilledRequest.requestId, "rejected")).rejects.toMatchObject({ code: "conflict" });
    expect((await listKidProfiles(services)).find(profile => profile.childId === fulfilledChild.id)?.rewards)
      .toMatchObject({ earnedPoints: 60, pointsToUse: 30, readyXboxPacks: 1, xboxRequest: { status: "fulfilled" } });

    expect(await (await decide(rejectedRequest.requestId, "rejected")).json()).toMatchObject({
      requestId: rejectedRequest.requestId, status: "rejected",
    });
    expect(await (await decide(rejectedRequest.requestId, "rejected")).json()).toMatchObject({ status: "rejected" });
    await expect(decide(rejectedRequest.requestId, "fulfilled")).rejects.toMatchObject({ code: "conflict" });
    expect((await listKidProfiles(services)).find(profile => profile.childId === rejectedChild.id)?.rewards)
      .toMatchObject({ earnedPoints: 30, pointsToUse: 30, readyXboxPacks: 1, xboxRequest: { status: "rejected" } });

    const raceChild = await createChild(services, { displayName: "Iga", avatarKey: "owl" });
    await seedCreditedDay(services, raceChild.id, [{ day: "2026-10-13", minutes: 30 }]);
    const raceRequest = await requestPack(raceChild.id);
    const race = await Promise.allSettled([
      decide(raceRequest.requestId, "fulfilled"),
      decide(raceRequest.requestId, "rejected"),
    ]);
    expect(race.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter(result => result.status === "rejected")).toMatchObject([
      { status: "rejected", reason: { code: "conflict" } },
    ]);
    const raceStatus = (await listKidProfiles(services)).find(profile => profile.childId === raceChild.id)?.rewards?.xboxRequest?.status;
    expect(["fulfilled", "rejected"]).toContain(raceStatus);
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
    // The replacement takeover does not credit the old stream's unclosed tail.
    expect(report.creditedSeconds).toBe(80);
    expect(report.sessions).toMatchObject([{ sessionId: session.sessionId, creditedSeconds: 80 }]);
    await pool.query("update learning_app.learning_sessions set context = jsonb_set(context, '{timezone}', '\"Invalid/Zone\"'::jsonb) where id=$1", [session.sessionId]);
    const rewardRow = await pool.query<{ deck_id: string; credited_milliseconds: string; awarded_points: number; remainder_milliseconds: number }>(
      "select deck_id, credited_milliseconds::text, awarded_points, remainder_milliseconds from learning_app.reward_activity_settlements where session_id=$1",
      [session.sessionId],
    );
    expect(rewardRow.rows).toMatchObject([{ deck_id: draft.deckId, credited_milliseconds: "80000", awarded_points: 1, remainder_milliseconds: 20000 }]);
    expect(await listKidProfiles(services)).toMatchObject([{ childId: child.id, rewards: { earnedPoints: 1, pointsToUse: 1, readyXboxPacks: 0, todayCreditedSeconds: 80 } }]);
    expect(await listKidDecks(services, child.id)).toMatchObject([{ deckId: draft.deckId, earnedPoints: 1 }]);
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
    expect(afterSkip.creditedSeconds).toBe(80);
    await expect(handleParentApi(
      new Request(`http://localhost/api/v1/parent/reward-activity/${child.id}`), services, ["reward-activity", child.id],
    )).rejects.toMatchObject({ code: "unauthorized" });
    const finished = await endSession(services, session.sessionId);
    expect(finished.reward).toEqual({ creditedSeconds: 80, pointsEarned: 1 });

    // The previous 35-second remainder carries into a different stable deck id.
    const secondDraft = await createDraft(services, { title: "Kolory", items: [{
      source: "niebieski", target: "blue", acceptedAnswers: [],
      locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
    }] });
    const secondRevision = (await pool.query<{ id: string }>("select id from learning_app.item_revisions where deck_version_id=$1", [secondDraft.id])).rows[0]!;
    const secondAssetId = randomUUID();
    const secondFingerprint = `reward-${randomUUID()}`;
    await pool.query(`insert into learning_app.media_assets
      (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
      values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake',$5::jsonb)`,
    [secondAssetId, secondFingerprint, `blob/${secondAssetId}`, `sha-${secondAssetId}`, JSON.stringify({ durationMs: 20_000 })]);
    await pool.query(`insert into learning_app.revision_assets
      (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')`,
    [secondRevision.id, secondAssetId, secondFingerprint]);
    await pool.query(`insert into learning_app.revision_assets
      (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')`,
    [secondRevision.id, `ill-${randomUUID()}`]);
    await publishDraft(services, secondDraft.id, 1);
    await upsertAssignment(services, child.id, secondDraft.deckId, null);
    const secondSession = await startSession(services, { childId: child.id, deckId: secondDraft.deckId, microphoneEnabled: false });
    const secondTask = await nextTask(services, secondSession.sessionId);
    expect(secondTask?.exerciseType).toBe("exposure");
    const secondStreamId = randomUUID();
    await recordRewardActivitySignal(services, { sessionId: secondSession.sessionId, taskId: secondTask!.taskId, streamId: secondStreamId, sequence: 1, kind: "interaction" });
    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, { sessionId: secondSession.sessionId, taskId: secondTask!.taskId, streamId: secondStreamId, sequence: 2, kind: "heartbeat" });
    clock.advanceMs(10_000);
    await completePresentation(services, { taskId: secondTask!.taskId });
    const secondAward = await pool.query<{ credited_milliseconds: string; awarded_points: number; remainder_milliseconds: number }>(
      "select credited_milliseconds::text, awarded_points, remainder_milliseconds from learning_app.reward_activity_settlements where session_id=$1",
      [secondSession.sessionId],
    );
    expect(secondAward.rows).toMatchObject([{ credited_milliseconds: "25000", awarded_points: 0, remainder_milliseconds: 45000 }]);
    expect(await listKidProfiles(services)).toMatchObject([{ childId: child.id, rewards: { earnedPoints: 1, pointsToUse: 1, readyXboxPacks: 0, todayCreditedSeconds: 105 } }]);
    expect(await listKidDecks(services, child.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ deckId: draft.deckId, earnedPoints: 1 }),
      expect.objectContaining({ deckId: secondDraft.deckId, earnedPoints: 0 }),
    ]));
    expect((await endSession(services, secondSession.sessionId)).reward).toEqual({ creditedSeconds: 25, pointsEarned: 0 });
    await deleteChild(services, child.id);
    for (const table of ["reward_activity_streams", "reward_activity_segments", "reward_activity_settlements", "reward_activity_pauses", "reward_activity_playback_authorizations"]) {
      const result = await pool.query(`select count(*)::int as count from learning_app.${table} where child_id = $1`, [child.id]);
      expect(result.rows[0]?.count).toBe(0);
    }
  });
});
