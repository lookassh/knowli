import { describe, expect, it } from "vitest";
import { isIncompleteWord, joinedText } from "./spelling-diff-view";

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

describe("isIncompleteWord — rozpoznanie brakujących liter (prefiks, sufiks, środek)", () => {
  it("zwraca true dla brakującego sufiksu (np. Mon dla Monday)", () => {
    expect(
      isIncompleteWord(
        [{ text: "Mon", state: "plain" }],
        [
          { text: "Mon", state: "plain" },
          { text: "day", state: "pill" },
        ],
      ),
    ).toBe(true);
  });

  it("zwraca true dla brakującego prefiksu (np. day dla Monday)", () => {
    expect(
      isIncompleteWord(
        [{ text: "day", state: "plain" }],
        [
          { text: "Mon", state: "pill" },
          { text: "day", state: "plain" },
        ],
      ),
    ).toBe(true);
  });

  it("zwraca true dla brakującej litery w środku (np. Mondy dla Monday)", () => {
    expect(
      isIncompleteWord(
        [{ text: "Mondy", state: "plain" }],
        [
          { text: "Mond", state: "plain" },
          { text: "a", state: "pill" },
          { text: "y", state: "plain" },
        ],
      ),
    ).toBe(true);
  });

  it("zwraca true dla wpisanego środka słowa — pigułki na obu końcach (np. dnes dla Wednesday)", () => {
    expect(
      isIncompleteWord(
        [{ text: "dnes", state: "plain" }],
        [
          { text: "We", state: "pill" },
          { text: "dnes", state: "plain" },
          { text: "day", state: "pill" },
        ],
      ),
    ).toBe(true);
  });

  it("zwraca false dla dwóch dziur w środku i braków rozproszonych", () => {
    // Weay dla Wednesday: brak "edn" i "sd" — dwie dziury w środku
    expect(
      isIncompleteWord(
        [{ text: "Weay", state: "plain" }],
        [
          { text: "W", state: "plain" },
          { text: "edn", state: "pill" },
          { text: "e", state: "plain" },
          { text: "sd", state: "pill" },
          { text: "ay", state: "plain" },
        ],
      ),
    ).toBe(false);
    // Wdnsdy dla Wednesday: braki rozproszone po całym słowie
    expect(
      isIncompleteWord(
        [{ text: "Wdnsdy", state: "plain" }],
        [
          { text: "W", state: "plain" },
          { text: "e", state: "pill" },
          { text: "dn", state: "plain" },
          { text: "e", state: "pill" },
          { text: "sd", state: "plain" },
          { text: "a", state: "pill" },
          { text: "y", state: "plain" },
        ],
      ),
    ).toBe(false);
  });

  it("zwraca false, gdy zapis dziecka zawiera błędną literę (pigułkę)", () => {
    expect(
      isIncompleteWord(
        [
          { text: "M", state: "plain" },
          { text: "u", state: "pill" },
          { text: "nday", state: "plain" },
        ],
        [
          { text: "M", state: "plain" },
          { text: "o", state: "pill" },
          { text: "nday", state: "plain" },
        ],
      ),
    ).toBe(false);
  });

  it("zwraca false dla nietypowych danych wejściowych (puste listy, brak segmentu plain, pojedynczy segment expected)", () => {
    expect(isIncompleteWord([], [{ text: "Monday", state: "plain" }])).toBe(false);
    expect(isIncompleteWord([{ text: "Mon", state: "plain" }], [])).toBe(false);
    expect(isIncompleteWord([{ text: "Mon", state: "plain" }], [{ text: "Monday", state: "pill" }])).toBe(false);
    expect(isIncompleteWord([{ text: "Mon", state: "plain" }], [{ text: "Mon", state: "pill" }, { text: "day", state: "pill" }])).toBe(false);
  });
});

