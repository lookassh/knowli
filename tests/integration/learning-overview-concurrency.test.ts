import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteChild, getLearningOverview } from "@learning/server";
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

describe("learning overview repeatable read", () => {
  it("returns one complete snapshot while a concurrent transaction deletes a child", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    let signalSnapshot!: () => void;
    let releaseSnapshot!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => { signalSnapshot = resolve; });
    const holdSnapshot = new Promise<void>((resolve) => { releaseSnapshot = resolve; });

    const reading = getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, world.token, async () => {
      signalSnapshot();
      await holdSnapshot;
    });
    await snapshotStarted;
    await deleteChild(services, world.childId);
    releaseSnapshot();

    const duringDelete = await reading;
    expect(duringDelete.children.map(({ childId }) => childId)).toEqual(expect.arrayContaining([world.childId, world.siblingId]));
    const afterDelete = await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, world.token);
    expect(afterDelete.children.map(({ childId }) => childId)).toEqual([world.siblingId]);
  });

  it("uses a PostgreSQL read-only transaction for report queries", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    const before = await pool.query(`select
      (select count(*)::int from learning_app.learning_sessions) sessions,
      (select count(*)::int from learning_app.attempts) attempts,
      (select count(*)::int from learning_app.assessments) assessments,
      (select count(*)::int from learning_app.learning_events) events,
      (select count(*)::int from learning_app.event_exposures) exposures,
      (select count(*)::int from learning_app.child_skill_progress) progress,
      (select count(*)::int from learning_app.integration_tokens) tokens`);
    await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, world.token);
    await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, world.token);
    const after = await pool.query(`select
      (select count(*)::int from learning_app.learning_sessions) sessions,
      (select count(*)::int from learning_app.attempts) attempts,
      (select count(*)::int from learning_app.assessments) assessments,
      (select count(*)::int from learning_app.learning_events) events,
      (select count(*)::int from learning_app.event_exposures) exposures,
      (select count(*)::int from learning_app.child_skill_progress) progress,
      (select count(*)::int from learning_app.integration_tokens) tokens`);
    expect(after.rows).toEqual(before.rows);
  });
});
