import { startLegacyTrainingSession } from "./helpers";
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
  createServices,
  type Services,
  ttsFingerprint,
  readSkillHistories,
  skillHistoryKey,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import {
  buildTestServices,
  ManualClock,
  testDatabase,
  truncateCoreTables,
} from "./helpers";
import { UI_AUDIO_TEXTS } from "../../packages/server/src/domain/ui-audio-catalog";
import { readLearningSnapshot } from "../../packages/server/src/modules/learning/learning-snapshot";

/**
 * Historia prób (zadanie 7): klucz odpowiedzi wydanego zadania, ekspozycje
 * i oceny zakończonych prób są niezmienne; usuwanie historii jest możliwe
 * wyłącznie przez usunięcie profilu dziecka.
 */

const { pool } = testDatabase();
let capturedHistoryQueries: string[] | null = null;
const originalPoolQuery = pool.query.bind(pool);
pool.query = ((...args: Parameters<typeof pool.query>) => {
  if (capturedHistoryQueries) {
    const query = args[0] as unknown as string | { text?: string };
    capturedHistoryQueries.push(typeof query === "string" ? query : query.text ?? "");
  }
  return originalPoolQuery(...args);
}) as typeof pool.query;

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

/** Sesja z jedną zakończoną próbą; używa modality zgodnego z wydanym zadaniem. */
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

  const session = await startLegacyTrainingSession(services, { childId, deckId: draft.deckId, microphoneEnabled: false });
  for (let step = 0; step < 10; step++) {
    const task = (await nextTask(services, session.sessionId))!;
    if (task.exerciseType !== "exposure") {
      const answer = (await query<{ target: string; optionId: string | null }>(
        `select answer_key->>'target' as target, answer_key->>'correctOptionId' as "optionId"
           from learning_app.session_tasks where id=$1`, [task.taskId],
      ))[0]!;
      const dto = await submitAttempt(services, {
        taskId: task.taskId,
        clientAttemptId: randomUUID(),
        ...(answer.optionId === null
          ? { modality: "text" as const, text: answer.target }
          : { modality: "choice" as const, optionId: answer.optionId }),
      });
      return { taskId: task.taskId, attemptId: dto.attemptId };
    }
    await completePresentation(services, { taskId: task.taskId });
  }
  throw new Error("nie wydano zadania ocenianego");
}

