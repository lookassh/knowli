import { describe, expect, it } from "vitest";
import { computeTargetKey, normalizeTargetText } from "./target-key";

describe("normalizeTargetText", () => {
  it("przycina zewnętrzne spacje i zamienia na małe litery", () => {
    expect(normalizeTargetText("  Monday ")).toBe("monday");
  });

  it("normalizuje do Unicode NFC", () => {
    const composed = "ą"; // U+0105
    const decomposed = "a\u0328"; // a + ogonek
    expect(normalizeTargetText(composed)).toBe(normalizeTargetText(decomposed));
  });
});

describe("computeTargetKey", () => {
  it("łączy znormalizowany tekst z locale", () => {
    const key = computeTargetKey(" Monday ", "en-GB");
    expect(key).toBe(computeTargetKey("monday", "en-GB"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("różne locale daje różny klucz", () => {
    expect(computeTargetKey("monday", "en-GB")).not.toBe(computeTargetKey("monday", "en-US"));
  });

  it("różny tekst daje różny klucz", () => {
    expect(computeTargetKey("monday", "en-GB")).not.toBe(computeTargetKey("tuesday", "en-GB"));
  });
});
