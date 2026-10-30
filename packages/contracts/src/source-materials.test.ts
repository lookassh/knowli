import { describe, expect, it } from "vitest";
import {
  SourceMaterialDtoSchema,
  SourceMaterialInputSchema,
  SourceMaterialPatchSchema,
  SourceMaterialSummaryDtoSchema,
} from "./source-materials";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const INSTANT = "2026-10-31T10:00:00.000Z";

describe("SourceMaterialInputSchema", () => {
  const valid = { clientRequestId: UUID, title: "Rozdział 4", body: "Fikcyjny tekst rozdziału." };

  it("accepts a title and body and trims both", () => {
    const parsed = SourceMaterialInputSchema.parse({ ...valid, title: "  Rozdział 4  ", body: "\n tekst \n" });
    expect(parsed).toEqual({ clientRequestId: UUID, title: "Rozdział 4", body: "tekst" });
  });

  it("limits the title to 1-120 characters after trimming", () => {
    expect(SourceMaterialInputSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, title: "a".repeat(120) }).success).toBe(true);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, title: "a".repeat(121) }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, title: ` ${"a".repeat(120)} ` }).success).toBe(true);
  });

  it("limits the body to 1-16000 characters after trimming", () => {
    expect(SourceMaterialInputSchema.safeParse({ ...valid, body: "  \n " }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, body: "" }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, body: "a".repeat(16000) }).success).toBe(true);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, body: "a".repeat(16001) }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, body: `\n${"a".repeat(16000)}\n` }).success).toBe(true);
  });

  it("requires a uuid client request id and rejects unknown keys", () => {
    expect(SourceMaterialInputSchema.safeParse({ ...valid, clientRequestId: "nie-uuid" }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ title: valid.title, body: valid.body }).success).toBe(false);
    expect(SourceMaterialInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe("SourceMaterialPatchSchema", () => {
  it("accepts a title-only, body-only or combined patch with trimmed values", () => {
    expect(SourceMaterialPatchSchema.parse({ expectedRevision: 1, title: " Nowy " })).toEqual({
      expectedRevision: 1,
      title: "Nowy",
    });
    expect(SourceMaterialPatchSchema.parse({ expectedRevision: 2, body: " tekst " })).toEqual({
      expectedRevision: 2,
      body: "tekst",
    });
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 3, title: "T", body: "B" }).success).toBe(true);
  });

  it("rejects a patch without title and body", () => {
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
  });

  it("requires an integer expectedRevision of at least 1", () => {
    expect(SourceMaterialPatchSchema.safeParse({ title: "T" }).success).toBe(false);
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 0, title: "T" }).success).toBe(false);
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 1.5, title: "T" }).success).toBe(false);
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: "1", title: "T" }).success).toBe(false);
  });

  it("applies the same limits and rejects unknown keys", () => {
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 1, title: "  " }).success).toBe(false);
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 1, title: "a".repeat(121) }).success).toBe(false);
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 1, body: "a".repeat(16001) }).success).toBe(false);
    expect(SourceMaterialPatchSchema.safeParse({ expectedRevision: 1, title: "T", extra: true }).success).toBe(false);
  });
});

describe("source material DTOs", () => {
  const summary = { id: UUID, title: "Rozdział 4", revision: 2, createdAt: INSTANT, updatedAt: INSTANT, deckCount: 1 };
  const deck = { deckId: UUID2, title: "Lekcja", kind: "lesson", state: "published", copiedRevision: 1, stale: true };

  it("parses the summary and the full DTO with decks", () => {
    expect(SourceMaterialSummaryDtoSchema.parse(summary)).toEqual(summary);
    expect(SourceMaterialDtoSchema.parse({ ...summary, body: "Tekst", decks: [deck] }).decks[0]).toEqual(deck);
    expect(SourceMaterialDtoSchema.safeParse({ ...summary, body: "Tekst", decks: [{ ...deck, copiedRevision: null, stale: false }] }).success).toBe(true);
  });

  it("rejects invalid revisions, kinds, states and counts", () => {
    expect(SourceMaterialSummaryDtoSchema.safeParse({ ...summary, revision: 0 }).success).toBe(false);
    expect(SourceMaterialSummaryDtoSchema.safeParse({ ...summary, deckCount: -1 }).success).toBe(false);
    expect(SourceMaterialDtoSchema.safeParse({ ...summary, body: "T", decks: [{ ...deck, kind: "quiz" }] }).success).toBe(false);
    expect(SourceMaterialDtoSchema.safeParse({ ...summary, body: "T", decks: [{ ...deck, state: "deleted" }] }).success).toBe(false);
    expect(SourceMaterialDtoSchema.safeParse({ ...summary, decks: [] }).success).toBe(false);
  });
});
