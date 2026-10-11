import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { getLearningOverview, issueIntegrationToken } from "@learning/server";
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
  it("returns every local day, activity, current progress and Umiem test dates without mutating learning state", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    const world = await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
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
