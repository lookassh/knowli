import { afterAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { endSession, nextTask, startSession, submitAttempt, upsertAssignment, readMockTestSummary, getMockTestReport, listMockTests, deleteChild } from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { mockTestDeck } from "./mock-test-helpers";
const { pool } = testDatabase();
beforeEach(truncateCoreTables); afterAll(() => pool.end());
async function world(count = 4, budget = 3) {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, count); clock.advanceHours(13);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "spelling"], mockTestTaskCount: budget });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" });
  return { ...a, services, clock, s };
}
it("preserves partial full coverage, split grades and report without parent disclosures", async () => {
  const { services, s, childId, deckId } = await world();
  const t = (await nextTask(services, s.sessionId))!;
  await expect(readMockTestSummary(services, s.sessionId)).rejects.toMatchObject({ code: "conflict" });
  await submitAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "text", text: "monday" });
  const ended = await endSession(services, s.sessionId);
  expect(ended).toMatchObject({ state: "ended", practiceItems: [] });
  const report = await getMockTestReport(services, s.sessionId);
  expect(report).toMatchObject({ complete: false, requestedTaskCount: 3, taskBudget: 3 });
  expect(report.skills).toEqual([
    { skill: "recall", totalItems: 4, independentCorrect: 1, practiceNeeded: 0, correctNotIndependent: 0, notTested: 3, skipped: 0, unassessed: 0 },
    { skill: "spelling", totalItems: 4, independentCorrect: 0, practiceNeeded: 1, correctNotIndependent: 0, notTested: 3, skipped: 0, unassessed: 0 },
  ]);
  expect(report.rows.some(r => r.masteryStatus === "mastered")).toBe(false);
  expect((await pool.query(`select id from learning_app.learning_events where task_id=$1 and kind='feedback_issued'`, [t.taskId])).rows).toHaveLength(0);
  await upsertAssignment(services, childId, deckId, null, { mockTestTaskCount: 20 });
  expect(await getMockTestReport(services, s.sessionId)).toEqual(report);
  expect(await listMockTests(services, childId, deckId)).toEqual([report]);
  await expect(pool.query(`update learning_app.learning_sessions set context=context-'mockTestReport' where id=$1`, [s.sessionId])).rejects.toThrow();
});
it("seals disclosures for every summary read and excludes unissued solutions", async () => {
  const { services, clock, s } = await world(); const t = (await nextTask(services, s.sessionId))!;
  await endSession(services, s.sessionId);
  const one = await readMockTestSummary(services, s.sessionId); clock.advanceMs(1000);
  const two = await readMockTestSummary(services, s.sessionId);
  expect(two).toEqual(one); expect(one.solutions).toHaveLength(1); expect(one.answeredCount).toBe(0);
  expect(one.solutions[0]).toMatchObject({ taskId: t.taskId, target: "Monday" });
  expect((await pool.query(`select count(*)::int as n from learning_app.learning_events where task_id=$1 and kind='feedback_issued' and sealed`, [t.taskId])).rows[0].n).toBe(2);
});
it.each(["time", "stale"] as const)("closes %s timeout before issuing or resuming and retains unfinished slots", async reason => {
  const { services, clock, s, childId, deckId } = await world(); const t = (await nextTask(services, s.sessionId))!;
  await submitAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  clock.advanceMs(reason === "time" ? 600_001 : 1_800_001);
  if (reason === "time") expect(await nextTask(services, s.sessionId)).toBeNull();
  else await startSession(services, { childId, deckId, microphoneEnabled: false, mode: "mock_test" });
  expect(await getMockTestReport(services, s.sessionId)).toMatchObject({ complete: false, state: "ended" });
});
it("finish racing answer freezes one result and profile deletion preserves shared material", async () => {
  const { services, s, childId, deckId } = await world(); const t = (await nextTask(services, s.sessionId))!;
  const race = await Promise.allSettled([submitAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Monday" }), endSession(services, s.sessionId)]);
  expect(race[1].status).toBe("fulfilled");
  const report = await getMockTestReport(services, s.sessionId);
  await endSession(services, s.sessionId); expect(await getMockTestReport(services, s.sessionId)).toEqual(report);
  await deleteChild(services, childId);
  await expect(getMockTestReport(services, s.sessionId)).rejects.toMatchObject({ code: "not_found" });
  expect((await pool.query(`select id from learning_app.decks where id=$1`, [deckId])).rows).toHaveLength(1);
});
