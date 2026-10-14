import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "./helpers";

const { pool } = testDatabase();

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
