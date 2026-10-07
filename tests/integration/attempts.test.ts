import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeDisclosure,
  completePresentation,
  createChild,
  createDraft,
  finalizeAttempt,
  nextTask,
  publishDraft,
  readAttempt,
  startSession,
  submitAttempt,
  upsertAssignment,
  type AppError,
} from "@learning/server";
import { AttemptDtoSchema, type TaskDto } from "@learning/contracts";
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

async function publishDeckWithAssignment(
  services: ReturnType<typeof buildTestServices>["services"],
  childId: string,
  pairs: { source: string; target: string }[],
): Promise<{ deckId: string; versionId: string }> {
  const draft = await createDraft(services, { title: `Zestaw ${pairs[0]!.target}`, items: pairs.map(vocabItem) });
  for (const index of pairs.keys()) {
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
  return { deckId: draft.deckId, versionId: draft.id };
}

interface AnswerKeyRow {
  target: string;
  correct_option_id: string | null;
}

async function answerKeyOf(taskId: string): Promise<AnswerKeyRow> {
  return (
    await query<AnswerKeyRow>(
      `select answer_key->>'target' as target, answer_key->>'correctOptionId' as correct_option_id
         from learning_app.session_tasks where id = $1`,
      [taskId],
    )
  )[0]!;
}

async function promptOptions(taskId: string): Promise<{ id: string; text: string }[]> {
  const rows = (
    await query<{ options: { id: string; text: string }[] }>(
      `select public_prompt->'options' as options from learning_app.session_tasks where id = $1`,
      [taskId],
    )
  )[0]!;
  return rows.options ?? [];
}

type Services = ReturnType<typeof buildTestServices>["services"];

async function submitCorrect(services: Services, task: TaskDto): Promise<ReturnType<typeof submitAttempt>> {
  const key = await answerKeyOf(task.taskId);
  if (task.prompt.kind === "listening" || task.prompt.kind === "reading" || task.prompt.kind === "reverse_recognition") {
    return submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "choice",
      optionId: key.correct_option_id!,
    });
  }
  return submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.target });
}

async function submitWrong(services: Services, task: TaskDto): Promise<ReturnType<typeof submitAttempt>> {
  if (task.prompt.kind === "listening" || task.prompt.kind === "reading" || task.prompt.kind === "reverse_recognition") {
    const key = await answerKeyOf(task.taskId);
    const wrong = (await promptOptions(task.taskId)).find((o) => o.id !== key.correct_option_id)!;
    return submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrong.id });
  }
  return submitAttempt(services, {
    taskId: task.taskId,
    clientAttemptId: randomUUID(),
    modality: "text",
    text: "definitely-not-the-answer",
  });
}

/** Pierwsze zadanie oceniane sesji; prezentacje po drodze są kończone. */
async function firstAssessedTask(services: Services, sessionId: string): Promise<TaskDto> {
  for (let step = 0; step < 10; step++) {
    const task = (await nextTask(services, sessionId))!;
    expect(task).not.toBeNull();
    if (task.exerciseType !== "exposure") return task;
    await completePresentation(services, { taskId: task.taskId });
  }
  throw new Error("nie wydano zadania ocenianego");
}

/** Fixture: element o zadanym indeksie ma należne sprawdzenie Recall/pisowni. */
async function setDueCheck(
  childId: string,
  versionId: string,
  itemIndex: number,
  status: "needs_confirmation" | "mastered",
  streak: number,
): Promise<string> {
  const revision = (
    await query<{ id: string }>(
      `select id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [versionId, itemIndex],
    )
  )[0]!;
  const rows = await query<{ skill_version_id: string }>(
    `select skill_version_id from learning_app.item_revision_skills
      where item_revision_id = $1 and skill in ('recall','spelling')`,
    [revision.id],
  );
  for (const row of rows) {
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       values ($1,$2,$3,$4, '2026-10-01T00:00:00Z', 'test')
       on conflict (child_id, skill_version_id) do update
         set status = excluded.status, independent_success_streak = excluded.independent_success_streak,
             next_review_at = excluded.next_review_at`,
      [childId, row.skill_version_id, status, streak],
    );
  }
  return revision.id;
}

