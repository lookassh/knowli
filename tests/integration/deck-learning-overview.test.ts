import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listKidDecks } from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { mockTestDeck } from "./mock-test-helpers";

const { pool } = testDatabase();
let statements: string[] | null = null;
pool.on("connect", client => {
  const original = client.query.bind(client) as (...args: unknown[]) => unknown;
  client.query = ((...args: unknown[]) => {
    const input = args[0] as string | { text?: string };
    if (statements) statements.push(typeof input === "string" ? input : input.text ?? "");
    return original(...args);
  }) as typeof client.query;
});

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await truncateCoreTables(); });

describe("model odczytu listy zestawów", () => {
  it("czyta gotowe projekcje w spójnej read-only migawce bez odtwarzania historii", async () => {
    const { services } = buildTestServices();
    const world = await mockTestDeck(services, 3, false);
    statements = [];
    try {
      const decks = await listKidDecks(services, world.childId, { microphoneEnabled: false });
      expect(decks).toHaveLength(1);
      expect(decks[0]).toMatchObject({ deckId: world.deckId, itemCount: 3, recommended: true });
      expect(statements.length).toBeGreaterThan(5);
      const forbidden = statements.filter(sql =>
        /\b(?:attempts|assessments|event_exposures|learning_events|session_tasks)\b|public_prompt|\b(?:insert|update|delete)\s+(?:into|from)?/i.test(sql));
      expect(forbidden).toEqual([]);
      expect(statements.some(sql => /begin.*repeatable read.*read only/i.test(sql))).toBe(true);
    } finally {
      statements = null;
    }
  });
});
