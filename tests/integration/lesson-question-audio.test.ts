import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createServices, editLessonDraft, endSession, executeMediaAsset, nextTask, runDueGenerationWork, publishLessonDraft, readLessonDeck,
  startSession, submitAttempt,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import {
  audioServices, FAKE_MEDIA, markTtsReady, publishAssignedSpiderLesson, seedSchoolDraft, SPIDER_OBJECTIVE, spiderExercises, truncateLessonAudioTables,
} from "./school-lesson-audio-helpers";

/**
 * Etap 8 przedmiotów szkolnych (design §11): „Posłuchaj pytania” na
 * PostgreSQL — edycja szkicu szkoły zleca nagrania `prompt_audio` (polski
 * tekst polecenia i pytania, bez opcji), publikacja na nie nie czeka, zadanie
 * dostaje `questionAudioAssetId` dopiero dla gotowego nagrania (także
 * w kartkówce), a odsłuch nie jest ujawnieniem (bez zdarzeń). Rodzic nie
 * widzi nagrań pytań wśród zasobów do decyzji.
 */

const { db, pool } = testDatabase();
const OBJECTIVE = SPIDER_OBJECTIVE;
const MEDIA = FAKE_MEDIA;
const services = () => audioServices();
const STEM = "Ile nóg ma pająk?";
const exercises = (stem = STEM) => spiderExercises(stem);

beforeEach(async () => {
  await truncateCoreTables();
  await truncateLessonAudioTables();
});
afterAll(() => pool.end());

const seedDraft = () => seedSchoolDraft([{ id: OBJECTIVE, titlePl: "Pająki", descriptionEn: "Spiders.",
  cards: [{ title: "Pająki", body: "Pająk ma osiem nóg." }, { title: "Owady", body: "Owady mają sześć nóg." }] }]);

interface PromptAudioRow { assetId: string; text: string; locale: string; state: string }

async function promptAudio(versionId: string): Promise<PromptAudioRow[]> {
  return (await pool.query<PromptAudioRow>(
    `select ra.asset_id as "assetId", ma.metadata->>'text' as text, ma.metadata->>'locale' as locale, ma.state
       from learning_app.revision_assets ra
       join learning_app.item_revisions ir on ir.id = ra.item_revision_id
       join learning_app.media_assets ma on ma.id = ra.asset_id
      where ir.deck_version_id = $1 and ra.role = 'prompt_audio'
      order by ir.position`,
    [versionId],
  )).rows;
}

const markReady = markTtsReady;