async function progressOf(childId: string, skillVersionId: string) {
  return (
    await query<{ status: string; streak: number; next_review_at: string | null }>(
      `select status, independent_success_streak as streak, next_review_at
         from learning_app.child_skill_progress
        where child_id = $1 and skill_version_id = $2`,
      [childId, skillVersionId],
    )
  )[0];
}

async function skillVersionIds(revisionId: string, skill: string): Promise<string[]> {
  const rows = await query<{ skill_version_id: string }>(
    `select skill_version_id from learning_app.item_revision_skills
      where item_revision_id = $1 and skill = $2`,
    [revisionId, skill],
  );
  return rows.map((r) => r.skill_version_id);
}

async function attemptRows(taskId: string) {
  return query<{
    id: string;
    child_id: string;
    state: string;
    modality: string;
    attempt_number: number;
    request_hash: string;
    feedback: { kind?: string } | null;
    context: Record<string, unknown>;
  }>(
    `select id, child_id, state, modality, attempt_number, request_hash, feedback, context
       from learning_app.attempts where task_id = $1 order by attempt_number`,
    [taskId],
  );
}

async function assessmentsOf(attemptId: string) {
  return query<{
    skill: string;
    outcome: string;
    reason: string | null;
    independent: boolean;
    confirmation_eligible: boolean;
    details: Record<string, unknown>;
  }>(
    `select skill, outcome, reason, independent, confirmation_eligible, details
       from learning_app.assessments where attempt_id = $1 order by skill`,
    [attemptId],
  );
}

async function taskRow(taskId: string) {
  return (
    await query<{ state: string; context: Record<string, unknown> }>(
      `select state, context from learning_app.session_tasks where id = $1`,
      [taskId],
    )
  )[0]!;
}

async function sessionContextRow(sessionId: string) {
  return (
    await query<{ reservations: string[]; settled_checks: string[] | null }>(
      `select context->'reservations' as reservations, context->'settledChecks' as settled_checks
         from learning_app.learning_sessions where id = $1`,
      [sessionId],
    )
  )[0]!;
}

async function feedbackEvents(taskId: string) {
  return query<{ step_id: string; sealed: boolean; target_keys: string[] | null }>(
    `select e.step_id, e.sealed, array_agg(x.target_key) as target_keys
       from learning_app.learning_events e
       left join learning_app.event_exposures x on x.event_id = e.id
      where e.task_id = $1 and e.kind = 'feedback_issued'
      group by e.step_id, e.sealed, e.occurred_at, e.id
      order by e.occurred_at`,
    [taskId],
  );
}

/** Symulacja przepływu mowy (zadanie 8): próba processing wstawiona wprost do bazy. */
async function insertProcessingAttempt(taskId: string, receivedAtIso: string): Promise<string> {
  const task = (
    await query<{ child_id: string; item_revision_id: string }>(
      `select child_id, item_revision_id from learning_app.session_tasks where id = $1`,
      [taskId],
    )
  )[0]!;
  const id = randomUUID();
  await pool.query(
    `insert into learning_app.attempts
       (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number,
        modality, state, answer, context, policy_id, received_at)
     values ($1,$2,$3,$4,$5,'hash',1,'audio','processing',jsonb_build_object('pending',true),
             jsonb_build_object('receivedAt', $6::text), 'learning-v1', $6::timestamptz)`,
    [id, task.child_id, taskId, task.item_revision_id, randomUUID(), receivedAtIso],
  );
  return id;
}

