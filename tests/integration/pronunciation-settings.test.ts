import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createChild,
  createDraft,
  createServices,
  completePresentation,
  endSession,
  ensureLearningPolicy,
  fakeSpeechDeps,
  getPronunciationSettings,
  nextTask,
  publishDraft,
  setupParent,
  startSession,
  submitSpeechAttempt,
  updatePronunciationBands,
  upsertAssignment,
  type AppError,
} from "@learning/server";
import { buildTestServices, testDatabase, testDatabaseUrl, truncateCoreTables } from "./helpers";

process.env.DATABASE_URL = testDatabaseUrl();
import { disposeServerServices } from "../../apps/web/src/composition";
import { POST as loginRoute } from "../../apps/web/src/app/api/v1/parent/login/route";
import {
  GET as getPronunciationRoute,
  PUT as putPronunciationRoute,
} from "../../apps/web/src/app/api/v1/parent/children/[id]/pronunciation/route";

const BASE = "http://localhost:3000";

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await testDatabase().pool.query(sql, params);
  return result.rows as T[];
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (error: unknown) => {
      expect(error as AppError).toMatchObject({ code });
    },
  );
}

async function publishOneWord(services: ReturnType<typeof buildTestServices>["services"], childId: string) {
  const draft = await createDraft(services, {
    title: "Dni tygodnia",
    items: [{
      source: "poniedziałek",
      target: "Monday",
      acceptedAnswers: [],
      locales: { source: "pl-PL", target: "en-GB" },
      visualType: "color",
      visualData: { color: "#4169e1" },
    }],
  });
  const revision = (await query<{ id: string }>(
    `select id from learning_app.item_revisions where deck_version_id = $1`,
    [draft.id],
  ))[0]!;
  const audioId = randomUUID();
  const audioFingerprint = `fp-${randomUUID()}`;
  await testDatabase().pool.query(
    `insert into learning_app.media_assets
       (id, kind, fingerprint, generation_number, state, storage_key, content_sha256,
        mime_type, byte_count, provider, model)
     values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake-tts')`,
    [audioId, audioFingerprint, `blob/${audioId}`, `sha-${audioId}`],
  );
  await testDatabase().pool.query(
    `insert into learning_app.revision_assets (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'target_audio',$2,$3,'approved')`,
    [revision.id, audioId, audioFingerprint],
  );
  await testDatabase().pool.query(
    `insert into learning_app.revision_assets (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'illustration',null,$2,'omitted')`,
    [revision.id, `fp-ill-${randomUUID()}`],
  );
  await publishDraft(services, draft.id, 1);
  await upsertAssignment(services, childId, draft.deckId, null);
  return draft.deckId;
}

