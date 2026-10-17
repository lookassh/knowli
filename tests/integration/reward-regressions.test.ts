import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { completePresentation, createChild, createDraft, endSession, ensureLearningPolicy, listKidDecks, nextTask, publishDraft, readParentWorkCard, readRewardActivitySummary, recordRewardActivitySignal, startSession, submitAttempt, upsertAssignment } from "@learning/server";
import { settleRewardActivity } from "../../packages/server/src/modules/reward-activity";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();
afterAll(() => pool.end());
beforeEach(async () => { await truncateCoreTables(); await pool.query("update learning_app.family_settings set timezone='Europe/Warsaw'"); });
afterEach(async () => { await pool.query("update learning_app.family_settings set timezone='Europe/Warsaw'"); });

async function lessonTask(startIso = "2026-10-16T10:00:00Z") {
  const { services, clock } = buildTestServices(startIso);
  const child = await createChild(services, { displayName: "Test", avatarKey: "owl" });
  const lesson = await lessonWorld(pool, { childId: child.id, now: clock.now() });
  const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
  let task = await nextTask(services, session.sessionId);
  for (let index = 0; task?.exerciseType === "lesson_card" && index < 10; index++) {
    await completePresentation(services, { taskId: task.taskId });
    task = await nextTask(services, session.sessionId);
  }
  expect(task?.exerciseType).toBe("lesson_choice");
  const key = (await pool.query("select answer_key from learning_app.session_tasks where id=$1", [task!.taskId])).rows[0].answer_key;
  return { services, clock, child, lesson, session, task: task!, key };
}

