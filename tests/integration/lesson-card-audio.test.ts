import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createLessonDraftFromPublished, createServices, editLessonDraft, endSession, nextTask, publishLessonDraft, readLessonDeck,
  regenerateLessonCardAudio, runDueGenerationWork, startSession, submitAttempt,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import {
  addGeneration, audioServices, FAKE_MEDIA, generationsOf, markTtsReady, mediaAsset, PL_LANGUAGE_INSTRUCTION, publishAssignedSpiderLesson,
  seedSchoolDraft, SPIDER_OBJECTIVE, spiderExercises, styledMedia, truncateLessonAudioTables,
} from "./school-lesson-audio-helpers";
import { STYLE_SENTENCES_PL } from "../../packages/server/src/providers/tts-style-profile";

/**
 * „Posłuchaj karty” (design szkoły §12) na PostgreSQL: edycja szkicu szkoły
 * zleca polskie nagrania kart nauki (tytuł, treść, przykłady) w
 * `lesson_card_assets`, karta ze wzorem nie ma nagrania, publikacja na nie nie
 * czeka, wiersze opublikowanej wersji są niezmienne, karta dostaje
 * `questionAudioAssetId` dopiero dla gotowego nagrania, a odsłuch nie jest
 * ujawnieniem. Worker syntetyzuje nagranie karty (nie uznaje go za zbędne).
 */

const { db, pool } = testDatabase();
const OBJECTIVE = SPIDER_OBJECTIVE;
const MEDIA = FAKE_MEDIA;
const services = () => audioServices();
const exercises = () => spiderExercises();
const CARDS = [
  { title: "Pająki", body: "Pająk ma osiem nóg {{examples}}." },
  { title: "Owady", body: "Owady mają sześć nóg." },
  { title: "Liczymy nogi", body: "Osiem to 2 · 4." },
];
const ROOTS = "school.ddeck000.korzenie";

beforeEach(async () => {
  await truncateCoreTables();
  await truncateLessonAudioTables();
});
afterAll(() => pool.end());

function seedDraft(options: { extraObjective?: boolean } = {}) {
  const objectives = [{ id: OBJECTIVE, titlePl: "Pająki", descriptionEn: "Spiders.", cards: CARDS }];
  if (options.extraObjective) {
    objectives.push({ id: ROOTS, titlePl: "Korzenie", descriptionEn: "Roots.", cards: [{ title: "Korzenie", body: "Korzeń pobiera wodę." }, { title: "Łodyga", body: "Łodyga niesie wodę." }] });
  }
  return seedSchoolDraft(objectives, { [OBJECTIVE]: ["Pająk krzyżak tka sieć"] });
}

interface CardAudioRow { objectiveId: string; cardIndex: number; assetId: string; text: string; locale: string; state: string }

async function cardAudio(versionId: string): Promise<CardAudioRow[]> {
  return (await pool.query<CardAudioRow>(
    `select ca.objective_id as "objectiveId", ca.card_index as "cardIndex", ca.asset_id as "assetId", ma.metadata->>'text' as text, ma.metadata->>'locale' as locale, ma.state
       from learning_app.lesson_card_assets ca
       join learning_app.media_assets ma on ma.id = ca.asset_id
      where ca.deck_version_id = $1
      order by ca.objective_id desc, ca.card_index`,
    [versionId],
  )).rows;
}

const markReady = markTtsReady;

