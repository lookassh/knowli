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
    ).toEqual([{ text: "grap", verdict: "good" }, { text: "e", verdict: "unknown" }]);
  });

  it("brak precyzyjnych danych daje neutralny cały wyraz", () => {
    expect(
      buildPronunciationFragments("cherry", { text: "cherry", errorType: "Mispronunciation", phonemes: phonemes([["tʃ", 96]]) }, bands, "partial"),
    ).toEqual([{ text: "cherry", verdict: "unknown" }]);
    expect(
      buildPronunciationFragments("no", { text: "no", errorType: null, phonemes: phonemes([["n", 96]]) }, bands, "correct"),
    ).toEqual([{ text: "no", verdict: "unknown" }]);
  });

  it("nieudane dopasowanie liter do fonemów daje cały wyraz", () => {
    expect(
      buildPronunciationFragments(
        "apple",
        { text: "apple", errorType: null, phonemes: phonemes([["æ", 96], ["p", 96], ["ə", 96], ["l", 96]]) },
        bands,
        "correct",
      ),
    ).toEqual([{ text: "apple", verdict: "unknown" }]);
  });

  it("brak słowa daje cały wyraz neutralnie", () => {
    expect(buildPronunciationFragments("cherry", undefined, bands, "partial")).toEqual([
      { text: "cherry", verdict: "unknown" },
    ]);
  });

  it("brak/niepoprawny score, errorType i niezgodne dane nie tworzą zielonego fallbacku", () => {
    const matching = phonemes([["tʃ", 96], ["ɛ", 94], ["r", 95], ["i", 96]]);
    for (const errorType of ["Omission", "Insertion", "UnknownError"])
      expect(buildPronunciationFragments("cherry", { text: "cherry", errorType, phonemes: matching }, bands, "correct"))
        .toEqual([{ text: "cherry", verdict: "unknown" }]);
    expect(buildPronunciationFragments("cherry", { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", 96]]) }, bands, "correct"))
      .toEqual([{ text: "cherry", verdict: "unknown" }]);
    expect(buildPronunciationFragments("cherry", { text: "grape", errorType: null, phonemes: matching }, bands, "correct"))
      .toEqual([{ text: "cherry", verdict: "unknown" }]);
    expect(buildPronunciationFragments("cherry", { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", null], ["ɛ", 94], ["r", 95], ["i", 96]]) }, bands, "correct"))
      .toEqual([{ text: "ch", verdict: "unknown" }, { text: "erry", verdict: "good" }]);
    expect(buildPronunciationFragments("cherry", { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", Number.NaN], ["ɛ", 94], ["r", 95], ["i", 96]]) }, bands, "correct"))
      .toEqual([{ text: "ch", verdict: "unknown" }, { text: "erry", verdict: "good" }]);
    expect(buildPronunciationFragments("cherry", { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", Number.POSITIVE_INFINITY], ["ɛ", 94], ["r", 95], ["i", 96]]) }, bands, "correct"))
      .toEqual([{ text: "ch", verdict: "unknown" }, { text: "erry", verdict: "good" }]);
    expect(buildPronunciationFragments("cherry", { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", 96], ["ɛ", 94], ["r", 95], ["i", 96], ["extra", 90]]) }, bands, "correct"))
      .toEqual([{ text: "cherry", verdict: "unknown" }]);
  });

  it("dopuszcza Mispronunciation przy kompletnych fonemach i zachowuje partial jako almost", () => {
    const expected = [
      { text: "ch", verdict: "good" },
      { text: "e", verdict: "almost" },
      { text: "rry", verdict: "good" },
    ];
    for (const errorType of ["Mispronunciation", "None"])
      expect(buildPronunciationFragments(
        "cherry",
        { text: "cherry", errorType, phonemes: phonemes([["tʃ", 96], ["ɛ", 40], ["r", 95], ["i", 96]]) },
        bands,
        "partial",
      )).toEqual(expected);
  });

  it("zachowuje wielkość liter, apostrof i łącznik w rekonstruowanych fragmentach", () => {
    for (const word of ["Monday", "don't", "mother-in-law"]) {
      const groups = letterGroups(word);
      const result = buildPronunciationFragments(word, {
        text: word,
        errorType: null,
        phonemes: groups.map((group) => ({ phoneme: group, accuracyScore: 90 })),
      }, bands, "correct");
      expect(result.map((fragment) => fragment.text).join("")).toBe(word);
    }
  });

  it("więcej niż sześć wyodrębnionych fragmentów daje neutralny cały tekst", () => {
    const word = "abcdefg";
    const result = buildPronunciationFragments(word, {
      text: word,
      errorType: null,
      phonemes: [..."abcdefg"].map((phoneme, index) => ({ phoneme, accuracyScore: index % 2 ? 20 : 90 })),
    }, bands, "correct");
    expect(result).toEqual([{ text: word, verdict: "unknown" }]);
  });
});
