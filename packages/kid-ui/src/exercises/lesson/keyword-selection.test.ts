import { describe, expect, it } from "vitest";
import { toggleKeyword } from "./keyword-selection";

describe("toggleKeyword", () => {
  it("adds and removes a concept", () => {
    const one = toggleKeyword([], "a", 3);
    expect(one).toEqual(["a"]);
    expect(toggleKeyword(one, "a", 3)).toEqual([]);
  });

  it("never selects more than maxSelected, but still allows removing", () => {
    const full = ["a", "b", "c"];
    expect(toggleKeyword(full, "d", 3)).toBe(full);
    expect(toggleKeyword(full, "b", 3)).toEqual(["a", "c"]);
  });
});
