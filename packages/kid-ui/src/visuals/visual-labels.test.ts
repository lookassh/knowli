import { describe, expect, it } from "vitest";
import { formatVisualCountLabel } from "./visual-labels";

describe("accessible labels for deterministic visuals", () => {
  it.each([
    [1, "1 element"],
    [2, "2 elementy"],
    [4, "4 elementy"],
    [5, "5 elementów"],
    [12, "12 elementów"],
    [22, "22 elementy"],
  ])("odmienia rzeczownik dla %i", (count, label) => {
    expect(formatVisualCountLabel(count)).toBe(label);
  });
});
