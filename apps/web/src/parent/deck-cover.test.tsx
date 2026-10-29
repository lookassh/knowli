import { describe, expect, it, vi } from "vitest";
import { DeckCoverSettings } from "./DeckCoverSettings";
import { renderParentMarkup } from "./test-render";

const handlers = {
  onUpload: vi.fn(), onRemove: vi.fn(), onGenerate: vi.fn(), onAcceptGenerated: vi.fn(), onRejectGenerated: vi.fn(),
};

describe("DeckCoverSettings", () => {
  it("shows a preview and removal control for a saved shared cover", () => {
    const markup = renderParentMarkup(<DeckCoverSettings coverAssetId="10000000-0000-4000-8000-000000000001" busy={false} generating={false} generatedPreview={null} {...handlers} />);
    expect(markup).toMatch(/<img[^>]*src="\/api\/v1\/media\/10000000-0000-4000-8000-000000000001"[^>]*data-testid="deck-cover-preview"|data-testid="deck-cover-preview"[^>]*src="\/api\/v1\/media\/10000000-0000-4000-8000-000000000001"/);
    expect(markup).toContain('data-testid="deck-cover-remove"');
  });

  it("keeps the no-cover state and supported file input available", () => {
    const markup = renderParentMarkup(<DeckCoverSettings coverAssetId={null} busy={false} generating={false} generatedPreview={null} {...handlers} />);
    expect(markup).toContain('data-testid="deck-cover-empty"');
    expect(markup).toMatch(/<input[^>]*data-testid="deck-cover-input"[^>]*>/);
    expect(markup).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(markup).not.toContain('data-testid="deck-cover-remove"');
    expect(markup).toContain('data-testid="deck-cover-generate"');
  });

  it("shows explicit accept and reject actions for a temporary generated preview", () => {
    const markup = renderParentMarkup(<DeckCoverSettings coverAssetId="saved-cover" busy={false} generating={false} generatedPreview="blob:preview" {...handlers} />);
    expect(markup).toContain('data-testid="generated-cover-preview"');
    expect(markup).toContain('data-testid="deck-cover-preview"');
    expect(markup).toContain('data-testid="deck-cover-accept"');
    expect(markup).toContain('data-testid="deck-cover-reject"');
    expect(markup).not.toContain('data-testid="deck-cover-generate"');
  });

  it("shows the cover error next to the cover section", () => {
    const markup = renderParentMarkup(<DeckCoverSettings coverAssetId={null} busy={false} generating={false} generatedPreview={null} error="Obraz okładkowy może mieć maksymalnie 5 MB." {...handlers} />);
    expect(markup).toContain('data-testid="deck-cover-error"');
    expect(markup).toContain("maksymalnie 5 MB");
  });
});
