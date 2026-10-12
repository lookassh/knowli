import { describe, expect, it } from "vitest";
import { compareSpelling } from "./spelling-diff";
import type { AnswerKey } from "./types";

function key(target: string, acceptedAnswers: readonly string[] = []): AnswerKey {
  return { exerciseType: "spelling", target, acceptedAnswers };
}

describe("compareSpelling — porównanie zapisu z zatwierdzonym wariantem (issue #9)", () => {
  it("brakująca litera: pigułka na brakującym fragmencie wzorca", () => {
    const result = compareSpelling("Wenesday", key("Wednesday"))!;
    expect(result.variant).toBe("Wednesday");
    expect(result.distance).toBe(1);
    expect(result.withinThreshold).toBe(true);
    expect(result.given).toEqual([{ text: "Wenesday", state: "plain" }]);
    expect(result.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "d", state: "pill" },
      { text: "nesday", state: "plain" },
    ]);
    expect(result.capitalizationHint).toBe(false);
  });

  it("nadmiarowa litera: pigułka na nadmiarowym fragmencie wpisu", () => {
    const result = compareSpelling("Wedneseday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "Wednes", state: "plain" },
      { text: "e", state: "pill" },
      { text: "day", state: "plain" },
    ]);
    expect(result.expected).toEqual([{ text: "Wednesday", state: "plain" }]);
  });

  it("zamieniona litera: pigułki w obu wierszach", () => {
    const result = compareSpelling("Widnesday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "W", state: "plain" },
      { text: "i", state: "pill" },
      { text: "dnesday", state: "plain" },
    ]);
    expect(result.expected).toEqual([
      { text: "W", state: "plain" },
      { text: "e", state: "pill" },
      { text: "dnesday", state: "plain" },
    ]);
  });

  it("przestawiona para sąsiednich liter liczy się jako jedna operacja", () => {
    const result = compareSpelling("Wendesday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "We", state: "plain" },
      { text: "nd", state: "pill" },
      { text: "esday", state: "plain" },
    ]);
    expect(result.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "dn", state: "pill" },
      { text: "esday", state: "plain" },
    ]);
  });

  it("wielkość liter nie liczy się do odległości, ale ustawia wskazówkę", () => {
    const result = compareSpelling("wendsday", key("Wednesday"))!;
    // brakujące „e” + przestawienie „nd”/„dn” = 2 operacje liter (wciąż w progu)
    expect(result.distance).toBe(2);
    expect(result.capitalizationHint).toBe(true);
  });

  it("próg: maksymalnie 2 operacje dla długich słów, 1 dla krótkich", () => {
    expect(compareSpelling("Wednsdya", key("Wednesday"))!.withinThreshold).toBe(true); // 2 przestawienia
    expect(compareSpelling("Wdnsdy", key("Wednesday"))!.withinThreshold).toBe(false); // 3 operacje
    expect(compareSpelling("cta", key("cat"))!.withinThreshold).toBe(true); // 1 (słowo ≤4 znaki)
    expect(compareSpelling("abt", key("cat"))!.withinThreshold).toBe(false); // 2 (słowo ≤4 znaki)
  });

  it("wybiera najbliższy wariant; remis rozstrzyga kanoniczny target", () => {
    const result = compareSpelling("colour", key("color", ["colour", "colourful"]))!;
    expect(result.variant).toBe("colour");
    expect(result.distance).toBe(0);
    const tie = compareSpelling("abc", key("abd", ["abe"]))!;
    expect(tie.variant).toBe("abd"); // target pierwszy wśród kandydatów
  });

  it("pusta odpowiedź i sam odstęp dają null", () => {
    expect(compareSpelling("", key("Wednesday"))).toBeNull();
    expect(compareSpelling("   ", key("Wednesday"))).toBeNull();
  });
});
