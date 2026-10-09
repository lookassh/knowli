import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KidDeckDto } from "@learning/contracts";
import { DeckScreen } from "../../../../packages/kid-ui/src/screens/DeckScreen";

const DECK: KidDeckDto = {
  deckId: "33333333-3333-3333-3333-333333333333",
  title: "Dni tygodnia",
  itemCount: 7,
  independentlyRecalledCount: 3,
  testDate: "2026-10-10",
  recommended: true,
};

function renderDeckScreen(deck: KidDeckDto): string {
  return renderToStaticMarkup(
    createElement(DeckScreen, {
      decks: [deck],
      childName: "Krzysztof",
      microphone: false,
      micDenied: false,
      onToggleMicrophone: () => undefined,
      onStart: () => undefined,
    }),
  );
}

describe("DeckScreen — powitanie i postępy na kafelkach (SPEC §6)", () => {
  it("wita dziecko i pokazuje liczbę słów oraz samodzielnie przypominane słowa", () => {
    const markup = renderDeckScreen(DECK);

    expect(markup).toContain("Cześć, Krzysztof! 👋");
    expect(markup).toContain("📅 Dni tygodnia — 7 słów");
    expect(markup).toContain("⭐ 3 słowa przypominasz samodzielnie");
    expect(markup).toContain("Sprawdzian: 2026-10-10");
  });

  it.each([
    [1, "1 słowo"],
    [3, "3 słowa"],
    [12, "12 słów"],
    [22, "22 słowa"],
  ])("odmienia polskie słowo dla liczby %i", (itemCount, label) => {
    const markup = renderDeckScreen({ ...DECK, itemCount });

    expect(markup).toContain(`Dni tygodnia — ${label}`);
  });
});
