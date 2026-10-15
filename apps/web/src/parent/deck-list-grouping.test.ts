import { describe, expect, it } from "vitest";
import type { DeckSummaryDto } from "@learning/contracts";
import { filterByKind, groupDecksByState, polishPlural } from "./deck-list-grouping";

function deck(id: string, title: string, state: DeckSummaryDto["state"], kind?: "vocabulary" | "lesson"): DeckSummaryDto {
  return {
    deckId: id,
    title,
    state,
    vocabularyFormat: "standard",
    ...(kind ? { kind } : {}),
    editableVersionId: null,
    publishedVersionId: null,
  };
}

describe("groupDecksByState", () => {
  it("grupuje w kolejności review → published → draft → archived i pomija puste grupy", () => {
    const rows = [deck("b", "B", "published"), deck("a", "A", "review"), deck("c", "C", "draft"), deck("d", "D", "published")];
    expect(groupDecksByState(rows).map((group) => [group.id, group.decks.map((d) => d.title)])).toEqual([
      ["review", ["A"]],
      ["published", ["B", "D"]],
      ["draft", ["C"]],
    ]);
  });

  it("zachowuje kolejność wejściową wewnątrz grupy", () => {
    const rows = [deck("d", "D", "published"), deck("b", "B", "published"), deck("c", "C", "review"), deck("a", "A", "review")];
    const groups = groupDecksByState(rows);
    expect(groups.map((group) => [group.id, group.decks.map((deck) => deck.title)])).toEqual([
      ["review", ["C", "A"]],
      ["published", ["D", "B"]],
    ]);
  });

  it("archiwum tworzy własną grupę tylko gdy widoczne na wejściu", () => {
    const rows = [deck("a", "A", "published"), deck("z", "Z", "archived")];
    expect(groupDecksByState(rows).map((group) => group.id)).toEqual(["published", "archived"]);
    expect(groupDecksByState(rows.slice(0, 1)).map((group) => group.id)).toEqual(["published"]);
  });

  it("pusta lista daje pustą tablicę grup", () => {
    expect(groupDecksByState([])).toEqual([]);
  });
});

describe("filterByKind", () => {
  it("all zwraca wszystko, w tym bez jawnego kind (zgodność wsteczna)", () => {
    const rows = [deck("a", "A", "published"), deck("l", "L", "published", "lesson")];
    expect(filterByKind(rows, "all")).toHaveLength(2);
  });

  it("vocabulary obejmuje brakujące pole kind", () => {
    const rows = [deck("a", "A", "published"), deck("v", "V", "published", "vocabulary"), deck("l", "L", "published", "lesson")];
    expect(filterByKind(rows, "vocabulary").map((deck) => deck.title)).toEqual(["A", "V"]);
  });

  it("lesson zwraca wyłącznie lekcje", () => {
    const rows = [deck("a", "A", "published"), deck("l", "L", "published", "lesson")];
    expect(filterByKind(rows, "lesson").map((deck) => deck.title)).toEqual(["L"]);
  });
});

describe("polishPlural", () => {
  it("wybiera formę zgodną z polską liczbą", () => {
    expect(polishPlural(1)).toBe("one");
    expect(polishPlural(2)).toBe("few");
    expect(polishPlural(4)).toBe("few");
    expect(polishPlural(5)).toBe("many");
    expect(polishPlural(12)).toBe("many");
    expect(polishPlural(22)).toBe("few");
    expect(polishPlural(42)).toBe("few");
    expect(polishPlural(0)).toBe("many");
  });
});
