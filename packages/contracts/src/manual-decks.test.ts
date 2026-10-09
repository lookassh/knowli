import { describe, expect, it } from "vitest";
import {
  CreateEmptyDeckCommandSchema,
  CreateEmptyDeckResultSchema,
  DraftInputSchema,
  DraftPatchSchema,
} from "./decks";

const deckId = "60dd9545-0fae-4ee5-bd14-4c2c045b99bd";

describe("manual deck creation contract", () => {
  it("trims an optional title and accepts its maximum length", () => {
    expect(CreateEmptyDeckCommandSchema.parse({ deckId, title: "  Zwierzęta  " })).toEqual({
      deckId,
      title: "Zwierzęta",
    });
    expect(CreateEmptyDeckCommandSchema.parse({ deckId }).title).toBeUndefined();
    expect(CreateEmptyDeckCommandSchema.parse({ deckId, title: "a".repeat(200) }).title).toHaveLength(200);
  });

  it("rejects invalid identifiers, blank and overlong titles, and unrelated fields", () => {
    expect(CreateEmptyDeckCommandSchema.safeParse({ deckId: "invalid" }).success).toBe(false);
    expect(CreateEmptyDeckCommandSchema.safeParse({ deckId, title: "   " }).success).toBe(false);
    expect(CreateEmptyDeckCommandSchema.safeParse({ deckId, title: "a".repeat(201) }).success).toBe(false);
    expect(CreateEmptyDeckCommandSchema.safeParse({ deckId, prompt: "angielskie słówka" }).success).toBe(false);
    expect(CreateEmptyDeckCommandSchema.safeParse({ deckId, items: [] }).success).toBe(false);
  });

  it("validates the create response and keeps content drafts nonempty", () => {
    expect(CreateEmptyDeckResultSchema.parse({ deckId })).toEqual({ deckId });
    expect(CreateEmptyDeckResultSchema.safeParse({ deckId: "invalid" }).success).toBe(false);
    expect(DraftInputSchema.safeParse({ title: "Ręczny zestaw", items: [] }).success).toBe(false);
    expect(DraftPatchSchema.safeParse({ expectedEditNumber: 1, items: [] }).success).toBe(false);
  });
});
