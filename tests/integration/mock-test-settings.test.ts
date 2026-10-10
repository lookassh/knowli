import { afterAll, beforeEach, expect, it } from "vitest";
import { upsertAssignment, startSession } from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { mockTestDeck } from "./mock-test-helpers";
const { pool } = testDatabase();
beforeEach(truncateCoreTables);
afterAll(() => pool.end());
it("keeps count and goals on date-only PUT and isolates assignments", async () => {
  const { services } = buildTestServices();
  const a = await mockTestDeck(services, 1, false), b = await mockTestDeck(services, 1, false);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "spelling"], mockTestTaskCount: 7 });
  await upsertAssignment(services, b.childId, a.deckId, null, { testGoals: ["listening"], mockTestTaskCount: 25 });
  await upsertAssignment(services, a.childId, a.deckId, "2026-10-12");
  const { rows } = await pool.query(`select child_id,test_goals,mock_test_task_count from learning_app.assignments where deck_id=$1 order by mock_test_task_count`, [a.deckId]);
  expect(rows).toEqual([
    { child_id: a.childId, test_goals: ["recall", "spelling"], mock_test_task_count: 7 },
    { child_id: b.childId, test_goals: ["listening"], mock_test_task_count: 25 },
  ]);
  const defaults = (await pool.query(`select test_goals,mock_test_task_count from learning_app.assignments where deck_id=$1`, [b.deckId])).rows[0];
  expect(defaults).toEqual({ test_goals: null, mock_test_task_count: 10 });
});
it("rejects plan mutation but allows session close and preserves legacy training", async () => {
  const { services } = buildTestServices();
  const a = await mockTestDeck(services, 1, false);
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false });
  expect(s.mode).toBe("training");
  await expect(pool.query(`update learning_app.learning_sessions set mode='mock_test',mock_test_plan='{}' where id=$1`, [s.sessionId])).rejects.toThrow();
  await pool.query(`update learning_app.learning_sessions set state='ended',ended_at=now() where id=$1`, [s.sessionId]);
  await expect(pool.query(`update learning_app.assignments set mock_test_task_count=0 where child_id=$1`, [a.childId])).rejects.toThrow();
  await expect(pool.query(`update learning_app.assignments set test_goals=ARRAY['recall','recall'] where child_id=$1`, [a.childId])).rejects.toThrow();
});
