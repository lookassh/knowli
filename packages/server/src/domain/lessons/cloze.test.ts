import { describe, expect, it } from "vitest";
import { clozeAnswer, clozeGapCount, clozeParts, fillCloze } from "./cloze";

describe("tekst z lukami (design szkoły §13)", () => {
  it("tnie tekst na fragmenty między lukami (2+ podkreśleń)", () => {
    expect(clozeParts("___ pobiera __ i ____.")).toEqual(["", " pobiera ", " i ", "."]);
    expect(clozeGapCount("a ___ b ___ c")).toBe(2);
    expect(clozeGapCount("bez luk_")).toBe(0);
  });

  it("wstawia słowa w kolejności luk, a brakujące zostawia jako lukę", () => {
    expect(fillCloze("Roślina pobiera ___ i ___.", ["wodę", "sole"])).toBe("Roślina pobiera wodę i sole.");
    expect(fillCloze("___ i ___", ["woda"])).toBe("woda i ___");
  });

  it("odpowiedź kanoniczna to słowa luk złączone przecinkiem", () => {
    expect(clozeAnswer({ gapAnswers: ["wodę", "sole"] })).toBe("wodę, sole");
    expect(clozeAnswer({})).toBe("");
  });
});
