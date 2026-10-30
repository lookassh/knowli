import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createServices, editLessonDraft, endSession, nextTask, publishLessonDraft, readLessonDeck,
  runDueGenerationWork, startSession, submitAttempt,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import {
  audioServices, FAKE_MEDIA, markTtsReady, publishAssignedSpiderLesson, seedSchoolDraft, SPIDER_OBJECTIVE, spiderExercises, truncateLessonAudioTables,
} from "./school-lesson-audio-helpers";

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

  it("publikacja nie czeka na nagrania kart; rodzic ich nie widzi; wiersze opublikowanej wersji są niezmienne", async () => {
    const { active, deckId, versionId } = await publishedWorld();
    const rows = await cardAudio(versionId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.state === "pending")).toBe(true);
    // DTO rodzica nie ujawnia nagrań kart ani w oczekiwaniu, ani po przygotowaniu.
    for (const ready of [false, true]) {
      if (ready) for (const row of rows) await markReady(row.assetId);
      const parentDto = JSON.stringify(await readLessonDeck(active, deckId));
      for (const row of rows) expect(parentDto).not.toContain(row.assetId);
      expect(parentDto).not.toContain("questionAudioAssetId");
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
