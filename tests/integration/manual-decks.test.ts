import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createEmptyDeck,
  createServices,
  editDraft,
  omitRevisionAsset,
  publishDraft,
  readDeck,
  runDueGenerationWork,
  type Services,
} from "@learning/server";
import { fakeGeneration } from "./fakes";
import { ManualClock, testDatabase } from "./helpers";

const { db, pool } = testDatabase();
const disposers: Array<() => Promise<void>> = [];

async function count(table: string): Promise<number> {
  const result = await pool.query(`select count(*)::int as count from learning_app.${table}`);
  return result.rows[0]!.count as number;
}

async function expectValidation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeDefined();
}

describe("ręczne tworzenie pustego zestawu (integracja)", () => {
  let services: Services;
  let llmRequests: unknown[];

  beforeEach(async () => {
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
       learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
       learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    services = createServices({
      db,
      clock: new ManualClock(),
      media: fakes.settings,
      generation: fakes.deps,
    });
    llmRequests = fakes.llm.requests;
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a persistent empty draft without generation, cards, assets or skill history", async () => {
    const deckId = randomUUID();
    const created = await createEmptyDeck(services, { deckId });

    expect(created).toEqual({ deckId, created: true });
    expect(await readDeck(services, deckId)).toMatchObject({
      id: deckId,
      title: "Nowy zestaw",
      state: "draft",
      generation: null,
      published: null,
      draft: { deckId, editNumber: 1, status: "draft", title: "Nowy zestaw", items: [], assets: [] },
    });
    await expect(count("learning_items")).resolves.toBe(0);
    await expect(count("item_revisions")).resolves.toBe(0);
    await expect(count("skill_versions")).resolves.toBe(0);
    await expect(count("media_assets")).resolves.toBe(0);
    await expect(count("generation_runs")).resolves.toBe(0);
    expect(llmRequests).toHaveLength(0);
  });

  it("deduplicates simultaneous creation and does not reset an existing draft", async () => {
    const deckId = randomUUID();
    const attempts = await Promise.all([
      createEmptyDeck(services, { deckId, title: "Zwierzęta" }),
      createEmptyDeck(services, { deckId, title: "Kolory" }),
    ]);

    expect(attempts.filter((attempt) => attempt.created)).toHaveLength(1);
    expect(await count("decks")).toBe(1);
    expect(await count("deck_versions")).toBe(1);
    const current = await readDeck(services, deckId);
    const winner = current.title;
    await editDraft(services, current.draft!.id, {
      title: "Własny tytuł",
      expectedEditNumber: current.draft!.editNumber,
    });

    expect(await createEmptyDeck(services, { deckId, title: "Nie nadpisuj" })).toEqual({
      deckId,
      created: false,
    });
    expect(await readDeck(services, deckId)).toMatchObject({
      title: winner,
      draft: { title: "Własny tytuł", editNumber: 2 },
    });
  });

  it("rejects an invalid title before writing either row", async () => {
    const deckId = randomUUID();
    await expectValidation(createEmptyDeck(services, { deckId, title: "  " }));
    await expectValidation(createEmptyDeck(services, { deckId, title: "a".repeat(201) }));
    expect(await count("decks")).toBe(0);
    expect(await count("deck_versions")).toBe(0);
  });

  it("keeps an empty deck unpublished until a complete card and its audio are ready", async () => {
    const deckId = randomUUID();
    const empty = await createEmptyDeck(services, { deckId, title: "Zwierzęta" });
    const before = await readDeck(services, deckId);
    await expect(publishDraft(services, before.draft!.id, before.draft!.editNumber))
      .rejects.toMatchObject({ code: "validation" });

    const saved = await editDraft(services, before.draft!.id, {
      expectedEditNumber: before.draft!.editNumber,
      items: [{
        source: "kot",
        target: "cat",
        acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" },
        visualType: "image",
      }],
    });
    expect(saved.items).toHaveLength(1);
    expect(saved.assets).toContainEqual(expect.objectContaining({ role: "target_audio", state: "pending" }));
    await omitRevisionAsset(services, { draftId: saved.id, itemRevisionId: saved.items[0]!.revisionId });
    expect(await count("skill_versions")).toBe(5);
    await expect(publishDraft(services, saved.id, saved.editNumber))
      .rejects.toMatchObject({ code: "validation" });

    await runDueGenerationWork(services);
    const published = await publishDraft(services, saved.id, saved.editNumber);
    expect(published.deckVersionId).toBe(saved.id);
    expect(await readDeck(services, deckId)).toMatchObject({ state: "published", published: { items: [{ source: "kot" }] } });
    expect(await createEmptyDeck(services, { deckId, title: "Nie resetuj publikacji" })).toEqual({ deckId, created: false });
    expect(await readDeck(services, deckId)).toMatchObject({ title: "Zwierzęta", published: { id: saved.id } });
    expect(llmRequests).toHaveLength(0);
    expect(empty.deckId).toBe(deckId);
  });
});
