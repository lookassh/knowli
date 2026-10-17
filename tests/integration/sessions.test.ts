import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeDisclosure,
  completePresentation,
  contextOf,
  createChild,
  createDraft,
  createDraftFromPublished,
  endSession,
  finalizeAttempt,
  listKidDecks,
  nextTask,
  publishDraft,
  readParentWorkCard,
  recordEvent,
  startSession,
  submitAttempt,
  upsertAssignment,
  updateChild,
  type AppError,
} from "@learning/server";
import { SessionSummaryDtoSchema, TaskDtoSchema, type TaskDto } from "@learning/contracts";
import {
  buildTestServices,
  openRestartedServices,
  testDatabase,
  truncateCoreTables,
  type ManualClock,
} from "./helpers";

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

afterAll(async () => {
  await pool.end();
});

describe("contextOf — kontekst przypięty do sesji", () => {
  it("zachowuje testDate tylko wtedy, gdy pole istnieje w kontekście", () => {
    expect(contextOf({ context: { testDate: "2026-10-11" } }).testDate).toBe("2026-10-11");
    expect(contextOf({ context: { testDate: null } }).testDate).toBeNull();
    expect(contextOf({ context: {} })).not.toHaveProperty("testDate");
  });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (error: unknown) => {
      expect(error).toMatchObject({ code });
    },
  );
}

const DAY_ITEMS: { source: string; target: string }[] = [
  { source: "poniedziałek", target: "Monday" },
  { source: "wtorek", target: "Tuesday" },
  { source: "środa", target: "Wednesday" },
  { source: "czwartek", target: "Thursday" },
  { source: "piątek", target: "Friday" },
  { source: "sobota", target: "Saturday" },
  { source: "niedziela", target: "Sunday" },
  { source: "czerwony", target: "red" },
  { source: "niebieski", target: "blue" },
  { source: "zielony", target: "green" },
  { source: "żółty", target: "yellow" },
  { source: "czarny", target: "black" },
];

const TEST_COLOR_HEXES: Record<string, string> = {
  red: "#ff0000",
  blue: "#0000ff",
  green: "#008000",
  yellow: "#ffff00",
  black: "#000000",
};

function vocabItem(pair: { source: string; target: string }, example?: string) {
  return {
    source: pair.source,
    target: pair.target,
    acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" },
    visualType: "color" as const,
    visualData: { color: TEST_COLOR_HEXES[pair.target.toLowerCase()] ?? "#4169e1" },
    ...(example !== undefined ? { example } : {}),
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

async function attachApprovedIllustration(deckVersionId: string, itemIndex: number): Promise<string> {
  const revision = (
    await query<{ id: string }>(
      `select id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [deckVersionId, itemIndex],
    )
  )[0]!;
  const assetId = randomUUID();
  const fingerprint = `fp-ill-${randomUUID()}`;
  await pool.query(
    `insert into learning_app.media_assets
       (id, kind, fingerprint, generation_number, state, storage_key, content_sha256,
        mime_type, byte_count, provider, model)
     values ($1,'illustration',$2,1,'ready',$3,$4,'image/webp',1024,'fake','fake-image')`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`],
  );
  await pool.query(
    `insert into learning_app.revision_assets
       (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'illustration',$2,$3,'approved')`,
    [revision.id, assetId, fingerprint],
  );
  return assetId;
}

async function attachApprovedExampleAudio(deckVersionId: string, itemIndex: number): Promise<string> {
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
     values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',2048,'fake','fake-tts')`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`],
  );
  await pool.query(
    `insert into learning_app.revision_assets
       (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'example_audio',$2,$3,'approved')`,
    [revision.id, assetId, fingerprint],
  );
  return assetId;
}

async function publishDeckWithAssignment(
  services: ReturnType<typeof buildTestServices>["services"],
  childId: string,
  pairs: { source: string; target: string }[],
  illustrationFor?: number,
  exampleFor?: number,
): Promise<{
  deckId: string;
  versionId: string;
  illustrationAssetId?: string;
  exampleAudioAssetId?: string;
}> {
  const draft = await createDraft(services, {
    title: `Zestaw ${pairs[0]!.target}`,
    items: pairs.map((pair, index) =>
      vocabItem(pair, index === exampleFor ? `${pair.target} is a nice day.` : undefined),
    ),
  });
  let illustrationAssetId: string | undefined;
  let exampleAudioAssetId: string | undefined;
  for (const index of pairs.keys()) {
    await attachFakeReadyAudio(draft.id, index);
    const revision = (
      await query<{ id: string }>(
        `select id from learning_app.item_revisions
          where deck_version_id = $1 order by position offset $2 limit 1`,
        [draft.id, index],
      )
    )[0]!;
    if (index === exampleFor) {
      exampleAudioAssetId = await attachApprovedExampleAudio(draft.id, index);
    }
    if (index === illustrationFor) {
      illustrationAssetId = await attachApprovedIllustration(draft.id, index);
      continue;
    }
    await pool.query(
      `insert into learning_app.revision_assets
         (item_revision_id, role, asset_id, expected_fingerprint, state)
       values ($1,'illustration',null,$2,'omitted')`,
      [revision.id, `fp-ill-${randomUUID()}`],
    );
  }
  await publishDraft(services, draft.id, 1);
  await upsertAssignment(services, childId, draft.deckId, null);
  return { deckId: draft.deckId, versionId: draft.id, illustrationAssetId, exampleAudioAssetId };
}

async function issueTrainingContact(services: ReturnType<typeof buildTestServices>["services"], sessionId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const task = await nextTask(services, sessionId);
    if (!task) throw new Error("training session ended before issuing a contact");
    const [row] = await query<{ item_revision_id: string; answer_key: { target?: string; correctOptionId?: string } }>(
      "select item_revision_id, answer_key from learning_app.session_tasks where id=$1", [task.taskId],
    );
    if (task.exerciseType === "exposure") {
      await completePresentation(services, { taskId: task.taskId });
    } else if (row?.answer_key.correctOptionId && "options" in task.prompt) {
      await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: row.answer_key.correctOptionId });
    } else if (row?.answer_key.target && "text" in task.prompt) {
      await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: row.answer_key.target });
    }
    if (row) return row.item_revision_id;
  }
  throw new Error("training session did not issue a contact");
}

/** Symulacja finalizacji próby (zadanie 7): zadanie oceniane przechodzi w answered. */
async function answerIssuedAssessedTask(sessionId: string): Promise<number> {
  const result = await pool.query(
    `update learning_app.session_tasks set state = 'answered'
      where session_id = $1 and state = 'issued' and exercise_type <> 'exposure'`,
    [sessionId],
  );
  return result.rowCount ?? 0;
}

async function seedSummaryCheck(childId: string, versionId: string): Promise<void> {
  await pool.query(`insert into learning_app.child_skill_progress
    (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
    select $1, s.skill_version_id, 'needs_confirmation', 2, '2026-10-01T00:00:00Z', 'test'
    from learning_app.item_revision_skills s
    join learning_app.item_revisions r on r.id = s.item_revision_id
    where r.deck_version_id = $2 and s.skill in ('recall','spelling')`, [childId, versionId]);
}

