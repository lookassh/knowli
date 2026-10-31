import { describe, expect, it } from "vitest";
import { trimTrailing } from "./text";

const PUNCTUATION = new Set([".", "!", "?", "…", " "]);

describe("trimTrailing", () => {
  it("ucina końcową interpunkcję i spacje, zostawia środek tekstu", () => {
    expect(trimTrailing("It's snowing. !", PUNCTUATION)).toBe("It's snowing");
    expect(trimTrailing("Mr. Beetle", PUNCTUATION)).toBe("Mr. Beetle");
    expect(trimTrailing("...", PUNCTUATION)).toBe("");
    expect(trimTrailing("", PUNCTUATION)).toBe("");
  });

  it("długi ciąg spacji w środku nie spowalnia (bez nawrotów)", () => {
    const text = `a${" ".repeat(100_000)}b`;
    expect(trimTrailing(text, PUNCTUATION)).toBe(text);
  });
});
