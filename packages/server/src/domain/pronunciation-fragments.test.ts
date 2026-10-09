import { describe, expect, it } from "vitest";
import { buildPronunciationFragments, letterGroups } from "./pronunciation-fragments";

const bands = { correctMinScore: 70, partialMinScore: 50 };

function phonemes(entries: Array<[string, number | null]>) {
  return entries.map(([phoneme, accuracyScore]) => ({ phoneme, accuracyScore }));
}

describe("letterGroups", () => {
  it("tnie digrafy zachłannie", () => {
    expect(letterGroups("cherry")).toEqual(["ch", "e", "rr", "y"]);
    expect(letterGroups("monday")).toEqual(["m", "o", "n", "d", "ay"]);
    expect(letterGroups("ship")).toEqual(["sh", "i", "p"]);
  });
});

describe("buildPronunciationFragments", () => {
  it("zgrane fonemy dają scalone zielone grupy", () => {
    expect(
      buildPronunciationFragments(
        "cherry",
        { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", 96], ["ɛ", 94], ["r", 95], ["i", 96]]) },
        bands,
        "correct",
      ),
    ).toEqual([{ text: "cherry", verdict: "good" }]);
  });

  it("słaby fonem dzieli słowo na good i almost", () => {
    expect(
      buildPronunciationFragments(
        "cherry",
        { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", 96], ["ɛ", 40], ["r", 95], ["i", 96]]) },
        bands,
        "correct",
      ),
    ).toEqual([
      { text: "ch", verdict: "good" },
      { text: "e", verdict: "almost" },
      { text: "rry", verdict: "good" },
    ]);
  });

  it("symbole literowe i końcowe nieme e dopasowują się", () => {
    expect(
      buildPronunciationFragments(
        "grape",
        { text: "grape", errorType: null, phonemes: phonemes([["g", 96], ["r", 96], ["eɪ", 96], ["p", 96]]) },
        bands,
        "correct",
      ),
    ).toEqual([{ text: "grape", verdict: "good" }]);
  });

  it("ErrorType i za mało fonemów dają cały wyraz", () => {
    expect(
      buildPronunciationFragments("cherry", { text: "cherry", errorType: "Mispronunciation", phonemes: phonemes([["tʃ", 96]]) }, bands, "partial"),
    ).toEqual([{ text: "cherry", verdict: "almost" }]);
    expect(
      buildPronunciationFragments("no", { text: "no", errorType: null, phonemes: phonemes([["n", 96]]) }, bands, "correct"),
    ).toEqual([{ text: "no", verdict: "good" }]);
  });

  it("nieudane dopasowanie liter do fonemów daje cały wyraz", () => {
    expect(
      buildPronunciationFragments(
        "apple",
        { text: "apple", errorType: null, phonemes: phonemes([["æ", 96], ["p", 96], ["ə", 96], ["l", 96]]) },
        bands,
        "correct",
      ),
    ).toEqual([{ text: "apple", verdict: "good" }]);
  });

  it("brak słowa daje cały wyraz z werdyktem bandu", () => {
    expect(buildPronunciationFragments("cherry", undefined, bands, "partial")).toEqual([
      { text: "cherry", verdict: "almost" },
    ]);
  });
});