async function firstCard(active: ReturnType<typeof services>, sessionId: string): Promise<TaskDto> {
  for (let i = 0; i < 30; i++) {
    const task = await nextTask(active, sessionId);
    if (!task) break;
    if (task.prompt.kind === "lesson_card") return task;
    await submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error("no lesson_card task");
}

async function publishedWorld() {
  return publishAssignedSpiderLesson(await seedDraft(), "Karty");
}

describe("„Posłuchaj karty” — styl roli (UMIEM_TTS_STYLE)", () => {
  async function cardMetadata(versionId: string): Promise<Record<string, unknown>[]> {
    return (await pool.query<{ metadata: Record<string, unknown> }>(
      `select ma.metadata from learning_app.lesson_card_assets ca join learning_app.media_assets ma on ma.id = ca.asset_id
        where ca.deck_version_id = $1 order by ca.card_index`,
      [versionId],
    )).rows.map((row) => row.metadata);
  }

  it("nagranie karty dostaje instrukcję języka i zdanie stylu lesson_card; klucz stylu nie trafia do metadanych", async () => {
    const { versionId } = await seedDraft();
    await editLessonDraft(audioServices(styledMedia()), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const metadata = await cardMetadata(versionId);
    expect(metadata).toHaveLength(2);
    for (const entry of metadata) {
      expect(entry.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.lesson_card}`);
      expect(entry).not.toHaveProperty("style");
    }
  });

  it("bez stylu w ustawieniach nagranie karty ma samą instrukcję języka", async () => {
    const plain = { ...MEDIA, tts: { ...MEDIA.tts, instructions: { "pl-PL": PL_LANGUAGE_INSTRUCTION } } };
    const { versionId } = await seedDraft();
    await editLessonDraft(audioServices(plain), versionId, { expectedEditNumber: 1, exercises: exercises() });
    for (const entry of await cardMetadata(versionId)) expect(entry.instructions).toBe(PL_LANGUAGE_INSTRUCTION);
  });
});

describe("„Posłuchaj karty” — przygotowanie nagrań", () => {
  it("edycja szkicu zleca polskie nagrania kart z przykładami; karta ze wzorem bez nagrania; zmiana karty = nowe nagranie tylko jej", async () => {
    const active = services();
    const { versionId } = await seedDraft();
    const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const rows = await cardAudio(versionId);
    expect(rows.map((row) => row.cardIndex)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ text: "Pająki. Pająk ma osiem nóg. Pająk krzyżak tka sieć.", locale: "pl-PL", state: "pending" });
    // Przykłady lekcji pokazuje każda karta zagadnienia (`renderCard`), więc każda je czyta.
    expect(rows[1]).toMatchObject({ text: "Owady. Owady mają sześć nóg. Pająk krzyżak tka sieć." });

    await editLessonDraft(active, versionId, {
      expectedEditNumber: draft.editNumber,
      dynamicTopic: { objectives: [{ id: OBJECTIVE, titlePl: "Pająki", cards: [CARDS[0]!, { title: "Owady", body: "Owad ma sześć nóg i czułki." }] }] },
    });
    const after = await cardAudio(versionId);
    expect(after.map((row) => row.cardIndex)).toEqual([0, 1]);
    expect(after[0]!.assetId).toBe(rows[0]!.assetId);
    expect(after[1]).toMatchObject({ text: "Owady. Owad ma sześć nóg i czułki. Pająk krzyżak tka sieć.", state: "pending" });
    expect(after[1]!.assetId).not.toBe(rows[1]!.assetId);
  });

  it("usunięcie zagadnienia usuwa nagrania jego kart w tej samej edycji", async () => {
    const active = services();
    const { versionId } = await seedDraft({ extraObjective: true });
    const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    expect((await cardAudio(versionId)).map((row) => [row.objectiveId, row.cardIndex]))
      .toEqual([[OBJECTIVE, 0], [OBJECTIVE, 1], [ROOTS, 0], [ROOTS, 1]]);
    await editLessonDraft(active, versionId, {
      expectedEditNumber: draft.editNumber,
      dynamicTopic: { objectives: [{ id: OBJECTIVE, titlePl: "Pająki", cards: CARDS }] },
    });
    expect((await cardAudio(versionId)).map((row) => [row.objectiveId, row.cardIndex])).toEqual([[OBJECTIVE, 0], [OBJECTIVE, 1]]);
  });

  it("publikacja zleca ponownie nieudane nagranie karty (nie jest decyzją rodzica)", async () => {
    const active = services();
    const { versionId } = await seedDraft();
    const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [failed] = await cardAudio(versionId);
    await pool.query("update learning_app.media_assets set state = 'failed', lease_token = null where id = $1", [failed!.assetId]);
    await publishLessonDraft(active, versionId, draft.editNumber);
    const [requeued] = await cardAudio(versionId);
    expect(requeued!.assetId).not.toBe(failed!.assetId);
    expect(requeued).toMatchObject({ state: "pending", text: failed!.text });
  });

  it("publikacja nie czeka na nagrania kart; nie są zasobami do decyzji rodzica; wiersze opublikowanej wersji są niezmienne", async () => {
    const { active, deckId, versionId } = await publishedWorld();
    const rows = await cardAudio(versionId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.state === "pending")).toBe(true);
    // Nagrania kart nie trafiają do `assets` (decyzji rodzica) — tylko stan odsłuchu w `cardAudio` (spec tonu TTS §4.5).
    for (const ready of [false, true]) {
      if (ready) for (const row of rows) await markReady(row.assetId);
      const published = (await readLessonDeck(active, deckId)).published!;
      const assetsJson = JSON.stringify(published.assets);
      for (const row of rows) expect(assetsJson).not.toContain(row.assetId);
      expect(JSON.stringify(published)).not.toContain("questionAudioAssetId");
      expect(published.cardAudio?.map((card) => card.audio.state)).toEqual(ready ? ["ready", "ready"] : ["pending", "pending"]);
    }
    await expect(pool.query("delete from learning_app.lesson_card_assets where deck_version_id = $1", [versionId]))
      .rejects.toThrow(/immutable/);
    await expect(pool.query("update learning_app.lesson_card_assets set asset_id = null where deck_version_id = $1", [versionId]))
      .rejects.toThrow(/immutable/);
  });
});

describe("„Posłuchaj karty” — karta dziecka", () => {
  it("bez gotowego nagrania brak pola; gotowe nagranie trafia do karty bez zdarzeń ujawnienia audio", async () => {
    const { active, child, deckId, versionId } = await publishedWorld();
    const first = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const pending = await firstCard(active, first.sessionId);
    expect(pending.prompt).not.toHaveProperty("questionAudioAssetId");
    await endSession(active, first.sessionId);

    for (const row of await cardAudio(versionId)) await markReady(row.assetId);
    const rows = await cardAudio(versionId);
    const second = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const card = await firstCard(active, second.sessionId);
    if (card.prompt.kind !== "lesson_card") throw new Error("expected card");
    const title = card.prompt.card.title;
    const expected = rows.find((row) => row.text.startsWith(`${title}.`));
    expect(card.prompt.questionAudioAssetId).toBe(expected!.assetId);
    await completePresentation(active, { taskId: card.taskId });

    const events = await pool.query(
      `select kind from learning_app.learning_events where child_id = $1 and kind in ('audio_issued', 'hint_issued', 'audio_played')`,
      [child.id],
    );
    expect(events.rows).toEqual([]);
  });
});

describe("„Posłuchaj karty” — worker", () => {
  it("syntetyzuje nagranie karty tekstem karty (nie uznaje go za zbędne)", async () => {
    const { versionId } = await seedDraft();
    await editLessonDraft(services(), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const fakes = await fakeGeneration();
    try {
      const worker = createServices({ db, clock: new ManualClock(), media: MEDIA, generation: fakes.deps });
      await runDueGenerationWork(worker, { lesson: 0, deck: 0, tts: 50, images: 0 });
      expect(fakes.tts.requests.map((request) => request.text)).toContain("Pająki. Pająk ma osiem nóg. Pająk krzyżak tka sieć.");
      expect((await cardAudio(versionId)).map((row) => row.state)).toEqual(["ready", "ready"]);
    } finally {
      await fakes.dispose();
    }
  });
});

/** Karty z tonem: „Zagadka:” + jedno zdanie czyta się jako jedno zdanie (dwukropek nie kończy zdania). */
const TONED_CARDS = [
  { title: "Zagadka:", body: "Pająk ma osiem nóg.", voiceTone: "mysterious" as const },
  { title: "Sekret", body: "Pająk nie jest owadem. Owady mają sześć nóg.", voiceTone: "mysterious" as const },
];

const seedTonedDraft = () =>
  seedSchoolDraft([{ id: OBJECTIVE, titlePl: "Pająki", descriptionEn: "Spiders.", cards: TONED_CARDS }]);

interface CardMetadataRow { cardIndex: number; assetId: string; fingerprint: string; metadata: Record<string, unknown> }

async function cardRows(versionId: string): Promise<CardMetadataRow[]> {
  return (await pool.query<CardMetadataRow>(
    `select ca.card_index as "cardIndex", ca.asset_id as "assetId", ca.expected_fingerprint as fingerprint, ma.metadata
       from learning_app.lesson_card_assets ca join learning_app.media_assets ma on ma.id = ca.asset_id
      where ca.deck_version_id = $1 order by ca.objective_id desc, ca.card_index`,
    [versionId],
  )).rows;
}

describe("„Posłuchaj karty” — ton lektora (spec tonu TTS §4.3–4.4)", () => {
  it("ton karty z tematu trafia do instrukcji (reguła szeptu); zmiana tonu = nowy fingerprint, stare gotowe nagranie nietknięte", async () => {
    const styled = audioServices(styledMedia());
    const { versionId } = await seedTonedDraft();
    const draft = await editLessonDraft(styled, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const rows = await cardRows(versionId);
    expect(rows.map((row) => row.metadata.text)).toEqual(["Zagadka: Pająk ma osiem nóg.", "Sekret. Pająk nie jest owadem. Owady mają sześć nóg."]);
    // Jedno zdanie z tonem tajemniczym → ciekawość; dwa i więcej → szept pierwszego zdania.
    expect(rows[0]!.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.curious}`);
    expect(rows[1]!.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.mysterious}`);

    await markReady(rows[0]!.assetId);
    const before = await mediaAsset(rows[0]!.assetId);
    await editLessonDraft(styled, versionId, {
      expectedEditNumber: draft.editNumber,
      dynamicTopic: { objectives: [{ id: OBJECTIVE, titlePl: "Pająki", cards: [{ ...TONED_CARDS[0]!, voiceTone: "cheerful" }, TONED_CARDS[1]!] }] },
    });
    const after = await cardRows(versionId);
    expect(after[0]!.metadata.instructions).toBe(`${PL_LANGUAGE_INSTRUCTION} ${STYLE_SENTENCES_PL.cheerful}`);
    expect(after[0]!.fingerprint).not.toBe(rows[0]!.fingerprint);
    expect(after[1]!.fingerprint).toBe(rows[1]!.fingerprint);
    expect(await mediaAsset(rows[0]!.assetId)).toEqual(before);
  });
});

describe("„Posłuchaj karty” — stan nagrania w szkicu rodzica (spec tonu TTS §4.5)", () => {
  it("cardAudio = stan najnowszej generacji o oczekiwanym fingerprincie; assetId tylko dla gotowej; brak wiersza = brak wpisu", async () => {
    const active = services();
    const { deckId, versionId } = await seedDraft();
    await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const readCards = async () => (await readLessonDeck(active, deckId)).draft!.cardAudio;
    expect(await readCards()).toEqual([
      { objectiveId: OBJECTIVE, cardIndex: 0, audio: { state: "pending" } },
      { objectiveId: OBJECTIVE, cardIndex: 1, audio: { state: "pending" } },
    ]);

    const [first] = await cardAudio(versionId);
    await markReady(first!.assetId);
    expect((await readCards())![0]).toEqual({ objectiveId: OBJECTIVE, cardIndex: 0, audio: { state: "ready", assetId: first!.assetId } });
    await addGeneration(first!.assetId, "failed");
    expect((await readCards())![0]!.audio).toEqual({ state: "failed" });

    await pool.query("delete from learning_app.lesson_card_assets where deck_version_id = $1 and card_index = 1", [versionId]);
    expect((await readCards())!.map((card) => card.cardIndex)).toEqual([0]);
  });
});

describe("„Posłuchaj karty” — ponowne nagranie (spec tonu TTS §2.4)", () => {
  it("gotowe albo nieudane → nowa generacja pending tego samego fingerprintu z metadanymi zasobu; przy pending zwraca istniejącą", async () => {
    const active = services();
    const { deckId, versionId } = await seedDraft();
    await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [row] = await cardAudio(versionId);
    await markReady(row!.assetId);
    const original = await mediaAsset(row!.assetId);
    const target = { lessonDraftId: versionId, objectiveId: OBJECTIVE, cardIndex: 0 };

    const first = await regenerateLessonCardAudio(audioServices(styledMedia()), target);
    expect(first.assetId).not.toBe(row!.assetId);
    expect(await mediaAsset(first.assetId)).toMatchObject({
      fingerprint: original.fingerprint, generationNumber: original.generationNumber + 1, state: "pending",
      provider: original.provider, model: original.model, metadata: original.metadata,
    });
    expect((await pool.query("select state from learning_app.generation_runs where asset_id = $1", [first.assetId])).rows).toEqual([{ state: "queued" }]);
    expect(await mediaAsset(row!.assetId)).toEqual(original);
    expect((await readLessonDeck(active, deckId)).draft!.cardAudio![0]!.audio).toEqual({ state: "pending" });

    expect((await regenerateLessonCardAudio(active, target)).assetId).toBe(first.assetId);
    expect(await generationsOf(original.fingerprint)).toHaveLength(2);

    await pool.query("update learning_app.media_assets set state = 'failed' where id = $1", [first.assetId]);
    const afterFailure = await regenerateLessonCardAudio(active, target);
    expect(await mediaAsset(afterFailure.assetId)).toMatchObject({
      fingerprint: original.fingerprint, generationNumber: original.generationNumber + 2, state: "pending",
    });
  });

  it("zmiana konfiguracji TTS od ostatniej edycji → konflikt tts_config_changed bez nowego wiersza; brak ustawień mediów → internal", async () => {
    const { versionId } = await seedDraft();
    await editLessonDraft(services(), versionId, { expectedEditNumber: 1, exercises: exercises() });
    const [row] = await cardAudio(versionId);
    await markReady(row!.assetId);
    const original = await mediaAsset(row!.assetId);
    const target = { lessonDraftId: versionId, objectiveId: OBJECTIVE, cardIndex: 0 };

    const switched = audioServices({ ...MEDIA, tts: { ...MEDIA.tts, provider: "openrouter", model: "openai/gpt-4o-mini-tts-2025-12-15" } });
    await expect(regenerateLessonCardAudio(switched, target)).rejects.toMatchObject({ code: "conflict", message: "tts_config_changed" });
    expect(await generationsOf(original.fingerprint)).toHaveLength(1);

    await expect(regenerateLessonCardAudio(createServices({ db, clock: new ManualClock() }), target)).rejects.toMatchObject({ code: "internal" });
    expect(await generationsOf(original.fingerprint)).toHaveLength(1);
  });

  it("nieznana karta albo szkic → not_found", async () => {
    const active = services();
    const { versionId } = await seedDraft();
    await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
    // Karta 2 ma wzór — bez nagrania i bez wiersza.
    await expect(regenerateLessonCardAudio(active, { lessonDraftId: versionId, objectiveId: OBJECTIVE, cardIndex: 2 }))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(regenerateLessonCardAudio(active, { lessonDraftId: versionId, objectiveId: "school.ddeck000.brak", cardIndex: 0 }))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(regenerateLessonCardAudio(active, { lessonDraftId: randomUUID(), objectiveId: OBJECTIVE, cardIndex: 0 }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("wersja opublikowana → immutable; nowe ujęcie ze szkicu trafia do kart opublikowanej wersji (wspólny fingerprint)", async () => {
    const { active, child, deckId, versionId } = await publishedWorld();
    for (const row of await cardAudio(versionId)) await markReady(row.assetId);
    await expect(regenerateLessonCardAudio(active, { lessonDraftId: versionId, objectiveId: OBJECTIVE, cardIndex: 0 }))
      .rejects.toMatchObject({ code: "immutable" });

    // Nowy szkic dostaje wiersze nagrań kart przy pierwszej edycji (uzgodnienie mediów).
    const fork = await createLessonDraftFromPublished(active, deckId);
    const draft = await editLessonDraft(active, fork.id, { expectedEditNumber: fork.editNumber, title: "Pająki 2" });
    expect(draft.cardAudio?.map((card) => card.audio.state)).toEqual(["ready", "ready"]);
    const regenerated = await Promise.all([0, 1].map((cardIndex) =>
      regenerateLessonCardAudio(active, { lessonDraftId: draft.id, objectiveId: OBJECTIVE, cardIndex })));
    for (const { assetId } of regenerated) await markReady(assetId);

    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const card = await firstCard(active, session.sessionId);
    expect(regenerated.map((entry) => entry.assetId)).toContain(card.prompt.kind === "lesson_card" ? card.prompt.questionAudioAssetId : undefined);
  });
});
