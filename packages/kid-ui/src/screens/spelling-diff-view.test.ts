import { describe, expect, it } from "vitest";
import { joinedText } from "./spelling-diff-view";

describe("joinedText — sklejony zapis segmentów diffu (issue #9)", () => {
  it("skleja segmenty w pełny zapis", () => {
    expect(
      joinedText([
        { text: "We", state: "plain" },
        { text: "nd", state: "pill" },
        { text: "esday", state: "plain" },
      ]),
    ).toBe("Wendesday");
  });

  it("pusta lista daje pusty tekst", () => {
    expect(joinedText([])).toBe("");
  });
});
