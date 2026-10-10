import { afterAll, beforeEach, expect, it } from "vitest";
import { endSession, nextTask, startSession, upsertAssignment, submitAttempt } from "@learning/server";
import { randomUUID } from "node:crypto";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { mockTestDeck } from "./mock-test-helpers";
const { pool } = testDatabase();
beforeEach(truncateCoreTables);
afterAll(() => pool.end());
it("pins configured count and material across resume and issues one fixed task", async () => {
  const { services, clock } = buildTestServices();
  const a = await mockTestDeck(services, 15); clock.advanceHours(13);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "spelling"], mockTestTaskCount: 13 });
  const input = { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" as const };
  const s = await startSession(services, input);
  expect(s).toMatchObject({ mode: "mock_test", taskBudget: 13 });
  const before = (await pool.query(`select mock_test_plan from learning_app.learning_sessions where id=$1`, [s.sessionId])).rows[0];
  await upsertAssignment(services, a.childId, a.deckId, "2026-10-14", { testGoals: ["listening"], mockTestTaskCount: 3 });
  expect(await startSession(services, input)).toMatchObject({ sessionId: s.sessionId, resumed: true, taskBudget: 13 });
  const tasks = await Promise.all([nextTask(services, s.sessionId), nextTask(services, s.sessionId)]);
  expect(tasks[0]).toEqual(tasks[1]);
  expect(tasks[0]).toMatchObject({ exerciseType: "recall", remainingAssessed: 13 });
  expect((await pool.query(`select mock_test_plan from learning_app.learning_sessions where id=$1`, [s.sessionId])).rows[0]).toEqual(before);
  await expect(startSession(services, { ...input, mode: "training" })).rejects.toMatchObject({ code: "conflict" });
  await expect(pool.query(`update learning_app.learning_sessions set mock_test_plan='{}' where id=$1`, [s.sessionId])).rejects.toThrow();
  for (let i = 0; i < 13; i++) {
    const task = await nextTask(services, s.sessionId);
    expect(task!.ordinal).toBe(i);
    await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  expect(await nextTask(services, s.sessionId)).toBeNull();
  await endSession(services, s.sessionId);
});
it("does not create an empty mock test for unknown material", async () => {
  const { services } = buildTestServices(); const a = await mockTestDeck(services, 1, false);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall"] });
  await expect(startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" })).rejects.toMatchObject({ code: "validation" });
  expect((await pool.query(`select id from learning_app.learning_sessions where child_id=$1`, [a.childId])).rows).toEqual([]);
});
