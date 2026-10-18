import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { completePresentation, createChild, createDraft, endSession, ensureLearningPolicy, nextTask, publishDraft, rebuildProgress, startSession, upsertAssignment } from "@learning/server";
import { writeSealedEvent } from "../../packages/server/src/modules/events";
import { recordSkillIssued } from "../../packages/server/src/modules/skill-projections";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();
afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});

describe("projekcje faktów nauki", () => {
  it("rollbackuje event i ekspozycje razem, jeśli transakcja zapieczętowania zawiedzie", async () => {
    const { services, clock } = buildTestServices();
    await ensureLearningPolicy(services.db);
    const child = await createChild(services, { displayName: "Ada", avatarKey: "fox" });
    const draft = await createDraft(services, { title: "Rollback ekspozycji", items: [{ source: "kot", target: "cat", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" }] });
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);
    const itemId = (await pool.query<{ item_id: string }>(`select item_id from learning_app.item_revisions where id=(select item_revision_id from learning_app.session_tasks where id=$1)`, [task!.taskId])).rows[0]!.item_id;
    const stepId = `rollback-${randomUUID()}`;
    const targetKey = `target-${randomUUID()}`;
    await expect(services.db.transaction(async tx => {
      await writeSealedEvent(tx, { childId: child.id, taskId: task!.taskId, itemId, kind: "hint_issued", stepId, occurredAt: clock.now(), exposures: [targetKey] });
      throw new Error("injected failure after event sealing");
    })).rejects.toThrow("injected failure");
    const result = await pool.query(`select
      (select count(*) from learning_app.learning_events where step_id=$1) as events,
      (select count(*) from learning_app.event_exposures where target_key=$2) as history_exposures,
      (select count(*) from learning_app.child_target_exposures where target_key=$2) as projection_exposures`, [stepId, targetKey]);
    expect(result.rows[0]).toEqual({ events: "0", history_exposures: "0", projection_exposures: "0" });
    await endSession(services, session.sessionId);
  });

  it("odtwarza pierwsze wydanie bez oceny, ustawia readiness na końcu i jest idempotentny", async () => {
    const { services } = buildTestServices();
    await ensureLearningPolicy(services.db);
    const child = await createChild(services, { displayName: "Olek", avatarKey: "cat" });
    const draft = await createDraft(services, { title: "Wydanie bez oceny", items: [{ source: "pies", target: "dog", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" }] });
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: true });
    let task = await nextTask(services, session.sessionId);
    for (let i = 0; task && task.exerciseType === "exposure" && i < 5; i++) {
      await completePresentation(services, { taskId: task.taskId });
      task = await nextTask(services, session.sessionId);
    }
    expect(task).toBeTruthy();
    await endSession(services, session.sessionId);
    await pool.query(`update learning_app.child_profiles set learning_projection_version=null where id=$1`, [child.id]);
    await rebuildProgress(services, { childId: child.id, apply: true });
    const fact = (await pool.query<{ first_issued_at: Date; has_qualifying_assessment: boolean }>(`select p.first_issued_at,p.has_qualifying_assessment
      from learning_app.child_skill_progress p join learning_app.item_revision_skills s on s.skill_version_id=p.skill_version_id
      join learning_app.item_revisions r on r.id=s.item_revision_id where p.child_id=$1 and p.policy_id='learning-v2' and r.deck_version_id=$2 and s.skill='recall'`, [child.id, draft.id])).rows[0];
    expect(fact?.first_issued_at).toBeInstanceOf(Date);
    expect(fact?.has_qualifying_assessment).toBe(false);
    expect((await pool.query(`select learning_projection_version from learning_app.child_profiles where id=$1`, [child.id])).rows[0].learning_projection_version).toBe("proj-3");
    const before = (await pool.query(`select first_issued_at,has_qualifying_assessment,status,independent_success_streak,last_reviewed_at,next_review_at,projection_version
      from learning_app.child_skill_progress where child_id=$1 and skill_version_id=(select s.skill_version_id from learning_app.item_revision_skills s join learning_app.item_revisions r on r.id=s.item_revision_id where r.deck_version_id=$2 and s.skill='recall') and policy_id='learning-v2'`, [child.id, draft.id])).rows;
    const second = await rebuildProgress(services, { childId: child.id, apply: true });
    expect(second.inserted + second.updated + second.deleted).toBe(0);
    expect((await pool.query(`select first_issued_at,has_qualifying_assessment,status,independent_success_streak,last_reviewed_at,next_review_at,projection_version
      from learning_app.child_skill_progress where child_id=$1 and skill_version_id=(select s.skill_version_id from learning_app.item_revision_skills s join learning_app.item_revisions r on r.id=s.item_revision_id where r.deck_version_id=$2 and s.skill='recall') and policy_id='learning-v2'`, [child.id, draft.id])).rows).toEqual(before);
  });

  it("równoległe zapisy zachowują MIN pierwszego wydania", async () => {
    const { services, clock } = buildTestServices();
    await ensureLearningPolicy(services.db);
    const child = await createChild(services, { displayName: "Iza", avatarKey: "owl" });
    const draft = await createDraft(services, { title: "MIN", items: [{ source: "ptak", target: "bird", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" }] });
    const skillVersionId = (await pool.query<{ skill_version_id: string }>(`select s.skill_version_id from learning_app.item_revision_skills s join learning_app.item_revisions r on r.id=s.item_revision_id where r.deck_version_id=$1 and s.skill='recall'`, [draft.id])).rows[0]!.skill_version_id;
    const scope = { childId: child.id, skillVersionId, skill: "recall" as const };
    const early = new Date(clock.now().getTime() - 1000); const late = clock.now();
    await Promise.all([late, early].map(at => services.db.transaction(tx => recordSkillIssued(tx, scope, "learning-v2", at))));
    const fact = (await pool.query<{ first_issued_at: Date }>(`select first_issued_at from learning_app.child_skill_progress where child_id=$1 and skill_version_id=$2 and policy_id='learning-v2'`, [child.id, skillVersionId])).rows[0]!;
    expect(fact.first_issued_at.toISOString()).toBe(early.toISOString());
  });
});
