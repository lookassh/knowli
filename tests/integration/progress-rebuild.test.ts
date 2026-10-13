import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  createDraft,
  createServices,
  endSession,
  FakeAnswerGrader,
  nextTask,
  publishDraft,
  rebuildProgress,
  startSession,
  submitAttempt,
  upsertAssignment,
} from "@learning/server";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

afterAll(async () => { await pool.end(); });

describe("rebuildProgress (integracja PostgreSQL)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
      learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("dry-run nie zapisuje, apply odtwarza projekcje per dziecko i jest idempotentne", async () => {
    const { services, clock } = buildTestServices();
    const children = await Promise.all([
      createChild(services, { displayName: "Dziecko A", avatarKey: "fox" }),
      createChild(services, { displayName: "Dziecko B", avatarKey: "cat" }),
    ]);
    const draft = await createDraft(services, { title: "Dni", items: [
      { source: "poniedziałek", target: "Monday", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" },
      { source: "wtorek", target: "Tuesday", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" },
      { source: "środa", target: "Wednesday", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" },
    ] });
    const revisions = await query<{ id: string; position: number }>(
      `select id, position from learning_app.item_revisions where deck_version_id = $1 order by position`, [draft.id],
    );
    for (const revision of revisions) {
      const assetId = randomUUID();
      const fingerprint = `test-${randomUUID()}`;
      await pool.query(`insert into learning_app.media_assets
        (id, kind, fingerprint, generation_number, state, storage_key, content_sha256, mime_type, byte_count, provider, model)
        values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake')`,
      [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`]);
      await pool.query(`insert into learning_app.revision_assets
        (item_revision_id, role, asset_id, expected_fingerprint, state)
        values ($1,'target_audio',$2,$3,'approved'),($1,'illustration',null,$4,'omitted')`,
      [revision.id, assetId, fingerprint, `image-${randomUUID()}`]);
    }
    await publishDraft(services, draft.id, 1);
    for (const child of children) await upsertAssignment(services, child.id, draft.deckId, null);

    for (const child of children) {
      const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
      let answered = false;
      for (let step = 0; step < 10 && !answered; step++) {
        const task = await nextTask(services, session.sessionId);
        if (!task) break;
        if (task.exerciseType === "exposure") {
          await completePresentation(services, { taskId: task.taskId });
          continue;
        }
        const key = (await query<{ target: string; optionId: string | null }>(
          `select answer_key->>'target' as target, answer_key->>'correctOptionId' as "optionId"
             from learning_app.session_tasks where id = $1`, [task.taskId],
        ))[0]!;
        await submitAttempt(services, key.optionId === null
          ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.target }
          : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.optionId });
        answered = true;
      }
      expect(answered).toBe(true);
      await endSession(services, session.sessionId);
    }

    // Zmień wersję polityki dziecka między sesjami; historia tej samej
    // umiejętności ma teraz dowód learning-v2 i nowszy learning-v1.
    await pool.query(`update learning_app.child_profiles set policy_id='learning-v1' where id=$1`, [children[0]!.id]);
    clock.advanceHours(24);
    const policySession = await startSession(services, { childId: children[0]!.id, deckId: draft.deckId, microphoneEnabled: false });
    const dueTask = await nextTask(services, policySession.sessionId);
    expect(dueTask?.exerciseType).toBe("listening");
    const dueAnswer = (await query<{ target: string; optionId: string | null }>(
      `select answer_key->>'target' as target, answer_key->>'correctOptionId' as "optionId"
         from learning_app.session_tasks where id=$1`, [dueTask!.taskId],
    ))[0]!;
    await submitAttempt(services, dueAnswer.optionId === null
      ? { taskId: dueTask!.taskId, clientAttemptId: randomUUID(), modality: "text", text: dueAnswer.target }
      : { taskId: dueTask!.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: dueAnswer.optionId });
    await endSession(services, policySession.sessionId);
    expect(await query<{ policy_id: string }>(
      `select distinct a.policy_id from learning_app.attempts a where a.child_id=$1 order by a.policy_id`, [children[0]!.id],
    )).toEqual([{ policy_id: "learning-v1" }, { policy_id: "learning-v2" }]);

    const skillVersion = (await query<{ id: string }>(
      `select s.id from learning_app.skill_versions s join learning_app.item_revisions r on r.item_id = s.item_id
        where r.deck_version_id = $1 and r.position = 0 and s.skill = 'listening'`, [draft.id],
    ))[0]!.id;
    const orphanSkillVersion = (await query<{ id: string }>(
      `select s.id from learning_app.skill_versions s join learning_app.item_revisions r on r.item_id = s.item_id
        where r.deck_version_id = $1 and r.position = 0 and s.skill = 'spelling'`, [draft.id],
    ))[0]!.id;
    await pool.query(`insert into learning_app.child_skill_progress
      (child_id, skill_version_id, status, independent_success_streak, last_reviewed_at, next_review_at, projection_version)
      values ($1,$2,'mastered',99,'2026-10-01T00:00:00Z','2030-01-01T00:00:00Z','poisoned')
      on conflict (child_id, skill_version_id) do update set status='mastered', independent_success_streak=99,
        last_reviewed_at='2026-10-01T00:00:00Z', next_review_at='2030-01-01T00:00:00Z', projection_version='poisoned'`,
    [children[0]!.id, skillVersion]);
    await pool.query(`delete from learning_app.child_skill_progress where child_id=$1 and skill_version_id=$2`, [children[1]!.id, skillVersion]);
    await pool.query(`insert into learning_app.child_skill_progress
      (child_id, skill_version_id, status, independent_success_streak, projection_version)
      values ($1,$2,'mastered',30,'poisoned')`, [children[0]!.id, orphanSkillVersion]);

    const rawSnapshot = async () => (await query<{ raw: Record<string, unknown> }>(
      `select jsonb_build_object(
        'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from learning_app.attempts a where a.child_id = any($1::uuid[])),
        'assessments',(select jsonb_agg(to_jsonb(a) order by a.attempt_id,a.skill) from learning_app.assessments a where a.child_id = any($1::uuid[])),
        'exposures',(select jsonb_agg(to_jsonb(x) order by x.event_id,x.target_key) from learning_app.event_exposures x where x.child_id = any($1::uuid[])),
        'summaries',(select jsonb_agg(context->'summary' order by id) from learning_app.learning_sessions where child_id = any($1::uuid[]))
      ) as raw`, [children.map((child) => child.id)],
    ))[0]!.raw;
    const before = await rawSnapshot();
    const dryRun = await rebuildProgress(services, { apply: false });
    expect(dryRun.downgraded).toBeGreaterThan(0);
    expect(dryRun.inserted).toBeGreaterThan(0);
    expect(dryRun.deleted).toBe(1);
    expect(await rawSnapshot()).toEqual(before);
    expect(await query<{ child_id: string; status: string }>(`select child_id,status from learning_app.child_skill_progress where child_id=$1 and skill_version_id=$2`, [children[0]!.id, skillVersion])).toEqual([{ child_id: children[0]!.id, status: "mastered" }]);

    const applied = await rebuildProgress(services, { apply: true });
    expect(applied.inserted).toBeGreaterThan(0);
    expect(applied.updated).toBeGreaterThan(0);
    expect(applied.deleted).toBe(1);
    expect(applied.downgraded).toBeGreaterThan(0);
    expect(await rawSnapshot()).toEqual(before);
    expect(await query<{ child_id: string; status: string; streak: number }>(
      `select child_id, status, independent_success_streak as streak from learning_app.child_skill_progress
        where child_id = any($1::uuid[]) order by child_id`, [children.map((child) => child.id)],
    )).toEqual(children.map((child) => child.id).sort().map((childId) => ({ child_id: childId, status: "practicing", streak: 1 })));
    const second = await rebuildProgress(services, { apply: true });
    expect(second.inserted + second.updated + second.deleted).toBe(0);
    expect(await query(`select 1 from learning_app.child_skill_progress where child_id=$1 and skill_version_id=$2`, [children[0]!.id, orphanSkillVersion])).toEqual([]);

    const active = await startSession(services, { childId: children[0]!.id, deckId: draft.deckId, microphoneEnabled: false });
    await pool.query(`update learning_app.child_skill_progress set status='mastered', independent_success_streak=99
      where child_id=$1 and skill_version_id=$2`, [children[0]!.id, skillVersion]);
    await expect(rebuildProgress(services, { childId: children[0]!.id, apply: true })).rejects.toMatchObject({ code: "conflict" });
    await expect(query<{ status: string }>(`select status from learning_app.child_skill_progress where child_id=$1 and skill_version_id=$2`, [children[0]!.id, skillVersion]))
      .resolves.toEqual([{ status: "mastered" }]);
    await endSession(services, active.sessionId);
    await pool.query(`insert into learning_app.attempts
      (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number, modality, state, answer, context, policy_id, received_at)
      select gen_random_uuid(), t.child_id, t.id, t.item_revision_id, gen_random_uuid(), 'processing-fixture', 999,
             'audio', 'processing', '{}'::jsonb, '{}'::jsonb, s.policy_id, now()
        from learning_app.session_tasks t join learning_app.learning_sessions s on s.id=t.session_id
       where s.child_id=$1 and t.exercise_type <> 'exposure' limit 1`, [children[0]!.id]);
    await expect(rebuildProgress(services, { childId: children[0]!.id, apply: true })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("rebuildProgress — cele lekcji (child_objective_progress)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
      learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("odbudowuje child_objective_progress z ocen objective; dry-run bez zapisu, apply idempotentny, słówka nietknięte", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "correct", errorCategory: null, fragments: [], note: "ok" } });
    const { services: base, clock } = buildTestServices();
    const services = createServices({
      db: (base as unknown as { db: Parameters<typeof createServices>[0]["db"] }).db,
      clock,
      generation: {} as Parameters<typeof createServices>[0]["generation"],
      grader: { provider: grader, maxCallsPerSession: 20, timeoutMs: 8000 },
    });
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, now: clock.now() });

    // Zagraj kilka ćwiczeń celu → oceny skill='objective' + projekcja child_objective_progress.
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    let answered = 0;
    for (let step = 0; step < 30 && answered < 3; step++) {
      const task = await nextTask(services, session.sessionId);
      if (!task) break;
      if (task.exerciseType === "lesson_card") { await completePresentation(services, { taskId: task.taskId }); continue; }
      const key = (await query<{ answerKey: Record<string, unknown> }>(
        `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`, [task.taskId]))[0]!.answerKey;
      if (task.exerciseType === "lesson_choice" || task.exerciseType === "lesson_short_answer" || task.exerciseType === "lesson_notice") {
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
      } else if (task.exerciseType === "lesson_order") {
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: key.itemIds as string[] });
      } else {
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });
      }
      answered += 1;
    }
    expect(answered).toBeGreaterThan(0);
    await endSession(services, session.sessionId);

    const objBefore = (await query<{ status: string; streak: number }>(
      `select status, streak from learning_app.child_objective_progress where child_id = $1`, [child.id]))[0]!;
    expect(objBefore).toBeTruthy();

    // Zatruj projekcję celu.
    await pool.query(
      `update learning_app.child_objective_progress set status='mastered', streak=99, projection_version='poisoned' where child_id=$1`,
      [child.id]);
    // Osierocona projekcja celu (nieistniejący cel) → kasowana przez odbudowę.
    await pool.query(
      `insert into learning_app.child_objective_progress (child_id, subject_id, objective_id, topic_id, status, streak, projection_version)
       values ($1, $2, 'ghost_objective', $3, 'mastered', 7, 'poisoned')`,
      [child.id, lesson.subjectId, lesson.topicId]);

    const dryRun = await rebuildProgress(services, { apply: false });
    expect(dryRun.updated + dryRun.downgraded).toBeGreaterThan(0);
    expect(dryRun.deleted).toBeGreaterThan(0);
    // Dry-run niczego nie zapisał.
    expect((await query<{ status: string; streak: number }>(
      `select status, streak from learning_app.child_objective_progress where child_id=$1 and objective_id=$2`,
      [child.id, lesson.objectiveId]))[0]).toEqual({ status: "mastered", streak: 99 });

    const applied = await rebuildProgress(services, { apply: true });
    expect(applied.updated).toBeGreaterThan(0);
    // Zatruta projekcja wróciła do prawdziwej; duch skasowany.
    const objAfter = (await query<{ status: string; streak: number; version: string }>(
      `select status, streak, projection_version as version from learning_app.child_objective_progress where child_id=$1 and objective_id=$2`,
      [child.id, lesson.objectiveId]))[0]!;
    expect(objAfter.status).toBe(objBefore.status);
    expect(objAfter.streak).toBe(objBefore.streak);
    expect(objAfter.version).not.toBe("poisoned");
    expect(await query(`select 1 from learning_app.child_objective_progress where child_id=$1 and objective_id='ghost_objective'`, [child.id])).toEqual([]);

    // Idempotencja: drugi apply nic nie zmienia.
    const second = await rebuildProgress(services, { apply: true });
    expect(second.inserted + second.updated + second.deleted).toBe(0);

    // Odmowa przy aktywnej sesji dziecka.
    const active = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    await expect(rebuildProgress(services, { childId: child.id, apply: true })).rejects.toMatchObject({ code: "conflict" });
    await endSession(services, active.sessionId);
  });
});
