import { describe, expect, it } from "vitest";
import { responseOutcome } from "./parent-work-card";

describe("responseOutcome", () => {
  it("łączy oceny umiejętności jednej odpowiedzi", () => {
    expect(responseOutcome("text", new Set(["correct"]))).toBe("correct");
    expect(responseOutcome("text", new Set(["incorrect"]))).toBe("incorrect");
    // treść dobra, pisownia błędna
    expect(responseOutcome("text", new Set(["correct", "incorrect"]))).toBe("partial");
    // ocena nieoceniona nie rozstrzyga poprawności
    expect(responseOutcome("text", new Set(["correct", "unassessed"]))).toBe("correct");
    expect(responseOutcome("audio", new Set(["unassessed"]))).toBeNull();
    expect(responseOutcome("choice", undefined)).toBeNull();
  });

  it("pominięcie i „Nie pamiętam” nie mają wyniku poprawności", () => {
    expect(responseOutcome("skip", new Set(["incorrect"]))).toBeNull();
    expect(responseOutcome("dont_remember", new Set(["incorrect"]))).toBeNull();
  });
});