describe("przyjmowanie odpowiedzi (integracja)", () => {
  let services: Services;
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

  it("poprawna odpowiedź tekstowa zalicza umiejętność, ustawia feedback i zapisuje ekspozycję przed odpowiedzią", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const revision0 = (
      await query<{ id: string }>(
        `select id from learning_app.item_revisions where deck_version_id = $1 order by position limit 1`,
        [versionId],
      )
    )[0]!;
    await setDueCheck(childId, versionId, 0, "needs_confirmation", 3);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, session.sessionId))!;
    expect(task.exerciseType).toBe("recall");

    const dto = await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Monday",
    });
    expect(AttemptDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto).toMatchObject({ state: "completed", modality: "text", taskState: "answered" });
    expect(dto.feedback?.kind).toBe("great");
    expect(dto.stepId).not.toBeNull();

    const [attempt] = await attemptRows(task.taskId);
    expect(attempt).toMatchObject({ state: "completed", modality: "text", attempt_number: 1, child_id: childId });
    const grades = await assessmentsOf(attempt!.id);
    expect(grades).toHaveLength(2);
    for (const grade of grades) {
      expect(grade).toMatchObject({ outcome: "correct", independent: true });
    }
    // projekcja zaktualizowana w tej samej transakcji
    const recallVersion = (await skillVersionIds(revision0.id, "recall"))[0]!;
    // projekcja liczy od historii: fixture bez ocen → pierwszy sukces daje streak 1
    expect(await progressOf(childId, recallVersion)).toMatchObject({ status: "practicing", streak: 1 });
    // ujawnienie feedbacku zapisane i zapieczętowane przed odpowiedzią HTTP
    const events = await feedbackEvents(task.taskId);
    expect(events).toHaveLength(1);
    expect(events[0]!.sealed).toBe(true);
    expect(events[0]!.step_id).toBe(dto.stepId);
    expect(events[0]!.target_keys).not.toBeNull();
  });

  it("retry z tym samym clientAttemptId i tą samą treścią zwraca ten sam wynik; inna treść daje 409", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    await setDueCheck(childId, versionId, 0, "needs_confirmation", 3);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, session.sessionId))!;
    const clientAttemptId = randomUUID();

    const first = await submitAttempt(services, { taskId: task.taskId, clientAttemptId, modality: "text", text: "Monday" });
    const retry = await submitAttempt(services, { taskId: task.taskId, clientAttemptId, modality: "text", text: "Monday" });
    expect(retry.attemptId).toBe(first.attemptId);
    expect(retry.feedback?.kind).toBe(first.feedback?.kind);
    expect((await attemptRows(task.taskId)).length).toBe(1);

    // retry feedbacku zapisuje kolejne ujawnienie przed wysłaniem
    expect((await feedbackEvents(task.taskId)).length).toBe(2);

    await expectAppError(
      submitAttempt(services, { taskId: task.taskId, clientAttemptId, modality: "text", text: "Tuesday" }),
      "conflict",
    );
    const read = await readAttempt(services, first.attemptId);
    expect(read.attemptId).toBe(first.attemptId);
    expect(read.state).toBe("completed");
  });

  it("pierwszy błąd zostawia zadanie issued, drugi kończy jako answered i kieruje do wsparcia", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);

    const first = await submitWrong(services, task);
    expect(first.taskState).toBe("issued");
    expect(first.feedback?.kind).toBe("incorrect");
    const same = (await nextTask(services, session.sessionId))!;
    expect(same.taskId).toBe(task.taskId);

    const second = await submitWrong(services, task);
    expect(second.taskState).toBe("answered");
    expect((await attemptRows(task.taskId)).map((a) => a.attempt_number)).toEqual([1, 2]);
    expect((await taskRow(task.taskId)).state).toBe("answered");

    // po dwóch błędach scheduler wydaje prezentację wsparcia tego elementu
    const support = (await nextTask(services, session.sessionId))!;
    expect(support.exerciseType).toBe("exposure");
    const context = await taskRow(support.taskId);
    expect((context.context as { reason?: string }).reason).toBe("support");
  });

  it("„Nie pamiętam” to trudność bez mylonej pary; „Pomiń” nie udaje błędu", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);

    const forgotten = await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "dont_remember",
    });
    expect(forgotten.taskState).toBe("answered");
    expect(forgotten.feedback?.kind).toBe("incorrect");
    const [attempt] = await attemptRows(task.taskId);
    const grades = await assessmentsOf(attempt!.id);
    for (const grade of grades) {
      expect(grade).toMatchObject({ outcome: "incorrect", reason: "dont_remember", independent: true });
      expect(grade.details).not.toHaveProperty("confusion");
    }

    // „Pomiń”: bez ocen, bez kroku błędu, zadanie skipped, kolejne zadanie jest nowe
    const next = await firstAssessedTask(services, session.sessionId);
    expect(next.taskId).not.toBe(task.taskId);
    const skipped = await submitAttempt(services, {
      taskId: next.taskId,
      clientAttemptId: randomUUID(),
      modality: "skip",
    });
    expect(skipped).toMatchObject({ taskState: "skipped", state: "completed" });
    expect(skipped.feedback?.kind).toBe("not_assessed");
    const [skipAttempt] = await attemptRows(next.taskId);
    expect(skipAttempt!.modality).toBe("skip");
    expect(await assessmentsOf(skipAttempt!.id)).toHaveLength(0);
    expect((await taskRow(next.taskId)).state).toBe("skipped");
  });

  it("odpowiedź dla zadania zakończonego i dla prezentacji jest odrzucana", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);
    await submitCorrect(services, task);

    await expectAppError(
      submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Monday" }),
      "conflict",
    );
    expect((await attemptRows(task.taskId)).length).toBe(1);

    const presentation = (await nextTask(services, session.sessionId))!;
    if (presentation.exerciseType === "exposure") {
      await expectAppError(
        submitAttempt(services, {
          taskId: presentation.taskId,
          clientAttemptId: randomUUID(),
          modality: "text",
          text: "x",
        }),
        "validation",
      );
    }
  });

  it("299 sekund od ekspozycji nie kwalifikuje Recall: sukces pozostaje utrwalaniem", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const revision0 = (
      await query<{ id: string }>(
        `select id from learning_app.item_revisions where deck_version_id = $1 order by position limit 1`,
        [versionId],
      )
    )[0]!;
    const recallVersion = (await skillVersionIds(revision0.id, "recall"))[0]!;

    // element 0: prezentacja (ekspozycja celu), potem należne sprawdzenie
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const exposure = (await nextTask(services, session.sessionId))!;
    expect(exposure.exerciseType).toBe("exposure");
    await completePresentation(services, { taskId: exposure.taskId });

    await setDueCheck(childId, versionId, 0, "needs_confirmation", 3);
    clock.advanceMs(298_000);
    const check = (await nextTask(services, session.sessionId))!;
    expect(check.exerciseType).toBe("recall");
    clock.advanceMs(1_000); // łącznie 299 s od ekspozycji
    const tooSoon = await submitAttempt(services, {
      taskId: check.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Monday",
    });
    expect(tooSoon.feedback?.kind).toBe("great"); // treść poprawna...
    const [attempt] = await attemptRows(check.taskId);
    const grades = await assessmentsOf(attempt!.id);
    for (const grade of grades) {
      expect(grade.independent).toBe(false); // ...ale to utrwalanie, nie niezależne sprawdzenie
    }
    expect((attempt!.context as { lastExposureAt?: string }).lastExposureAt).toBeDefined();
    // kontekst zamrożony przy received_at: odczyt 30 s później nie zmienia kwalifikacji
    clock.advanceMs(30_000);
    const reread = await readAttempt(services, attempt!.id);
    expect(reread.state).toBe("completed");
    expect((await assessmentsOf(attempt!.id)).every((g) => !g.independent)).toBe(true);
    // projekcja nie awansuje: seria nie rośnie z próby z niedawną ekspozycją
    expect(await progressOf(childId, recallVersion)).toMatchObject({ streak: 0 });
  });

  it("ujawnienie na drugim kliencie przed odpowiedzią jest uwzględnione we wspólnej kolejności", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    await setDueCheck(childId, versionId, 0, "needs_confirmation", 3);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const check = (await nextTask(services, session.sessionId))!;
    expect(check.exerciseType).toBe("recall");

    const second = openRestartedServices();
    try {
      await authorizeDisclosure(second.services, { taskId: check.taskId, kind: "audio" });
    } finally {
      await second.dispose();
    }

    clock.advanceMs(301_000); // poza okno 300 s — dyskwalifikuje wyłącznie użyte wsparcie
    const dto = await submitAttempt(services, {
      taskId: check.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Monday",
    });
    expect(dto.feedback?.kind).toBe("great");
    const [attempt] = await attemptRows(check.taskId);
    expect((attempt!.context as { assistance?: string[] }).assistance).toContain("model_audio");
    const grades = await assessmentsOf(attempt!.id);
    for (const grade of grades) {
      expect(grade.independent).toBe(false); // odsłuch wzorca = próba wspomagana
    }
  });

  it("leniwa finalizacja: processing starsze niż 60 s zamienia się w nieocenione przy odczycie i nowej próbie", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);

    const freshId = await insertProcessingAttempt(task.taskId, "2026-10-07T15:59:55.000Z");
    const fresh = await readAttempt(services, freshId);
    expect(fresh).toMatchObject({ attemptId: freshId, state: "processing", feedback: null });

    // nowa próba tego zadania przy świeżym processing nie uruchamia drugiej analizy
    const same = await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "nope",
    });
    expect(same.attemptId).toBe(freshId);
    expect(same.state).toBe("processing");

    clock.advanceMs(61_000);
    const staled = await readAttempt(services, freshId);
    expect(staled).toMatchObject({ state: "completed", feedback: { kind: "not_assessed" }, taskState: "issued" });
    const grades = await assessmentsOf(freshId);
    expect(grades.length).toBeGreaterThan(0);
    for (const grade of grades) {
      expect(grade).toMatchObject({ outcome: "unassessed", reason: "technical" });
    }

    // droga do nowej próby jest otwarta
    const retry = await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: (await answerKeyOf(task.taskId)).target,
    });
    expect(retry).toMatchObject({ state: "completed", taskState: "answered" });
    expect((await attemptRows(task.taskId)).map((a) => a.attempt_number)).toEqual([1, 2]);
  });

  it("awaria w połowie finalizacji wycofuje całą transakcję oceny i projekcji", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);
    const attemptId = await insertProcessingAttempt(task.taskId, "2026-10-07T16:00:00.000Z");

    // zatruty grade łamie CHECK assessments (unassessed z confirmationEligible)
    await finalizeAttempt(services, attemptId, {
      skills: {
        listening: { outcome: "unevaluated", independent: false, confirmationEligible: true },
      },
      attempt: { independent: false, confirmationEligible: false },
    }).then(
      () => {
        throw new Error("Oczekiwano odrzucenia zatrutej oceny");
      },
      () => undefined,
    );

    const [attempt] = await attemptRows(task.taskId);
    expect(attempt!.state).toBe("processing");
    expect(await assessmentsOf(attemptId)).toHaveLength(0);
    const progressRows = await query<{ count: number }>(
      `select count(*)::int as count from learning_app.child_skill_progress where child_id = $1`,
      [childId],
    );
    expect(progressRows[0]!.count).toBe(0);
    expect(await feedbackEvents(task.taskId)).toHaveLength(0);
  });

  it("równoległa finalizacja tej samej próby kończy się jednym kompletem ocen", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);
    const attemptId = await insertProcessingAttempt(task.taskId, "2026-10-07T16:00:00.000Z");

    const grade = {
      skills: { listening: { outcome: "correct" as const, independent: true, confirmationEligible: false } },
      attempt: { independent: true, confirmationEligible: false },
    };
    const [a, b] = await Promise.all([
      finalizeAttempt(services, attemptId, grade),
      finalizeAttempt(services, attemptId, grade),
    ]);
    expect(a.state).toBe("completed");
    expect(b.state).toBe("completed");
    expect(await assessmentsOf(attemptId)).toHaveLength(1);
    expect((await feedbackEvents(task.taskId)).length).toBeGreaterThanOrEqual(1);
  });

  it("wynik drugiego dziecka nie trafia do zadania pierwszego", async () => {
    const { deckId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const other = await createChild(services, { displayName: "Bartek", avatarKey: "bear" });
    await upsertAssignment(services, other.id, deckId, null);

    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId);
    await submitCorrect(services, task);

    const [attempt] = await attemptRows(task.taskId);
    expect(attempt!.child_id).toBe(childId);
    const otherProgress = await query<{ count: number }>(
      `select count(*)::int as count from learning_app.child_skill_progress where child_id = $1`,
      [other.id],
    );
    expect(otherProgress[0]!.count).toBe(0);

    // złożony klucz (task_id, child_id) blokuje przypisanie próby cudzemu dziecku
    const taskMeta = (
      await query<{ item_revision_id: string }>(
        `select item_revision_id from learning_app.session_tasks where id = $1`,
        [task.taskId],
      )
    )[0]!;
    await expect(
      pool.query(
        `insert into learning_app.attempts
           (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash,
            attempt_number, modality, state, context, policy_id)
         values ($1,$2,$3,$4,$5,'h',2,'text','processing','{}'::jsonb,'learning-v1')`,
        [randomUUID(), other.id, task.taskId, taskMeta.item_revision_id, randomUUID()],
      ),
    ).rejects.toThrow(/attempts_task_child_fk/);
  });

  it("publikacja zmienionego słowa w trakcie sesji nie awansuje nowego skill_version", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = await firstAssessedTask(services, session.sessionId); // przypięte do wersji 1

    // rodzic publikuje wersję 2 ze zmienionym celem pierwszego elementu
    const v2 = randomUUID();
    const v1Revisions = await query<{ id: string; item_id: string; position: number; payload: Record<string, unknown>; deck_id: string }>(
      `select id, item_id, position, payload, deck_id from learning_app.item_revisions
        where deck_version_id = $1 order by position`,
      [versionId],
    );
    await pool.query(
      `insert into learning_app.deck_versions
         (id, deck_id, version_number, edit_number, state, title)
       values ($1,$2,2,1,'draft','Zestaw v2')`,
      [v2, deckId],
    );
    for (const rev of v1Revisions) {
      const newRevision = randomUUID();
      const payload = rev.position === 0 ? { ...rev.payload, target: "Mondayy" } : rev.payload;
      await pool.query(
        `insert into learning_app.item_revisions (id, item_id, deck_id, deck_version_id, position, payload, target_key)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [newRevision, rev.item_id, rev.deck_id, v2, rev.position, JSON.stringify(payload), `key-${newRevision}`],
      );
      const v1Skills = await query<{ skill: string; skill_version_id: string }>(
        `select skill, skill_version_id from learning_app.item_revision_skills where item_revision_id = $1`,
        [rev.id],
      );
      for (const { skill, skill_version_id } of v1Skills) {
        let reuseVersion = skill_version_id;
        if (rev.position === 0) {
          // zmiana celu zmienia kryteria wszystkich pięciu umiejętności
          reuseVersion = randomUUID();
          await pool.query(
            `insert into learning_app.skill_versions
               (id, item_id, skill, revision_number, criteria, criteria_hash, predecessor_id)
             values ($1,$2,$3,2,'{}'::jsonb,$4,$5)`,
            [reuseVersion, rev.item_id, skill, `hash-${reuseVersion}`, skill_version_id],
          );
        }
        await pool.query(
          `insert into learning_app.item_revision_skills (item_revision_id, item_id, skill, skill_version_id)
           values ($1,$2,$3,$4)`,
          [newRevision, rev.item_id, skill, reuseVersion],
        );
      }
    }
    await pool.query(`update learning_app.deck_versions set state = 'published', published_at = now() where id = $1`, [v2]);
    await pool.query(`update learning_app.decks set published_version_id = $1 where id = $2`, [v2, deckId]);

    await submitCorrect(services, task);

    const [attempt] = await attemptRows(task.taskId);
    const assessmentVersions = await query<{ skill_version_id: string }>(
      `select skill_version_id from learning_app.assessments where attempt_id = $1`,
      [attempt!.id],
    );
    const v1SkillVersions = (
      await query<{ skill_version_id: string }>(
        `select skill_version_id from learning_app.item_revision_skills
          where item_revision_id = any($1::uuid[])`,
        [v1Revisions.map((r) => r.id)],
      )
    ).map((r) => r.skill_version_id);
    expect(assessmentVersions.length).toBeGreaterThan(0);
    for (const row of assessmentVersions) {
      expect(v1SkillVersions).toContain(row.skill_version_id);
    }
    // nowe klucze wersji 2 nie mają żadnego postępu dziecka
    const v2Progress = await query<{ count: number }>(
      `select count(*)::int as count from learning_app.child_skill_progress p
         join learning_app.item_revision_skills s on s.skill_version_id = p.skill_version_id
        where s.item_revision_id = any($1::uuid[]) and p.child_id = $2`,
      [
        (await query<{ id: string }>(`select id from learning_app.item_revisions where deck_version_id = $1`, [v2])).map(
          (r) => r.id,
        ),
        childId,
      ],
    );
    expect(v2Progress[0]!.count).toBe(0);
  });

  it("pominięte należne sprawdzenie zwalnia rezerwację i nie wraca w tej sesji", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 4));
    await setDueCheck(childId, versionId, 0, "needs_confirmation", 3);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const check = (await nextTask(services, session.sessionId))!;
    expect(check.exerciseType).toBe("recall");
    const contextBefore = await sessionContextRow(session.sessionId);
    expect(contextBefore.reservations.length).toBeGreaterThan(0);

    await submitAttempt(services, { taskId: check.taskId, clientAttemptId: randomUUID(), modality: "skip" });

    const contextAfter = await sessionContextRow(session.sessionId);
    expect(contextAfter.reservations).toHaveLength(0);
    expect((contextAfter.settled_checks ?? []).length).toBeGreaterThan(0);

    const next = (await nextTask(services, session.sessionId))!;
    expect(next.taskId).not.toBe(check.taskId);
    expect(next.exerciseType).not.toBe("recall");
  });

  it("pełna pętla opanowania: seria sukcesów, potwierdzenie po przerwie, błąd → needs_reconfirmation", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 2));
    const revision0 = (
      await query<{ id: string }>(
        `select id from learning_app.item_revisions where deck_version_id = $1 order by position limit 1`,
        [versionId],
      )
    )[0]!;
    const recallVersion = (await skillVersionIds(revision0.id, "recall"))[0]!;
    await setDueCheck(childId, versionId, 0, "needs_confirmation", 0);

    const answerDueCheck = async (text: string): Promise<void> => {
      const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
      const check = (await nextTask(services, session.sessionId))!;
      expect(check.exerciseType).toBe("recall");
      clock.advanceMs(301_000); // poza okno 300 s od ekspozycji z poprzedniego cyklu
      const dto = await submitAttempt(services, {
        taskId: check.taskId,
        clientAttemptId: randomUUID(),
        modality: "text",
        text,
      });
      expect(dto.feedback?.kind).toBe(text === "Monday" ? "great" : "incorrect");
    };

    await answerDueCheck("Monday"); // sukces 1 (bez przerwy 12 h — nie potwierdza)
    expect(await progressOf(childId, recallVersion)).toMatchObject({ status: "practicing", streak: 1 });

    clock.advanceHours(25);
    await answerDueCheck("Monday"); // sukces 2, po przerwie i w innym dniu lokalnym
    expect(await progressOf(childId, recallVersion)).toMatchObject({ status: "practicing", streak: 2 });

    clock.advanceHours(25 + 50); // sukces 3 po pełnym odstępie
    await answerDueCheck("Monday");
    expect(await progressOf(childId, recallVersion)).toMatchObject({ status: "mastered", streak: 3 });

    clock.advanceHours(24 * 7 + 13);
    await answerDueCheck("zupelnie-inne-slowo");
    expect(await progressOf(childId, recallVersion)).toMatchObject({ status: "needs_reconfirmation", streak: 0 });
  });
});
