import { describe, expect, it } from "vitest";
import { splitGap } from "./gap";

describe("splitGap — podział zdania wokół luki (lesson_gap)", () => {
  it("dzieli na część przed i po pierwszym ciągu podkreśleń", () => {
    expect(splitGap("He ___ (play).")).toEqual({ before: "He ", after: " (play).", hasGap: true });
  });

  it("obsługuje lukę na początku i na końcu", () => {
    expect(splitGap("___ plays football.")).toEqual({ before: "", after: " plays football.", hasGap: true });
    expect(splitGap("She plays ___")).toEqual({ before: "She plays ", after: "", hasGap: true });
  });

  it("bez luki zwraca całe zdanie przed polem (hasGap=false)", () => {
    expect(splitGap("Brak luki tutaj.")).toEqual({ before: "Brak luki tutaj.", after: "", hasGap: false });
  });

  it("dzieli tylko na pierwszej luce", () => {
    expect(splitGap("A ___ i B ___")).toEqual({ before: "A ", after: " i B ___", hasGap: true });
  });
});