async function reach(active: ReturnType<typeof services>, sessionId: string, stem: string): Promise<TaskDto> {
  for (let i = 0; i < 30; i++) {
    const task = await nextTask(active, sessionId);
    if (!task) break;
    if (task.prompt.kind === "lesson_choice" && task.prompt.stem === stem) return task;
    if (task.exerciseType === "lesson_card") await completePresentation(active, { taskId: task.taskId });
    else await submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error(`no lesson_choice with stem ${stem}`);
}

async function publishedWorld() {
  return publishAssignedSpiderLesson(await seedDraft(), "Pytania", STEM);
}

describe("„Posłuchaj pytania” — przygotowanie nagrań", () => {
  it("edycja szkicu szkoły zleca polskie nagrania polecenia i pytania bez opcji; zmiana pytania = nowe nagranie", async () => {
    const active = services();
    const { versionId } = await seedDraft();
    const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const rows = await promptAudio(versionId);
    expect(rows).toHaveLength(exercises().length);
    expect(rows[0]).toMatchObject({ text: "Wybierz odpowiedź. Ile nóg ma pająk?", locale: "pl-PL", state: "pending" });
    expect(rows.map((row) => row.text)).toContain("Uzupełnij. Pająk ma luka nóg (osiem).");
    for (const row of rows) expect(row.text).not.toContain("cztery");

    const edited = await editLessonDraft(active, versionId, { expectedEditNumber: draft.editNumber, exercises: exercises("Ile nóg ma owad?") });
    expect(edited.editNumber).toBeGreaterThan(draft.editNumber);
    const after = await promptAudio(versionId);
    expect(after[0]!.text).toBe("Wybierz odpowiedź. Ile nóg ma owad?");
    expect(after[0]!.assetId).not.toBe(rows[0]!.assetId);
    expect(after[1]!.assetId).toBe(rows[1]!.assetId);
  });

  it("publikacja zleca ponownie nieudane nagranie pytania (nie jest decyzją rodzica)", async () => {
    const active = services();
    const { versionId } = await seedDraft();
    const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [failed] = await promptAudio(versionId);
    await pool.query("update learning_app.media_assets set state = 'failed', lease_token = null where id = $1", [failed!.assetId]);
    await publishLessonDraft(active, versionId, draft.editNumber);
    const [requeued] = await promptAudio(versionId);
    expect(requeued!.assetId).not.toBe(failed!.assetId);
    expect(requeued).toMatchObject({ state: "pending", text: failed!.text });
  });

  it("publikacja nie czeka na nagrania; rodzic nie dostaje ich jako zasobów do decyzji", async () => {
    const { active, deckId, versionId } = await publishedWorld();
    expect((await promptAudio(versionId)).every((row) => row.state === "pending")).toBe(true);
    const deck = await readLessonDeck(active, deckId);
    expect(JSON.stringify(deck)).not.toContain("prompt_audio");
  });
});

describe("„Posłuchaj pytania” — zadanie dziecka", () => {
  it("bez gotowego nagrania brak pola; gotowe nagranie trafia do treningu i kartkówki bez zdarzeń ujawnienia", async () => {
    const { active, child, deckId, versionId } = await publishedWorld();
    const first = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const pending = await reach(active, first.sessionId, STEM);
    expect(pending.prompt).not.toHaveProperty("questionAudioAssetId");
    // Wydane zadanie ma niezmienny prompt — nagranie dojdzie dopiero w nowym zadaniu.
    await endSession(active, first.sessionId);

    const [row] = await promptAudio(versionId);
    await markReady(row!.assetId);
    const second = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const ready = await reach(active, second.sessionId, STEM);
    expect(ready.prompt).toMatchObject({ kind: "lesson_choice", questionAudioAssetId: row!.assetId });
    await endSession(active, second.sessionId);

    const mock = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false, mode: "mock_test" });
    const mockTask = await reach(active, mock.sessionId, STEM);
    expect(mockTask.prompt).toMatchObject({ questionAudioAssetId: row!.assetId });

    // Odsłuch pytania nie jest ujawnieniem: wydanie zadań z nagraniem nie zapisuje
    // zdarzeń audio ani podpowiedzi (szkoła nie ma `ttsForAnswers`).
    const events = await pool.query(
      `select kind from learning_app.learning_events where child_id = $1 and kind in ('audio_issued', 'hint_issued', 'audio_played')`,
      [child.id],
    );
    expect(events.rows).toEqual([]);
    const kinds = await pool.query(`select distinct kind from learning_app.learning_events where child_id = $1`, [child.id]);
    expect(kinds.rows.length).toBeGreaterThan(0);
  });
});

describe("„Posłuchaj pytania” — nagranie po publikacji", () => {
  it("porażka zasobu powiązanego przy edycji nie odbiera przycisku: liczy się gotowy zasób o tym samym fingerprincie", async () => {
    const { active, child, deckId, versionId } = await publishedWorld();
    const [row] = await promptAudio(versionId);
    await pool.query("update learning_app.media_assets set state = 'failed', lease_token = null where id = $1", [row!.assetId]);
    const replacement = randomUUID();
    await pool.query(
      `insert into learning_app.media_assets (id, kind, fingerprint, generation_number, state, provider, model, metadata)
       select $2, kind, fingerprint, generation_number + 1, 'pending', provider, model, metadata from learning_app.media_assets where id = $1`,
      [row!.assetId, replacement],
    );
    await markReady(replacement);
    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const task = await reach(active, session.sessionId, STEM);
    expect(task.prompt).toMatchObject({ questionAudioAssetId: replacement });
  });
});

