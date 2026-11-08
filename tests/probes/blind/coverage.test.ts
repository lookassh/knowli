import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseForms, coverageOf } = require("./coverage.cjs") as {
  parseForms(text: string): string[][];
  coverageOf(forms: string[][], dump: unknown): { total: number; missing: string[]; leaks: number };
};

describe("coverage.cjs (etap 5)", () => {
  const forms = parseForms("hat|hats\n\nboots|boot\nI'm wearing|I am wearing\n");

  it("matches whole words only, case-insensitively", () => {
    // „hat” w „What's” nie liczy się jako pokrycie.
    const dump = { objectives: [{ card: "[Zwroty] What's the weather like?", cards: [] }], exercises: [{ answer: "I'M WEARING boots." }] };
    expect(coverageOf(forms, dump)).toEqual({ total: 3, missing: ["hat"], leaks: 0 });
  });

  it("accepts any alternative and typographic apostrophes, and counts leaks from the dump", () => {
    const dump = { objectives: [{ cards: [{ title: "Słowa", body: "hats — kapelusze" }] }], exercises: [{ pairs: [{ left: "boot", right: "but" }] }, { answer: "I’m wearing a hat." }], exposureLeaks: [{}] };
    expect(coverageOf(forms, dump)).toEqual({ total: 3, missing: [], leaks: 1 });
  });
});