async function answerCorrectly(task: TaskDto, suppliedServices?: Services): Promise<void> {
  const row = (await query<{ answer_key: { correctOptionId?: string; target?: string } }>(
    `select answer_key from learning_app.session_tasks where id = $1`, [task.taskId],
  ))[0]!;
  await submitAttempt(suppliedServices ?? buildTestServices().services, {
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
  const session = await startLegacyTrainingSession(services, { childId, deckId, microphoneEnabled: false });
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

  it("utrzymuje zdolność czytania przypiętą do aktywnej sesji po zmianie profilu", async () => {
    const { deckId } = await sharedDeckForChildren([childId]);
    const services = buildTestServices().services;
    const started = await startLegacyTrainingSession(services, { childId, deckId, microphoneEnabled: false });
    expect(started.canRead).toBe(true);
    await updateChild(services, childId, { canRead: false });
    const resumed = await startLegacyTrainingSession(services, { childId, deckId, microphoneEnabled: false });
    expect(resumed).toMatchObject({ resumed: true, canRead: true, vocabularyFormat: "standard" });
    expect((await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.learning_sessions where id = $1", [started.sessionId],
    ))[0]!.context).toMatchObject({ canRead: true, vocabularyFormat: "standard" });
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

  it("zachowuje dokładne trójki zakresów przy stałym rozmiarze SQL i pomija pusty odczyt", async () => {
    const services = buildTestServices().services;
    const childB = (await createChild(services, { displayName: "Zakres B", avatarKey: "owl" })).id;
    const first = await sessionWithAttempt(childId);
    const second = await sessionWithAttempt(childB);
    const scopes = await query<{ childId: string; skillVersionId: string; skill: "listening" }>(
      `select child_id as "childId", skill_version_id as "skillVersionId", skill
       from learning_app.assessments where attempt_id = any($1::uuid[]) order by child_id`,
      [[first.attemptId, second.attemptId]],
    );
    expect(scopes).toHaveLength(2);
    const crossed = scopes.map((scope, index) => ({ ...scope, childId: scopes[1 - index]!.childId }));
    expect((await readSkillHistories(services.db, crossed)).size).toBe(0);
    capturedHistoryQueries = [];
    try {
      expect((await readSkillHistories(services.db, [])).size).toBe(0);
      expect(capturedHistoryQueries).toHaveLength(0);
      const absent = Array.from({ length: 400 }, (_, index) => ({
        childId: index % 2 ? childId : childB, skillVersionId: randomUUID(), skill: "listening" as const,
      }));
      const result = await readSkillHistories(services.db, [...scopes, ...scopes, ...absent]);
      expect([...result.keys()].sort()).toEqual(scopes.map(skillHistoryKey).sort());
      expect([...result.values()].map(history => history.length)).toEqual([1, 1]);
      // Bounded query text prevents hundreds of OR branches and JIT compilation overhead.
      expect(capturedHistoryQueries[0]!.length).toBeLessThan(5000);
    } finally {
      capturedHistoryQueries = null;
    }
  });

  it("kwalifikuje reading z audio jako wspomagane przy przyjęciu odpowiedzi", async () => {
    const { deckId } = await sharedDeckForChildren([childId]);
    const { services: sessionServices, clock } = buildTestServices();
    const { task } = await openLearningExercise(childId, deckId, "reading", sessionServices);
    await authorizeDisclosure(sessionServices, { taskId: task.taskId, kind: "audio" });
    clock.advanceMs(1);
    await authorizeDisclosure(sessionServices, { taskId: task.taskId, kind: "audio" });
    await answerCorrectly(task, sessionServices);

    const assessment = await query<{ outcome: string; independent: boolean; confirmation_eligible: boolean }>(
      `select a.outcome, a.independent, a.confirmation_eligible
         from learning_app.assessments a join learning_app.attempts t on t.id = a.attempt_id
        where t.task_id = $1 and a.skill = 'reading'`,
      [task.taskId],
    );
    expect(assessment[0]).toMatchObject({ outcome: "correct", independent: false, confirmation_eligible: false });
    const scope = (await query<{ child_id: string; skill_version_id: string }>(
      `select a.child_id, a.skill_version_id from learning_app.assessments a
        join learning_app.attempts t on t.id = a.attempt_id
       where t.task_id = $1 and a.skill = 'reading'`,
      [task.taskId],
    ))[0]!;
    const history = await readSkillHistories(sessionServices.db, [{
      childId: scope.child_id, skillVersionId: scope.skill_version_id, skill: "reading",
    }]);
    const entry = history.get(skillHistoryKey({
      childId: scope.child_id, skillVersionId: scope.skill_version_id, skill: "reading",
    }));
    expect(entry).toHaveLength(1);
    expect(entry![0]).toMatchObject({ independent: false, confirmationEligible: false });
    expect((await query<{ count: string }>(
      `select count(*)::text as count from learning_app.learning_events
        where task_id = $1 and kind = 'audio_issued' and sealed = true`,
      [task.taskId],
    ))[0]!.count).toBe("2");
  });

  it("ignoruje późniejsze i niezapieczętowane audio oraz audio spoza zadania", async () => {
    const { deckId } = await sharedDeckForChildren([childId]);
    const services = buildTestServices().services;
    const { task } = await openLearningExercise(childId, deckId, "reading", services);
    await answerCorrectly(task, services);
    const attempt = (await query<{ child_id: string; item_id: string; received_at: Date; skill_version_id: string }>(
      `select a.child_id, r.item_id, t.received_at, a.skill_version_id
         from learning_app.assessments a
         join learning_app.attempts t on t.id = a.attempt_id
         join learning_app.session_tasks st on st.id = t.task_id
         join learning_app.item_revisions r on r.id = st.item_revision_id
        where t.task_id = $1 and a.skill = 'reading'`,
      [task.taskId],
    ))[0]!;
    const timestamp = attempt.received_at;
    // Testowy, historycznie niemożliwy do zapisania stan unsealed pozwala
    // zweryfikować filtr obronny czytnika; wyłączony trigger nie opuszcza tej bazy.
    await pool.query("alter table learning_app.learning_events disable trigger learning_events_sealed_at_commit");
    try {
      await pool.query(
        `insert into learning_app.learning_events
          (id, child_id, task_id, item_id, sealed, step_id, kind, occurred_at, context)
         values ($1,$2,$3,$4,false,'unsealed-test','audio_issued',$5,'{}'::jsonb)`,
        [randomUUID(), attempt.child_id, task.taskId, attempt.item_id, new Date(timestamp.getTime() - 1000)],
      );
    } finally {
      await pool.query("alter table learning_app.learning_events enable trigger learning_events_sealed_at_commit");
    }
    await pool.query(
      `insert into learning_app.learning_events
        (id, child_id, task_id, item_id, sealed, step_id, kind, occurred_at, context)
       values ($1,$2,$3,$4,true,'late-audio-test','audio_issued',$5,'{}'::jsonb)`,
      [randomUUID(), attempt.child_id, task.taskId, attempt.item_id, new Date(timestamp.getTime() + 1000)],
    );
    const otherChild = (await createChild(services, { displayName: "Iga", avatarKey: "owl" })).id;
    await upsertAssignment(services, otherChild, deckId, null);
    const otherTask = await openLearningExercise(otherChild, deckId, "reading", services);
    await authorizeDisclosure(services, { taskId: otherTask.task.taskId, kind: "audio" });

    const scope = { childId: attempt.child_id, skillVersionId: attempt.skill_version_id, skill: "reading" as const };
    const histories = await readSkillHistories(services.db, [scope]);
    const history = histories.get(skillHistoryKey(scope));
    expect(history).toHaveLength(1);
    expect(history![0]!.independent).toBe(true);

    // A historical grade marked independent is requalified by the evidence reader.
    // No earlier sealed audio can mask the equality boundary in this scenario.
    await pool.query(
      `insert into learning_app.learning_events
        (id, child_id, task_id, item_id, sealed, step_id, kind, occurred_at, context)
       values ($1,$2,$3,$4,true,'equal-audio-test','audio_issued',$5,'{}'::jsonb)`,
      [randomUUID(), attempt.child_id, task.taskId, attempt.item_id, timestamp],
    );
    const requalified = (await readSkillHistories(services.db, [scope])).get(skillHistoryKey(scope));
    expect(requalified).toHaveLength(1);
    expect(requalified![0]).toMatchObject({ independent: false, confirmationEligible: false });
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
    const session = await startLegacyTrainingSession(services, { childId, deckId, microphoneEnabled: false });
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
      .toEqual({ id: childId, displayName: "Ala", avatarKey: "panda", birthYear: 2018, recordingMode: "hold", canRead: true });
    expect(await snapshot()).toEqual(before);
    expect(await query("select * from learning_app.child_profiles where id = $1", [otherId])).toEqual(otherBefore);
    expect(await query("select * from learning_app.child_profiles where id = $1", [childId]))
      .toEqual([{ ...profileBefore[0], display_name: "Ala", avatar_key: "panda" }]);
  });

  async function ensureUiAudioCatalog(services: Services): Promise<void> {
    const { provider, model, voice, format } = services.media!.tts;
    for (const [key, text] of Object.entries(UI_AUDIO_TEXTS)) {
      const fingerprint = ttsFingerprint({ text, locale: "pl-PL", provider, model, voice, format });
      const existing = (await query<{ generation_number: number }>(
        "select generation_number from learning_app.media_assets where fingerprint = $1 order by generation_number desc limit 1",
        [fingerprint],
      ))[0];
      if (existing) continue;
      const id = randomUUID();
      await pool.query(
        `insert into learning_app.media_assets
           (id, kind, fingerprint, generation_number, state, storage_key, content_sha256,
            mime_type, byte_count, provider, model, metadata)
         values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1,$5,$6,$7)`,
        [id, fingerprint, `blob/${id}`, `sha-${id}`, provider, model,
          { purpose: "kid_ui_guidance", uiAudioKey: key, text, locale: "pl-PL", voice, format }],
      );
    }
  }

  it("kwalifikuje próbę picture_listening z opcjami labelPl jako niezależną", async () => {
    const testServices = buildTestServices().services;
    const sessionServices = createServices({
      db: testDatabase().db,
      clock: new ManualClock(),
      media: {
        tts: { provider: "fake", model: "fake-tts", voice: "test", format: "mp3" },
        image: { provider: "fake", model: "fake-image", size: "small", quality: "low", format: "svg" },
      },
    });
    await ensureUiAudioCatalog(sessionServices);
    const nonReaderId = (await createChild(testServices, { displayName: "Ola", avatarKey: "fox" })).id;
    await updateChild(testServices, nonReaderId, { canRead: false });

    const draft = await createDraft(testServices, {
      title: "Kolory",
      vocabularyFormat: "picture",
      items: [
        {
          source: "czerwony",
          target: "red",
          acceptedAnswers: [],
          locales: { source: "pl-PL", target: "en-GB" },
          visualType: "color",
          visualData: { color: "#ff0000" },
        },
        {
          source: "niebieski",
          target: "blue",
          acceptedAnswers: [],
          locales: { source: "pl-PL", target: "en-GB" },
          visualType: "color",
          visualData: { color: "#0000ff" },
        },
        {
          source: "zielony",
          target: "green",
          acceptedAnswers: [],
          locales: { source: "pl-PL", target: "en-GB" },
          visualType: "color",
          visualData: { color: "#008000" },
        },
      ],
    });
    for (const index of [0, 1, 2]) {
      await attachFakeReadyAudio(draft.id, index);
      const revision = (
        await query<{ id: string }>(
          `select id from learning_app.item_revisions
            where deck_version_id = $1 order by position offset $2 limit 1`,
          [draft.id, index],
        )
      )[0]!;
      const illustrationId = randomUUID();
      const fingerprint = `fp-ill-${randomUUID()}`;
      await pool.query(
        `insert into learning_app.media_assets
          (id, kind, fingerprint, generation_number, state, storage_key, content_sha256, mime_type, byte_count, provider, model)
          values ($1,'illustration',$2,1,'ready',$3,$4,'image/svg+xml',128,'fake','fake-image')`,
        [illustrationId, fingerprint, `blob/${illustrationId}`, `sha-${illustrationId}`],
      );
      await pool.query(
        `insert into learning_app.revision_assets
          (item_revision_id, role, asset_id, expected_fingerprint, state) values ($1,'illustration',$2,$3,'approved')`,
        [revision.id, illustrationId, fingerprint],
      );
    }
    await publishDraft(testServices, draft.id, 1);
    await upsertAssignment(testServices, nonReaderId, draft.deckId, null);

    const session = await startLegacyTrainingSession(sessionServices, {
      childId: nonReaderId,
      deckId: draft.deckId,
      microphoneEnabled: true,
      supportsPictureVocabulary: true,
    });

    let listeningTask: TaskDto | null = null;
    for (let step = 0; step < 10; step++) {
      const task = (await nextTask(sessionServices, session.sessionId))!;
      if (task.exerciseType === "listening") {
        listeningTask = task;
        break;
      }
      await completePresentation(sessionServices, { taskId: task.taskId });
    }
    expect(listeningTask).not.toBeNull();
    expect(listeningTask!.prompt.kind).toBe("picture_listening");

    await answerCorrectly(listeningTask!);

    const targetRev = (
      await query<{ id: string }>(
        `select item_revision_id as id from learning_app.session_tasks where id = $1`,
        [listeningTask!.taskId],
      )
    )[0]!;
    const skillVersions = await query<{ id: string }>(
      `select sv.id from learning_app.skill_versions sv
         join learning_app.item_revision_skills irs on irs.skill_version_id = sv.id
        where irs.item_revision_id = $1 and sv.skill = 'listening'`,
      [targetRev.id],
    );
    expect(skillVersions.length).toBeGreaterThan(0);

    capturedHistoryQueries = [];
    const histories = await readSkillHistories(sessionServices.db, [
      { childId: nonReaderId, skillVersionId: skillVersions[0]!.id, skill: "listening" },
    ]);
    const historyQueries = capturedHistoryQueries;
    capturedHistoryQueries = null;
    expect(historyQueries!.some((statement) => /exists\s*\(\s*select 1 from learning_app\.learning_events/i.test(statement))).toBe(false);
    const audioQuery = historyQueries!.find((statement) => /from "learning_app"\."learning_events"/i.test(statement));
    expect(audioQuery).toBeDefined();
    expect(audioQuery).toMatch(/min\(.*occurred_at.*\).*group by.*task_id/is);
    expect(audioQuery).toMatch(/task_id.*=\s*any\(/i);
    const explainClient = await pool.connect();
    let audioPlan: unknown;
    try {
      await explainClient.query("begin");
      await explainClient.query("set local enable_seqscan = off");
      const explained = await explainClient.query(
        `explain (format json)
         select task_id, min(occurred_at)
           from learning_app.learning_events
          where task_id = $1 and kind = 'audio_issued' and sealed = true
          group by task_id`,
        [listeningTask!.taskId],
      );
      audioPlan = explained.rows[0]?.["QUERY PLAN"];
      await explainClient.query("rollback");
    } finally {
      explainClient.release();
    }
    expect(JSON.stringify(audioPlan)).toContain("learning_events_audio_task_occurred_idx");
    const history = histories.get(skillHistoryKey({
      childId: nonReaderId,
      skillVersionId: skillVersions[0]!.id,
      skill: "listening",
    }));

    expect(history).toBeDefined();
    expect(history!.length).toBe(1);
    expect(history![0]!.independent).toBe(true);
  });
});

