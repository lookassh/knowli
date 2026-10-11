import { describe, expect, it } from "vitest";
import { ensureActivityDeck } from "./learning-overview";

describe("learning overview daily deck aggregation", () => {
  it("keeps historical versions of one deck in separate buckets", () => {
    const day = { decks: new Map() } as Parameters<typeof ensureActivityDeck>[0];
    const row = {
      childId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      deckId: "33333333-3333-4333-8333-333333333333",
      deckVersionId: "44444444-4444-4444-8444-444444444444",
      deckTitle: "Dni v1", deckVersionNumber: 1,
    } as Parameters<typeof ensureActivityDeck>[1];

    ensureActivityDeck(day, row);
    ensureActivityDeck(day, { ...row, deckVersionId: "55555555-5555-4555-8555-555555555555", deckTitle: "Dni v2", deckVersionNumber: 2 });

    expect([...day.decks.values()].map(({ deckVersionId }) => deckVersionId).sort()).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]);
  });
});
