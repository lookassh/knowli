import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createChild, createDraft, publishDraft, upsertAssignment, startSession, nextTask, endSession, completePresentation, submitAttempt, createServices, executeMediaAsset, prepareUiAudio, reconcileDraftAssets, runDueGenerationWork } from "@learning/server";
import { randomUUID } from "node:crypto";
import { buildTestServices, ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { readTrainingSessionPlan } from "@learning/server";

const { pool } = testDatabase();
const pairs = Array.from({ length: 4 }, (_, index) => ({ source: `słowo ${index}`, target: `word${index}` }));

describe("stały plan treningu słówek", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let childId: string;
  let deckId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query("truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade");
    services = buildTestServices().services;
    childId = (await createChild(services, { displayName: "Ola", avatarKey: "fox" })).id;
    const draft = await createDraft(services, { title: "Stały plan", items: pairs.map(({ source, target }) => ({ source, target, acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color" as const, visualData: { color: "#4169e1" } })) });
    const revisions = (await pool.query("select id from learning_app.item_revisions where deck_version_id=$1 order by position", [draft.id])).rows as {id:string}[];
    for (const [index, revision] of revisions.entries()) {
      const assetId = randomUUID(), fingerprint = `training-${assetId}`;
      await pool.query("insert into learning_app.media_assets (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model) values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',128,'fake','fake')", [assetId,fingerprint,`blob/${assetId}`,`sha-${assetId}`]);
      await pool.query("insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')", [revision.id,assetId,fingerprint]);
      await pool.query("insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')", [revision.id,`image-${index}-${assetId}`]);
    }
    await publishDraft(services, draft.id, 1);
    deckId = draft.deckId;
    await upsertAssignment(services, childId, deckId, null);
  });

  afterAll(async () => { await pool.end(); });

  it("tworzy prywatny, skończony plan atomowo przy starcie i wydaje jego pierwszy krok", async () => {
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan: {version:number; slots:Array<{taskId:string}>}}[];
    expect(row?.training_plan).toMatchObject({ version: 1 });
    expect(row?.training_plan.slots.length).toBeGreaterThan(0);
    expect(row?.training_plan.slots.length).toBeLessThanOrEqual(session.taskBudget * 2 + 4);
    expect((await pool.query("select count(*)::int as count from learning_app.learning_events where task_id in (select id from learning_app.session_tasks where session_id=$1)", [session.sessionId])).rows[0]?.count).toBe(0);
    await expect(pool.query("update learning_app.learning_sessions set training_plan=jsonb_set(training_plan,'{version}','2') where id=$1", [session.sessionId]))
      .rejects.toThrow(/Training session plan is immutable/);
    const task = await nextTask(services, session.sessionId);
    expect(task?.taskId).toBe(row?.training_plan.slots[0]?.taskId);
    expect(task).not.toHaveProperty("answerKey");
    expect(await nextTask(services, session.sessionId)).toMatchObject({ taskId: task?.taskId });
    const [unchanged] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as typeof row[];
    expect(unchanged?.training_plan).toEqual(row?.training_plan);
    await endSession(services, session.sessionId);
  });

  it("akceptuje plan z dostępną prezentacją wsparcia i bez możliwego zadania ocenianego", async () => {
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan:{slots:Array<{exerciseType:string;ordinal:number}>;taskBudget:number;version:1}}[];
    const exposure = row!.training_plan.slots.find((slot) => slot.exerciseType === "exposure")!;
    expect(readTrainingSessionPlan({ ...row!.training_plan, taskBudget: 1, slots: [{ ...exposure, ordinal: 0 }] })).not.toBeNull();
    await endSession(services, session.sessionId);
  });

  it("nie planuje ponownie należnego sprawdzenia tego samego celu", async () => {
    await pool.query(`insert into learning_app.child_skill_progress
      (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
      select $1, s.skill_version_id, 'needs_confirmation', 2, '2026-10-01T00:00:00Z', 'test'
      from learning_app.item_revision_skills s join learning_app.item_revisions r on r.id=s.item_revision_id
      where r.deck_version_id=(select id from learning_app.deck_versions where deck_id=$2 and state='published' order by version_number desc limit 1)
        and s.skill in ('recall','spelling')`, [childId, deckId]);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan:{slots:Array<{reason:string;itemRevisionId:string}>}}[];
    const checks = row!.training_plan.slots.filter((slot) => slot.reason === "due-check");
    expect(new Set(checks.map((slot) => slot.itemRevisionId)).size).toBe(checks.length);
    expect(checks.length).toBeGreaterThan(1);
    await endSession(services, session.sessionId);
  });

  it("wprowadza dany etap przypominania najwyżej raz w jednym planie", async () => {
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    for (let step = 0; step < 100; step++) {
      const task = await nextTask(services, first.sessionId);
      if (!task) break;
      if (task.exerciseType === "exposure") { await completePresentation(services, { taskId: task.taskId }); continue; }
      const [row] = (await pool.query("select answer_key from learning_app.session_tasks where id=$1", [task.taskId])).rows as {answer_key:Record<string,unknown>}[];
      if (task.exerciseType === "recall" || task.exerciseType === "spelling" || task.exerciseType === "letter_completion") await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: String(row!.answer_key.canonicalAnswer) });
      else if (task.prompt.kind === "listening" || task.prompt.kind === "reading") await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: String(row!.answer_key.correctOptionId) });
      else break;
    }
    await endSession(services, first.sessionId);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan:{slots:Array<{reason:string;itemRevisionId:string;skillAtIssue?:string}>}}[];
    const introductions = row!.training_plan.slots.filter((slot) => slot.reason === "stage-introduction");
    expect(introductions.length).toBeGreaterThan(0);
    const keys = introductions.map((slot) => `${slot.itemRevisionId}:${slot.skillAtIssue}`);
    expect(new Set(keys).size).toBe(keys.length);
    await endSession(services, session.sessionId);
  });

  it("plan kolejnej sesji umieszcza wsparcie po dwóch rzeczywistych błędach", async () => {
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    let task = await nextTask(services, first.sessionId);
    while (task?.exerciseType === "exposure") {
      await completePresentation(services, { taskId: task.taskId });
      task = await nextTask(services, first.sessionId);
    }
    expect(task?.prompt.kind).toBe("listening");
    if (task?.prompt.kind !== "listening") throw new Error("expected a listening task");
    const [answer] = (await pool.query("select answer_key->>'correctOptionId' as id from learning_app.session_tasks where id=$1", [task.taskId])).rows as {id:string}[];
    const wrong = task.prompt.options.find((option) => option.id !== answer?.id)!;
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrong.id });
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrong.id });
    await endSession(services, first.sessionId);

    const next = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [planned] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [next.sessionId])).rows as {training_plan: {slots:Array<{reason:string;exerciseType:string}>}}[];
    expect(planned?.training_plan.slots[0]).toMatchObject({ reason: "support", exerciseType: "exposure" });
    const slot = await nextTask(services, next.sessionId);
    expect(slot).toMatchObject({ exerciseType: "exposure" });
    await endSession(services, next.sessionId);
  });

  it.each([false, true])( "tworzy niezmienny plan obrazkowy także dla canRead=%s", async (canRead) => {
    const fakes = await fakeGeneration();
    try {
      const pictureServices = createServices({ db: testDatabase().db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps, mediaStore: fakes.store });
      await prepareUiAudio(pictureServices);
      for (let pass = 0; pass < 8; pass++) {
        const pending = (await pool.query("select id from learning_app.media_assets where state='pending'")).rows as {id:string}[];
        if (pending.length === 0) break;
        for (const asset of pending) await executeMediaAsset(pictureServices, asset.id);
      }
      const draft = await createDraft(pictureServices, {
        title: "Kolory planowane", vocabularyFormat: "picture",
        items: ["red", "blue", "green", "yellow"].map((target, index) => ({
          source: ["czerwony", "niebieski", "zielony", "żółty"][index]!, target,
          acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" },
          visualType: "color" as const, visualData: { color: ["#ff0000", "#0000ff", "#008000", "#ffff00"][index]! },
        })),
      });
      await reconcileDraftAssets(pictureServices, draft.id);
      for (let pass = 0; pass < 8; pass++) if ((await runDueGenerationWork(pictureServices)).processed === 0) break;
      await publishDraft(pictureServices, draft.id, 1);
      const pictureChild = await createChild(pictureServices, { displayName: "Ola", avatarKey: "fox", canRead });
      await upsertAssignment(pictureServices, pictureChild.id, draft.deckId, null);
      const session = await startSession(pictureServices, { childId: pictureChild.id, deckId: draft.deckId, microphoneEnabled: false, supportsPictureVocabulary: true });
      const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan: {slots:Array<{exerciseType:string; prompt:{kind:string}}>}}[];
      expect(row?.training_plan.slots.some((slot) => slot.prompt.kind === "picture_exposure")).toBe(true);
      expect(row?.training_plan.slots.some((slot) => slot.prompt.kind === "picture_listening")).toBe(true);
      const fixed = row!.training_plan;
      const first = await nextTask(pictureServices, session.sessionId);
      expect(first?.prompt.kind).toBe("picture_exposure");
      expect((await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows[0].training_plan).toEqual(fixed);
      await endSession(pictureServices, session.sessionId);
    } finally {
      await fakes.dispose();
    }
  });
});
