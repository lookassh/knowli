import { describe, expect, it } from "vitest";
import { isShortChoiceSet } from "./choice-layout";

describe("isShortChoiceSet", () => {
  it("accepts exactly four short labels", () => {
    expect(isShortChoiceSet(["noga", "ręka", "głowa", "oko"])).toBe(true);
  });

  it("accepts a label of exactly 14 characters and rejects 15", () => {
    expect(isShortChoiceSet(["abcdefghijklmn", "a", "b", "c"])).toBe(true);
    expect(isShortChoiceSet(["abcdefghijklmno", "a", "b", "c"])).toBe(false);
  });

  it("requires exactly four options", () => {
    expect(isShortChoiceSet(["a", "b", "c"])).toBe(false);
    expect(isShortChoiceSet(["a", "b", "c", "d", "e"])).toBe(false);
    expect(isShortChoiceSet([])).toBe(false);
  });

  it("counts Polish letters as one character each and ignores surrounding whitespace", () => {
    expect(isShortChoiceSet(["żółć".repeat(3) + "żół", "a", "b", "c"])).toBe(false);
    expect(isShortChoiceSet(["żółć".repeat(3) + "żó", "a", "b", "c"])).toBe(true);
    expect(isShortChoiceSet(["  abcdefghijklmn  ", "a", "b", "c"])).toBe(true);
  });
});