async function seedPresentedRecognitionAndSpelling(
  childId: string,
  versionId: string,
  position = 0,
): Promise<void> {
  const rows = await query<{ skill: string; skill_version_id: string }>(
    `select s.skill, s.skill_version_id
       from learning_app.item_revision_skills s
       join learning_app.item_revisions r on r.id = s.item_revision_id
      where r.deck_version_id = $1 and r.position = $2 and s.skill in ('listening','spelling')`,
    [versionId, position],
  );
  for (const row of rows) {
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       values ($1,$2,'practicing',$3,'2030-01-01T00:00:00Z','test')
       on conflict (child_id, skill_version_id) do update set
         status = 'practicing', independent_success_streak = excluded.independent_success_streak,
         next_review_at = excluded.next_review_at`,
      [childId, row.skill_version_id, row.skill === "listening" ? 1 : 0],
    );
  }
  expect(rows.map((row) => row.skill).sort()).toEqual(["listening", "spelling"]);
}

async function countSessionRows(sessionId: string, table: string): Promise<number> {
  const sql =
    table === "learning_sessions"
      ? "select count(*)::int as count from learning_app.learning_sessions where id = $1"
      : table === "session_tasks"
        ? "select count(*)::int as count from learning_app.session_tasks where session_id = $1"
        : table === "assessments"
          ? `select count(*)::int as count from learning_app.assessments n
               join learning_app.attempts a on a.id = n.attempt_id
               join learning_app.session_tasks t on t.id = a.task_id
              where t.session_id = $1`
          : `select count(*)::int as count from learning_app.${table} n
               join learning_app.session_tasks t on t.id = n.task_id
              where t.session_id = $1`;
  const rows = await query<{ count: number }>(sql, [sessionId]);
  return rows[0]!.count;
}

interface EventRow {
  id: string;
  kind: string;
  step_id: string;
  sealed: boolean;
  client_event_id: string | null;
  target_keys: string[] | null;
}

async function sessionEvents(sessionId: string): Promise<EventRow[]> {
  return query<EventRow>(
    `select e.id, e.kind, e.step_id, e.sealed, e.client_event_id,
            array_agg(x.target_key order by x.target_key) as target_keys
       from learning_app.learning_events e
       join learning_app.session_tasks t on t.id = e.task_id
       left join learning_app.event_exposures x on x.event_id = e.id
      where t.session_id = $1
      group by e.id, e.kind, e.step_id, e.sealed, e.client_event_id, e.occurred_at
      order by e.occurred_at, e.id`,
    [sessionId],
  );
}

/** Przeprowadza sesję dopóki nie wyda zadania oczekiwanego typu (lub nie skończy budżetu). */
async function driveUntilExercise(
  services: ReturnType<typeof buildTestServices>["services"],
  sessionId: string,
  wanted: TaskDto["exerciseType"],
  maxSteps = 40,
): Promise<TaskDto | null> {
  for (let step = 0; step < maxSteps; step++) {
    const task = await nextTask(services, sessionId);
    if (!task) return null;
    if (task.exerciseType === wanted) return task;
    if (task.exerciseType === "exposure") {
      await completePresentation(services, { taskId: task.taskId });
    } else {
      await answerIssuedAssessedTask(sessionId);
    }
  }
  return null;
}

describe("cykl życia sesji (integracja)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let clock: ManualClock;
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    clock = built.clock;
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    childId = child.id;
  });

  it("blokuje nową sesję standardową dla nieczytającego, ale pozwala wznowić przypiętą starą sesję", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const started = await startSession(services, { childId, deckId, microphoneEnabled: false });
    await updateChild(services, childId, { canRead: false });
    await pool.query("update learning_app.assignments set active=false where child_id=$1 and deck_id=$2", [childId, deckId]);
    await pool.query("update learning_app.decks set archived_at=now() where id=$1", [deckId]);
    const resumed = await startSession(services, { childId, deckId, microphoneEnabled: false });
    expect(resumed).toMatchObject({ sessionId: started.sessionId, resumed: true, canRead: true, vocabularyFormat: "standard" });
    expect(await listKidDecks(services, childId)).toMatchObject([
      { deckId, resumeOnly: true, activeSession: { sessionId: started.sessionId, mode: "training" }, mockTestAvailable: false },
    ]);
    await endSession(services, started.sessionId);
    const newDeck = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(2, 4));
    await expect(startSession(services, { childId, deckId: newDeck.deckId, microphoneEnabled: false }))
      .rejects.toMatchObject({ code: "validation", details: { reason: "vocabulary_requires_reading" } });
  });

  it("odrzuca klienta bez obsługi picture i wyłącza kartkówkę dla nieczytającego", async () => {
    const other = await createChild(services, { displayName: "Maja", avatarKey: "fox", canRead: false });
    const standard = await publishDeckWithAssignment(services, other.id, DAY_ITEMS.slice(0, 2));
    await expect(startSession(services, { childId: other.id, deckId: standard.deckId, microphoneEnabled: false, mode: "mock_test" }))
      .rejects.toMatchObject({ code: "validation", details: { reason: "non_reader_mock_test_unavailable" } });
    const draft = await createDraft(services, {
      title: "Kolory obrazkowe", vocabularyFormat: "picture",
      items: ["#ff0000", "#0000ff"].map((color, index) => ({
        source: ["czerwony", "niebieski"][index]!, target: ["red", "blue"][index]!, acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" }, visualType: "color" as const, visualData: { color },
      })),
    });
    await attachFakeReadyAudio(draft.id, 0);
    await attachFakeReadyAudio(draft.id, 1);
    await attachApprovedIllustration(draft.id, 0);
    await attachApprovedIllustration(draft.id, 1);
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, other.id, draft.deckId, null);
    await expect(startSession(services, { childId: other.id, deckId: draft.deckId, microphoneEnabled: false }))
      .rejects.toMatchObject({ code: "validation", details: { reason: "picture_client_update_required" } });
  });

  it("wydaje cztery obrazkowe odpowiedzi i przyjmuje czwarty wybór", async () => {
    const draft = await createDraft(services, {
      title: "Kolory", vocabularyFormat: "picture",
      items: [
        { source: "czerwony", target: "red", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#ff0000" } },
        { source: "niebieski", target: "blue", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#0000ff" } },
        { source: "zielony", target: "green", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#008000" } },
        { source: "żółty", target: "yellow", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#ffff00" } },
      ],
    });
    for (const index of [0, 1, 2, 3]) {
      await attachFakeReadyAudio(draft.id, index);
      await attachApprovedIllustration(draft.id, index);
    }
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, childId, draft.deckId, null);
    const session = await startSession(services, { childId, deckId: draft.deckId, microphoneEnabled: false, supportsPictureVocabulary: true });
    for (let index = 0; index < 2; index += 1) {
      const exposure = await nextTask(services, session.sessionId);
      expect(exposure?.prompt.kind).toBe("picture_exposure");
      await completePresentation(services, { taskId: exposure!.taskId });
    }
    let listening = await nextTask(services, session.sessionId);
    // Po bootstrapie losowanie może wybrać trzecią prezentację przed pytaniem.
    if (listening?.prompt.kind === "picture_exposure") {
      await completePresentation(services, { taskId: listening.taskId });
      listening = await nextTask(services, session.sessionId);
    }
    expect(listening?.prompt.kind).toBe("picture_listening");
    if (listening?.prompt.kind !== "picture_listening") throw new Error("expected picture listening task");
    expect(listening.prompt.options).toHaveLength(4);
    const [{ id: correctId }] = await query<{ id: string }>(
      "select answer_key->>'correctOptionId' as id from learning_app.session_tasks where id=$1", [listening.taskId],
    );
    const correct = listening.prompt.options.find((option) => option.id === correctId)!;
    const fourth = listening.prompt.options[3]!;
    const attempt = await submitAttempt(services, {
      taskId: listening.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: fourth.id,
    });
    if (fourth.id === correct.id) {
      expect(attempt.feedback).toMatchObject({ kind: "great" });
    } else {
      expect(attempt.feedback).toMatchObject({ kind: "incorrect", correctText: correct.labelPl });
      const stored = await query<{ details: { confusion: { expected: string; answered: string } } }>(
        "select details from learning_app.assessments where attempt_id=$1 and outcome='incorrect' limit 1", [attempt.attemptId],
      );
      expect(stored[0]?.details.confusion).toEqual({ expected: correct.labelPl, answered: fourth.labelPl });
    }
  });

  it("dwa równoległe starty dają jedną sesję", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const [a, b] = await Promise.all([
      startSession(services, { childId, deckId, microphoneEnabled: true }),
      startSession(services, { childId, deckId, microphoneEnabled: true }),
    ]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.state).toBe("active");
    expect(await countSessionRows(a.sessionId, "learning_sessions")).toBe(1);
  });

  it("rejects a stale daily_round start request without creating a session", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    await expect(startSession(services, { childId, deckId, microphoneEnabled: false, mode: "daily_round" as never }))
      .rejects.toMatchObject({ name: "ZodError" });
    expect(await query<{ count: string }>("select count(*)::text as count from learning_app.learning_sessions where child_id=$1", [childId]))
      .toEqual([{ count: "0" }]);
  });

  it("does not grade a delayed audio result from an ended legacy daily round", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 1));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    let task = (await nextTask(services, session.sessionId))!;
    while (task.exerciseType === "exposure") {
      await completePresentation(services, { taskId: task.taskId });
      task = (await nextTask(services, session.sessionId))!;
    }
    const legacySessionId = randomUUID();
    await pool.query(`insert into learning_app.learning_sessions
      (id, child_id, assignment_id, deck_id, deck_version_id, policy_id, microphone_enabled,
       mode, daily_round_date, mock_test_plan, state, task_budget, started_at, ended_at, context)
      select $2, child_id, assignment_id, deck_id, deck_version_id, policy_id, microphone_enabled,
       'daily_round', '2026-10-17', null, 'ended', task_budget, started_at, $3, context
      from learning_app.learning_sessions where id=$1`, [session.sessionId, legacySessionId, clock.now()]);
    const legacyTaskId = randomUUID();
    await pool.query(`insert into learning_app.session_tasks
      (id, session_id, child_id, deck_version_id, item_revision_id, ordinal, exercise_type, direction,
       state, public_prompt, answer_key, context, issued_at)
      select $2, $3, child_id, deck_version_id, item_revision_id, 0, exercise_type, direction,
       'issued', public_prompt, answer_key, context, issued_at
      from learning_app.session_tasks where id=$1`, [task.taskId, legacyTaskId, legacySessionId]);
    const attemptId = randomUUID();
    await pool.query(`insert into learning_app.attempts
      (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number,
       modality, state, context, policy_id, received_at)
      select $1, child_id, id, item_revision_id, $2, 'hash', 1, 'audio', 'processing', '{}', $3, $4
      from learning_app.session_tasks where id = $5`,
      [attemptId, randomUUID(), session.policyId, clock.now(), legacyTaskId]);

    await expect(finalizeAttempt(services, attemptId, {
      skills: { recall: { outcome: "correct", independent: true, confirmationEligible: true } },
      attempt: { independent: true, confirmationEligible: true },
    })).rejects.toMatchObject({ code: "conflict" });
    const unchanged = await query<{ state: string }>("select state from learning_app.attempts where id=$1", [attemptId]);
    expect(unchanged[0]?.state).toBe("processing");
    expect(await query("select * from learning_app.assessments where attempt_id=$1", [attemptId])).toEqual([]);
    expect(await query("select * from learning_app.reward_activity_settlements where task_id=$1", [legacyTaskId])).toEqual([]);
  });







  it("ponowny start tej samej talii wznawia aktywną sesję", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const second = await startSession(services, { childId, deckId, microphoneEnabled: false });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resumed).toBe(true);
    expect(second.microphoneEnabled).toBe(false);
  });

  it("singleton po własnej ekspozycji przechodzi do Recall bez fikcyjnego wyniku rozpoznawania", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, [DAY_ITEMS[0]!]);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const exposure = await nextTask(services, session.sessionId);
    expect(exposure?.exerciseType).toBe("exposure");
    await completePresentation(services, { taskId: exposure!.taskId });

    const recall = await nextTask(services, session.sessionId);
    expect(recall?.exerciseType).toBe("recall");

    const recognitionRows = await query<{ skill: string; independent_success_streak: number | null }>(
      `select s.skill, p.independent_success_streak
         from learning_app.item_revision_skills s
         join learning_app.item_revisions r on r.id = s.item_revision_id
         left join learning_app.child_skill_progress p on p.skill_version_id = s.skill_version_id and p.child_id = $1
        where r.deck_version_id = $2 and s.skill in ('listening','reading')`,
      [childId, versionId],
    );
    expect(recognitionRows).toHaveLength(2);
    expect(recognitionRows.every((row) => row.independent_success_streak === null)).toBe(true);
  });

  it("przypina datę sprawdzianu do sesji, wznowienia i kolejnego startu", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    await upsertAssignment(services, childId, deckId, "2026-10-11");
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const firstContext = (await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.learning_sessions where id = $1", [first.sessionId],
    ))[0]!.context;
    expect(firstContext.testDate).toBe("2026-10-11");

    await upsertAssignment(services, childId, deckId, "2026-10-12");
    const resumed = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const resumedContext = (await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.learning_sessions where id = $1", [resumed.sessionId],
    ))[0]!.context;
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumedContext.testDate).toBe("2026-10-11");

    await endSession(services, first.sessionId);
    const next = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const newContext = (await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.learning_sessions where id = $1", [next.sessionId],
    ))[0]!.context;
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(newContext.testDate).toBe("2026-10-12");
  });

  it("prior exposure and recognition put written preparation before unseen material", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    await upsertAssignment(services, childId, deckId, "2026-10-09");

    const prior = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const exposure = await nextTask(services, prior.sessionId);
    expect(exposure?.exerciseType).toBe("exposure");
    await completePresentation(services, { taskId: exposure!.taskId });
    await endSession(services, prior.sessionId);
    await seedPresentedRecognitionAndSpelling(childId, versionId);

    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [first, retry] = await Promise.all([
      nextTask(services, session.sessionId),
      nextTask(services, session.sessionId),
    ]);
    expect(first?.exerciseType).toBe("recall");
    expect(first?.taskId).toBe(retry?.taskId);
    const taskRow = (await query<{ context: Record<string, unknown>; ordinal: number }>(
      "select context, ordinal from learning_app.session_tasks where id = $1", [first!.taskId],
    ))[0]!;
    expect(taskRow.context).toMatchObject({ reason: "test-preparation" });
    expect(taskRow.ordinal).toBe(0);
    expect(first!.remainingAssessed).toBe(12);
    expect(retry!.remainingAssessed).toBe(12);
    expect(await countSessionRows(session.sessionId, "session_tasks")).toBe(1);
    const fixedPlan = (await query<{ training_plan: { slots: Array<{ taskId: string; reason: string; exerciseType: string }> } }>(
      "select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId],
    ))[0]!.training_plan;

    await pool.query("update learning_app.session_tasks set state = 'skipped' where id = $1", [first!.taskId]);
    expect(await countSessionRows(session.sessionId, "assessments")).toBe(0);
    const next = await nextTask(services, session.sessionId);
    expect(next?.taskId).toBe(fixedPlan.slots[1]?.taskId);
    const nextRow = (await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.session_tasks where id = $1", [next!.taskId],
    ))[0]!;
    expect(nextRow.context).toMatchObject({ reason: fixedPlan.slots[1]?.reason });

    await endSession(services, session.sessionId);
    const secondSession = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const secondPreparation = await nextTask(services, secondSession.sessionId);
    expect(secondPreparation?.exerciseType).toBe("recall");
    await submitAttempt(services, {
      taskId: secondPreparation!.taskId,
      clientAttemptId: randomUUID(),
      modality: "dont_remember",
    });
    await endSession(services, secondSession.sessionId);
    const thirdSession = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const support = await nextTask(services, thirdSession.sessionId);
    expect(support).toMatchObject({ exerciseType: "exposure" });
    const supportRow = (await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.session_tasks where id = $1", [support!.taskId],
    ))[0]!;
    expect(supportRow.context).toMatchObject({ reason: "support" });
    await endSession(services, thirdSession.sessionId);
  });

  it("legacy context without testDate keeps the ordinary scheduler", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    await upsertAssignment(services, childId, deckId, "2026-10-09");
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    await pool.query("update learning_app.learning_sessions set context = context - 'testDate' where id = $1", [session.sessionId]);

    const exposure = await nextTask(services, session.sessionId);
    expect(exposure?.exerciseType).toBe("exposure");
    await completePresentation(services, { taskId: exposure!.taskId });
    await seedPresentedRecognitionAndSpelling(childId, versionId);
    const next = await nextTask(services, session.sessionId);
    const row = (await query<{ context: Record<string, unknown> }>(
      "select context from learning_app.session_tasks where id = $1", [next!.taskId],
    ))[0]!;
    expect(row.context.reason).not.toBe("test-preparation");
  });

  it("start dla innej talii wymaga jawnego zakończenia aktywnej sesji", async () => {
    const deckA = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const deckB = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(2, 4));
    const first = await startSession(services, { childId, deckId: deckA.deckId, microphoneEnabled: true });
    await expectAppError(startSession(services, { childId, deckId: deckB.deckId, microphoneEnabled: true }), "conflict");
    const oldRow = (
      await query<{ state: string; ended_at: string }>(
        "select state, ended_at from learning_app.learning_sessions where id = $1",
        [first.sessionId],
      )
    )[0]!;
    expect(oldRow.state).toBe("active");
    expect(oldRow.ended_at).toBeNull();
    await endSession(services, first.sessionId);
    const second = await startSession(services, { childId, deckId: deckB.deckId, microphoneEnabled: true });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.deckVersionId).toBe(deckB.versionId);
    expect(second.state).toBe("active");
  });

  it("sesja bez zdarzeń przez ponad 30 minut zamyka się zamiast być wznawiana", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const first = await startSession(services, { childId, deckId, microphoneEnabled: true });
    await nextTask(services, first.sessionId);

    clock.advanceMs(31 * 60_000);
    const second = await startSession(services, { childId, deckId, microphoneEnabled: true });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.resumed).toBe(false);
    expect(
      (await query<{ state: string }>("select state from learning_app.learning_sessions where id = $1", [
        first.sessionId,
      ]))[0]!.state,
    ).toBe("ended");

    // snapshot kontaktów z poprzednich sesji trafił do kontekstu nowej sesji
    const context = (
      await query<{ context: { previousContact?: Record<string, string> } }>(
        "select context from learning_app.learning_sessions where id = $1",
        [second.sessionId],
      )
    )[0]!.context;
    expect(Object.keys(context.previousContact ?? {}).length).toBeGreaterThan(0);
  });

  it("start bez przypisania kończy się not_found", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const other = await createChild(services, { displayName: "Iga", avatarKey: "owl" });
    await expectAppError(
      startSession(services, { childId: other.id, deckId, microphoneEnabled: true }),
      "not_found",
    );
  });

  it("next retry zwraca to samo issued task bez duplikatów", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const first = await nextTask(services, session.sessionId);
    const retry = await nextTask(services, session.sessionId);

    expect(first).not.toBeNull();
    expect(retry!.taskId).toBe(first!.taskId);
    expect(retry!.ordinal).toBe(first!.ordinal);
    expect(await countSessionRows(session.sessionId, "session_tasks")).toBe(1);
  });

  it("pierwsze zadanie nowego materiału to prezentacja z ujawnieniem celu przed odpowiedzią", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);

    expect(task!.exerciseType).toBe("exposure");
    expect(task!.prompt).toMatchObject({
      kind: "exposure",
      target: "Monday",
      visualType: "color",
      visualData: { color: "#4169e1" },
    });
    expect(task!.remainingAssessed).toBe(session.taskBudget);

    // zapis ujawnienia poprzedza odpowiedź HTTP i działa bez ACK klienta
    const events = await sessionEvents(session.sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("prompt_issued");
    expect(events[0]!.sealed).toBe(true);
    expect(events[0]!.target_keys).not.toBeNull();
  });

  it("prezentacja niesie zatwierdzoną ilustrację, a karta bez obrazu dostaje null (SPEC §12.1)", async () => {
    const { deckId, illustrationAssetId } = await publishDeckWithAssignment(
      services,
      childId,
      DAY_ITEMS.slice(0, 3),
      0,
    );
    expect(illustrationAssetId).toBeDefined();
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });

    const first = await nextTask(services, session.sessionId);
    expect(first!.prompt).toMatchObject({ kind: "exposure", imageAssetId: illustrationAssetId });

    // karta z pominiętym obrazem: pomoc wizualna jest nieobecna, nie błędna
    await completePresentation(services, { taskId: first!.taskId, clientCommandId: randomUUID() });
    const second = await driveUntilExercise(services, session.sessionId, "exposure");
    expect(second).not.toBeNull();
    expect(second!.taskId).not.toBe(first!.taskId);
    expect(second!.prompt).toMatchObject({ kind: "exposure", imageAssetId: null });
  });

  it("prezentacja niesie audio zdania przykładowego, a karta bez przykładu dostaje null (SPEC §12.1, §22)", async () => {
    const { deckId, exampleAudioAssetId } = await publishDeckWithAssignment(
      services,
      childId,
      DAY_ITEMS.slice(0, 3),
      0,
      0,
    );
    expect(exampleAudioAssetId).toBeDefined();
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });

    const first = await nextTask(services, session.sessionId);
    expect(first!.prompt).toMatchObject({ kind: "exposure", exampleAudioAssetId });

    // karta bez zdania przykładowego: brak audio przykładu nie jest błędem
    await completePresentation(services, { taskId: first!.taskId, clientCommandId: randomUUID() });
    const second = await driveUntilExercise(services, session.sessionId, "exposure");
    expect(second).not.toBeNull();
    expect(second!.taskId).not.toBe(first!.taskId);
    expect(second!.prompt).toMatchObject({ kind: "exposure", exampleAudioAssetId: null });
  });

  it("limit czasu kończy wydawanie zadań między zadaniami", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);
    await completePresentation(services, { taskId: task!.taskId });

    clock.advanceMs(11 * 60_000);
    expect(await nextTask(services, session.sessionId)).toBeNull();

    const summary = await endSession(services, session.sessionId);
    expect(summary.state).toBe("completed");
  });

  it("budżet 12 nie rośnie i obietnica „Jeszcze 3” wygrywa z limitem czasu", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });

    let assessed = 0;
    let guard = 0;
    while (assessed < 9 && guard++ < 40) {
      const task = await nextTask(services, session.sessionId);
      expect(task).not.toBeNull();
      if (task!.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task!.taskId });
      } else {
        expect(await answerIssuedAssessedTask(session.sessionId)).toBe(1);
        assessed += 1;
      }
    }
    expect(assessed).toBe(9);

    // soft limit 10 minut przekroczony, ale trzy ostatnie zadania oceniane
    // są obiecane; prezentacje między nimi są poza budżetem
    clock.advanceMs(11 * 60_000);
    let promised = 0;
    let steps = 0;
    while (promised < 3) {
      expect(steps++).toBeLessThan(10);
      const task = await nextTask(services, session.sessionId);
      expect(task).not.toBeNull();
      if (task!.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task!.taskId });
        continue;
      }
      expect(await answerIssuedAssessedTask(session.sessionId)).toBe(1);
      promised += 1;
    }

    expect(await nextTask(services, session.sessionId)).toBeNull();
    const assessedRows = await query<{ count: number }>(
      `select count(*)::int as count from learning_app.session_tasks
        where session_id = $1 and exercise_type <> 'exposure'`,
      [session.sessionId],
    );
    expect(assessedRows[0]!.count).toBe(12);
  });

  it("podsumowanie rozdziela Recall i pisownię oraz zamyka ekspozycje przed odpowiedzią", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 1));
    await seedSummaryCheck(childId, versionId);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, session.sessionId))!;
    expect(task.exerciseType).toBe("recall");
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "monday" });
    clock.advanceMs(1000);
    const [summary, secondClient] = await Promise.all([
      endSession(services, session.sessionId), endSession(services, session.sessionId),
    ]);
    expect(secondClient).toEqual(summary);
    expect(SessionSummaryDtoSchema.safeParse(summary).success).toBe(true);
    expect(summary).toMatchObject({
      independentSuccesses: { recall: 1, spelling: 0 },
      practiceItems: [{ target: "Monday", skills: ["spelling"] }],
    });
    const events = (await sessionEvents(session.sessionId)).filter(e => e.step_id.startsWith(`${session.sessionId}:summary:`));
    expect(events).toHaveLength(2);
    expect(events.every(e => e.sealed && e.target_keys?.length === 1)).toBe(true);
    clock.advanceMs(1000);
    expect(await endSession(services, session.sessionId)).toEqual(summary);
    const latest = await query<{ occurred_at: Date }>(`select occurred_at from learning_app.learning_events
      where step_id like $1 order by occurred_at desc limit 1`, [`${session.sessionId}:summary:%`]);
    expect(latest[0]!.occurred_at).toEqual(clock.now());
  });

  it.each(["dont_remember", "skip", "assisted"] as const)("podsumowanie klasyfikuje %s bez fałszywego samodzielnego sukcesu", async (action) => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 1));
    await seedSummaryCheck(childId, versionId);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, session.sessionId))!;
    if (action === "assisted") await authorizeDisclosure(services, { taskId: task.taskId, kind: "hint" });
    await submitAttempt(services, action === "assisted"
      ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Monday" }
      : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: action });
    const summary = await endSession(services, session.sessionId);
    expect(summary).toMatchObject({ independentSuccesses: { recall: 0, spelling: 0 } });
    expect(summary.practiceItems).toEqual(action === "dont_remember"
      ? [{ itemId: expect.any(String), target: "Monday", skills: ["recall", "spelling"] }] : []);
  });

  it("podsumowanie dwóch umiejętności korzysta wyłącznie z ocen bieżącej sesji", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 1));
    await seedSummaryCheck(childId, versionId);
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, first.sessionId))!;
    const input = { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text" as const, text: "Monday" };
    await submitAttempt(services, input);
    await submitAttempt(services, input);
    const summary = await endSession(services, first.sessionId);
    expect(summary).toMatchObject({ independentSuccesses: { recall: 1, spelling: 1 }, practiceItems: [] });
    const second = await startSession(services, { childId, deckId, microphoneEnabled: false });
    expect(await endSession(services, second.sessionId)).toMatchObject({ independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [] });
  });

  it("spóźniona finalizacja próby mowy nie przepisuje pokazanego podsumowania", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 1));
    await seedSummaryCheck(childId, versionId);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = (await nextTask(services, session.sessionId))!;
    const attemptId = randomUUID();
    await pool.query(`insert into learning_app.attempts
      (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number,
       modality, state, context, policy_id, received_at)
      select $1, child_id, id, item_revision_id, $2, 'hash', 1, 'audio', 'processing', '{}', $3, $4
      from learning_app.session_tasks where id = $5`,
      [attemptId, randomUUID(), session.policyId, clock.now(), task.taskId]);
    const summary = await endSession(services, session.sessionId);
    expect(summary).toMatchObject({ independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [] });
    clock.advanceMs(1000);
    await finalizeAttempt(services, attemptId, {
      skills: { recall: { outcome: "incorrect", independent: true, confirmationEligible: false } },
      attempt: { independent: true, confirmationEligible: false },
    });
    expect(await endSession(services, session.sessionId)).toEqual(summary);
    const rows = await query<{ count: number }>(`select count(*)::int as count from learning_app.assessments where attempt_id = $1`, [attemptId]);
    expect(rows[0]!.count).toBe(1);
  });

  it("endSession jest idempotentny i zwraca podsumowanie", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    await nextTask(services, session.sessionId);

    const summary = await endSession(services, session.sessionId);
    expect(summary.state).toBe("completed");
    expect(summary.tasksIssued).toBe(1);
    expect(summary.assessedTasksIssued).toBe(0);
    expect(summary).toMatchObject({ independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [] });
    expect(summary.endedAt).not.toBeNull();

    const again = await endSession(services, session.sessionId);
    expect(again.endedAt).toBe(summary.endedAt);
  });
});

describe("zakończenie prezentacji (arch §9.1a)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    childId = child.id;
  });

  it("exposure → complete-presentation → next działa bez próby, oceny i zużycia budżetu", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);

    const done = await completePresentation(services, {
      taskId: task!.taskId,
      clientCommandId: randomUUID(),
    });
    expect(done).toMatchObject({ taskId: task!.taskId, state: "completed" });
    expect(done.completedAt).not.toBeNull();

    expect(await countSessionRows(session.sessionId, "attempts")).toBe(0);
    expect(await countSessionRows(session.sessionId, "assessments")).toBe(0);

    const next = await nextTask(services, session.sessionId);
    expect(next).not.toBeNull();
    expect(next!.taskId).not.toBe(task!.taskId);

    const events = await sessionEvents(session.sessionId);
    expect(events.some((e) => e.kind === "presentation_completed")).toBe(true);
  });

  it("retry completion zwraca ten sam rezultat i nie kończy kolejnego zadania", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);
    const commandId = randomUUID();

    const first = await completePresentation(services, { taskId: task!.taskId, clientCommandId: commandId });
    const next = await nextTask(services, session.sessionId);

    const retry = await completePresentation(services, { taskId: task!.taskId, clientCommandId: commandId });
    expect(retry.completedAt).toBe(first.completedAt);

    const nextRow = (
      await query<{ state: string }>("select state from learning_app.session_tasks where id = $1", [
        next!.taskId,
      ])
    )[0]!;
    expect(nextRow.state).toBe("issued");
  });

  it("completion dla zadania ocenianego jest odrzucane", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const assessed = await driveUntilExercise(services, session.sessionId, "listening");
    expect(assessed).not.toBeNull();

    await expectAppError(
      completePresentation(services, { taskId: assessed!.taskId, clientCommandId: randomUUID() }),
      "validation",
    );
  });
});

describe("ujawnienia i ekspozycje (Review Focus 2)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let clock: ManualClock;
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    clock = built.clock;
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    childId = child.id;
  });

  it("autoryzacja odsłuchu zapisuje ekspozycję celu przed odpowiedzią; retry odświeża czas", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);

    const disclosure = await authorizeDisclosure(services, { taskId: task!.taskId, kind: "audio" });
    expect(disclosure).toMatchObject({ taskId: task!.taskId, kind: "audio" });
    expect(disclosure.reveal).toBeNull();

    // ujawnienie zapisane i zapieczętowane bez żadnego ACK
    let events = await sessionEvents(session.sessionId);
    const audioEvents = events.filter((e) => e.kind === "audio_issued");
    expect(audioEvents).toHaveLength(1);
    expect(audioEvents[0]!.sealed).toBe(true);
    expect(audioEvents[0]!.target_keys).not.toBeNull();

    // retry/reload: ponowne wydanie treści rejestruje nowy czas możliwej ekspozycji
    clock.advanceMs(5_000);
    await authorizeDisclosure(services, { taskId: task!.taskId, kind: "audio" });
    events = await sessionEvents(session.sessionId);
    expect(events.filter((e) => e.kind === "audio_issued")).toHaveLength(2);
  });

  it("podpowiedź ujawnia rozwiązanie własnego zadania", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);

    const disclosure = await authorizeDisclosure(services, { taskId: task!.taskId, kind: "hint" });
    expect(disclosure.kind).toBe("hint");
    expect(disclosure.reveal).toMatchObject({ target: "Monday" });
    const events = await sessionEvents(session.sessionId);
    expect(events.some((e) => e.kind === "hint_issued" && e.target_keys !== null)).toBe(true);
  });

  it("utracony ACK: ten sam clientEventId nie tworzy dwóch obserwacji", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);
    const stepId = (await authorizeDisclosure(services, { taskId: task!.taskId, kind: "audio" })).stepId;

    const clientEventId = randomUUID();
    await recordEvent(services, { taskId: task!.taskId, clientEventId, kind: "audio_played", stepId });
    await recordEvent(services, { taskId: task!.taskId, clientEventId, kind: "audio_played", stepId });

    const observations = await query<{ count: number }>(
      `select count(*)::int as count from learning_app.learning_events
        where client_event_id = $1`,
      [clientEventId],
    );
    expect(observations[0]!.count).toBe(1);
  });

  it("drugi klient działa na tej samej sesji pod wspólną blokadą", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const task = await nextTask(services, session.sessionId);
    await authorizeDisclosure(services, { taskId: task!.taskId, kind: "audio" });

    const { services: secondClient, dispose } = openRestartedServices();
    try {
      const fromSecond = await authorizeDisclosure(secondClient, { taskId: task!.taskId, kind: "audio" });
      expect(fromSecond.taskId).toBe(task!.taskId);
    } finally {
      await dispose();
    }

    const events = await sessionEvents(session.sessionId);
    expect(events.filter((e) => e.kind === "audio_issued")).toHaveLength(2);
  });

  it("dystraktor Wednesday staje się ekspozycją Wednesday", async () => {
    const pairs = [DAY_ITEMS[3]!, DAY_ITEMS[2]!, DAY_ITEMS[4]!]; // Thursday, Wednesday, Friday
    const { deckId } = await publishDeckWithAssignment(services, childId, pairs);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });

    const reverse = await driveUntilExercise(services, session.sessionId, "reverse_recognition");
    expect(reverse).not.toBeNull();
    const texts = (reverse!.prompt as { options: { text: string }[] }).options.map((o) => o.text);
    expect(texts).toContain("Thursday");
    expect(texts.filter((t) => t !== "Thursday").sort()).toEqual(["Friday", "Wednesday"]);

    const prompt = (
      await sessionEvents(session.sessionId).then((rows) =>
        rows.filter((e) => e.kind === "prompt_issued" && e.step_id.startsWith(reverse!.taskId)),
      )
    )[0];
    expect(prompt).toBeDefined();
    expect(prompt!.target_keys).not.toBeNull();
    const keys = await query<{ target_key: string }>(
      `select x.target_key from learning_app.event_exposures x
        join learning_app.learning_events e on e.id = x.event_id
       where e.task_id = $1 and e.kind = 'prompt_issued'`,
      [reverse!.taskId],
    );
    const expectedKeys = (
      await query<{ target_key: string }>(
        `select target_key from learning_app.item_revisions where deck_version_id = $1`,
        [session.deckVersionId],
      )
    ).map((r) => r.target_key);
    expect(keys.map((k) => k.target_key).sort()).toEqual([...expectedKeys].sort());
  });
});

describe("ćwiczenie zestawu w dowolnym momencie (extra-practice + rekomendacja)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let clock: ManualClock;
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    clock = built.clock;
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    childId = child.id;
  });

  /** Poprawna odpowiedź na zadanie wyboru lub tekstowe wg klucza z bazy. */
  async function answerCorrectly(task: TaskDto): Promise<void> {
    const key = (
      await query<{ target: string; correct_option_id: string | null }>(
        `select answer_key->>'target' as target, answer_key->>'correctOptionId' as correct_option_id
           from learning_app.session_tasks where id = $1`,
        [task.taskId],
      )
    )[0]!;
    await submitAttempt(
      services,
      key.correct_option_id === null
        ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.target }
        : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correct_option_id },
    );
  }

  it("lista tematów podaje liczbę słów i liczy tylko opanowany Recall", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    await expect(listKidDecks(services, childId)).resolves.toMatchObject([
      { deckId, itemCount: 4, independentlyRecalledCount: 0 },
    ]);
    const skillRows = await query<{ skill: string; skill_version_id: string }>(
      `select irs.skill, irs.skill_version_id
         from learning_app.item_revision_skills irs
         join learning_app.item_revisions ir on ir.id = irs.item_revision_id
        where ir.deck_version_id = $1 and ir.position = 0 and irs.skill in ('recall', 'reading')`,
      [versionId],
    );
    expect(skillRows.map((row) => row.skill).sort()).toEqual(["reading", "recall"]);

    for (const row of skillRows) {
      await pool.query(
        `insert into learning_app.child_skill_progress
           (child_id, skill_version_id, status, projection_version)
         values ($1, $2, 'mastered', 'learning-v1')`,
        [childId, row.skill_version_id],
      );
    }

    await expect(listKidDecks(services, childId)).resolves.toMatchObject([
      { deckId, itemCount: 4, independentlyRecalledCount: 1 },
    ]);
  });

  it("zachowuje postęp przypiętej wersji po publikacji i w trybie wznowienia", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    const [recall] = await query<{ skill_version_id: string }>(
      `select irs.skill_version_id
         from learning_app.item_revision_skills irs
         join learning_app.item_revisions ir on ir.id = irs.item_revision_id
        where ir.deck_version_id = $1 and ir.position = 0 and irs.skill = 'recall'`,
      [versionId],
    );
    expect(recall).toBeDefined();
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, projection_version)
       values ($1, $2, 'mastered', 'learning-v1')`,
      [childId, recall!.skill_version_id],
    );

    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const nextVersion = await createDraftFromPublished(services, deckId);
    await publishDraft(services, nextVersion.id, nextVersion.editNumber);

    await expect(listKidDecks(services, childId)).resolves.toMatchObject([
      { deckId, activeSession: { sessionId: session.sessionId }, independentlyRecalledCount: 1 },
    ]);

    await pool.query("update learning_app.assignments set active=false where child_id=$1 and deck_id=$2", [childId, deckId]);
    await pool.query("update learning_app.decks set archived_at=now() where id=$1", [deckId]);
    await expect(listKidDecks(services, childId)).resolves.toMatchObject([
      { deckId, resumeOnly: true, activeSession: { sessionId: session.sessionId }, independentlyRecalledCount: 1 },
    ]);
  });

  it("utrzymuje rekomendację, gdy skończony plan nie zakłada nowych etapów z góry", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));

    // nowy materiał → rekomendacja przed nauką
    await expect(listKidDecks(services, childId)).resolves.toMatchObject([{ deckId, recommended: true }]);

    // sesja 1: cały materiał przerobiony poprawnie, budżet wyczerpany
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    let assessed = 0;
    for (let step = 0; step < 60; step++) {
      const task = await nextTask(services, first.sessionId);
      if (!task) break;
      if (task.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task.taskId });
        continue;
      }
      await answerCorrectly(task);
      assessed += 1;
    }
    expect(assessed).toBe(12); // budżet domyślny
    await endSession(services, first.sessionId);

    // Sukcesy nie dopisują zadań do aktualnej listy, więc nowa sesja może mieć kolejny zaplanowany etap.
    await expect(listKidDecks(services, childId)).resolves.toMatchObject([{ deckId, recommended: true }]);

    // druga sesja tego samego dnia: utrwalanie rozpoznawania zamiast „Na dziś wystarczy”
    const second = await startSession(services, { childId, deckId, microphoneEnabled: false });
    expect(second.resumed).toBe(false);
    const extra = await nextTask(services, second.sessionId);
    expect(extra).not.toBeNull();
    expect(extra!.exerciseType === "listening" || extra!.exerciseType === "reading").toBe(true);
    expect(TaskDtoSchema.safeParse(extra).success).toBe(true);
    if (extra!.prompt.kind === "listening" || extra!.prompt.kind === "reading") {
      expect(extra!.prompt.options.length).toBeGreaterThanOrEqual(1);
    }
    const row = (
      await query<{ context: Record<string, unknown> }>(
        `select context from learning_app.session_tasks where id = $1`,
        [extra!.taskId],
      )
    )[0]!;
    expect(row.context.reason).toEqual(expect.any(String));

    // odpowiedź działa normalnie i zamyka zadanie
    await answerCorrectly(extra!);
    const closed = (
      await query<{ state: string }>(`select state from learning_app.session_tasks where id = $1`, [extra!.taskId])
    )[0]!;
    expect(closed.state).toBe("answered");
    await endSession(services, second.sessionId);

    expect(await listKidDecks(services, childId)).toMatchObject([{ deckId }]);
  });

  it("druga sesja tego samego dnia rotuje elementy zamiast wiercić jeden (regresja „zawsze styczeń”)", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));

    // sesja 1: cały materiał przerobiony poprawnie, budżet wyczerpany
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    for (let step = 0; step < 60; step++) {
      const task = await nextTask(services, first.sessionId);
      if (!task) break;
      if (task.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task.taskId });
        continue;
      }
      await answerCorrectly(task);
    }
    await endSession(services, first.sessionId);

    // sesja 2 tego samego dnia: kolejne zadania dotyczą różnych elementów —
    // na 4-elementowym zestawie pierwsze 4 zadania to 4 różne rewizje
    const second = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const seenRevisions: string[] = [];
    for (let step = 0; step < 4; step++) {
      const task = await nextTask(services, second.sessionId);
      expect(task).not.toBeNull();
      const row = (
        await query<{ item_revision_id: string }>(
          `select item_revision_id from learning_app.session_tasks where id = $1`,
          [task!.taskId],
        )
      )[0]!;
      expect(seenRevisions).not.toContain(row.item_revision_id);
      seenRevisions.push(row.item_revision_id);
      if (task!.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task!.taskId });
      } else {
        await answerCorrectly(task!);
      }
    }
    expect(seenRevisions).toHaveLength(4);
    await endSession(services, second.sessionId);
  });
});

