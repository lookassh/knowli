import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createChild, createDraft, createServices,
  executeMediaAsset, nextTask, prepareUiAudio, publishDraft, reconcileDraftAssets, runDueGenerationWork, startSession, upsertAssignment,
  type Services,
} from "@learning/server";
import { fakeGeneration, type FakeGeneration } from "./fakes";
import { testDatabase, truncateCoreTables } from "./helpers";
import { DisclosureDtoSchema, SessionDtoSchema } from "@learning/contracts";
import { handleKidApi } from "../../apps/web/src/kid/kid-router";
import { withApi } from "../../apps/web/src/http/errors";
const { pool } = testDatabase();

afterAll(async () => {
  await pool.end();
});

describe("migracja formatu zestawu obrazkowego", () => {
  it("ustawia zgodne wstecznie wartości domyślne i odrzuca niedozwolony format lekcji", async () => {
    const childId = randomUUID();
    await pool.query(
      "insert into learning_app.child_profiles(id, display_name, avatar_key) values ($1, 'Ala', 'fox')",
      [childId],
    );
    const profile = await pool.query("select can_read from learning_app.child_profiles where id = $1", [childId]);
    expect(profile.rows[0]).toEqual({ can_read: true });

    const deckId = randomUUID();
    await pool.query("insert into learning_app.decks(id, title, kind) values ($1, 'Lekcja', 'lesson')", [deckId]);
    const versionId = randomUUID();
    await expect(pool.query(
      `insert into learning_app.deck_versions(id, deck_id, version_number, edit_number, state, title, lesson_context, vocabulary_format)
       values ($1, $2, 1, 1, 'draft', 'Lekcja', '{"subjectId":"grammar"}', 'picture')`,
      [versionId, deckId],
    )).rejects.toThrow(/Lesson versions must use standard vocabulary format/);

    await expect(pool.query(
      `insert into learning_app.deck_versions(id, deck_id, version_number, edit_number, state, title, lesson_context, vocabulary_format)
       values ($1, $2, 1, 1, 'draft', 'Lekcja', '{"subjectId":"grammar"}', 'unknown')`,
      [randomUUID(), deckId],
    )).rejects.toThrow();
  });

  it("chroni format po opublikowaniu wersji", async () => {
    const deckId = randomUUID();
    const versionId = randomUUID();
    await pool.query("insert into learning_app.decks(id, title) values ($1, 'Kolory')", [deckId]);
    await pool.query(
      `insert into learning_app.deck_versions(id, deck_id, version_number, edit_number, state, title, vocabulary_format)
       values ($1, $2, 1, 1, 'draft', 'Kolory', 'picture')`,
      [versionId, deckId],
    );
    await pool.query("update learning_app.deck_versions set state = 'published', published_at = now() where id = $1", [versionId]);
    await expect(pool.query("update learning_app.deck_versions set vocabulary_format = 'standard' where id = $1", [versionId]))
      .rejects.toThrow(/Published version is immutable/);
  });
});

describe("bezpieczna sesja obrazkowa bez czytania", () => {
  let services: Services;
  let fakes: FakeGeneration;
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query("truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade");
    fakes = await fakeGeneration();
    services = createServices({ db: testDatabase().db, media: fakes.settings, generation: fakes.deps, mediaStore: fakes.store });
    await prepareUiAudio(services);
    const pending = (await pool.query("select id from learning_app.media_assets where state='pending'")).rows as { id: string }[];
    for (const asset of pending) await executeMediaAsset(services, asset.id);
  });
  afterEach(async () => { await fakes.dispose(); });

  it("po wyłączeniu mikrofonu pomija wydane przypominanie bez oceny i kończy jednowyrazową sesję", async () => {
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox", canRead: false });
    const draft = await createDraft(services, {
      title: "Kolory", vocabularyFormat: "picture",
      items: [{ source: "czerwony", target: "red", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#ff0000" } }],
    });
    await reconcileDraftAssets(services, draft.id);
    const [revision] = (await pool.query("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows as { id: string }[];
    for (let pass = 0; pass < 6; pass += 1) {
      if ((await runDueGenerationWork(services)).processed === 0) break;
    }
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: true, supportsPictureVocabulary: true });
    const exposure = await nextTask(services, session.sessionId);
    expect(exposure?.prompt.kind).toBe("picture_exposure");
    await completePresentation(services, { taskId: exposure!.taskId });
    const recall = await nextTask(services, session.sessionId);
    expect(recall?.prompt.kind).toBe("picture_recall");
    expect(JSON.stringify(recall?.prompt)).not.toContain("red");
    const api = withApi((request) => handleKidApi(request, services, ["tasks", recall!.taskId, "disclosures"]));
    const audioResponse = await api(new Request("http://localhost/api/v1/kid/tasks/disclosures", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "audio" }),
    }));
    const hintResponse = await api(new Request("http://localhost/api/v1/kid/tasks/disclosures", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "hint" }),
    }));
    expect(audioResponse.status).toBe(200);
    expect(hintResponse.status).toBe(200);
    const audioDisclosure = DisclosureDtoSchema.parse(await audioResponse.json());
    const hintDisclosure = DisclosureDtoSchema.parse(await hintResponse.json());
    expect(audioDisclosure).toMatchObject({ kind: "audio", reveal: null });
    expect(audioDisclosure.audioAssetId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(hintDisclosure).toMatchObject({ kind: "hint", reveal: null, audioAssetId: audioDisclosure.audioAssetId });
    const disclosures = await pool.query(`select e.kind, e.sealed, count(x.target_key)::int as exposures
      from learning_app.learning_events e left join learning_app.event_exposures x on x.event_id=e.id
      where e.task_id=$1 and e.kind in ('audio_issued','hint_issued') group by e.id`, [recall!.taskId]);
    expect(disclosures.rows).toHaveLength(2);
    expect(disclosures.rows.every((event) => event.sealed && event.exposures === 1)).toBe(true);

    const disableApi = withApi((request) => handleKidApi(request, services, ["sessions", session.sessionId, "disable-microphone"]));
    const disabledResponse = await disableApi(new Request("http://localhost/api/v1/kid/sessions/disable-microphone", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(disabledResponse.status).toBe(200);
    const disabled = SessionDtoSchema.parse(await disabledResponse.json());
    expect(disabled.microphoneEnabled).toBe(false);
    const repeated = await disableApi(new Request("http://localhost/api/v1/kid/sessions/disable-microphone", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(SessionDtoSchema.parse(await repeated.json())).toMatchObject({ microphoneEnabled: false });
    const state = await pool.query("select state from learning_app.session_tasks where id=$1", [recall!.taskId]);
    expect(state.rows[0]).toEqual({ state: "skipped" });
    expect((await pool.query("select count(*)::int as count from learning_app.assessments where item_revision_id=$1", [revision!.id])).rows[0]).toEqual({ count: 0 });
    const fallback = await nextTask(services, session.sessionId);
    expect(fallback?.prompt.kind).toBe("picture_exposure");
    await completePresentation(services, { taskId: fallback!.taskId });
    expect(await nextTask(services, session.sessionId)).toBeNull();
  });
});
