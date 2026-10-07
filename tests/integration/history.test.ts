import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  createDraft,
  deleteChild,
  nextTask,
  publishDraft,
  startSession,
  submitAttempt,
  upsertAssignment,
} from "@learning/server";
import {
  buildTestServices,
  testDatabase,
  truncateCoreTables,
} from "./helpers";

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
});
