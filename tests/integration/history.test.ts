import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  createDraft,
  authorizeDisclosure,
  deleteChild,
  updateChild,
  ensureLearningPolicy,
  CURRENT_POLICY_ID,
  nextTask,
  loadPolicy,
  publishDraft,
  startSession,
  submitAttempt,
  upsertAssignment,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import {
  buildTestServices,
  testDatabase,
  truncateCoreTables,
} from "./helpers";
import { readLearningSnapshot } from "../../packages/server/src/modules/learning-snapshot";

/**
 * Historia prób (zadanie 7): klucz odpowiedzi wydanego zadania, ekspozycje
 * i oceny zakończonych prób są niezmienne; usuwanie historii jest możliwe
 * wyłącznie przez usunięcie profilu dziecka.
 */

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

afterAll(async () => {
  await pool.end();
});

async function expectQueryFailure(sql: string, params: unknown[] = [], pattern: RegExp): Promise<void> {
  await pool.query(sql, params).then(
    () => {
      throw new Error(`Oczekiwano odrzucenia: ${sql}`);
    },
    (error: unknown) => {
      expect(String(error)).toMatch(pattern);
    },
  );
}

const PAIRS: { source: string; target: string }[] = [
  { source: "poniedziałek", target: "Monday" },
  { source: "wtorek", target: "Tuesday" },
  { source: "środa", target: "Wednesday" },
];

function vocabItem(pair: { source: string; target: string }) {
  return {
    source: pair.source,
    target: pair.target,
    acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" },
    visualType: "color" as const,
    visualData: { color: "#4169e1" },
  };
}

