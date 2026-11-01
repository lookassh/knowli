import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLesson, createServices, executeLessonGeneration, readLessonDeck } from "@learning/server";
import type { LessonDraftDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { markTtsReady } from "./school-lesson-audio-helpers";

/**
 * Ćwiczenie „Posłuchaj i wybierz” (`lesson_listen_choice`): rodzic widzi stan
 * nagrania zdania (`sentenceAudio`) wyłącznie przy ćwiczeniach słuchowych;
 * nagranie nie jest zasobem do decyzji rodzica (`assets` go pomija).
 */

const { db, pool } = testDatabase();
const OBJECTIVE = "english_grammar.present_simple.third_person_s";
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
    learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
afterAll(() => pool.end());

async function generatedGrammarDraft() {
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

const listenOf = (draft: LessonDraftDto) => draft.exercises.filter((exercise) => exercise.exerciseType === "lesson_listen_choice");

/** Zasób zdania (`feedback_audio`) ćwiczenia o danej rewizji. */
async function sentenceAssetId(revisionId: string): Promise<string> {
  return (await pool.query<{ asset_id: string }>(
    "select asset_id from learning_app.revision_assets where item_revision_id = $1 and role = 'feedback_audio'",
    [revisionId],
  )).rows[0]!.asset_id;
}

describe("lekcja gramatyki — stan nagrania zdania ćwiczenia słuchowego w DTO rodzica", () => {
  it("ćwiczenie słuchowe ma sentenceAudio, a inne ćwiczenia nie mają pola", async () => {
    const { draft } = await generatedGrammarDraft();
    const listen = listenOf(draft);
    expect(listen.length).toBeGreaterThan(0);
    for (const exercise of listen) expect(exercise.sentenceAudio).toEqual({ state: "pending" });
    const others = draft.exercises.filter((exercise) => exercise.exerciseType !== "lesson_listen_choice");
    expect(others.some((exercise) => exercise.exerciseType === "lesson_choice")).toBe(true);
    for (const exercise of others) expect(exercise).not.toHaveProperty("sentenceAudio");
  });

  it("gotowy zasób daje ready z assetId, nieudany failed, a feedback_audio nie trafia do assets", async () => {
    const { services, run, draft } = await generatedGrammarDraft();
    const [first, second] = listenOf(draft);
    const readyAsset = await sentenceAssetId(first!.revisionId);
    const failedAsset = await sentenceAssetId(second!.revisionId);
    await markTtsReady(readyAsset);
    await pool.query("update learning_app.media_assets set state = 'failed', lease_token = null where id = $1", [failedAsset]);

    const after = (await readLessonDeck(services, run.deckId)).draft!;
    const byRevision = new Map(listenOf(after).map((exercise) => [exercise.revisionId, exercise]));
    expect(byRevision.get(first!.revisionId)!.sentenceAudio).toEqual({ state: "ready", assetId: readyAsset });
    expect(byRevision.get(second!.revisionId)!.sentenceAudio).toEqual({ state: "failed" });
    expect(JSON.stringify(after.assets)).not.toContain("feedback_audio");
    expect(after.assets).toEqual([]);
  });
});
