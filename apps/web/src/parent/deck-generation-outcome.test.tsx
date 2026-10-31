import { describe, expect, it, vi } from "vitest";
import { messages, type GenerationDto } from "@learning/contracts";
import { DeckGenerationOutcome, generationFailureText } from "./DeckEditor";
import { renderParentMarkup } from "./test-render";

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

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
    expect(markup).toContain(messages.decks.rejectedFromSource.replace("{n}", "3"));
    expect(messages.decks.rejectedFromSource).toBe("Pominięto pozycji spoza tekstu lub niepoprawnych: {n}");
    expect(markup).not.toContain('data-testid="generation-failed"');
  });

  it("bez odrzuceń albo bez liczby (tryb „z opisu”): bez notki", () => {
    for (const rejectedCount of [0, null, undefined]) {
      const markup = render(run(rejectedCount === undefined ? {} : { rejectedCount }));
      expect(markup, String(rejectedCount)).not.toContain('data-testid="vocabulary-rejected-count"');
    }
  });

  it("run bez słówek z tekstu źródła: komunikat no_source_items z ponowieniem", () => {
    const markup = render(run({ state: "failed", errorCode: "no_source_items", rejectedCount: 5 }));
    expect(markup).toContain('data-testid="generation-failed"');
    expect(markup).toContain(messages.decks.noSourceItems);
    // ponowienie powtarza zamrożone polecenie — inne zawężenie to nowy zestaw ze źródła
    expect(messages.decks.noSourceItems).toBe(
      "Nie znaleziono w tekście źródła słówek do zestawu. Ponów generowanie albo utwórz nowy zestaw ze źródła z innym zawężeniem lub w rodzaju standardowym.",
    );
    expect(markup).toContain('data-testid="generation-retry"');
    expect(markup).not.toContain(messages.decks.generationFailed);
    expect(markup).toContain(messages.decks.rejectedFromSource.replace("{n}", "5"));
    // bez źródła (usunięte albo zestaw z opisu) — bez linku
    expect(markup).not.toContain('data-testid="generation-source-link"');
  });

  it("no_source_items w zestawie ze źródłem: link „Przejdź do źródła” do strony źródła", () => {
    const source = { id: SOURCE_ID, title: "Unit 3 — Food", copiedRevision: 2, currentRevision: 2 };
    const markup = renderParentMarkup(
      <DeckGenerationOutcome generation={run({ state: "failed", errorCode: "no_source_items" })} onRetry={vi.fn()} source={source} onOpenSource={vi.fn()} />,
    );
    expect(markup).toContain('data-testid="generation-source-link"');
    expect(markup).toContain(`href="/parent/sources/${SOURCE_ID}"`);
    expect(messages.decks.goToSource).toBe("Przejdź do źródła");
    expect(markup).toContain(messages.decks.goToSource);

    // inna porażka zestawu ze źródłem: ponowienie ma sens, link nie jest podpowiedzią
    const other = renderParentMarkup(
      <DeckGenerationOutcome generation={run({ state: "failed", errorCode: "provider_timeout" })} onRetry={vi.fn()} source={source} onOpenSource={vi.fn()} />,
    );
    expect(other).not.toContain('data-testid="generation-source-link"');
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