describe("reward and work-card review regressions", () => {
  it("settles a deterministic lesson answer exactly once and releases its stream", async () => {
    const { services, clock, child, session, task, key } = await lessonTask();
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId: randomUUID(), sequence: 1, kind: "takeover" });
    clock.advanceMs(15_000);
    const input = { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice" as const, optionId: key.correctOptionId };
    await submitAttempt(services, input);
    await submitAttempt(services, input);
    expect((await readRewardActivitySummary(services, child.id)).creditedSeconds).toBe(15);
    expect((await pool.query("select * from learning_app.reward_activity_settlements where task_id=$1", [task.taskId])).rows).toHaveLength(1);
    expect((await pool.query("select active from learning_app.reward_activity_streams where task_id=$1", [task.taskId])).rows).toEqual([{ active: false }]);
  });

  it("rejects an unannounced replacement stream with a domain conflict", async () => {
    const { services, session, task } = await lessonTask();
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId: randomUUID(), sequence: 1, kind: "interaction" });
    await expect(recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId: randomUUID(), sequence: 1, kind: "interaction" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("validates stream ownership before accepting an equal sequence", async () => {
    const first = await lessonTask();
    const second = await lessonTask();
    const streamId = randomUUID();
    await recordRewardActivitySignal(first.services, { sessionId: first.session.sessionId, taskId: first.task.taskId, streamId, sequence: 1, kind: "interaction" });
    await expect(recordRewardActivitySignal(second.services, { sessionId: second.session.sessionId, taskId: second.task.taskId, streamId, sequence: 1, kind: "interaction" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("accepts an exact takeover replay after a lost response", async () => {
    const { services, session, task } = await lessonTask();
    const input = { sessionId: session.sessionId, taskId: task.taskId, streamId: randomUUID(), sequence: 1, kind: "takeover" as const };
    const result = await recordRewardActivitySignal(services, input);
    expect(await recordRewardActivitySignal(services, input)).toEqual(result);
  });

  it("does not credit an unclosed tail when a new device takes over", async () => {
    const { services, clock, session, task } = await lessonTask();
    const firstStreamId = randomUUID();
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId: firstStreamId, sequence: 1, kind: "takeover" });
    clock.advanceMs(5_000);

    const replacementStreamId = randomUUID();
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId: replacementStreamId, sequence: 1, kind: "takeover" });
    expect((await pool.query("select id from learning_app.reward_activity_segments where stream_id=$1", [firstStreamId])).rows).toHaveLength(0);

    clock.advanceMs(15_000);
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId: replacementStreamId, sequence: 2, kind: "heartbeat" });
    const interval = (await pool.query<{ duration_ms: string }>(`select (extract(epoch from (ended_at-started_at))*1000)::text as duration_ms
      from learning_app.reward_activity_segments where stream_id=$1`, [replacementStreamId])).rows[0];
    expect(Number(interval?.duration_ms)).toBe(15_000);
  });

  it("keeps authorized long playback active past the interaction idle window", async () => {
    const { services, clock, child, session, task, key } = await lessonTask();
    const streamId = randomUUID(), authorizationId = randomUUID(), assetId = randomUUID();
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId, sequence: 1, kind: "takeover" });
    await pool.query(`insert into learning_app.media_assets
      (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
      values ($1,'tts',$2,1,'ready',$2,$2,'audio/mpeg',100,'fake','fake','{"durationMs":120000}')`, [assetId, randomUUID()]);
    await pool.query(`insert into learning_app.reward_activity_playback_authorizations
      (id,stream_id,child_id,session_id,task_id,asset_id,asset_duration_ms,authorized_at,expires_at)
      values ($1,$2,$3,$4,$5,$6,120000,$7,$8)`,
    [authorizationId, streamId, child.id, session.sessionId, task.taskId, assetId, clock.now(), new Date(clock.now().getTime() + 30_000)]);
    await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId, sequence: 2, kind: "playback_start", playbackAuthorizationId: authorizationId, playbackAssetId: assetId });
    for (let index = 0; index < 7; index++) {
      clock.advanceMs(15_000);
      const signal = await recordRewardActivitySignal(services, { sessionId: session.sessionId, taskId: task.taskId, streamId, sequence: index + 3, kind: "heartbeat" });
      expect(signal.paused).toBe(false);
    }
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId });
    expect((await readRewardActivitySummary(services, child.id)).creditedSeconds).toBe(105);
  });

  it("counts only budgeted lesson exercises as remaining work", async () => {
    const { services, child, session } = await lessonTask();
    const report = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    expect(report.sessions[0]?.remainingSteps).toBe(session.taskBudget - 1);
  });

  it("reports a response with graded recall and unassessed spelling as mixed", async () => {
    const { services, clock } = buildTestServices("2026-10-16T10:00:00Z");
    const child = await createChild(services, { displayName: "Test", avatarKey: "owl" });
    const draft = await createDraft(services, { title: "Słówka", items: [{ source: "kot", target: "cat", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" }] });
    const revision = (await pool.query("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows[0];
    const assetId = randomUUID(), fingerprint = randomUUID();
    await pool.query(`insert into learning_app.media_assets (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model)
      values ($1,'tts',$2,1,'ready',$2,$2,'audio/mpeg',100,'fake','fake')`, [assetId, fingerprint]);
    await pool.query(`insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved'),($1,'illustration',null,$3,'omitted')`, [revision.id, assetId, fingerprint]);
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
    const taskId = randomUUID(), attemptId = randomUUID();
    await pool.query(`insert into learning_app.session_tasks (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,state,public_prompt,answer_key,issued_at)
      values ($1,$2,$3,$4,$5,0,'written_recall','answered','{}','{}',$6)`, [taskId, session.sessionId, child.id, draft.id, revision.id, clock.now()]);
    await pool.query(`insert into learning_app.attempts (id,child_id,task_id,item_revision_id,client_attempt_id,request_hash,attempt_number,modality,state,answer,context,policy_id,received_at,completed_at)
      select $1,$2,$3,$4,$5,'mixed',1,'text','processing','{"text":"cat"}','{}',policy_id,$6,null from learning_app.learning_sessions where id=$7`, [attemptId, child.id, taskId, revision.id, randomUUID(), clock.now(), session.sessionId]);
    await pool.query(`insert into learning_app.assessments (child_id,attempt_id,item_revision_id,skill,skill_version_id,outcome,independent,confirmation_eligible)
      select $1,$2,$3,skill,skill_version_id,case when skill='recall' then 'correct' else 'unassessed' end,false,false
      from learning_app.item_revision_skills where item_revision_id=$3 and skill in ('recall','spelling')`, [child.id, attemptId, revision.id]);
    await pool.query("update learning_app.attempts set state='completed',completed_at=$2 where id=$1", [attemptId, clock.now()]);
    const report = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    expect(report.sessions[0]?.steps[0]?.responses[0]?.assessment).toBe("mixed");
  });

  it("shows the ordered words as an answer example for lesson sequence responses", async () => {
    const { services, clock, child, session, task } = await lessonTask();
    const sequenceTaskId = randomUUID();
    await pool.query(`insert into learning_app.session_tasks
      (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,state,public_prompt,answer_key,issued_at)
      select $1,session_id,child_id,deck_version_id,item_revision_id,ordinal+1,'lesson_order','answered','{}'::jsonb,$3::jsonb,$4
      from learning_app.session_tasks where id=$2`, [
      sequenceTaskId, task.taskId, JSON.stringify({ itemIds: ["a", "b"], itemValues: { a: "She", b: "runs" } }), clock.now(),
    ]);
    await pool.query(`insert into learning_app.attempts
      (id,child_id,task_id,item_revision_id,client_attempt_id,request_hash,attempt_number,modality,state,answer,context,policy_id,received_at,completed_at)
      select $1,st.child_id,st.id,st.item_revision_id,$2,'ordered',1,'sequence','completed',$3::jsonb,'{}',ls.policy_id,$4,$4
      from learning_app.session_tasks st inner join learning_app.learning_sessions ls on ls.id=st.session_id where st.id=$5`,
    [randomUUID(), randomUUID(), JSON.stringify({ itemIds: ["a", "b"] }), clock.now(), sequenceTaskId]);

    const report = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    const responses = report.sessions.find(row => row.sessionId === session.sessionId)?.steps.flatMap(step => step.responses) ?? [];
    expect(responses.map(response => response.answerExample)).toContain("She runs");
  });

  it("settles while a concurrent session resume holds the profile lock", async () => {
    const { services, clock, child, lesson, session, task } = await lessonTask();
    let resume: Promise<unknown> | undefined;
    await services.db.transaction(async tx => {
      // Reproduce the precise legacy lock graph: finalization owns the session,
      // while resume owns the profile and waits for that session.
      await tx.execute(`select id from learning_app.learning_sessions where id='${session.sessionId}' for update`);
      resume = startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false }).catch(error => error);
      let blocked = false;
      for (let index = 0; index < 100 && !blocked; index++) {
        blocked = (await pool.query(`select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
          and wait_event_type='Lock' and query like '%learning_sessions%for update%'`)).rows.length > 0;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await settleRewardActivity(tx, { childId: child.id, sessionId: session.sessionId, taskId: task.taskId, completionRef: randomUUID(), kind: "attempt", at: clock.now() });
    });
    expect(await resume).toMatchObject({ sessionId: session.sessionId, resumed: true });
  });

  it("includes today's issued task from a session started yesterday without an answer or reward time", async () => {
    const { services, clock, child, session } = await lessonTask("2026-10-16T21:59:50Z");
    const current = await nextTask(services, session.sessionId);
    await submitAttempt(services, { taskId: current!.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    clock.advanceMs(20_000);
    const issued = await nextTask(services, session.sessionId);
    expect(issued).not.toBeNull();
    const report = await readParentWorkCard(services, { childId: child.id, date: "2026-10-17" });
    expect(report.sessions.flatMap(value => value.steps.map(step => step.taskId))).toContain(issued!.taskId);
  });

  it("uses the family timezone for an omitted report date", async () => {
    const { services, child } = await lessonTask("2026-10-16T22:30:00Z");
    await pool.query("update learning_app.family_settings set timezone='Europe/Warsaw'");
    expect((await readParentWorkCard(services, { childId: child.id })).date).toBe("2026-10-17");
    await pool.query("update learning_app.family_settings set timezone='UTC'");
    expect((await readParentWorkCard(services, { childId: child.id })).date).toBe("2026-10-16");
  });



});
