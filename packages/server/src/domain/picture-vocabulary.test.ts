import { describe, expect, it } from "vitest";
import type { VocabularyItemInput } from "@learning/contracts";

const word = (visualType: VocabularyItemInput["visualType"], visualData?: Record<string, unknown>): VocabularyItemInput => ({
  source: "czerwony",
  target: "red",
  acceptedAnswers: ["red"],
  locales: { source: "pl-PL", target: "en-GB" },
  visualType,
  ...(visualData === undefined ? {} : { visualData }),
});

async function loadValidator() {
  try {
    return await import("./picture-vocabulary");
  } catch {
    return null;
  }
}

describe("walidacja zestawu obrazkowego", () => {
  it("akceptuje tylko kompletne reprezentacje image, color i number", async () => {
    const validator = await loadValidator();
    expect(validator).not.toBeNull();
    if (!validator) return;
    expect(() => validator.validateVocabularyFormatItems("picture", [word("image")])).not.toThrow();
    expect(() => validator.validateVocabularyFormatItems("picture", [word("color", { color: "#ff0000" })])).not.toThrow();
    expect(() => validator.validateVocabularyFormatItems("picture", [word("number", { count: 1 })])).not.toThrow();
    expect(() => validator.validateVocabularyFormatItems("picture", [word("none")])).toThrow();
    expect(() => validator.validateVocabularyFormatItems("picture", [word("sequence", { position: 1, total: 7, sequenceStart: "Monday" })])).toThrow();
    expect(() => validator.validateVocabularyFormatItems("picture", [word("color", { color: "red" })])).toThrow();
    expect(() => validator.validateVocabularyFormatItems("standard", [word("none")])).not.toThrow();
  });
});