describe("wprowadzanie kolejnych etapów (SPEC §13)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    childId = child.id;
  });

  /** Poprawna odpowiedź na zadanie wyboru lub tekstowe wg klucza z bazy. */
  async function answerCorrectly(task: TaskDto): Promise<void> {
    const key = (
      await query<{ target: string; correct_option_id: string | null }>(
        `select answer_key->>'target' as target, answer_key->>'correctOptionId' as correct_option_id
           from learning_app.session_tasks where id = $1`,
        [task.taskId],
      )
    )[0]!;
    await submitAttempt(
      services,
      key.correct_option_id === null
        ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.target }
        : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correct_option_id },
    );
  }

  /** Prowadzi sesję prawdziwymi próbami (postęp rośnie) do zadania oczekiwanego typu. */
  async function driveRealUntil(
    sessionId: string,
    wanted: TaskDto["exerciseType"],
    maxSteps = 30,
  ): Promise<TaskDto | null> {
    for (let step = 0; step < maxSteps; step++) {
      const task = await nextTask(services, sessionId);
      if (!task) return null;
      if (task.exerciseType === wanted) return task;
      if (task.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task.taskId });
      } else {
        await answerCorrectly(task);
      }
    }
    return null;
  }

  it("planuje recall i wymowę dopiero w kolejnych sesjach po odpowiednim sukcesie", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const initialPlan = (await query<{ training_plan: { slots: Array<{ exerciseType: string; reason: string }> } }>(
      "select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId],
    ))[0]!.training_plan;
    expect(initialPlan.slots.some((slot) => slot.exerciseType === "recall" || slot.exerciseType === "speech")).toBe(false);
    for (;;) {
      const task = await nextTask(services, session.sessionId);
      if (!task) break;
      if (task.exerciseType === "exposure") await completePresentation(services, { taskId: task.taskId });
      else await answerCorrectly(task);
    }
    expect((await query<{ training_plan: unknown }>("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId]))[0]!.training_plan)
      .toEqual(initialPlan);
    await endSession(services, session.sessionId);

    const recallSession = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const recall = await driveRealUntil(recallSession.sessionId, "recall");
    expect(recall?.exerciseType).toBe("recall");
    expect(TaskDtoSchema.safeParse(recall).success).toBe(true);
    const recallContext = (await query<{ context: Record<string, unknown> }>("select context from learning_app.session_tasks where id=$1", [recall!.taskId]))[0]!;
    expect(recallContext.context).toMatchObject({ reason: "stage-introduction" });
    await answerCorrectly(recall!);
    await endSession(services, recallSession.sessionId);

    const speechSession = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const speech = await driveRealUntil(speechSession.sessionId, "speech");
    expect(speech?.prompt.kind).toBe("speech");
    expect(TaskDtoSchema.safeParse(speech).success).toBe(true);
    const speechContext = (await query<{ context: Record<string, unknown> }>("select context from learning_app.session_tasks where id=$1", [speech!.taskId]))[0]!;
    expect(speechContext.context).toMatchObject({ reason: "stage-introduction" });
    if (speech!.prompt.kind === "speech") expect(speech!.prompt.audioAssetId).not.toBeNull();
    await endSession(services, speechSession.sessionId);
  });

  it("bez mikrofonu wymowa się nie pojawia, a przypominanie działa (SPEC §14)", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });

    const types: string[] = [];
    for (let step = 0; step < 60; step++) {
      const task = await nextTask(services, session.sessionId);
      if (!task) break;
      types.push(task.exerciseType);
      if (task.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task.taskId });
      } else {
        await answerCorrectly(task);
      }
    }
    expect(types).not.toContain("speech");
    expect(types).not.toContain("recall");
    await endSession(services, session.sessionId);

    const nextSession = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const plan = (await query<{ training_plan: { slots: Array<{ exerciseType: string; reason: string }> } }>(
      "select training_plan from learning_app.learning_sessions where id=$1", [nextSession.sessionId],
    ))[0]!.training_plan;
    expect(plan.slots).toContainEqual(expect.objectContaining({ exerciseType: "recall", reason: "stage-introduction" }));
    expect(plan.slots.some((slot) => slot.exerciseType === "speech")).toBe(false);
    await endSession(services, nextSession.sessionId);
  });
});

