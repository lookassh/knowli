import { describe, expect, it } from "vitest";
import { alignCodePoints, editDistance } from "./text-distance";

describe("alignCodePoints — restricted Damerau–Levenshtein z alignmentem (wydzielone ze spelling-diff)", () => {
  it("identyczne słowa: odległość 0, same dopasowania", () => {
    const { distance, steps } = alignCodePoints("cat", "cat");
    expect(distance).toBe(0);
    expect(steps).toEqual([
      { op: "match", a: 0, b: 0 },
      { op: "match", a: 1, b: 1 },
      { op: "match", a: 2, b: 2 },
    ]);
  });

  it("podstawienie: jedna operacja substitute", () => {
    const { distance, steps } = alignCodePoints("cat", "cot");
    expect(distance).toBe(1);
    expect(steps).toContainEqual({ op: "substitute", a: 1, b: 1 });
  });

  it("wstawienie we wzorcu (dziecko ma mniej liter) → insert", () => {
    const { distance, steps } = alignCodePoints("cat", "cart");
    expect(distance).toBe(1);
    expect(steps).toContainEqual({ op: "insert", b: 2 });
  });

  it("usunięcie z wpisu (dziecko ma więcej liter) → delete", () => {
    const { distance, steps } = alignCodePoints("xcat", "cat");
    expect(distance).toBe(1);
    expect(steps).toContainEqual({ op: "delete", a: 0 });
  });

  it("przestawienie pary sąsiednich znaków liczy się jako jedna operacja", () => {
    const { distance, steps } = alignCodePoints("acb", "abc");
    expect(distance).toBe(1);
    expect(steps).toContainEqual({ op: "transpose", a: 1, b: 1 });
  });

  it("wielkość liter jest ignorowana (porównanie po lowercase)", () => {
    expect(alignCodePoints("CAT", "cat").distance).toBe(0);
    expect(alignCodePoints("Wednesday", "wednesday").distance).toBe(0);
  });

  it("punkty kodowe spoza BMP są jedną jednostką alignmentu", () => {
    // 😀 i 🎉 to po jednym punkcie kodowym (dwie jednostki UTF-16 każdy).
    const { distance, steps } = alignCodePoints("a😀b", "a🎉b");
    expect(distance).toBe(1);
    expect(steps).toEqual([
      { op: "match", a: 0, b: 0 },
      { op: "substitute", a: 1, b: 1 },
      { op: "match", a: 2, b: 2 },
    ]);
  });
});

describe("editDistance — sama odległość bez alignmentu", () => {
  it("zwraca odległość alignCodePoints", () => {
    expect(editDistance("cat", "cat")).toBe(0);
    expect(editDistance("cat", "cot")).toBe(1);
    expect(editDistance("Wednesday", "Wenesday")).toBe(1);
    expect(editDistance("acb", "abc")).toBe(1);
  });

  it("ignoruje wielkość liter", () => {
    expect(editDistance("MILK", "milk")).toBe(0);
  });
});