async function attachFakeReadyAudio(deckVersionId: string, itemIndex: number): Promise<void> {
  const revision = (
    await query<{ id: string }>(
      `select id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [deckVersionId, itemIndex],
    )
  )[0]!;
  const assetId = randomUUID();
  const fingerprint = `fp-${randomUUID()}`;
  await pool.query(
    `insert into learning_app.media_assets
       (id, kind, fingerprint, generation_number, state, storage_key, content_sha256,
        mime_type, byte_count, provider, model)
     values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake-tts')`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`],
  );
  await pool.query(
    `insert into learning_app.revision_assets
       (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'target_audio',$2,$3,'approved')`,
    [revision.id, assetId, fingerprint],
  );
}

/** Sesja z jedną zakończoną próbą tekstową; zwraca id zadania i próby. */
async function sessionWithAttempt(childId: string): Promise<{ taskId: string; attemptId: string }> {
  const services = buildTestServices().services;
  const draft = await createDraft(services, { title: "Historia", items: PAIRS.map(vocabItem) });
  for (const index of PAIRS.keys()) {
    await attachFakeReadyAudio(draft.id, index);
    const revision = (
      await query<{ id: string }>(
        `select id from learning_app.item_revisions
          where deck_version_id = $1 order by position offset $2 limit 1`,
        [draft.id, index],
      )
    )[0]!;
    await pool.query(
      `insert into learning_app.revision_assets
         (item_revision_id, role, asset_id, expected_fingerprint, state)
       values ($1,'illustration',null,$2,'omitted')`,
      [revision.id, `fp-ill-${randomUUID()}`],
    );
  }
  await publishDraft(services, draft.id, 1);
  await upsertAssignment(services, childId, draft.deckId, null);

  const session = await startSession(services, { childId, deckId: draft.deckId, microphoneEnabled: false });
  for (let step = 0; step < 10; step++) {
    const task = (await nextTask(services, session.sessionId))!;
    if (task.exerciseType !== "exposure") {
      const dto = await submitAttempt(services, {
        taskId: task.taskId,
        clientAttemptId: randomUUID(),
        modality: "text",
        text: "monday",
      });
      return { taskId: task.taskId, attemptId: dto.attemptId };
    }
    await completePresentation(services, { taskId: task.taskId });
  }
  throw new Error("nie wydano zadania ocenianego");
}

async function answerCorrectly(task: TaskDto): Promise<void> {
  const row = (await query<{ answer_key: { correctOptionId?: string; target?: string } }>(
    `select answer_key from learning_app.session_tasks where id = $1`, [task.taskId],
  ))[0]!;
  await submitAttempt(buildTestServices().services, {
    taskId: task.taskId,
    clientAttemptId: randomUUID(),
    ...(row.answer_key.correctOptionId
      ? { modality: "choice" as const, optionId: row.answer_key.correctOptionId }
      : { modality: "text" as const, text: row.answer_key.target! }),
  });
}

async function sharedDeckForChildren(childIds: readonly string[]): Promise<{ deckId: string; versionId: string }> {
  const services = buildTestServices().services;
  const draft = await createDraft(services, { title: "Wspólna historia", items: PAIRS.map(vocabItem) });
  for (const index of PAIRS.keys()) {
    await attachFakeReadyAudio(draft.id, index);
    const revision = (await query<{ id: string }>(
      `select id from learning_app.item_revisions where deck_version_id = $1 order by position offset $2 limit 1`,
      [draft.id, index],
    ))[0]!;
    await pool.query(
      `insert into learning_app.revision_assets (item_revision_id, role, asset_id, expected_fingerprint, state)
       values ($1,'illustration',null,$2,'omitted')`,
      [revision.id, `fp-ill-${randomUUID()}`],
    );
  }
  await publishDraft(services, draft.id, 1);
  for (const childId of childIds) await upsertAssignment(services, childId, draft.deckId, null);
  return { deckId: draft.deckId, versionId: draft.id };
}

async function nextLearningExercise(childId: string, deckId: string, type: TaskDto["exerciseType"]): Promise<TaskDto> {
  return (await openLearningExercise(childId, deckId, type)).task;
}

async function openLearningExercise(childId: string, deckId: string, type: TaskDto["exerciseType"], suppliedServices?: ReturnType<typeof buildTestServices>["services"]): Promise<{
  services: ReturnType<typeof buildTestServices>["services"];
  sessionId: string;
  task: TaskDto;
}> {
  const services = suppliedServices ?? buildTestServices().services;
  const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
  for (let step = 0; step < 40; step++) {
    const task = (await nextTask(services, session.sessionId))!;
    if (task.exerciseType === type) return { services, sessionId: session.sessionId, task };
    if (task.exerciseType === "exposure") await completePresentation(services, { taskId: task.taskId });
    else await answerCorrectly(task);
  }
  throw new Error(`Nie wydano zadania ${type}`);
}

describe("niezmienność historii prób (integracja)", () => {
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    childId = (await createChild(buildTestServices().services, { displayName: "Ola", avatarKey: "fox" })).id;
  });

  it("klucz odpowiedzi i kontekst wydanego zadania są niezmienne; zmienia się wyłącznie stan", async () => {
    const { taskId } = await sessionWithAttempt(childId);

    await expectQueryFailure(
      `update learning_app.session_tasks set answer_key = answer_key || '{"target":"hacked"}'::jsonb where id = $1`,
      [taskId],
      /Issued task snapshot is immutable/,
    );
    await expectQueryFailure(
      `update learning_app.session_tasks set public_prompt = public_prompt || '{"extra":true}'::jsonb where id = $1`,
      [taskId],
      /Issued task snapshot is immutable/,
    );

    // sama zmiana stanu jest dozwolona (issued → answered)
    const allowed = await pool.query(
      `update learning_app.session_tasks set state = 'answered' where id = $1 and state = 'issued'`,
      [taskId],
    );
    expect(allowed.rowCount ?? 0).toBeLessThanOrEqual(1);

    // stan terminalny nie otwiera zadania ponownie
    await expectQueryFailure(
      `update learning_app.session_tasks set state = 'issued' where id = $1`,
      [taskId],
      /Terminal task cannot be reopened/,
    );
  });

  it("nie wlicza historii rodzeństwa do projekcji tego samego skill version", async () => {
    const services = buildTestServices().services;
    const childB = (await createChild(services, { displayName: "Iga", avatarKey: "owl" })).id;
    const { deckId, versionId } = await sharedDeckForChildren([childId, childB]);
    const taskA = await nextLearningExercise(childId, deckId, "listening");
    await answerCorrectly(taskA);
    const taskB = await nextLearningExercise(childB, deckId, "listening");
    await answerCorrectly(taskB);

    const rows = await query<{ child_id: string; skill: string; independent_success_streak: number }>(
      `select p.child_id, s.skill, p.independent_success_streak
         from learning_app.child_skill_progress p
         join learning_app.item_revision_skills s on s.skill_version_id = p.skill_version_id
         join learning_app.item_revisions r on r.id = s.item_revision_id
        where r.deck_version_id = $1 and p.child_id = $2 and s.skill = 'listening'`,
      [versionId, childB],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.independent_success_streak).toBe(1);
    const assessmentChildren = await query<{ child_id: string }>(
      `select child_id from learning_app.assessments where skill = 'listening'`,
    );
    expect([...new Set(assessmentChildren.map((row) => row.child_id))].sort()).toEqual([childId, childB].sort());
  });

  it("kwalifikuje reading z audio jako wspomagane przy przyjęciu odpowiedzi", async () => {
    const { deckId } = await sharedDeckForChildren([childId]);
    const { services: sessionServices, task } = await openLearningExercise(childId, deckId, "reading");
    await authorizeDisclosure(sessionServices, { taskId: task.taskId, kind: "audio" });
    await answerCorrectly(task);

    const assessment = await query<{ outcome: string; independent: boolean; confirmation_eligible: boolean }>(
      `select a.outcome, a.independent, a.confirmation_eligible
         from learning_app.assessments a join learning_app.attempts t on t.id = a.attempt_id
        where t.task_id = $1 and a.skill = 'reading'`,
      [task.taskId],
    );
    expect(assessment[0]).toMatchObject({ outcome: "correct", independent: false, confirmation_eligible: false });
  });

  it("zachowuje termin samodzielnego Recall 24 godziny po pierwszym wydaniu", async () => {
    const { services, clock } = buildTestServices();
    const { deckId, versionId } = await sharedDeckForChildren([childId]);
    const { task } = await openLearningExercise(childId, deckId, "recall", services);
    await answerCorrectly(task);
    const policy = await loadPolicy(services.db, CURRENT_POLICY_ID);
    const revision = (await query<{ id: string }>(
      `select id from learning_app.item_revisions where deck_version_id = $1 order by position limit 1`, [versionId],
    ))[0]!;
    const before = await readLearningSnapshot(services.db, {
      childId, revisionIds: [revision.id], policy, now: clock.now().toISOString(),
    });
    const dueAt = before[0]!.work.recall!.reviewDueAt;
    expect(dueAt).toBe(new Date(clock.now().getTime() + 24 * 60 * 60 * 1000).toISOString());
    expect(before[0]!.work.recall!.dueNow).toBe(false);

    clock.advanceHours(24);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const dueTask = await nextTask(services, session.sessionId);
    expect(dueTask?.exerciseType).toBe("recall");
    const after = await readLearningSnapshot(services.db, {
      childId, revisionIds: [revision.id], policy, now: clock.now().toISOString(),
    });
    expect(after[0]!.work.recall!.dueNow).toBe(true);
  });

  it("zakończona próba jest niezmieniona, a oceny nie podlegają edycji ani wymianie", async () => {
    const { taskId, attemptId } = await sessionWithAttempt(childId);

    await expectQueryFailure(
      `update learning_app.attempts set answer = '{"text":"forged"}'::jsonb where id = $1`,
      [attemptId],
      /Completed attempt is immutable/,
    );
    await expectQueryFailure(
      `update learning_app.attempts set request_hash = 'other' where id = $1`,
      [attemptId],
      /Completed attempt is immutable/,
    );
    await expectQueryFailure(
      `update learning_app.assessments set outcome = 'correct' where attempt_id = $1`,
      [attemptId],
      /Immutable row in assessments/,
    );
    await expectQueryFailure(
      `delete from learning_app.assessments where attempt_id = $1`,
      [attemptId],
      /Delete the child profile/,
    );
    await expectQueryFailure(
      `delete from learning_app.attempts where id = $1`,
      [attemptId],
      /Delete the child profile/,
    );
    // ponowne wstawienie oceny do zakończonej próby jest blokowane
    const skillVersion = (
      await query<{ skill_version_id: string; child_id: string; item_revision_id: string }>(
        `select a.skill_version_id, a.child_id, a.item_revision_id
           from learning_app.assessments a where a.attempt_id = $1 limit 1`,
        [attemptId],
      )
    )[0]!;
    await expectQueryFailure(
      `insert into learning_app.assessments
         (child_id, attempt_id, item_revision_id, skill, skill_version_id, outcome,
          independent, confirmation_eligible, details)
       values ($1,$2,$3,'spelling',$4,'correct',true,false,'{}'::jsonb)`,
      [skillVersion.child_id, attemptId, skillVersion.item_revision_id, skillVersion.skill_version_id],
      /may only be inserted before attempt finalization/,
    );

    // ekspozycji zapieczętowanego zdarzenia nie da się dopisać
    const sealedEvent = (
      await query<{ id: string }>(
        `select e.id from learning_app.learning_events e
          join learning_app.session_tasks t on t.id = e.task_id
          where t.id = $1 and e.sealed limit 1`,
        [taskId],
      )
    )[0]!;
    await expectQueryFailure(
      `insert into learning_app.event_exposures (child_id, event_id, target_key)
       values ($1,$2,'sneaky')`,
      [childId, sealedEvent!.id],
      /Cannot extend sealed disclosure/,
    );
  });

  it("usunięcie profilu usuwa całą historię dziecka, zachowując wspólny materiał", async () => {
    const services = buildTestServices().services;
    const { taskId, attemptId } = await sessionWithAttempt(childId);
    const deckCount = await query<{ count: number }>(`select count(*)::int as count from learning_app.decks`);
    const itemCount = await query<{ count: number }>(`select count(*)::int as count from learning_app.learning_items`);
    expect(deckCount[0]!.count).toBeGreaterThan(0);

    await deleteChild(services, childId);

    const leftovers: [string, unknown, string][] = [
      [`select count(*)::int as count from learning_app.attempts where id = $1`, attemptId, "próba"],
      [`select count(*)::int as count from learning_app.assessments where attempt_id = $1`, attemptId, "ocena"],
      [
        `select count(*)::int as count from learning_app.learning_events e
           join learning_app.session_tasks t on t.id = e.task_id where t.id = $1`,
        taskId,
        "zdarzenia",
      ],
      [`select count(*)::int as count from learning_app.session_tasks where id = $1`, taskId, "zadanie"],
      [
        `select count(*)::int as count from learning_app.child_skill_progress where child_id = $1`,
        childId,
        "projekcja",
      ],
    ];
    for (const [sql, param, label] of leftovers) {
      const rows = await query<{ count: number }>(sql, [param]);
      expect(rows[0]!.count, `po usunięciu profilu: ${label}`).toBe(0);
    }

    // wspólny materiał pozostaje
    expect((await query<{ count: number }>(`select count(*)::int as count from learning_app.decks`))[0]!.count).toBe(
      deckCount[0]!.count,
    );
    expect((await query<{ count: number }>(`select count(*)::int as count from learning_app.learning_items`))[0]!.count).toBe(
      itemCount[0]!.count,
    );
  });

  it("edycja profilu zachowuje całą historię, materiał i politykę sesji", async () => {
    const services = buildTestServices().services;
    await ensureLearningPolicy(services.db);
    await pool.query("update learning_app.child_profiles set birth_year = 2018, policy_id = $1 where id = $2", [CURRENT_POLICY_ID, childId]);
    await sessionWithAttempt(childId);
    const otherId = (await createChild(services, { displayName: "Jan", avatarKey: "cat" })).id;
    await sessionWithAttempt(otherId);
    const tables = ["learning_sessions", "session_tasks", "attempts", "assessments", "learning_events",
      "event_exposures", "child_skill_progress", "assignments", "decks", "deck_versions", "learning_items",
      "item_revisions", "skill_versions", "item_revision_skills", "learning_policies"];
    const snapshot = async () => Promise.all(tables.map(async (table) => {
      const rows = await query(`select * from learning_app.${table} order by to_jsonb(${table})::text`);
      expect(rows.length, table).toBeGreaterThan(0);
      return rows;
    }));
    const profileBefore = await query<Record<string, unknown>>("select * from learning_app.child_profiles where id = $1", [childId]);
    const otherBefore = await query("select * from learning_app.child_profiles where id = $1", [otherId]);
    const before = await snapshot();
    expect(await updateChild(services, childId, { displayName: "Ala", avatarKey: "panda" }))
      .toEqual({ id: childId, displayName: "Ala", avatarKey: "panda", birthYear: 2018 });
    expect(await snapshot()).toEqual(before);
    expect(await query("select * from learning_app.child_profiles where id = $1", [otherId])).toEqual(otherBefore);
    expect(await query("select * from learning_app.child_profiles where id = $1", [childId]))
      .toEqual([{ ...profileBefore[0], display_name: "Ala", avatar_key: "panda" }]);
  });
});
