import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KidDeckDto } from "@learning/contracts";
import { DeckScreen } from "../../../../packages/kid-ui/src/screens/DeckScreen";
import { KidThemeProvider } from "../../../../packages/kid-ui/src/theme/KidThemeProvider";

const DECK: KidDeckDto = {
  mockTestAvailable: false,
  activeSession: null,
  deckId: "33333333-3333-3333-3333-333333333333",
  title: "Dni tygodnia",
  itemCount: 7,
  independentlyRecalledCount: 3,
  testDate: "2026-10-10",
  recommended: true,
};

function renderDeckScreen(deck: KidDeckDto): string {
  return renderToStaticMarkup(
    createElement(KidThemeProvider, null, createElement(DeckScreen, {
      decks: [deck],
      childName: "Krzysztof",
      microphone: false,
      micDenied: false,
      onToggleMicrophone: () => undefined,
      onStart: () => undefined,
    })),
  );
}

describe("DeckScreen — powitanie i postępy na kafelkach (SPEC §6)", () => {
  it("wita dziecko i pokazuje liczbę słów oraz gwiazdki opanowania (samodzielny Recall)", () => {
    const markup = renderDeckScreen(DECK);

    expect(markup).toContain("Cześć, Krzysztof!");
    expect(markup).toContain("Dni tygodnia");
    expect(markup).toContain("7 słów");
    expect(markup).toContain('data-testid="kid-deck-stars"');
    expect(markup).toContain("★★☆☆☆☆"); // 3 z 7 słów → floor(3*6/7) = 2
    expect(markup).toContain("Przypominasz samodzielnie: 2 z 6 gwiazdek");
    expect(markup).not.toContain("⭐ 3 słowa przypominasz samodzielnie"); // pigułka zniknęła
    expect(markup).toContain("Sprawdzian: 10 paź");
  });

  it("pokazuje komplet 6 gwiazdek przy pełnym opanowaniu zestawu", () => {
    const markup = renderDeckScreen({ ...DECK, independentlyRecalledCount: 7 });

    expect(markup).toContain("★★★★★★");
    expect(markup).toContain("Przypominasz samodzielnie: 6 z 6 gwiazdek");
  });

  it.each([
    [1, "1 słowo"],
    [3, "3 słowa"],
    [12, "12 słów"],
    [22, "22 słowa"],
  ])("odmienia polskie słowo dla liczby %i", (itemCount, label) => {
    const markup = renderDeckScreen({ ...DECK, itemCount });

    expect(markup).toContain("Dni tygodnia");
    expect(markup).toContain(`>${label}<`);
  });
});

describe("DeckScreen — ustawienie mikrofonu w nagłówku (SPEC §14)", () => {
  it("pokazuje ikonę ustawienia po odmowie, a szczegóły dopiero po otwarciu", () => {
    const markup = renderToStaticMarkup(
      createElement(KidThemeProvider, null, createElement(DeckScreen, {
        decks: [DECK],
        childName: "Krzysztof",
        microphone: false,
        micDenied: true,
        onToggleMicrophone: () => undefined,
        onStart: () => undefined,
      })),
    );

    expect(markup).toContain('data-testid="kid-mic-settings"');
    expect(markup).not.toContain('data-testid="kid-mic-toggle"');
    expect(markup).not.toContain('data-testid="kid-mic-denied-hint"');
    expect(markup).toContain('aria-label="Odpowiedzi głosowe wyłączone"');
  });

  it("bez odmowy pokazuje ikonę, a ustawienie pozostaje zamknięte", () => {
    const markup = renderDeckScreen(DECK);

    expect(markup).toContain('data-testid="kid-mic-settings"');
    expect(markup).not.toContain('data-testid="kid-mic-toggle"');
    expect(markup).not.toContain("kid-mic-denied-hint");
    expect(markup).not.toContain("Możesz uczyć się również bez nagrywania.");
  });
});
