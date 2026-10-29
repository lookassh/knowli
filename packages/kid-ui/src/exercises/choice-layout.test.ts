import { describe, expect, it } from "vitest";
import { isShortChoiceSet } from "./choice-layout";

describe("isShortChoiceSet", () => {
  it("accepts exactly four short labels", () => {
    expect(isShortChoiceSet(["noga", "ręka", "głowa", "oko"])).toBe(true);
  });

  it("accepts a label of exactly 10 characters and rejects 11", () => {
    expect(isShortChoiceSet(["pomarańcza", "a", "b", "c"])).toBe(true);
    expect(isShortChoiceSet(["abcdefghijk", "a", "b", "c"])).toBe(false);
  });

  it("requires exactly four options", () => {
    expect(isShortChoiceSet(["a", "b", "c"])).toBe(false);
    expect(isShortChoiceSet(["a", "b", "c", "d", "e"])).toBe(false);
    expect(isShortChoiceSet([])).toBe(false);
  });

  it("counts Polish letters as one character each and ignores surrounding whitespace", () => {
    expect(isShortChoiceSet(["żółć".repeat(2) + "żół", "a", "b", "c"])).toBe(false);
    expect(isShortChoiceSet(["żółć".repeat(2) + "żó", "a", "b", "c"])).toBe(true);
    expect(isShortChoiceSet(["  abcdefghij  ", "a", "b", "c"])).toBe(true);
  });
});
