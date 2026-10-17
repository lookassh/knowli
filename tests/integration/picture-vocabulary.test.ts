import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completePresentation, computeTargetKey, createChild, createDraft, createDraftFromPublished, createServices, editDraft, endSession,
  executeMediaAsset, listKidDecks, nextTask, prepareUiAudio, publishDraft, readAttempt, reconcileDraftAssets, runDueGenerationWork, startSession, submitAttempt, upsertAssignment,
  type Services,
} from "@learning/server";
import { fakeGeneration, type FakeGeneration } from "./fakes";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { DisclosureDtoSchema, SessionDtoSchema } from "@learning/contracts";
import { handleKidApi } from "../../apps/web/src/kid/kid-router";
import { withApi } from "../../apps/web/src/http/errors";
const { pool } = testDatabase();
const selectionEntropy = vi.hoisted(() => ({ seed: 0, calls: 0 }));
vi.mock("node:crypto", async importOriginal => ({
  ...await importOriginal<typeof import("node:crypto")>(),
  randomInt: () => { selectionEntropy.calls++; return selectionEntropy.seed; },
}));

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
  let clock: ManualClock;
  beforeEach(async () => {
    selectionEntropy.seed = 0;
    selectionEntropy.calls = 0;
    await truncateCoreTables();
    await pool.query("truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade");
    fakes = await fakeGeneration();
    clock = new ManualClock(new Date(Date.now() - 60_000).toISOString());
    services = createServices({ db: testDatabase().db, clock, media: fakes.settings, generation: fakes.deps, mediaStore: fakes.store });
    await prepareUiAudio(services);
    const pending = (await pool.query("select id from learning_app.media_assets where state='pending'")).rows as { id: string }[];
    for (const asset of pending) await executeMediaAsset(services, asset.id);
  });
  afterEach(async () => { await fakes.dispose(); });

  it("zwykły zestaw wydaje obrazkowe listening tylko wspieranemu klientowi i ocenia wyłącznie listening", async () => {
    const draft = await createDraft(services, {
      title: "Kolory standardowe",
      items: [
        { source: "czerwony", target: "red", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#ff0000" } },
        { source: "niebieski", target: "blue", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#0000ff" } },
      ],
    });
    await reconcileDraftAssets(services, draft.id);
    for (let pass = 0; pass < 6; pass++) if ((await runDueGenerationWork(services)).processed === 0) break;
    await publishDraft(services, draft.id, 1);

    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox", canRead: true });
    await upsertAssignment(services, child.id, draft.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: draft.deckId,
      microphoneEnabled: false, supportsPictureVocabulary: true });
    for (let index = 0; index < 2; index++) {
      const exposure = await nextTask(services, session.sessionId);
      expect(exposure?.prompt.kind).toBe("exposure");
      await completePresentation(services, { taskId: exposure!.taskId });
    }
    const task = await nextTask(services, session.sessionId);
    expect(task?.prompt.kind).toBe("picture_listening");
    expect(await nextTask(services, session.sessionId)).toEqual(task);
    const stored = (await pool.query<{ answer_key: { correctOptionId: string } }>(
      "select answer_key from learning_app.session_tasks where id=$1", [task!.taskId],
    )).rows[0]!;
    const result = await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(),
      modality: "choice", optionId: stored.answer_key.correctOptionId });
    expect((await pool.query("select skill, outcome from learning_app.assessments where attempt_id=$1", [result.attemptId])).rows)
      .toEqual([{ skill: "listening", outcome: "correct" }]);
    await expect(startSession(services, { childId: child.id, deckId: draft.deckId,
      microphoneEnabled: false, supportsPictureVocabulary: false }))
      .rejects.toMatchObject({ details: { reason: "picture_client_update_required" } });

    const oldChild = await createChild(services, { displayName: "Jan", avatarKey: "fox", canRead: true });
    await upsertAssignment(services, oldChild.id, draft.deckId, null);
    const oldSession = await startSession(services, { childId: oldChild.id, deckId: draft.deckId,
      microphoneEnabled: false, supportsPictureVocabulary: false });
    for (let index = 0; index < 2; index++) {
      const exposure = await nextTask(services, oldSession.sessionId);
      expect(exposure?.prompt.kind).toBe("exposure");
      await completePresentation(services, { taskId: exposure!.taskId });
    }
    expect((await nextTask(services, oldSession.sessionId))?.prompt.kind).toBe("listening");
  });

  it.each([false, true])("liczby 0–20: losuje nextTask, utrwala issued i kończy przebieg, canRead=%s", async canRead => {
    const numbers = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
    const draft = await createDraft(services, {
      title: "Liczby 0–20", vocabularyFormat: "picture",
      items: numbers.map((target, index) => ({ source: `liczba ${index}`, target,
        acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" },
        visualType: "number" as const, visualData: { count: index },
      })),
    });
    await reconcileDraftAssets(services, draft.id);
    for (let pass = 0; pass < 10; pass++) if ((await runDueGenerationWork(services)).processed === 0) break;
    await publishDraft(services, draft.id, 1);
    const revisions = (await pool.query<{ id: string }>(
      "select id from learning_app.item_revisions where deck_version_id=$1 order by position", [draft.id],
    )).rows;
    for (const seed of [0, 1, 2]) {
      const child = await createChild(services, { displayName: "Ola", avatarKey: "fox", canRead });
      await upsertAssignment(services, child.id, draft.deckId, null);
      const session = await startSession(services, { childId: child.id, deckId: draft.deckId,
        microphoneEnabled: false, supportsPictureVocabulary: true });
      expect((await pool.query("select can_read from learning_app.child_profiles where id=$1", [child.id])).rows[0])
        .toEqual({ can_read: canRead });
      for (let index = 0; index < 2; index++) {
        const task = await nextTask(services, session.sessionId);
        expect(task?.prompt.kind).toBe("picture_exposure");
        await completePresentation(services, { taskId: task!.taskId });
      }
      selectionEntropy.seed = seed;
      const beforeCount = (await pool.query("select count(*)::int as count from learning_app.session_tasks where session_id=$1", [session.sessionId])).rows[0].count;
      const beforeCalls = selectionEntropy.calls;
      const [task, simultaneous] = await Promise.all([
        nextTask(services, session.sessionId), nextTask(services, session.sessionId),
      ]);
      expect(simultaneous).toEqual(task);
      expect(selectionEntropy.calls - beforeCalls).toBe(1);
      expect((await pool.query("select count(*)::int as count from learning_app.session_tasks where session_id=$1", [session.sessionId])).rows[0].count).toBe(beforeCount + 1);
      const stored = (await pool.query("select item_revision_id, public_prompt, answer_key from learning_app.session_tasks where id=$1", [task!.taskId])).rows[0];
      expect(stored.item_revision_id).toBe(revisions[seed]!.id);
      expect(task?.prompt.kind).toBe(seed === 2 ? "picture_exposure" : "picture_listening");
      const calls = selectionEntropy.calls;
      selectionEntropy.seed = 123;
      const repeated = await Promise.all([nextTask(services, session.sessionId), nextTask(services, session.sessionId)]);
      expect(repeated).toEqual([task, task]);
      expect(selectionEntropy.calls).toBe(calls);
      expect((await pool.query("select item_revision_id, public_prompt, answer_key from learning_app.session_tasks where id=$1", [task!.taskId])).rows[0]).toEqual(stored);
      if (seed !== 2) { await endSession(services, session.sessionId); continue; }
      // Przebieg przez publiczne operacje, z rzeczywistymi zapisami prezentacji i prób.
      let current = task;
      let assessed = 0;
      const presented = new Set(revisions.slice(0, 2).map(revision => revision.id));
      const questioned = new Set<string>();
      const exerciseKinds = new Set<string>();
      const pending = new Set(presented);
      for (let step = 0; current && step < 40; step++) {
        const row = (await pool.query("select item_revision_id, answer_key from learning_app.session_tasks where id=$1", [current.taskId])).rows[0];
        if (current.prompt.kind === "picture_exposure") {
          presented.add(row.item_revision_id);
          if (!questioned.has(row.item_revision_id)) pending.add(row.item_revision_id);
          await completePresentation(services, { taskId: current.taskId });
        } else {
          exerciseKinds.add(current.prompt.kind);
          expect(presented.has(row.item_revision_id)).toBe(true);
          questioned.add(row.item_revision_id);
          pending.delete(row.item_revision_id);
          assessed++;
          await submitAttempt(services, row.answer_key.correctOptionId
            ? { taskId: current.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: row.answer_key.correctOptionId }
            : { taskId: current.taskId, clientAttemptId: randomUUID(), modality: "text", text: row.answer_key.target });
        }
        expect(pending.size).toBeLessThanOrEqual(3);
        selectionEntropy.seed = step * 7 + 2;
        current = await nextTask(services, session.sessionId);
      }
      expect(current).toBeNull();
      expect(assessed).toBe(12);
      expect(questioned.size).toBeGreaterThanOrEqual(3);
      expect(exerciseKinds).toContain("picture_listening");
      if (canRead) expect(exerciseKinds).toContain("recall");
      else expect(exerciseKinds).toEqual(new Set(["picture_listening"]));
      expect((await pool.query("select can_read from learning_app.child_profiles where id=$1", [child.id])).rows[0])
        .toEqual({ can_read: canRead });
      expect(await nextTask(services, session.sessionId)).toBeNull();
    }
  });

  it("czytający: rozpoczęty materiał picture materializuje i ocenia oba kierunki reading", async () => {
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox", canRead: true });
    const draft = await createDraft(services, {
      title: "Dwa kolory", vocabularyFormat: "picture",
      items: [
        { source: "czerwony", target: "red", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#ff0000" } },
        { source: "niebieski", target: "blue", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#0000ff" } },
      ],
    });
    await reconcileDraftAssets(services, draft.id);
    for (let pass = 0; pass < 6; pass++) if ((await runDueGenerationWork(services)).processed === 0) break;
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);

    // Pierwsza sesja tworzy rzeczywistą historię poznania i wprowadzenia Recall.
    const seenDirections = new Set<string>();
    for (const phase of ["introduction", "started-material"]) {
      const session = await startSession(services, { childId: child.id, deckId: draft.deckId,
        microphoneEnabled: false, supportsPictureVocabulary: true });
      expect((await pool.query("select context->'canRead' as can_read, context->>'vocabularyFormat' as format from learning_app.learning_sessions where id=$1", [session.sessionId])).rows[0])
        .toEqual({ can_read: true, format: "picture" });
      for (let step = 0; step < 20; step++) {
        selectionEntropy.seed = 0;
        const task = await nextTask(services, session.sessionId);
        if (!task) break;
        const stored = (await pool.query("select public_prompt, answer_key from learning_app.session_tasks where id=$1", [task.taskId])).rows[0];
        if (task.prompt.kind === "picture_exposure") {
          await completePresentation(services, { taskId: task.taskId });
          continue;
        }
        const attempt = await submitAttempt(services, stored.answer_key.correctOptionId
          ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: stored.answer_key.correctOptionId }
          : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: stored.answer_key.target });
        if (phase !== "started-material" || (task.prompt.kind !== "reading" && task.prompt.kind !== "reverse_recognition")) continue;
        const direction = task.prompt.kind === "reading" ? "target_to_source" : "source_to_target";
        seenDirections.add(direction);
        expect(stored.public_prompt).toEqual(task.prompt);
        expect(stored.answer_key.direction).toBe(direction);
        if (task.prompt.kind === "reading") expect(task.prompt.text).toBe(stored.answer_key.target);
        else expect(task.prompt.prompt).toBe(stored.answer_key.target === "red" ? "czerwony" : "niebieski");
        expect((await pool.query("select skill, outcome, details->>'direction' as direction from learning_app.assessments where attempt_id=$1", [attempt.attemptId])).rows)
          .toEqual([{ skill: "reading", outcome: "correct", direction }]);
      }
      expect(await nextTask(services, session.sessionId)).toBeNull();
      await endSession(services, session.sessionId);
    }
    expect(seenDirections).toEqual(new Set(["target_to_source", "source_to_target"]));
    expect((await pool.query("select can_read from learning_app.child_profiles where id=$1", [child.id])).rows[0])
      .toEqual({ can_read: true });
  });

  it("aktywny resume-only używa okładki przypiętej wersji nawet po nowej publikacji", async () => {
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox", canRead: false });
    const original = await createDraft(services, {
      title: "Kolory", vocabularyFormat: "picture",
      items: [{ source: "czerwony", target: "red", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#ff0000" } }],
    });
    await reconcileDraftAssets(services, original.id);
    for (let pass = 0; pass < 6; pass += 1) if ((await runDueGenerationWork(services)).processed === 0) break;
    await publishDraft(services, original.id, 1);
    await upsertAssignment(services, child.id, original.deckId, null);
    const session = await startSession(services, { childId: child.id, deckId: original.deckId, microphoneEnabled: true, supportsPictureVocabulary: true });

    const revised = await createDraftFromPublished(services, original.deckId);
    const changed = await editDraft(services, revised.id, {
      expectedEditNumber: revised.editNumber,
      items: [{ source: "niebieski", target: "blue", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color", visualData: { color: "#0000ff" } }],
    });
    for (let pass = 0; pass < 6; pass += 1) if ((await runDueGenerationWork(services)).processed === 0) break;
    await publishDraft(services, revised.id, changed.editNumber);

    const [deck] = await listKidDecks(services, child.id, { microphoneEnabled: false });
    expect(deck).toMatchObject({
      deckId: original.deckId, resumeOnly: true,
      coverVisual: { kind: "color", color: "#ff0000" },
      activeSession: { sessionId: session.sessionId, mode: "training" },
    });
  });

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

    await pool.query("update learning_app.learning_sessions set context=jsonb_set(context,'{reservations}',$2::jsonb) where id=$1", [
      session.sessionId,
      JSON.stringify([computeTargetKey("red", "en-GB"), computeTargetKey("blue", "en-GB")]),
    ]);
    const attemptId = randomUUID();
    await pool.query(`insert into learning_app.attempts
      (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number,
       modality, state, answer, context, policy_id, received_at)
      select $1, child_id, id, item_revision_id, $2, 'picture-disable-processing', 1, 'audio', 'processing', '{}', '{}', $3, now()
      from learning_app.session_tasks where id = $4`, [attemptId, randomUUID(), session.policyId, recall!.taskId]);

    const disableApi = withApi((request) => handleKidApi(request, services, ["sessions", session.sessionId, "disable-microphone"]));
    const disabledResponse = await disableApi(new Request("http://localhost/api/v1/kid/sessions/disable-microphone", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(disabledResponse.status).toBe(200);
    const disabled = SessionDtoSchema.parse(await disabledResponse.json());
    expect(disabled.microphoneEnabled).toBe(false);
    expect((await pool.query<{ reservations: string[] }>("select context->'reservations' as reservations from learning_app.learning_sessions where id=$1", [session.sessionId])).rows[0]?.reservations).toEqual([]);
    const repeated = await disableApi(new Request("http://localhost/api/v1/kid/sessions/disable-microphone", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(SessionDtoSchema.parse(await repeated.json())).toMatchObject({ microphoneEnabled: false });
    clock.advanceMs(180_000);
    await expect(submitAttempt(services, {
      taskId: recall!.taskId, clientAttemptId: randomUUID(), modality: "dont_remember",
    })).rejects.toMatchObject({ code: "conflict" });
    expect((await pool.query("select state from learning_app.session_tasks where id=$1", [recall!.taskId])).rows[0])
      .toEqual({ state: "issued" });
    expect((await pool.query("select count(*)::int as count from learning_app.attempts where task_id=$1", [recall!.taskId])).rows[0])
      .toEqual({ count: 1 });
    const finalized = await readAttempt(services, attemptId);
    expect(finalized.taskState).toBe("skipped");
    const state = await pool.query("select state from learning_app.session_tasks where id=$1", [recall!.taskId]);
    expect(state.rows[0]).toEqual({ state: "skipped" });
    expect((await pool.query("select count(*)::int as count, bool_and(outcome='unassessed') as only_technical from learning_app.assessments where attempt_id=$1", [attemptId])).rows[0]).toEqual({ count: 1, only_technical: true });
    const fallback = await nextTask(services, session.sessionId);
    expect(fallback?.prompt.kind).toBe("picture_exposure");
    await completePresentation(services, { taskId: fallback!.taskId });
    expect(await nextTask(services, session.sessionId)).toBeNull();
    await endSession(services, session.sessionId);
    expect((await disableApi(new Request("http://localhost/api/v1/kid/sessions/disable-microphone", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }))).status).toBe(409);
  });

  it("dla dziecka nieczytającego liczy gwiazdki z opanowanego słuchania lub recall, a dla czytającego wyłącznie z recall", async () => {
    const nonReader = await createChild(services, { displayName: "Jaś", avatarKey: "fox", canRead: false });
    const reader = await createChild(services, { displayName: "Zosia", avatarKey: "bear", canRead: true });

    const draft = await createDraft(services, {
      title: "Zwierzęta", vocabularyFormat: "picture",
      items: [
        { source: "pies", target: "dog", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "image", visualData: { imagePrompt: "A friendly dog" } },
        { source: "kot", target: "cat", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "image", visualData: { imagePrompt: "A cute cat" } },
      ],
    });
    await reconcileDraftAssets(services, draft.id);
    for (let pass = 0; pass < 6; pass += 1) if ((await runDueGenerationWork(services)).processed === 0) break;
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, nonReader.id, draft.deckId, null);
    await upsertAssignment(services, reader.id, draft.deckId, null);

    const revisions = (await pool.query<{ id: string }>(
      "select id from learning_app.item_revisions where deck_version_id = $1 order by position", [draft.id],
    )).rows;

    const skillVersions = (await pool.query<{ item_revision_id: string; skill: string; skill_version_id: string }>(
      "select item_revision_id, skill, skill_version_id from learning_app.item_revision_skills where item_revision_id = any($1)",
      [[revisions[0]!.id, revisions[1]!.id]],
    )).rows;

    const dogListening = skillVersions.find((s) => s.item_revision_id === revisions[0]!.id && s.skill === "listening")!.skill_version_id;
    const catListening = skillVersions.find((s) => s.item_revision_id === revisions[1]!.id && s.skill === "listening")!.skill_version_id;
    const catRecall = skillVersions.find((s) => s.item_revision_id === revisions[1]!.id && s.skill === "recall")!.skill_version_id;

    await pool.query(
      `insert into learning_app.child_skill_progress(child_id, skill_version_id, status, independent_success_streak, projection_version)
       values ($1, $2, 'mastered', 3, 'test'), ($1, $3, 'mastered', 3, 'test'), ($1, $4, 'mastered', 3, 'test')`,
      [nonReader.id, dogListening, catListening, catRecall],
    );
    await pool.query(
      `insert into learning_app.child_skill_progress(child_id, skill_version_id, status, independent_success_streak, projection_version)
       values ($1, $2, 'mastered', 3, 'test'), ($1, $3, 'mastered', 3, 'test')`,
      [reader.id, dogListening, catRecall],
    );

    const [nonReaderDeck] = await listKidDecks(services, nonReader.id);
    const [readerDeck] = await listKidDecks(services, reader.id);

    expect(nonReaderDeck).toMatchObject({
      deckId: draft.deckId,
      itemCount: 2,
      independentlyRecalledCount: 2,
    });

    expect(readerDeck).toMatchObject({
      deckId: draft.deckId,
      itemCount: 2,
      independentlyRecalledCount: 1,
    });
  });
});
