import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createLessonDraftFromPublished, createServices, editLessonDraft, endSession, executeMediaAsset, nextTask, runDueGenerationWork,
  publishLessonDraft, readLessonDeck, regenerateLessonPromptAudio, startSession, submitAttempt, createSubjectRegistry, schoolSubject, ttsFingerprint,
} from "@learning/server";
import type { LessonDraftDto, LessonExerciseInput, TaskDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import {
  addGeneration, audioServices, EN_LANGUAGE_INSTRUCTION, FAKE_MEDIA, generationsOf, markTtsReady, mediaAsset, PL_LANGUAGE_INSTRUCTION,
  publishAssignedSpiderLesson, seedSchoolDraft, SPIDER_OBJECTIVE, spiderExercises, styledMedia, truncateLessonAudioTables,
} from "./school-lesson-audio-helpers";
import { STYLE_SENTENCES_PL } from "../../packages/server/src/providers/tts-style-profile";

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

interface AudioMetadataRow { role: string; fingerprint: string; metadata: Record<string, unknown> }

async function audioMetadata(versionId: string, role: string): Promise<AudioMetadataRow[]> {
  return (await pool.query<AudioMetadataRow>(
    `select ra.role, ma.fingerprint, ma.metadata
       from learning_app.revision_assets ra
       join learning_app.item_revisions ir on ir.id = ra.item_revision_id
       join learning_app.media_assets ma on ma.id = ra.asset_id
      where ir.deck_version_id = $1 and ra.role = $2
      order by ir.position`,
    [versionId, role],
  )).rows;
}

describe("„Posłuchaj pytania” — styl roli (UMIEM_TTS_STYLE)", () => {
  it("nagranie pytania dostaje instrukcję języka i zdanie stylu lesson_question; klucz stylu nie trafia do metadanych", async () => {
    const { versionId } = await seedDraft();
    await editLessonDraft(audioServices(styledMedia()), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const rows = await audioMetadata(versionId, "prompt_audio");
    expect(rows).toHaveLength(exercises().length);
    for (const row of rows) {
      expect(row.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.lesson_question}`);
      expect(row.metadata).not.toHaveProperty("style");
    }
  });

  it("target_audio odpowiedzi (en-GB) pozostaje bez stylu — sama instrukcja języka", async () => {
    const english = createSubjectRegistry([{ ...schoolSubject, ttsForAnswers: true, answerLocale: "en-GB" }]);
    const { versionId } = await seedDraft();
    await editLessonDraft(audioServices(styledMedia(), english), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const answers = await audioMetadata(versionId, "target_audio");
    expect(answers.length).toBeGreaterThan(0);
    for (const row of answers) {
      expect(row.metadata.locale).toBe("en-GB");
      expect(row.metadata.instructions).toBe(EN_LANGUAGE_INSTRUCTION);
    }
    const prompts = await audioMetadata(versionId, "prompt_audio");
    for (const row of prompts) expect(row.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.lesson_question}`);
  });

  it("bez stylu w ustawieniach fingerprint nagrania pytania jest liczony z samej instrukcji języka (jak przed stylem)", async () => {
    const plain = { ...MEDIA, tts: { ...MEDIA.tts, instructions: { "pl-PL": PL_LANGUAGE_INSTRUCTION } } };
    const { versionId } = await seedDraft();
    await editLessonDraft(audioServices(plain), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const rows = await audioMetadata(versionId, "prompt_audio");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.metadata.instructions).toBe(PL_LANGUAGE_INSTRUCTION);
      expect(row.fingerprint).toBe(ttsFingerprint({
        text: row.metadata.text as string, locale: "pl-PL", provider: plain.tts.provider, model: plain.tts.model,
        voice: plain.tts.voice, format: plain.tts.format, instructions: PL_LANGUAGE_INSTRUCTION,
      }));
    }
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

/** Ćwiczenia szkicu jako wejście edycji (bez pól tylko do odczytu). */
function inputsOf(draft: LessonDraftDto): LessonExerciseInput[] {
  return draft.exercises.map(({ revisionId: _revisionId, promptAudio: _promptAudio, ...input }) => input);
}

const skillVersionCount = async (): Promise<number> =>
  (await pool.query<{ count: number }>("select count(*)::int as count from learning_app.skill_versions")).rows[0]!.count;

describe("„Posłuchaj pytania” — ton lektora (spec tonu TTS §4.4)", () => {
  it("ton ćwiczenia trafia do instrukcji nagrania; zmiana tonu = nowy fingerprint, stare gotowe nagranie i umiejętności nietknięte", async () => {
    const styled = audioServices(styledMedia());
    const { versionId } = await seedDraft();
    const toned = exercises();
    toned[0] = { ...toned[0]!, voiceTone: "cheerful" };
    const draft = await editLessonDraft(styled, versionId, { expectedEditNumber: 1, exercises: toned });
    const rows = await audioMetadata(versionId, "prompt_audio");
    expect(rows[0]!.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.cheerful}`);
    expect(rows[1]!.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.lesson_question}`);

    const [old] = await promptAudio(versionId);
    await markReady(old!.assetId);
    const before = await mediaAsset(old!.assetId);
    const skillVersions = await skillVersionCount();

    const retoned = inputsOf(draft);
    retoned[0] = { ...retoned[0]!, voiceTone: "gentle" };
    await editLessonDraft(styled, versionId, { expectedEditNumber: draft.editNumber, exercises: retoned });
    const after = await audioMetadata(versionId, "prompt_audio");
    expect(after[0]!.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.gentle}`);
    expect(after[0]!.fingerprint).not.toBe(rows[0]!.fingerprint);
    expect(after[1]!.fingerprint).toBe(rows[1]!.fingerprint);
    expect(await mediaAsset(old!.assetId)).toEqual(before);
    expect(await skillVersionCount()).toBe(skillVersions);
  });
});

describe("„Posłuchaj pytania” — stan nagrania w szkicu rodzica (spec tonu TTS §4.5)", () => {
  it("promptAudio = stan najnowszej generacji o oczekiwanym fingerprincie; assetId tylko dla gotowej; brak wiersza = brak pola", async () => {
    const active = services();
    const { deckId, versionId } = await seedDraft();
    await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const readDraft = async () => (await readLessonDeck(active, deckId)).draft!;
    expect((await readDraft()).exercises[0]!.promptAudio).toEqual({ state: "pending" });

    const [row] = await promptAudio(versionId);
    await markReady(row!.assetId);
    expect((await readDraft()).exercises[0]!.promptAudio).toEqual({ state: "ready", assetId: row!.assetId });

    // Nowsza nieudana generacja tego samego tekstu: stan „failed”, choć starsze nagranie jest gotowe.
    await addGeneration(row!.assetId, "failed");
    expect((await readDraft()).exercises[0]!.promptAudio).toEqual({ state: "failed" });

    const second = (await readDraft()).exercises[1]!;
    await pool.query("delete from learning_app.revision_assets where item_revision_id = $1 and role = 'prompt_audio'", [second.revisionId]);
    expect((await readDraft()).exercises[1]).not.toHaveProperty("promptAudio");
  });
});

describe("„Posłuchaj pytania” — ponowne nagranie (spec tonu TTS §2.4)", () => {
  it("gotowe albo nieudane → nowa generacja pending tego samego fingerprintu z metadanymi zasobu; przy pending zwraca istniejącą", async () => {
    const active = services();
    const { deckId, versionId } = await seedDraft();
    await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [row] = await promptAudio(versionId);
    await markReady(row!.assetId);
    const original = await mediaAsset(row!.assetId);
    const itemRevisionId = (await readLessonDeck(active, deckId)).draft!.exercises[0]!.revisionId;

    // Fingerprint i metadane pochodzą z wiersza i zasobu, nie z bieżącej konfiguracji (inny styl w env).
    const first = await regenerateLessonPromptAudio(audioServices(styledMedia()), { lessonDraftId: versionId, itemRevisionId });
    expect(first.assetId).not.toBe(row!.assetId);
    expect(await mediaAsset(first.assetId)).toMatchObject({
      fingerprint: original.fingerprint, generationNumber: original.generationNumber + 1, state: "pending",
      provider: original.provider, model: original.model, metadata: original.metadata,
    });
    expect((await pool.query("select state from learning_app.generation_runs where asset_id = $1", [first.assetId])).rows).toEqual([{ state: "queued" }]);
    expect(await mediaAsset(row!.assetId)).toEqual(original);
    expect((await readLessonDeck(active, deckId)).draft!.exercises[0]!.promptAudio).toEqual({ state: "pending" });

    const again = await regenerateLessonPromptAudio(active, { lessonDraftId: versionId, itemRevisionId });
    expect(again.assetId).toBe(first.assetId);
    expect(await generationsOf(original.fingerprint)).toHaveLength(2);

    await pool.query("update learning_app.media_assets set state = 'failed' where id = $1", [first.assetId]);
    const afterFailure = await regenerateLessonPromptAudio(active, { lessonDraftId: versionId, itemRevisionId });
    expect(await mediaAsset(afterFailure.assetId)).toMatchObject({
      fingerprint: original.fingerprint, generationNumber: original.generationNumber + 2, state: "pending",
    });
  });

  it("nieznana rewizja albo szkic → not_found; rewizja bez nagrania pytania → not_found", async () => {
    const active = services();
    const { deckId, versionId } = await seedDraft();
    await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    await expect(regenerateLessonPromptAudio(active, { lessonDraftId: versionId, itemRevisionId: randomUUID() }))
      .rejects.toMatchObject({ code: "not_found" });
    const itemRevisionId = (await readLessonDeck(active, deckId)).draft!.exercises[0]!.revisionId;
    await expect(regenerateLessonPromptAudio(active, { lessonDraftId: randomUUID(), itemRevisionId }))
      .rejects.toMatchObject({ code: "not_found" });
    await pool.query("delete from learning_app.revision_assets where item_revision_id = $1 and role = 'prompt_audio'", [itemRevisionId]);
    await expect(regenerateLessonPromptAudio(active, { lessonDraftId: versionId, itemRevisionId }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("wersja opublikowana → immutable; nowe ujęcie ze szkicu trafia do zadań opublikowanej wersji (wspólny fingerprint)", async () => {
    const { active, child, deckId, versionId } = await publishedWorld();
    const [row] = await promptAudio(versionId);
    await markReady(row!.assetId);
    const publishedRevision = (await pool.query<{ id: string }>(
      "select id from learning_app.item_revisions where deck_version_id = $1 order by position limit 1", [versionId],
    )).rows[0]!.id;
    await expect(regenerateLessonPromptAudio(active, { lessonDraftId: versionId, itemRevisionId: publishedRevision }))
      .rejects.toMatchObject({ code: "immutable" });

    const draft = await createLessonDraftFromPublished(active, deckId);
    expect(draft.exercises[0]!.promptAudio).toEqual({ state: "ready", assetId: row!.assetId });
    const regenerated = await regenerateLessonPromptAudio(active, { lessonDraftId: draft.id, itemRevisionId: draft.exercises[0]!.revisionId });
    await markReady(regenerated.assetId);
    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const task = await reach(active, session.sessionId, STEM);
    expect(task.prompt).toMatchObject({ questionAudioAssetId: regenerated.assetId });
  });
});
