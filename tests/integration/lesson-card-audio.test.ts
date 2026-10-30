import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createChild, createServices, editLessonDraft, endSession, nextTask, publishLessonDraft, readLessonDeck,
  runDueGenerationWork, startSession, submitAttempt,
} from "@learning/server";
import type { LessonExerciseInput, TaskDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";

/**
 * „Posłuchaj karty” (design szkoły §12) na PostgreSQL: edycja szkicu szkoły
 * zleca polskie nagrania kart nauki (tytuł, treść, przykłady) w
 * `lesson_card_assets`, karta ze wzorem nie ma nagrania, publikacja na nie nie
 * czeka, wiersze opublikowanej wersji są niezmienne, karta dostaje
 * `questionAudioAssetId` dopiero dla gotowego nagrania, a odsłuch nie jest
 * ujawnieniem. Worker syntetyzuje nagranie karty (nie uznaje go za zbędne).
 */

const { db, pool } = testDatabase();
const OBJECTIVE = "school.ddeck000.pajaki";
const MATERIAL = "Pająk ma osiem nóg i nie jest owadem. Owady mają sześć nóg. Pająki tkają sieci z nici.";
const MEDIA = {
  tts: { provider: "fake", model: "fake-tts", voice: "test", format: "mp3" as const },
  image: { provider: "fake", model: "fake-image", size: "1024x1024", quality: "low", format: "webp" },
};
const CARDS = [
  { title: "Pająki", body: "Pająk ma osiem nóg {{examples}}." },
  { title: "Owady", body: "Owady mają sześć nóg." },
  { title: "Liczymy nogi", body: "Osiem to 2 · 4." },
];

function services() {
  return createServices({ db, clock: new ManualClock(), media: MEDIA });
}

const common = { objectiveId: OBJECTIVE, acceptedAnswers: [], sourceRefs: [{ quote: "Pająk ma osiem nóg i nie jest owadem." }] };

function exercises(): LessonExerciseInput[] {
  return [
    ...["osiem", "sześć", "sieci"].map((answer) => ({
      ...common, exerciseType: "lesson_choice" as const, instructionPl: "Wybierz odpowiedź.", stem: `Wybierz słowo: ${answer}.`,
      answer, focus: [answer], options: [{ id: "a", text: answer }, { id: "b", text: "cztery" }], correctOption: "a",
    })),
    ...["osiem", "sześć"].map((answer) => ({
      ...common, exerciseType: "lesson_gap" as const, instructionPl: "Uzupełnij.", stem: `Pająk ma ___ nóg (${answer}).`, answer, focus: [answer],
    })),
    ...["Pająk ma osiem nóg.", "Owady mają sześć nóg."].map((answer, i) => ({
      ...common, exerciseType: "lesson_open_answer" as const, instructionPl: "Wyjaśnij.", prompt: `Wyjaśnij zasadę ${i + 1}.`, answer, focus: [answer],
      questionType: "definition" as const, expectedForm: "explanation" as const, requiredElements: [{ id: "e1", text: answer }],
    })),
  ];
}

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts, learning_app.lesson_card_assets,
    learning_app.revision_assets, learning_app.generation_runs, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

async function seedDraft() {
  const deckId = randomUUID();
  const versionId = randomUUID();
  await pool.query("insert into learning_app.decks (id,title,kind) values ($1,'Pająki','lesson')", [deckId]);
  const context = {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, objectiveIds: [OBJECTIVE], poolSize: 20,
    examples: { [OBJECTIVE]: ["Pająk krzyżak tka sieć"] }, material: MATERIAL, subjectTitlePl: "Przyroda",
    dynamicTopic: { titlePl: "Pająki", objectives: [{ id: OBJECTIVE, titlePl: "Pająki", descriptionEn: "Spiders.", cards: CARDS }] },
  };
  await pool.query(`insert into learning_app.deck_versions (id,deck_id,version_number,edit_number,state,title,lesson_context)
    values ($1,$2,1,1,'draft','Pająki',$3::jsonb)`, [versionId, deckId, JSON.stringify(context)]);
  return { deckId, versionId };
}

interface CardAudioRow { cardIndex: number; assetId: string; text: string; locale: string; state: string }

async function cardAudio(versionId: string): Promise<CardAudioRow[]> {
  return (await pool.query<CardAudioRow>(
    `select ca.card_index as "cardIndex", ca.asset_id as "assetId", ma.metadata->>'text' as text, ma.metadata->>'locale' as locale, ma.state
       from learning_app.lesson_card_assets ca
       join learning_app.media_assets ma on ma.id = ca.asset_id
      where ca.deck_version_id = $1
      order by ca.card_index`,
    [versionId],
  )).rows;
}

/** Zastępuje workera: gotowy, niezmienny zasób (bajty nieistotne dla wydania karty). */
async function markReady(assetId: string): Promise<void> {
  await pool.query(
    `update learning_app.media_assets
        set state = 'ready', storage_key = $2, mime_type = 'audio/mpeg', byte_count = 3, content_sha256 = $3, lease_token = null
      where id = $1`,
    [assetId, `tts/${assetId}.mp3`, "0".repeat(64)],
  );
}

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
  const active = services();
  const child = await createChild(active, { displayName: "Karty", avatarKey: "owl" });
  const { deckId, versionId } = await seedDraft();
  const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: exercises() });
  await publishLessonDraft(active, versionId, draft.editNumber);
  await pool.query("insert into learning_app.assignments (id,child_id,deck_id,test_date,test_goals) values ($1,$2,$3,CURRENT_DATE + 7,ARRAY['lesson'])", [randomUUID(), child.id, deckId]);
  return { active, child, deckId, versionId };
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

  it("publikacja nie czeka na nagrania kart; rodzic ich nie widzi; wiersze opublikowanej wersji są niezmienne", async () => {
    const { active, deckId, versionId } = await publishedWorld();
    expect((await cardAudio(versionId)).every((row) => row.state === "pending")).toBe(true);
    expect(JSON.stringify(await readLessonDeck(active, deckId))).not.toContain("lesson_card_assets");
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
