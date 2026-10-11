import { describe, expect, it } from "vitest";
import { MASTERY_STAR_MAX, starsForFraction } from "./stars";

describe("starsForFraction — skala 0–6 (SPEC §6, jak w omówieniu kartkówki §19.1)", () => {
  it("zwraca 0 gwiazdek dla pustego zestawu i zerowego postępu", () => {
    expect(starsForFraction(0, 0)).toBe(0);
    expect(starsForFraction(0, 10)).toBe(0);
  });

  it("przyznaje pierwszą gwiazdkę dopiero po osiągnięciu 1/6 drogi", () => {
    expect(starsForFraction(1, 10)).toBe(0); // 10% < 16,7%
    expect(starsForFraction(2, 10)).toBe(1); // 20% ≥ 16,7%
  });

  it("liczy z pełnego ułamka, nie z zaokrąglonego procentu", () => {
    expect(starsForFraction(5, 6)).toBe(5); // próg piątej gwiazdki dokładnie
    expect(starsForFraction(3, 7)).toBe(2); // floor(18/7) — przypadek z deck-screen.test.ts
  });

  it("pełne opanowanie to maksimum 6 gwiazdek, bez przekroczenia", () => {
    expect(starsForFraction(10, 10)).toBe(MASTERY_STAR_MAX);
    expect(starsForFraction(12, 10)).toBe(MASTERY_STAR_MAX);
  });
});
