import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLesson, createLessonDraftFromPublished, createServices, executeLessonGeneration, publishLessonDraft, readLessonDeck,
} from "@learning/server";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";

/**
 * Odczyt pełnego zdania po odpowiedzi (gramatyka): `feedback_audio` jest
 * planowane przy przygotowaniu materiału, nie blokuje publikacji i jest
 * uzgadniane także przy publikacji kopii starej lekcji.
 */

const { db, pool } = testDatabase();
const OBJECTIVE = "english_grammar.present_simple.third_person_s";
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
afterAll(() => pool.end());

async function generatedGrammarLesson() {
  const fakes = await fakeGeneration();
  cleanup.push(fakes.dispose);
  const services = createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
  const run = await createLesson(services, {
    subjectId: "english_grammar", topicId: "present_simple", objectiveIds: [OBJECTIVE],
    material: "He plays football. She reads books. She watches TV.", poolSize: 20, clientRequestId: randomUUID(),
  });
  await executeLessonGeneration(services, run.runId);
  const draft = (await readLessonDeck(services, run.deckId)).draft!;
  return { services, run, draft };
}

const feedbackRows = async (versionId: string) => (await pool.query<{ text: string; state: string }>(
  `select ma.metadata->>'text' as text, ma.state
     from learning_app.revision_assets ra
     join learning_app.item_revisions ir on ir.id = ra.item_revision_id
     join learning_app.media_assets ma on ma.id = ra.asset_id
    where ir.deck_version_id = $1 and ra.role = 'feedback_audio'`,
  [versionId],
)).rows;

const mediaCount = async () => (await pool.query("select count(*)::int as count from learning_app.media_assets")).rows[0].count as number;

describe("lekcja gramatyki — nagranie zdania feedbacku", () => {
  it("generacja zleca feedback_audio, a rodzic go nie widzi i publikacja na nie nie czeka", async () => {
    const { services, draft } = await generatedGrammarLesson();
    const rows = await feedbackRows(draft.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === "pending")).toBe(true);
    expect(draft.assets).toEqual([]);
    await expect(publishLessonDraft(services, draft.id, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.id });
  });

  it("nowa wersja starej lekcji (bez feedback_audio) po publikacji ma nagrania, a drugie przejście nie dubluje zasobów", async () => {
    const { services, run, draft } = await generatedGrammarLesson();
    await publishLessonDraft(services, draft.id, draft.editNumber);
    const copy = await createLessonDraftFromPublished(services, run.deckId);
    // Symulacja lekcji opublikowanej przed zmianą: kopia bez wierszy feedback_audio
    // (opublikowane wersje są niezmienne, więc usuwamy je w szkicu kopii).
    await pool.query(
      `delete from learning_app.revision_assets ra using learning_app.item_revisions ir
        where ir.id = ra.item_revision_id and ir.deck_version_id = $1 and ra.role = 'feedback_audio'`,
      [copy.id],
    );
    expect(await feedbackRows(copy.id)).toEqual([]);
    await publishLessonDraft(services, copy.id, copy.editNumber);
    const created = await feedbackRows(copy.id);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((row) => row.state === "pending")).toBe(true);

    const mediaAfterFirst = await mediaCount();
    const second = await createLessonDraftFromPublished(services, run.deckId);
    await publishLessonDraft(services, second.id, second.editNumber);
    expect((await feedbackRows(second.id)).map((row) => row.text).sort()).toEqual(created.map((row) => row.text).sort());
    expect(await mediaCount()).toBe(mediaAfterFirst);
  });

  it("CHECK roli przyjmuje feedback_audio", async () => {
    const { draft } = await generatedGrammarLesson();
    const revision = (await pool.query(`select id from learning_app.item_revisions where deck_version_id = $1 limit 1`, [draft.id])).rows[0].id;
    await pool.query(`delete from learning_app.revision_assets where item_revision_id = $1 and role = 'feedback_audio'`, [revision]);
    await expect(pool.query(
      `insert into learning_app.revision_assets (item_revision_id, role, expected_fingerprint, state) values ($1, 'feedback_audio', 'fp', 'pending')`, [revision],
    )).resolves.toBeDefined();
    await expect(pool.query(
      `insert into learning_app.revision_assets (item_revision_id, role, expected_fingerprint, state) values ($1, 'bogus_audio', 'fp', 'pending')`, [revision],
    )).rejects.toThrow(/revision_assets_role_allowed/);
  });
});
