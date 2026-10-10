import { afterAll, beforeEach, expect, it } from "vitest";
import { endSession, nextTask, startSession, upsertAssignment, submitAttempt, readAttempt, finalizeAttempt, authorizeDisclosure, submitSpeechAttempt } from "@learning/server";
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

it("does not reveal on submit, read, retry or finalize and ends after one incorrect answer", async () => {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, 2); clock.advanceHours(13);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "spelling"], mockTestTaskCount: 2 });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" });
  const t = (await nextTask(services, s.sessionId))!;
  const input = { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "text" as const, text: "wrong" };
  const result = await submitAttempt(services, input);
  expect(result).toMatchObject({ state: "completed", taskState: "answered", feedback: null, stepId: null });
  expect(await readAttempt(services, result.attemptId)).toEqual(result);
  expect(await submitAttempt(services, input)).toEqual(result);
  expect(await finalizeAttempt(services, result.attemptId, { skills: {}, attempt: { independent: false, confirmationEligible: false } })).toEqual(result);
  await expect(submitAttempt(services, { ...input, text: "Monday" })).rejects.toMatchObject({ code: "conflict" });
  await expect(submitAttempt(services, { ...input, clientAttemptId: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
  expect((await pool.query(`select id from learning_app.learning_events where task_id=$1 and kind='feedback_issued'`, [t.taskId])).rows).toEqual([]);
  await endSession(services, s.sessionId);
  expect((await readAttempt(services, result.attemptId)).feedback).toBeNull();
});

it("blocks written hints, model audio and microphone attempts but permits listening replay", async () => {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, 2); clock.advanceHours(13);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "listening"], mockTestTaskCount: 2 });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: true, mode: "mock_test" });
  const t = (await nextTask(services, s.sessionId))!;
  for (const kind of ["hint", "audio"] as const) await expect(authorizeDisclosure(services, { taskId: t.taskId, kind })).rejects.toMatchObject({ code: "conflict" });
  await expect(submitSpeechAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID() }, { bytes: new Uint8Array([1]), mimeType: "audio/webm", locale: "en-GB" })).rejects.toMatchObject({ code: "validation" });
  await submitAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  const audio = (await nextTask(services, s.sessionId))!;
  expect(audio.exerciseType).toBe("listening");
  await authorizeDisclosure(services, { taskId: audio.taskId, kind: "audio" });
  await authorizeDisclosure(services, { taskId: audio.taskId, kind: "audio" });
  expect((await pool.query(`select count(*)::int as n from learning_app.event_exposures x join learning_app.learning_events e on e.id=x.event_id where e.task_id=$1 and e.kind='audio_issued' and e.sealed`, [audio.taskId])).rows[0].n).toBe(2);
});

it.each(["dont_remember", "skip", "text"] as const)("finishes %s without support or disclosures", async modality => {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, 2); clock.advanceHours(13);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall"], mockTestTaskCount: 2 });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" });
  const t = (await nextTask(services, s.sessionId))!;
  const result = await submitAttempt(services, modality === "text" ? { taskId: t.taskId, clientAttemptId: randomUUID(), modality, text: "" } : { taskId: t.taskId, clientAttemptId: randomUUID(), modality });
  expect(result.taskState).toBe(modality === "skip" ? "skipped" : "answered");
  expect(result.feedback).toBeNull();
  expect((await nextTask(services, s.sessionId))!.ordinal).toBe(1);
  const grades = (await pool.query(`select outcome,reason from learning_app.assessments where attempt_id=$1`, [result.attemptId])).rows;
  if (modality === "skip") expect(grades).toEqual([]);
  else expect(grades.every(g => g.outcome === (modality === "text" ? "unassessed" : "incorrect"))).toBe(true);
});

it.each([299, 300])("qualifies at received_at after %i seconds and preserves split written grades", async seconds => {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, 1); clock.advanceMs(seconds * 1000);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "spelling"], mockTestTaskCount: 1 });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" });
  const t = (await nextTask(services, s.sessionId))!;
  const input = { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "text" as const, text: "monday" };
  const [one, two] = await Promise.all([submitAttempt(services, input), submitAttempt(services, input)]);
  expect(one.attemptId).toBe(two.attemptId);
  const grades = (await pool.query(`select skill,outcome,independent from learning_app.assessments where attempt_id=$1 order by skill`, [one.attemptId])).rows;
  expect(grades).toEqual([{ skill: "recall", outcome: "correct", independent: seconds === 300 }, { skill: "spelling", outcome: "incorrect", independent: seconds === 300 }]);
});

it("counts exposure of the same target in a different deck", async () => {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, 1); clock.advanceHours(13);
  const b = await mockTestDeck(services, 1, false);
  await upsertAssignment(services, a.childId, b.deckId, null);
  const training = await startSession(services, { childId: a.childId, deckId: b.deckId, microphoneEnabled: false });
  expect((await nextTask(services, training.sessionId))!.exerciseType).toBe("exposure");
  await endSession(services, training.sessionId); clock.advanceMs(299_000);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall"] });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" });
  const t = (await nextTask(services, s.sessionId))!;
  const r = await submitAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Monday" });
  expect((await pool.query(`select independent from learning_app.assessments where attempt_id=$1 and skill='recall'`, [r.attemptId])).rows[0].independent).toBe(false);
});

it("accepts exactly one of two different concurrent answers", async () => {
  const { services, clock } = buildTestServices(); const a = await mockTestDeck(services, 1); clock.advanceHours(13);
  await upsertAssignment(services, a.childId, a.deckId, null, { testGoals: ["recall", "spelling"] });
  const s = await startSession(services, { childId: a.childId, deckId: a.deckId, microphoneEnabled: false, mode: "mock_test" });
  const t = (await nextTask(services, s.sessionId))!;
  const race = await Promise.allSettled(["Monday", "wrong"].map(text => submitAttempt(services, { taskId: t.taskId, clientAttemptId: randomUUID(), modality: "text", text })));
  expect(race.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((await pool.query(`select id from learning_app.attempts where task_id=$1`, [t.taskId])).rows).toHaveLength(1);
});
