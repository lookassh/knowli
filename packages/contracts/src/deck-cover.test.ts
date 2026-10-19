import { describe, expect, it } from "vitest";
import { DeckCoverCommandSchema, DeckDtoSchema, DeckSettingsPatchSchema, DeckSummaryDtoSchema } from "./decks";
import { KidDeckDtoSchema } from "./kid";

const id = "10000000-0000-4000-8000-000000000001";

describe("deck cover contracts", () => {
  it("accepts an older kid DTO without a cover and keeps the legacy visual default", () => {
    const parsed = KidDeckDtoSchema.parse({
      deckId: id, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0,
      testDate: null, recommended: false,
    });
    expect(parsed.coverVisual).toBeNull();
    expect(parsed.coverAssetId).toBeUndefined();
  });

  it("accepts an older parent summary without a cover id", () => {
    const parsed = DeckSummaryDtoSchema.parse({
      deckId: id, title: "Dni tygodnia", state: "draft", vocabularyFormat: "standard",
      editableVersionId: null, publishedVersionId: null,
    });
    expect(parsed.coverAssetId).toBeUndefined();
  });

  it("accepts an optional opaque cover id on kid and parent deck DTOs", () => {
    const kid = KidDeckDtoSchema.parse({
      deckId: id, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0,
      testDate: null, recommended: false, coverAssetId: id,
    });
    expect(kid.coverAssetId).toBe(id);
    expect(DeckDtoSchema.parse({ id, title: "Dni", state: "draft", draft: null, published: null, generation: null, assignments: [], coverAssetId: id }).coverAssetId).toBe(id);
  });

  it("only accepts the explicit clear parent command", () => {
    expect(DeckCoverCommandSchema.parse({ action: "clear" })).toEqual({ action: "clear" });
    expect(DeckCoverCommandSchema.safeParse({ action: "upload", url: "https://example.test/image.png" }).success).toBe(false);
  });

  it("accepts an older deck DTO without sessionTaskBudget and defaults to 20", () => {
    const summary = DeckSummaryDtoSchema.parse({
      deckId: id, title: "Dni tygodnia", state: "published", vocabularyFormat: "standard",
      editableVersionId: null, publishedVersionId: id,
    });
    expect(summary.sessionTaskBudget).toBe(20);
    const detail = DeckDtoSchema.parse({ id, title: "Dni", state: "published", draft: null, published: null, generation: null, assignments: [] });
    expect(detail.sessionTaskBudget).toBe(20);
    expect(DeckSummaryDtoSchema.parse({ ...summary, sessionTaskBudget: 7 }).sessionTaskBudget).toBe(7);
    expect(DeckDtoSchema.parse({ ...detail, sessionTaskBudget: 7 }).sessionTaskBudget).toBe(7);
  });

  it("deck settings patch requires sessionTaskBudget within 1–100", () => {
    expect(DeckSettingsPatchSchema.parse({ sessionTaskBudget: 7 })).toEqual({ sessionTaskBudget: 7 });
    expect(DeckSettingsPatchSchema.parse({ sessionTaskBudget: 1 })).toEqual({ sessionTaskBudget: 1 });
    expect(DeckSettingsPatchSchema.parse({ sessionTaskBudget: 100 })).toEqual({ sessionTaskBudget: 100 });
    for (const invalid of [0, 101, 7.5, "7", undefined, null]) {
      const input = invalid === undefined ? {} : { sessionTaskBudget: invalid };
      expect(DeckSettingsPatchSchema.safeParse(input).success, `sessionTaskBudget=${String(invalid)}`).toBe(false);
    }
  });
});
