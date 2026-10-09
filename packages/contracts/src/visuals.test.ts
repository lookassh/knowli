import { describe, expect, it } from "vitest";
import { VocabularyItemInputSchema } from "./decks";

const base = {
  source: "jedenascie",
  target: "Eleven",
  acceptedAnswers: [],
  locales: { source: "pl-PL", target: "en-GB" },
};

describe("deterministic visual data contract", () => {
  it("accepts a count that can be rendered as a number visualization", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        visualType: "number",
        visualData: { count: 11 },
      }).success,
    ).toBe(true);
  });

  it("rejects visual data whose count cannot represent the target quantity", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        visualType: "number",
        visualData: { count: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects a count that conflicts with a known English number word", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        target: "Eleven",
        visualType: "number",
        visualData: { count: 12 },
      }).success,
    ).toBe(false);
  });

  it("rejects a color value that conflicts with a known English color word", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        target: "Red",
        visualType: "color",
        visualData: { color: "#0000ff" },
      }).success,
    ).toBe(false);
  });

  it("requires explicit data when an item selects a deterministic visual type", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        visualType: "number",
      }).success,
    ).toBe(false);
  });

  it("rejects a sequence position beyond its total length", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        source: "poniedzialek",
        target: "Monday",
        visualType: "sequence",
        visualData: { position: 8, total: 7 },
      }).success,
    ).toBe(false);
  });

  it("keeps the sequence start marker from the vocabulary contract", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        source: "poniedzialek",
        target: "Monday",
        visualType: "sequence",
        visualData: { position: 1, total: 7, sequenceStart: "Monday" },
      }).success,
    ).toBe(true);
  });

  it("rejects weekday sequence data whose position conflicts with the English target", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        target: "Monday",
        visualType: "sequence",
        visualData: { position: 2, total: 7, sequenceStart: "Monday" },
      }).success,
    ).toBe(false);
  });

  it("requires a sequence start marker so the axis has a defined order", () => {
    expect(
      VocabularyItemInputSchema.safeParse({
        ...base,
        target: "Monday",
        visualType: "sequence",
        visualData: { position: 1, total: 7 },
      }).success,
    ).toBe(false);
  });
});