describe("„Posłuchaj pytania” — zmiana dostawcy TTS (OpenAI → OpenRouter)", () => {
  const OPEN_ROUTER = { ...MEDIA, tts: { ...MEDIA.tts, provider: "openrouter", model: "openai/gpt-4o-mini-tts-2025-12-15" } };

  async function stateOf(assetId: string): Promise<{ asset: string; runs: string[] }> {
    const asset = (await pool.query("select state from learning_app.media_assets where id = $1", [assetId])).rows[0].state;
    const runs = (await pool.query("select state from learning_app.generation_runs where asset_id = $1", [assetId])).rows.map((row) => row.state);
    return { asset, runs };
  }

  it("nowy worker nie wysyła starego zlecenia do nowego dostawcy ani nie zmienia jego stanu; edycja zleca nagranie z nowym fingerprintem", async () => {
    const { versionId } = await seedDraft();
    const draft = await editLessonDraft(services(), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [stale] = await promptAudio(versionId);

    const fakes = await fakeGeneration();
    try {
      const worker = createServices({ db, clock: new ManualClock(), media: OPEN_ROUTER, generation: fakes.deps });
      await executeMediaAsset(worker, stale!.assetId);
      expect(await runDueGenerationWork(worker, { lesson: 0, deck: 0, tts: 50, images: 0 })).toMatchObject({ processed: 0 });
      expect(fakes.tts.requests).toHaveLength(0);
      expect(await stateOf(stale!.assetId)).toEqual({ asset: "pending", runs: ["queued"] });

      await editLessonDraft(worker, versionId, { expectedEditNumber: draft.editNumber, exercises: exercises() });
      const [fresh] = await promptAudio(versionId);
      expect(fresh!.assetId).not.toBe(stale!.assetId);
      expect((await pool.query("select provider, model from learning_app.media_assets where id = $1", [fresh!.assetId])).rows[0])
        .toEqual({ provider: "openrouter", model: "openai/gpt-4o-mini-tts-2025-12-15" });
      await executeMediaAsset(worker, fresh!.assetId);
      expect(fakes.tts.requests).toHaveLength(1);
      expect((await stateOf(fresh!.assetId)).asset).toBe("ready");
    } finally {
      await fakes.dispose();
    }
  });

  it("stary worker w trakcie wdrożenia nie unieważnia nagrania zleconego już z nową konfiguracją", async () => {
    const { versionId } = await seedDraft();
    await editLessonDraft(createServices({ db, clock: new ManualClock(), media: OPEN_ROUTER }), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [fresh] = await promptAudio(versionId);

    const fakes = await fakeGeneration();
    try {
      const oldWorker = createServices({ db, clock: new ManualClock(), media: MEDIA, generation: fakes.deps });
      await executeMediaAsset(oldWorker, fresh!.assetId);
      expect(await runDueGenerationWork(oldWorker, { lesson: 0, deck: 0, tts: 50, images: 0 })).toMatchObject({ processed: 0 });
      expect(fakes.tts.requests).toHaveLength(0);
      expect(await stateOf(fresh!.assetId)).toEqual({ asset: "pending", runs: ["queued"] });

      const newWorker = createServices({ db, clock: new ManualClock(), media: OPEN_ROUTER, generation: fakes.deps });
      await runDueGenerationWork(newWorker, { lesson: 0, deck: 0, tts: 50, images: 0 });
      expect((await stateOf(fresh!.assetId)).asset).toBe("ready");
    } finally {
      await fakes.dispose();
    }
  });
});
