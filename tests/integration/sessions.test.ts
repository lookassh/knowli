import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeDisclosure,
  completePresentation,
  createChild,
  createDraft,
  endSession,
  listKidDecks,
  nextTask,
  publishDraft,
  recordEvent,
  startSession,
  submitAttempt,
  upsertAssignment,
  type AppError,
} from "@learning/server";
import { TaskDtoSchema, type TaskDto } from "@learning/contracts";
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

function vocabItem(pair: { source: string; target: string }, example?: string) {
  return {
    source: pair.source,
    target: pair.target,
    acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" },
    visualType: "color" as const,
    visualData: { color: "#4169e1" },
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

/** Symulacja finalizacji próby (zadanie 7): zadanie oceniane przechodzi w answered. */
async function answerIssuedAssessedTask(sessionId: string): Promise<number> {
  const result = await pool.query(
    `update learning_app.session_tasks set state = 'answered'
      where session_id = $1 and state = 'issued' and exercise_type <> 'exposure'`,
    [sessionId],
  );
  return result.rowCount ?? 0;
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

  it("ponowny start tej samej talii wznawia aktywną sesję", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const second = await startSession(services, { childId, deckId, microphoneEnabled: false });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resumed).toBe(true);
    expect(second.microphoneEnabled).toBe(false);
  });

  it("start dla innej talii zamyka aktywną sesję jako ended", async () => {
    const deckA = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const deckB = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(2, 4));
    const first = await startSession(services, { childId, deckId: deckA.deckId, microphoneEnabled: true });
    const second = await startSession(services, { childId, deckId: deckB.deckId, microphoneEnabled: true });

    expect(second.sessionId).not.toBe(first.sessionId);
    const oldRow = (
      await query<{ state: string; ended_at: string }>(
        "select state, ended_at from learning_app.learning_sessions where id = $1",
        [first.sessionId],
      )
    )[0]!;
    expect(oldRow.state).toBe("ended");
    expect(oldRow.ended_at).not.toBeNull();
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
    expect(task!.prompt).toMatchObject({ kind: "exposure", target: "Monday" });
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

  it("endSession jest idempotentny i zwraca podsumowanie", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
    await nextTask(services, session.sessionId);

    const summary = await endSession(services, session.sessionId);
    expect(summary.state).toBe("completed");
    expect(summary.tasksIssued).toBe(1);
    expect(summary.assessedTasksIssued).toBe(0);
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

  it("po wyczerpaniu materiału zestaw nie jest rekomendowany, ale od razu wydaje extra-practice", async () => {
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

    // wszystkie powtórki w przyszłości → brak rekomendacji, ale bez blokady
    await expect(listKidDecks(services, childId)).resolves.toMatchObject([{ deckId, recommended: false }]);

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
    expect(row.context).toMatchObject({ reason: "extra-practice" });

    // odpowiedź działa normalnie i zamyka zadanie
    await answerCorrectly(extra!);
    const closed = (
      await query<{ state: string }>(`select state from learning_app.session_tasks where id = $1`, [extra!.taskId])
    )[0]!;
    expect(closed.state).toBe("answered");
    await endSession(services, second.sessionId);

    // po dojściu terminów (25h) zestaw wraca do rekomendowanych
    clock.advanceHours(25);
    await expect(listKidDecks(services, childId)).resolves.toMatchObject([{ deckId, recommended: true }]);
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

  it("po samodzielnym sukcesie rozpoznawania sesja wprowadza przypominanie, a potem wymowę", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: true });

    // przypominanie pojawia się samo — bez ręcznie zasianego terminu powtórki
    const recall = await driveRealUntil(session.sessionId, "recall");
    expect(recall).not.toBeNull();
    expect(recall!.prompt.kind).toBe("recall");
    expect(TaskDtoSchema.safeParse(recall).success).toBe(true);
    const recallContext = (
      await query<{ context: Record<string, unknown> }>(
        `select context from learning_app.session_tasks where id = $1`,
        [recall!.taskId],
      )
    )[0]!;
    expect(recallContext.context).toMatchObject({ reason: "stage-introduction" });
    await answerCorrectly(recall!);

    // wymowa wchodzi jako kolejny etap tego samego elementu (mikrofon zgłoszony)
    const speech = await driveRealUntil(session.sessionId, "speech");
    expect(speech).not.toBeNull();
    expect(speech!.prompt.kind).toBe("speech");
    expect(TaskDtoSchema.safeParse(speech).success).toBe(true);
    const speechContext = (
      await query<{ context: Record<string, unknown> }>(
        `select context from learning_app.session_tasks where id = $1`,
        [speech!.taskId],
      )
    )[0]!;
    expect(speechContext.context).toMatchObject({ reason: "stage-introduction" });
    // widok wymowy niesie wzorzec audio (SPEC §12.6)
    if (speech!.prompt.kind === "speech") {
      expect(speech!.prompt.audioAssetId).not.toBeNull();
    }
    await endSession(services, session.sessionId);
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
    expect(types).toContain("recall");
    await endSession(services, session.sessionId);
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
