import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { completePresentation, createChild, createDraft, nextTask, publishDraft, readParentWorkCard, startSession, submitAttempt, upsertAssignment } from "@learning/server";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();
afterAll(() => pool.end());

/**
 * Regresje Karty pracy odtworzone po usunięciu reward-regressions.test.ts
 * (spec client-reward-time): ocena „mixed", przykład odpowiedzi sekwencji,
 * domyślna data wg strefy rodziny, zadanie wydane przed północą w karcie
 * dnia następnego i remainingSteps bez ekspozycji/kart lekcji. Bez segmentów
 * i Xbox — te już nie istnieją.
 */

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
  await pool.query("update learning_app.family_settings set timezone='Europe/Warsaw'");
});
afterEach(async () => { await pool.query("update learning_app.family_settings set timezone='Europe/Warsaw'"); });

async function lessonTask(startIso = "2026-10-16T10:00:00Z", delayFirstIssueMs = 0) {
  const { services, clock } = buildTestServices(startIso);
  const child = await createChild(services, { displayName: "Test", avatarKey: "owl" });
  const lesson = await lessonWorld(pool, { childId: child.id, now: clock.now() });
  const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
  if (delayFirstIssueMs > 0) clock.advanceMs(delayFirstIssueMs);
  let task = await nextTask(services, session.sessionId);
  for (let index = 0; task?.exerciseType === "lesson_card" && index < 10; index++) {
    await completePresentation(services, { taskId: task.taskId });
    task = await nextTask(services, session.sessionId);
  }
  expect(task?.exerciseType).toBe("lesson_choice");
  const key = (await pool.query("select answer_key from learning_app.session_tasks where id=$1", [task!.taskId])).rows[0].answer_key;
  return { services, clock, child, lesson, session, task: task!, key };
}

describe("parent work card regressions", () => {
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
    // nieoceniona pisownia nie zmienia wyniku ocenionej poprawnie treści
    expect(report.sessions[0]?.steps[0]?.responses[0]?.outcome).toBe("correct");
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

  it("marks a wrong lesson answer with the outcome of its assessment", async () => {
    const { services, child, session, task, key } = await lessonTask();
    const wrongId = (task.prompt as { options: { id: string }[] }).options.find(option => option.id !== key.correctOptionId)!.id;
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrongId });

    const report = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    const step = report.sessions.find(row => row.sessionId === session.sessionId)?.steps.find(row => row.taskId === task.taskId);
    expect(step?.responses.map(response => response.outcome)).toEqual(["incorrect"]);
  });

  it("counts only budgeted lesson exercises as remaining work", async () => {
    const { services, child, session } = await lessonTask();
    const report = await readParentWorkCard(services, { childId: child.id, date: "2026-10-16" });
    expect(report.sessions[0]?.remainingSteps).toBe(session.taskBudget - 1);
  });

  it("includes today's issued task from a session started yesterday without an answer or approved time", async () => {
    const { services, child, task: issued } = await lessonTask("2026-10-16T21:59:50Z", 20_000);
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
