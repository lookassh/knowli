import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createChild,
  createLesson,
  createServices,
  createSubjectRegistry,
  deleteChild,
  englishGrammarSubject,
  executeLessonGeneration,
  historyLikeSubject,
  listChildren,
  readGeneration,
  readLessonDeck,
  regenerateObjective,
  updateChild,
  type Services,
} from "@learning/server";
import type { LessonCommand } from "@learning/contracts";
import { buildTestServices, countRows, ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";

describe("profil — zainteresowania", () => {
  beforeEach(async () => {
    await truncateCoreTables();
  });

  it("nowy profil ma pustą listę zainteresowań", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    expect(child.interests).toEqual([]);
    await expect(listChildren(services)).resolves.toEqual([expect.objectContaining({ id: child.id, interests: [] })]);
  });

  it("updateChild zapisuje zainteresowania w podanej kolejności, a pusta lista je czyści", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });

    const updated = await updateChild(services, child.id, { interests: ["piłka nożna", "Minecraft"] });
    expect(updated.interests).toEqual(["piłka nożna", "Minecraft"]);
    await expect(listChildren(services)).resolves.toEqual([
      expect.objectContaining({ id: child.id, interests: ["piłka nożna", "Minecraft"] }),
    ]);

    // zmiana innego pola nie rusza listy
    await updateChild(services, child.id, { avatarKey: "owl" });
    await expect(listChildren(services)).resolves.toEqual([
      expect.objectContaining({ interests: ["piłka nożna", "Minecraft"] }),
    ]);

    const cleared = await updateChild(services, child.id, { interests: [] });
    expect(cleared.interests).toEqual([]);
  });

  it("CHECK odrzuca więcej niż 5 elementów i NULL w tablicy", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    const { pool } = testDatabase();

    await expect(pool.query(
      "UPDATE learning_app.child_profiles SET interests = ARRAY['a','b','c','d','e','f'] WHERE id = $1",
      [child.id],
    )).rejects.toMatchObject({ constraint: "child_profiles_interests_valid" });
    await expect(pool.query(
      "UPDATE learning_app.child_profiles SET interests = ARRAY['a', NULL] WHERE id = $1",
      [child.id],
    )).rejects.toMatchObject({ constraint: "child_profiles_interests_valid" });
    await expect(pool.query(
      "INSERT INTO learning_app.child_profiles (id, display_name, avatar_key, interests) VALUES (gen_random_uuid(), 'Ola', 'cat', ARRAY['a','b','c','d','e','f'])",
    )).rejects.toMatchObject({ constraint: "child_profiles_interests_valid" });

    await expect(pool.query(
      "UPDATE learning_app.child_profiles SET interests = ARRAY['a','b','c','d','e'] WHERE id = $1",
      [child.id],
    )).resolves.toBeDefined();
  });

  it("deleteChild usuwa wiersz razem z listą", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    await updateChild(services, child.id, { interests: ["dinozaury"] });

    await deleteChild(services, child.id);

    expect(await countRows("child_profiles")).toBe(0);
  });
});

const OBJECTIVE_ID = "english_grammar.present_simple.third_person_s";

function lessonServices(fakes: FakeGeneration): Services {
  const { db } = testDatabase();
  return createServices({
    db,
    clock: new ManualClock(),
    media: fakes.settings,
    generation: fakes.deps,
    subjects: createSubjectRegistry([englishGrammarSubject, historyLikeSubject]),
  });
}

function grammarCommand(overrides: Partial<LessonCommand> = {}): LessonCommand {
  return {
    subjectId: "english_grammar",
    topicId: "present_simple",
    objectiveIds: [OBJECTIVE_ID],
    material: "He plays football. She watches TV. They study English every day.",
    clientRequestId: randomUUID(),
    ...overrides,
  };
}