async function markPronunciationDue(childId: string, deckVersionId: string): Promise<void> {
  const revision = (await query<{ id: string }>(
    `select id from learning_app.item_revisions where deck_version_id = $1`,
    [deckVersionId],
  ))[0]!;
  const skills = await query<{ id: string }>(
    `select skill_version_id as id from learning_app.item_revision_skills where item_revision_id = $1 and skill = 'pronunciation'`,
    [revision.id],
  );
  for (const skill of skills) {
    await testDatabase().pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       values ($1,$2,'needs_confirmation',3,'2026-10-01T00:00:00Z','test')
       on conflict (child_id, skill_version_id) do update
         set status = 'needs_confirmation', independent_success_streak = 3, next_review_at = '2026-10-01T00:00:00Z'`,
      [childId, skill.id],
    );
  }
}

function wavInput() {
  const dataBytes = 16_000;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return { bytes: new Uint8Array(buffer), mimeType: "audio/wav", locale: "en-GB" };
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("ustawienia wymowy per dziecko (design 2026-10-09)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
  });

  afterAll(async () => {
    await disposeServerServices();
    await testDatabase().pool.end();
  });

  it("GET zwraca learning-v2 przy providerze i unavailable bez providera", async () => {
    const { services: bare, clock } = buildTestServices();
    const child = await createChild(bare, { displayName: "Szymon", avatarKey: "fox" });
    await ensureLearningPolicy(bare.db);
    const withoutProvider = await getPronunciationSettings(bare, child.id);
    expect(withoutProvider).toMatchObject({ pronunciationAvailable: false, thresholds: null, attempts: [] });

    const withSpeech = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    const settings = await getPronunciationSettings(withSpeech, child.id);
    expect(settings.pronunciationAvailable).toBe(true);
    expect(settings.thresholds).toEqual({ correctMinScore: 70, partialMinScore: 50 });
  });

  it("PUT tworzy kolejne niezmienne wersje polityki i przepina profil", async () => {
    const { services: bare, clock } = buildTestServices();
    const child = await createChild(bare, { displayName: "Krzyś", avatarKey: "owl" });
    const services = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    await ensureLearningPolicy(services.db);
    await updatePronunciationBands(services, child.id, { correctMinScore: 75, partialMinScore: 55 });
    await updatePronunciationBands(services, child.id, { correctMinScore: 80, partialMinScore: 60 });

    const rows = await query<{ id: string; config: { pronunciationBands: Record<string, { correctMinScore: number }> } }>(
      `select id, config from learning_app.learning_policies where id like $1 order by id`,
      [`child-${child.id}-%`],
    );
    expect(rows.map((row) => row.id)).toEqual([`child-${child.id}-1`, `child-${child.id}-2`]);
    expect(rows[0]!.config.pronunciationBands["fake-pron"]!.correctMinScore).toBe(75);
    expect(rows[1]!.config.pronunciationBands["fake-pron"]!.correctMinScore).toBe(80);
    const profile = (await query<{ policy_id: string }>(
      `select policy_id from learning_app.child_profiles where id = $1`,
      [child.id],
    ))[0]!;
    expect(profile.policy_id).toBe(`child-${child.id}-2`);
  });

  it("PUT waliduje dostępność, progi i istnienie profilu", async () => {
    const { services: bare, clock } = buildTestServices();
    const child = await createChild(bare, { displayName: "A", avatarKey: "cat" });
    const withSpeech = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    await expectAppError(updatePronunciationBands(bare, child.id, { correctMinScore: 75, partialMinScore: 55 }), "conflict");
    await expectAppError(updatePronunciationBands(withSpeech, child.id, { correctMinScore: 50, partialMinScore: 50 }), "validation");
    await expectAppError(updatePronunciationBands(withSpeech, randomUUID(), { correctMinScore: 75, partialMinScore: 55 }), "not_found");
  });

  it("aktywna sesja zachowuje starą politykę po zmianie progów", async () => {
    const { services: base, clock } = buildTestServices();
    const child = await createChild(base, { displayName: "B", avatarKey: "panda" });
    const services = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    const deckId = await publishOneWord(base, child.id);
    const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: true });
    await updatePronunciationBands(services, child.id, { correctMinScore: 90, partialMinScore: 70 });
    const oldRow = (await query<{ policy_id: string }>(
      `select policy_id from learning_app.learning_sessions where id = $1`,
      [session.sessionId],
    ))[0]!;
    expect(oldRow.policy_id).toBe("learning-v2");
    await endSession(services, session.sessionId);
    const next = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false });
    const nextRow = (await query<{ policy_id: string }>(
      `select policy_id from learning_app.learning_sessions where id = $1`,
      [next.sessionId],
    ))[0]!;
    expect(nextRow.policy_id).toBe(`child-${child.id}-1`);
  });

  it("GET zwraca ostatnią ocenę wymowy do listy kalibracyjnej", async () => {
    const { services: base, clock } = buildTestServices();
    const child = await createChild(base, { displayName: "Szymon", avatarKey: "fox" });
    await ensureLearningPolicy(base.db);
    const deckId = await publishOneWord(base, child.id);
    const revision = (await query<{ deck_version_id: string }>(
      `select published_version_id as deck_version_id from learning_app.decks where id = $1`,
      [deckId],
    ))[0]!.deck_version_id;
    await markPronunciationDue(child.id, revision);
    const services = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: true });
    let speechTask: { taskId: string } | null = null;
    for (let step = 0; step < 30 && !speechTask; step += 1) {
      const task = await nextTask(services, session.sessionId);
      if (!task) break;
      if (task.exerciseType === "speech") {
        speechTask = task;
      } else if (task.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task.taskId });
      } else {
        await testDatabase().pool.query(
          `update learning_app.session_tasks set state = 'answered' where id = $1 and state = 'issued'`,
          [task.taskId],
        );
      }
    }
    expect(speechTask).not.toBeNull();
    await submitSpeechAttempt(services, { taskId: speechTask!.taskId, clientAttemptId: randomUUID() }, wavInput());

    const settings = await getPronunciationSettings(services, child.id);
    expect(settings.attempts).toHaveLength(1);
    expect(settings.attempts[0]).toMatchObject({ word: "Monday", score: 95, band: "correct" });
    expect(settings.attempts[0]!.attemptedAt).toContain("2026-");
  });

  it("GET i PUT wymagają sesji rodzica", async () => {
    const id = randomUUID();
    const get = await getPronunciationRoute(new Request(`${BASE}/api/v1/parent/children/${id}/pronunciation`), context(id));
    const put = await putPronunciationRoute(
      new Request(`${BASE}/api/v1/parent/children/${id}/pronunciation`, {
        method: "PUT",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ correctMinScore: 75, partialMinScore: 55 }),
      }),
      context(id),
    );
    expect(get.status).toBe(401);
    expect(put.status).toBe(401);
  });

  it("GET działa z cookie zalogowanego rodzica", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "rodzinny-pin-1");
    const child = await createChild(services, { displayName: "Szymon", avatarKey: "fox" });
    const loginResponse = await loginRoute(new Request(`${BASE}/api/v1/parent/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ secret: "rodzinny-pin-1" }),
    }));
    const cookie = loginResponse.headers.getSetCookie().find((value) => value.startsWith("parent_session="))!.split(";")[0]!;
    const response = await getPronunciationRoute(
      new Request(`${BASE}/api/v1/parent/children/${child.id}/pronunciation`, {
        headers: { cookie },
      }),
      context(child.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pronunciationAvailable: false, thresholds: null });
  });
});
