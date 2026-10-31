import { describe, expect, it, vi } from "vitest";
import { messages, type GenerationDto } from "@learning/contracts";
import { DeckGenerationOutcome, generationFailureText } from "./DeckEditor";
import { renderParentMarkup } from "./test-render";

const run = (overrides: Partial<GenerationDto> = {}): GenerationDto => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  deckId: "00000000-0000-4000-8000-0000000000d1",
  deckVersionId: "00000000-0000-4000-8000-0000000000d2",
  state: "succeeded",
  attempts: 1,
  errorCode: null,
  ...overrides,
});

const render = (generation: GenerationDto) => renderParentMarkup(<DeckGenerationOutcome generation={generation} onRetry={vi.fn()} />);

describe("DeckGenerationOutcome (edytor zestawu słówek)", () => {
  it("zestaw ze źródła z odrzuconymi pozycjami: liczba pominiętych", () => {
    const markup = render(run({ rejectedCount: 3 }));
    expect(markup).toContain('data-testid="vocabulary-rejected-count"');
    expect(markup).toContain("Pominięto pozycji spoza tekstu źródła: 3");
    expect(markup).not.toContain('data-testid="generation-failed"');
  });

  it("bez odrzuceń albo bez liczby (tryb „z opisu”): bez notki", () => {
    for (const rejectedCount of [0, null, undefined]) {
      const markup = render(run(rejectedCount === undefined ? {} : { rejectedCount }));
      expect(markup, String(rejectedCount)).not.toContain('data-testid="vocabulary-rejected-count"');
    }
  });

  it("run bez słówek z tekstu źródła: komunikat no_source_items z ponowieniem", () => {
    const markup = render(run({ state: "failed", errorCode: "no_source_items", deckVersionId: null, rejectedCount: 5 }));
    expect(markup).toContain('data-testid="generation-failed"');
    expect(markup).toContain(messages.decks.noSourceItems);
    expect(messages.decks.noSourceItems).toBe("Nie znaleziono w tekście źródła słówek do zestawu. Zmień zawężenie albo spróbuj ponownie.");
    expect(markup).toContain('data-testid="generation-retry"');
    expect(markup).not.toContain(messages.decks.generationFailed);
    expect(markup).toContain("Pominięto pozycji spoza tekstu źródła: 5");
  });

  it("komunikaty porażki według kodu: obrazkowy, ze źródła, pozostałe bez zmian", () => {
    expect(generationFailureText("no_picture_material")).toBe(messages.decks.noPictureMaterial);
    expect(generationFailureText("no_source_items")).toBe(messages.decks.noSourceItems);
    expect(generationFailureText("provider_timeout")).toBe(messages.decks.generationFailed);
    expect(generationFailureText(null)).toBe(messages.decks.generationFailed);
  });

  it("run w toku albo udany: bez komunikatu porażki", () => {
    expect(render(run({ state: "running" }))).not.toContain('data-testid="generation-failed"');
    expect(render(run())).not.toContain('data-testid="generation-failed"');
  });
});