describe("lekcja — migawka tematów", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await truncateCoreTables();
    const { pool } = testDatabase();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  async function world(): Promise<{ fakes: FakeGeneration; services: Services }> {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    return { fakes, services: lessonServices(fakes) };
  }

  async function snapshots(deckId: string, runId: string) {
    const { pool } = testDatabase();
    const context = await pool.query(
      "select lesson_context ? 'interests' as has, lesson_context->'interests' as value from learning_app.deck_versions where deck_id = $1",
      [deckId],
    );
    const input = await pool.query(
      "select input ? 'interests' as has, input->'interests' as value from learning_app.generation_runs where id = $1",
      [runId],
    );
    return { context: context.rows[0] as { has: boolean; value: unknown }, input: input.rows[0] as { has: boolean; value: unknown } };
  }

  it("createLesson zapisuje migawkę w kontekście i w runie; bez pola nie ma klucza", async () => {
    const { services } = await world();

    const withThemes = await createLesson(services, grammarCommand({ interests: ["piłka nożna"] }));
    const stored = await snapshots(withThemes.deckId, withThemes.runId);
    expect(stored.context).toEqual({ has: true, value: ["piłka nożna"] });
    expect(stored.input).toEqual({ has: true, value: ["piłka nożna"] });

    const without = await createLesson(services, grammarCommand());
    const bare = await snapshots(without.deckId, without.runId);
    expect(bare.context.has).toBe(false);
    expect(bare.input.has).toBe(false);
  });

  it("przedmiot bez reguły odrzuca zainteresowania przed zapisem czegokolwiek", async () => {
    const { services } = await world();

    await expect(createLesson(services, {
      subjectId: historyLikeSubject.id,
      topicId: historyLikeSubject.topics[0]!.id,
      objectiveIds: [historyLikeSubject.topics[0]!.objectives[0]!.id],
      material: "Tekst.",
      interests: ["piłka nożna"],
      clientRequestId: randomUUID(),
    })).rejects.toMatchObject({ code: "validation" });

    expect(await countRows("decks")).toBe(0);
    expect(await countRows("deck_versions")).toBe(0);
    expect(await countRows("generation_runs")).toBe(0);
  });

  it("wykonanie i dogenerowanie niosą migawkę do LLM, a żądanie nie zawiera danych dziecka", async () => {
    const { fakes, services } = await world();
    const child = await createChild(services, { displayName: "Zuzanna Testowa-Fikcyjna", avatarKey: "fox", birthYear: 2017 });
    const themes = ["piłka nożna", "dinozaury"];
    await updateChild(services, child.id, { interests: themes });

    const { runId, deckId } = await createLesson(services, grammarCommand({ interests: themes }));
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");

    expect(fakes.llm.lessonRequests.length).toBeGreaterThan(0);
    for (const request of fakes.llm.lessonRequests) {
      expect(request.interests).toEqual(themes);
      expect(request.promptProfile.interestsRule).toEqual(expect.any(String));
    }

    // Profil znika, a dogenerowanie dalej korzysta z migawki lekcji.
    await deleteChild(services, child.id);
    const before = fakes.llm.lessonRequests.length;
    const draft = (await readLessonDeck(services, deckId)).draft!;
    const topUp = await regenerateObjective(services, {
      deckId, objectiveId: OBJECTIVE_ID, count: 2, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID(),
    });
    const topUpStored = await snapshots(deckId, topUp.runId);
    expect(topUpStored.input).toEqual({ has: true, value: themes });
    await executeLessonGeneration(services, topUp.runId);
    expect(fakes.llm.lessonRequests.length).toBeGreaterThan(before);
    for (const request of fakes.llm.lessonRequests.slice(before)) expect(request.interests).toEqual(themes);

    const serialized = JSON.stringify(fakes.llm.lessonRequests);
    expect(serialized).not.toContain("Zuzanna");
    expect(serialized).not.toContain("Testowa-Fikcyjna");
    expect(serialized).not.toContain("2017");
    expect(serialized).not.toContain(child.id);
  });
});

afterAll(async () => {
  const { pool } = testDatabase();
  await pool.end();
});
