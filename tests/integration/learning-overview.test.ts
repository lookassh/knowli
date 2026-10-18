import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { endSession, getLearningOverview, issueIntegrationToken, updateChild, upsertAssignment } from "@learning/server";
import { LearningOverviewDtoSchema } from "@learning/contracts";
import { learningOverviewWorld } from "../fixtures/learning-overview-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

describe("GET learning overview read model", () => {
  it("keeps currentProgress across policy switches and selects newer credible results from either policy", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    const skillVersionId = (await pool.query<{ skill_version_id: string }>(
      `select links.skill_version_id from learning_app.item_revision_skills links
         join learning_app.item_revisions revisions on revisions.id=links.item_revision_id
        where revisions.deck_version_id=$1 and links.skill='listening' limit 1`, [world.versionId],
    )).rows[0]!.skill_version_id;
    await pool.query(`insert into learning_app.child_skill_progress
      (child_id, skill_version_id, policy_id, status, independent_success_streak,
       last_reviewed_at, first_issued_at, has_qualifying_assessment, projection_version)
      values ($1,$2,'learning-v2','mastered',3,'2026-10-06T10:00:00Z','2026-10-01T00:00:00Z',true,'proj-3')`,
    [world.childId, skillVersionId]);
    await pool.query(`update learning_app.child_profiles set policy_id='learning-v1' where id=$1`, [world.childId]);
    await pool.query(`insert into learning_app.child_skill_progress
      (child_id, skill_version_id, policy_id, status, independent_success_streak, first_issued_at,
       has_qualifying_assessment, projection_version)
      values ($1,$2,'learning-v1','unseen',0,'2030-01-01T00:00:00Z',false,'proj-3')`,
    [world.childId, skillVersionId]);

    const getListening = async () => {
      const overview = await getLearningOverview(services, { days: 1, upcomingTestDays: 14 }, world.token);
      return overview.children.find(({ childId }) => childId === world.childId)!.currentProgress
        .flatMap(({ skills }) => skills).find(({ skill }) => skill === "listening")!;
    };
    expect(await getListening()).toMatchObject({ mastered: 1, notAssessed: 0 });

    await pool.query(`update learning_app.child_skill_progress
      set status='practicing', independent_success_streak=1, last_reviewed_at='2026-10-06T12:00:00Z', has_qualifying_assessment=true
      where child_id=$1 and skill_version_id=$2 and policy_id='learning-v1'`, [world.childId, skillVersionId]);
    expect(await getListening()).toMatchObject({ practicing: 1, mastered: 0 });
    await pool.query(`update learning_app.child_skill_progress
      set status='needs_confirmation', independent_success_streak=0, last_reviewed_at='2026-10-06T13:00:00Z'
      where child_id=$1 and skill_version_id=$2 and policy_id='learning-v2'`, [world.childId, skillVersionId]);
    expect(await getListening()).toMatchObject({ needsConfirmation: 1, practicing: 0 });
  });

  it("keeps all five skill denominators for profiles with different reading settings and exposes no capability flag", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    await updateChild(services, world.childId, { canRead: false });
    await upsertAssignment(services, world.siblingId, world.deckId, null);

    const result = await getLearningOverview(services, { days: 1, upcomingTestDays: 14 }, world.token);
    expect(result.schemaVersion).toBe(1);
    const first = result.children.find(({ childId }) => childId === world.childId)!;
    const sibling = result.children.find(({ childId }) => childId === world.siblingId)!;
    for (const child of [first, sibling]) {
      const progress = child.currentProgress.find(({ deckId }) => deckId === world.deckId)!;
      expect(progress.totalItems).toBe(1);
      expect(progress.skills).toHaveLength(5);
      expect(progress.skills.map(({ skill }) => skill).sort()).toEqual(["listening", "pronunciation", "reading", "recall", "spelling"].sort());
      expect(progress.skills.every((skill) => skill.mastered + skill.needsConfirmation + skill.needsReconfirmation + skill.practicing + skill.notAssessed === progress.totalItems)).toBe(true);
      expect(progress).not.toHaveProperty("canRead");
      expect(child).not.toHaveProperty("canRead");
    }
    expect(first.currentProgress[0]!.skills).toEqual(sibling.currentProgress[0]!.skills);
  });

  it("returns every local day, activity, current progress and Umiem test dates without mutating learning state", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    await endSession(services, world.sessionId);
    const before = await pool.query(`select
      (select count(*)::int from learning_app.learning_sessions) as sessions,
      (select count(*)::int from learning_app.attempts) as attempts,
      (select count(*)::int from learning_app.assessments) as assessments,
      (select count(*)::int from learning_app.learning_events) as events,
      (select state from learning_app.learning_sessions where id=$1) as session_state`, [world.sessionId]);

    const result = await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, world.token);
    expect(LearningOverviewDtoSchema.parse(result)).toEqual(result);
    expect(new Set(result.children.map((child) => child.childId))).toEqual(new Set([world.childId, world.siblingId]));
    const child = result.children.find(({ childId }) => childId === world.childId)!;
    expect(child.dailyActivity.map(({ date }) => date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(child.dailyActivity[0]).toMatchObject({ hasRecordedActivity: false, learningTime: { seconds: 0, estimated: true } });
    expect(child.dailyActivity[2]).toMatchObject({
      isPartialDay: true,
      hasRecordedActivity: true,
      sessionsWithActivity: 1,
      submittedAttempts: 0,
      learningTime: { seconds: 30, estimated: true },
    });
    expect(child.currentProgress[0]?.skills).toHaveLength(5);
    expect(child.plannedTests).toMatchObject([{ date: "2026-10-15", daysUntil: 4, goals: ["recall", "spelling"], source: "umiem_assignment" }]);
    expect(result.children.find(({ childId }) => childId === world.siblingId)?.dailyActivity.every(({ learningTime }) => learningTime.seconds === 0)).toBe(true);

    const after = await pool.query(`select
      (select count(*)::int from learning_app.learning_sessions) as sessions,
      (select count(*)::int from learning_app.attempts) as attempts,
      (select count(*)::int from learning_app.assessments) as assessments,
      (select count(*)::int from learning_app.learning_events) as events,
      (select state from learning_app.learning_sessions where id=$1) as session_state`, [world.sessionId]);
    expect(after.rows).toEqual(before.rows);
  });

  it("filters only the requested child and does not reveal sibling records", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    const result = await getLearningOverview(services, { days: 1, upcomingTestDays: 1, childId: world.siblingId }, world.token);
    expect(result.children.map(({ childId }) => childId)).toEqual([world.siblingId]);
  });

  it("counts a processing answer as submitted and pending", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    const task = (await pool.query<{ id: string; child_id: string; item_revision_id: string }>(
      "select id, child_id, item_revision_id from learning_app.session_tasks where session_id=$1 order by ordinal desc limit 1", [world.sessionId],
    )).rows[0]!;
    const taskRow = (await pool.query<{ child_id: string; item_revision_id: string }>(
      "select child_id, item_revision_id from learning_app.session_tasks where id=$1", [task.id],
    )).rows[0]!;
    const attemptId = randomUUID();
    await pool.query(`insert into learning_app.attempts
      (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number,
       modality, state, answer, context, policy_id, received_at)
      values ($1,$2,$3,$4,$5,'synthetic-hash',(select coalesce(max(attempt_number),0)+1 from learning_app.attempts where task_id=$3),'audio','processing',
       jsonb_build_object('pending',true),jsonb_build_object('receivedAt',$6::text),'learning-v1',$6::timestamptz)`,
    [attemptId, taskRow.child_id, task.id, taskRow.item_revision_id, randomUUID(), "2026-10-11T16:59:00.000Z"]);

    const result = await getLearningOverview(services, { days: 1, upcomingTestDays: 14 }, world.token);
    const today = result.children.find(({ childId }) => childId === world.childId)!.dailyActivity[0]!;
    expect(today).toMatchObject({ submittedAttempts: 1, pendingAttempts: 1 });
  });

  it("returns an empty children list for a family without profiles", async () => {
    const { services } = buildTestServices("2026-10-11T17:00:00.000Z");
    const token = `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
    await issueIntegrationToken(services, "empty family", token);
    await expect(getLearningOverview(services, { days: 2, upcomingTestDays: 14 }, token)).resolves.toMatchObject({
      children: [],
      period: { from: "2026-10-10", to: "2026-10-11", days: 2 },
    });
  });
});