describe("polityka per dziecka (design 2026-10-09)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let childId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    childId = child.id;
  });

  async function answerCorrectly(task: TaskDto): Promise<void> {
    const key = (await query<{ target: string; correct_option_id: string | null }>(
      `select answer_key->>'target' as target, answer_key->>'correctOptionId' as correct_option_id
         from learning_app.session_tasks where id = $1`, [task.taskId],
    ))[0]!;
    await submitAttempt(services, key.correct_option_id === null
      ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.target }
      : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correct_option_id });
  }

  it("nowa sesja przypina learning-v2 z pasmami 70/50", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    const row = (
      await query<{ policy_id: string }>(
        `select policy_id from learning_app.learning_sessions where id = $1`,
        [session.sessionId],
      )
    )[0]!;
    expect(row.policy_id).toBe("learning-v2");
    const config = (
      await query<{ config: Record<string, unknown> }>(
        `select config from learning_app.learning_policies where id = 'learning-v2'`,
      )
    )[0]!;
    expect(config.config).toMatchObject({
      pronunciationBands: {
        "azure-pronunciation": { correctMinScore: 70, partialMinScore: 50 },
        "fake-pron": { correctMinScore: 70, partialMinScore: 50 },
      },
    });
  });

  it("po pominięciu due-review wybiera kolejną umiejętność zamiast powtarzać tę samą", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       select $1, s.skill_version_id, 'practicing', 0,
              case when r.position = 0 then '2026-10-06T00:00:00Z'::timestamptz else '2026-10-05T00:00:00Z'::timestamptz end,
              'test'
         from learning_app.item_revision_skills s
         join learning_app.item_revisions r on r.id = s.item_revision_id
        where r.deck_version_id = $2 and r.position < 2 and s.skill = 'listening'`,
      [childId, versionId],
    );
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const first = await nextTask(services, session.sessionId);
    expect(first?.exerciseType).toBe("listening");
    const firstRow = (await query<{ position: number; context: Record<string, unknown> }>(
      `select r.position, t.context from learning_app.session_tasks t
         join learning_app.item_revisions r on r.id = t.item_revision_id where t.id = $1`, [first!.taskId],
    ))[0]!;
    expect(firstRow.position).toBe(1);
    expect(firstRow.context).toMatchObject({ reason: "due-review", skillAtIssue: "listening", statusAtIssue: "learning" });
    await submitAttempt(services, { taskId: first!.taskId, clientAttemptId: randomUUID(), modality: "skip" });

    const second = await nextTask(services, session.sessionId);
    expect(second?.exerciseType).toBe("listening");
    const secondRow = (await query<{ position: number }>(
      `select r.position from learning_app.session_tasks t
         join learning_app.item_revisions r on r.id = t.item_revision_id where t.id = $1`, [second!.taskId],
    ))[0]!;
    expect(secondRow.position).toBe(0);
    await endSession(services, session.sessionId);
  });

  it("po dwóch trudnych due-review wstawia jedno bezpieczne ćwiczenie rozpoznawania", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       select $1, s.skill_version_id, 'practicing', 0,
              case when r.position = 0 then '2026-10-05T00:00:00Z'::timestamptz else '2026-10-06T00:00:00Z'::timestamptz end,
              'test'
         from learning_app.item_revision_skills s
         join learning_app.item_revisions r on r.id = s.item_revision_id
        where r.deck_version_id = $2 and r.position < 2 and s.skill = 'listening'`,
      [childId, versionId],
    );
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    for (const expectedPosition of [0, 1]) {
      const task = await nextTask(services, session.sessionId);
      expect(task?.exerciseType).toBe("listening");
      const row = (await query<{ position: number; context: Record<string, unknown> }>(
        `select r.position, t.context from learning_app.session_tasks t
           join learning_app.item_revisions r on r.id = t.item_revision_id where t.id = $1`, [task!.taskId],
      ))[0]!;
      expect(row.position).toBe(expectedPosition);
      expect(row.context).toMatchObject({ reason: "due-review", skillAtIssue: "listening", statusAtIssue: "learning" });
      await answerCorrectly(task!);
    }
    const easy = await nextTask(services, session.sessionId);
    expect(easy?.exerciseType === "listening" || easy?.exerciseType === "reading").toBe(true);
    const easyContext = (await query<{ context: Record<string, unknown> }>(
      `select context from learning_app.session_tasks where id = $1`, [easy!.taskId],
    ))[0]!;
    expect(easyContext.context).toMatchObject({ reason: "difficulty-break" });
    await endSession(services, session.sessionId);
  });

  it("własna polityka profilu wygrywa z domyślną", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    await query(
      `update learning_app.child_profiles set policy_id = 'learning-v1' where id = $1`,
      [childId],
    );
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const row = (
      await query<{ policy_id: string }>(
        `select policy_id from learning_app.learning_sessions where id = $1`,
        [session.sessionId],
      )
    )[0]!;
    expect(row.policy_id).toBe("learning-v1");
  });
});
