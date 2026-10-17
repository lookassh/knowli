import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { completePresentation, createChild, createDraft, createServices, endSession, migrateDatabase, nextTask, publishDraft, readParentWorkCard, rebuildKidRewardProjection, startSession, upsertAssignment } from "@learning/server";
import { ManualClock, openQuietDatabase, testDatabaseUrl, waitForDatabaseIdle } from "./helpers";

const migrationsFolder = path.resolve("packages/server/drizzle");
const adminPool = openQuietDatabase(testDatabaseUrl()).pool;
afterAll(async () => { await adminPool.end(); });

describe("reward projection migration", () => {
  it("backfills points and days from their source ledgers, handles DST/invalid timezone, and retires old rounds", async () => {
    const temporaryFolder = await mkdtemp(path.join(tmpdir(), "knowli-reward-projection-"));
    const databaseName = `reward_projection_${randomUUID().replaceAll("-", "")}`;
    const databaseUrl = new URL(testDatabaseUrl());
    databaseUrl.pathname = `/${databaseName}`;
    let closeTestPool: (() => Promise<void>) | undefined;
    try {
      const fullJournal = JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
      const legacyEntries = fullJournal.entries.slice(0, 16);
      const legacyFolder = path.join(temporaryFolder, "legacy");
      await mkdir(path.join(legacyFolder, "meta"), { recursive: true });
      await writeFile(path.join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...fullJournal, entries: legacyEntries }));
      for (const { tag } of legacyEntries) await copyFile(path.join(migrationsFolder, `${tag}.sql`), path.join(legacyFolder, `${tag}.sql`));
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      await migrateDatabase(databaseUrl.toString(), legacyFolder);

      const { db, pool } = openQuietDatabase(databaseUrl.toString());
      closeTestPool = () => pool.end();
      const clock = new ManualClock("2026-10-25T02:00:00.000Z");
      const services = createServices({ db, clock });
      const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
      const draft = await createDraft(services, { title: "Migration test", items: [{
        source: "kot", target: "cat", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
      }] });
      const revision = (await pool.query<{ id: string }>("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows[0]!;
      const assetId = randomUUID();
      const fingerprint = `test-${randomUUID()}`;
      await pool.query(`insert into learning_app.media_assets
        (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
        values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake','{"durationMs":20000}'::jsonb)`,
      [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`]);
      await pool.query(`insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state)
        values ($1,'target_audio',$2,$3,'approved'), ($1,'illustration',null,'omit-test','omitted')`, [revision.id, assetId, fingerprint]);
      await publishDraft(services, draft.id, 1);
      await upsertAssignment(services, child.id, draft.deckId, null);
      const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
      const task = (await nextTask(services, session.sessionId))!;
      expect(task).toBeTruthy();
      await pool.query("update learning_app.learning_sessions set context=jsonb_set(context,'{timezone}','\"Invalid/Timezone\"'::jsonb,true) where id=$1", [session.sessionId]);
      await endSession(services, session.sessionId);

      const legacyRoundId = randomUUID();
      await pool.query(`insert into learning_app.learning_sessions
        (id,child_id,assignment_id,deck_id,deck_version_id,policy_id,microphone_enabled,mode,daily_round_date,
         mock_test_plan,state,task_budget,started_at,ended_at,context)
        select $2,child_id,assignment_id,deck_id,deck_version_id,policy_id,microphone_enabled,'daily_round','2026-10-25',
         null,'active',task_budget,started_at,null,jsonb_set(context,'{timezone}','"america/new_york"'::jsonb,true)
        from learning_app.learning_sessions where id=$1`, [session.sessionId, legacyRoundId]);
      const roundTaskId = randomUUID();
      await pool.query(`insert into learning_app.session_tasks
        (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,direction,state,public_prompt,answer_key,context,issued_at)
        select $2,$3,child_id,deck_version_id,item_revision_id,0,exercise_type,direction,'issued',public_prompt,answer_key,context,issued_at
        from learning_app.session_tasks where id=$1`, [task.taskId, roundTaskId, legacyRoundId]);
      const completedExposureTaskId = randomUUID();
      const completedLessonCardTaskId = randomUUID();
      await pool.query(`insert into learning_app.session_tasks
        (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,direction,state,public_prompt,answer_key,context,issued_at)
        select $2,$3,child_id,deck_version_id,item_revision_id,1,'exposure',direction,'completed',public_prompt,answer_key,context,issued_at
        from learning_app.session_tasks where id=$1`, [task.taskId, completedExposureTaskId, legacyRoundId]);
      await pool.query(`insert into learning_app.session_tasks
        (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,direction,state,public_prompt,answer_key,context,issued_at)
        select $2,$3,child_id,deck_version_id,item_revision_id,2,'lesson_card',direction,'completed',public_prompt,answer_key,context,issued_at
        from learning_app.session_tasks where id=$1`, [task.taskId, completedLessonCardTaskId, legacyRoundId]);
      const settlementZero = randomUUID();
      const settlementAwarded = randomUUID();
      const streamZero = randomUUID();
      const streamAwarded = randomUUID();
      const completionZero = randomUUID();
      const completionAwarded = randomUUID();
      await pool.query(`insert into learning_app.reward_activity_settlements
        (id,child_id,session_id,task_id,completion_ref,kind,settled_at,deck_id,credited_milliseconds,awarded_points,remainder_milliseconds,timezone)
        values ($1,$2,$3,$4,$5,'presentation',$6,$7,0,0,0,'Europe/Warsaw'),
               ($8,$2,$11,$9,$10,'presentation',$6,$7,1802500,30,2500,'Europe/Warsaw')`,
      [settlementZero, child.id, session.sessionId, task.taskId, completionZero, clock.now(), draft.deckId,
        settlementAwarded, roundTaskId, completionAwarded, legacyRoundId]);
      await pool.query(`insert into learning_app.reward_activity_streams
        (id,child_id,session_id,task_id,policy_version,last_sequence,last_signal_at,last_interaction_at,active)
        values ($1,$2,$3,$4,'1',1,$5,$5,false), ($6,$2,$7,$8,'1',1,$5,$5,true)`,
      [streamZero, child.id, session.sessionId, task.taskId, clock.now(), streamAwarded, legacyRoundId, roundTaskId]);
      await pool.query(`insert into learning_app.reward_activity_segments
        (id,stream_id,child_id,session_id,task_id,started_at,ended_at,settlement_ref)
        values ($1,$2,$3,$4,$5,'2026-10-24T21:45:00Z','2026-10-24T22:15:00Z',$6),
               ($7,$8,$3,$9,$10,'2026-10-25T00:45:00Z','2026-10-25T01:15:00Z',$11),
               ($12,$8,$3,$9,$10,'2026-10-25T01:15:00Z','2026-10-25T01:16:00Z',null)`,
      [randomUUID(), streamZero, child.id, session.sessionId, task.taskId, settlementZero,
        randomUUID(), streamAwarded, legacyRoundId, roundTaskId, settlementAwarded, randomUUID()]);
      const blockId = randomUUID();
      await pool.query(`insert into learning_app.reward_activity_xbox_blocks
        (id,child_id,timezone,local_date,block_number,credited_seconds_at_creation)
        values ($1,$2,'Europe/Warsaw','2026-10-25',1,2700)`, [blockId, child.id]);
      await pool.query(`insert into learning_app.reward_activity_xbox_requests
        (id,child_id,block_id,status,timezone_snapshot,local_date_snapshot,block_number_snapshot,credited_seconds_snapshot)
        values ($1,$2,$3,'pending','Europe/Warsaw','2026-10-25',1,2700)`, [randomUUID(), child.id, blockId]);
      const playbackId = randomUUID();
      await pool.query(`insert into learning_app.reward_activity_playback_authorizations
        (id,stream_id,child_id,session_id,task_id,asset_id,asset_duration_ms,authorized_at,expires_at)
        values ($1,$2,$3,$4,$5,$6,20000,$7,$8)`,
      [playbackId, streamAwarded, child.id, legacyRoundId, roundTaskId, assetId, clock.now(), new Date(clock.now().getTime() + 60_000)]);

      await migrateDatabase(databaseUrl.toString(), migrationsFolder);
      const projection = (await pool.query(`select earned_points, credited_milliseconds, remainder_milliseconds, qualified_packs, consumed_packs
        from learning_app.child_reward_projection where child_id=$1`, [child.id])).rows[0];
      expect(projection).toMatchObject({ earned_points: 30, credited_milliseconds: "1802500", remainder_milliseconds: 2500, qualified_packs: 1, consumed_packs: 1 });
      const deckProjection = (await pool.query("select earned_points from learning_app.deck_reward_projection where child_id=$1 and deck_id=$2", [child.id, draft.deckId])).rows[0];
      expect(deckProjection?.earned_points).toBe(30);
      const days = (await pool.query(`select timezone,local_date,credited_milliseconds from learning_app.reward_day_projection
        where child_id=$1 order by timezone,local_date`, [child.id])).rows;
      expect(days).toEqual([
        { timezone: "Europe/Warsaw", local_date: "2026-10-24", credited_milliseconds: "900000" },
        { timezone: "Europe/Warsaw", local_date: "2026-10-25", credited_milliseconds: "900000" },
        { timezone: "america/new_york", local_date: "2026-10-24", credited_milliseconds: "1800000" },
      ]);
      const retired = (await pool.query("select state,ended_at from learning_app.learning_sessions where id=$1", [legacyRoundId])).rows[0];
      expect(retired.state).toBe("ended");
      expect(retired.ended_at).not.toBeNull();
      expect((await pool.query("select active from learning_app.reward_activity_streams where id=$1", [streamAwarded])).rows[0]?.active).toBe(false);
      expect((await pool.query("select revoked_at from learning_app.reward_activity_playback_authorizations where id=$1", [playbackId])).rows[0]?.revoked_at).not.toBeNull();
      expect((await pool.query("select settlement_ref from learning_app.reward_activity_segments where id=$1", [(await pool.query("select id from learning_app.reward_activity_segments where settlement_ref is null and task_id=$1", [roundTaskId])).rows[0]?.id])).rows[0]?.settlement_ref).toBeNull();
      const lowerCaseZoneDays = (await pool.query(`select timezone,local_date,credited_milliseconds from learning_app.reward_day_projection
        where child_id=$1 and timezone='america/new_york'`, [child.id])).rows;
      expect(lowerCaseZoneDays).toEqual([{ timezone: "america/new_york", local_date: "2026-10-24", credited_milliseconds: "1800000" }]);
      const beforeLatePost = {
        task: (await pool.query("select state from learning_app.session_tasks where id=$1", [roundTaskId])).rows[0],
        segment: (await pool.query("select settlement_ref from learning_app.reward_activity_segments where task_id=$1 and settlement_ref is null", [roundTaskId])).rows,
        assessments: (await pool.query("select count(*)::int count from learning_app.assessments where child_id=$1", [child.id])).rows[0]?.count,
        settlements: (await pool.query("select count(*)::int count from learning_app.reward_activity_settlements where task_id=$1", [roundTaskId])).rows[0]?.count,
        projection: (await pool.query("select * from learning_app.child_reward_projection where child_id=$1", [child.id])).rows[0],
      };
      await expect(completePresentation(services, { taskId: roundTaskId })).rejects.toMatchObject({ code: "conflict" });
      expect({
        task: (await pool.query("select state from learning_app.session_tasks where id=$1", [roundTaskId])).rows[0],
        segment: (await pool.query("select settlement_ref from learning_app.reward_activity_segments where task_id=$1 and settlement_ref is null", [roundTaskId])).rows,
        assessments: (await pool.query("select count(*)::int count from learning_app.assessments where child_id=$1", [child.id])).rows[0]?.count,
        settlements: (await pool.query("select count(*)::int count from learning_app.reward_activity_settlements where task_id=$1", [roundTaskId])).rows[0]?.count,
        projection: (await pool.query("select * from learning_app.child_reward_projection where child_id=$1", [child.id])).rows[0],
      }).toEqual(beforeLatePost);
      const beforeRebuild = {
        child: (await pool.query("select earned_points,credited_milliseconds,remainder_milliseconds,qualified_packs,consumed_packs from learning_app.child_reward_projection where child_id=$1", [child.id])).rows,
        decks: (await pool.query("select deck_id,earned_points from learning_app.deck_reward_projection where child_id=$1 order by deck_id", [child.id])).rows,
        days: (await pool.query("select timezone,local_date,credited_milliseconds from learning_app.reward_day_projection where child_id=$1 order by timezone,local_date", [child.id])).rows,
      };
      await rebuildKidRewardProjection(services, child.id);
      expect({
        child: (await pool.query("select earned_points,credited_milliseconds,remainder_milliseconds,qualified_packs,consumed_packs from learning_app.child_reward_projection where child_id=$1", [child.id])).rows,
        decks: (await pool.query("select deck_id,earned_points from learning_app.deck_reward_projection where child_id=$1 order by deck_id", [child.id])).rows,
        days: (await pool.query("select timezone,local_date,credited_milliseconds from learning_app.reward_day_projection where child_id=$1 order by timezone,local_date", [child.id])).rows,
      }).toEqual(beforeRebuild);
      const historicalReport = await readParentWorkCard(services, { childId: child.id, date: "2026-10-24" });
      expect(historicalReport.sessions.find(row => row.sessionId === legacyRoundId)?.remainingSteps).toBe((await pool.query(
        "select task_budget from learning_app.learning_sessions where id=$1", [legacyRoundId],
      )).rows[0]?.task_budget - 3);
      expect(historicalReport.sessions.find(row => row.sessionId === legacyRoundId)?.steps.map(step => step.exerciseType))
        .toEqual(expect.arrayContaining(["exposure", "lesson_card"]));
    } finally {
      await closeTestPool?.().catch(() => undefined);
      await waitForDatabaseIdle(adminPool, databaseName).catch(() => undefined);
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  }, 180_000);
});
