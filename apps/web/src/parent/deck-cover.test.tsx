import { describe, expect, it, vi } from "vitest";
import React from "react";
import { DeckCoverSettings } from "./DeckCoverSettings";

function nodes(element: React.ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!React.isValidElement(element)) return [];
  const node = element as React.ReactElement<Record<string, unknown>>;
  const rendered = typeof node.type === "function" ? (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props) : node.props.children as React.ReactNode;
  return [{ type: node.type, props: node.props }, ...nodes(rendered)];
}

describe("DeckCoverSettings", () => {
  it("shows a preview and removal control for a saved shared cover", () => {
    const rendered = nodes(<DeckCoverSettings coverAssetId="10000000-0000-4000-8000-000000000001" busy={false} onUpload={vi.fn()} onRemove={vi.fn()} />);
    expect(rendered.some((node) => node.props["data-testid"] === "deck-cover-preview")).toBe(true);
    expect(rendered.find((node) => node.props["data-testid"] === "deck-cover-preview")?.props.src).toBe("/api/v1/media/10000000-0000-4000-8000-000000000001");
    expect(rendered.some((node) => node.props["data-testid"] === "deck-cover-remove")).toBe(true);
  });

  it("keeps the no-cover state and supported file input available", () => {
    const rendered = nodes(<DeckCoverSettings coverAssetId={null} busy={false} onUpload={vi.fn()} onRemove={vi.fn()} />);
    expect(rendered.some((node) => node.props["data-testid"] === "deck-cover-empty")).toBe(true);
    expect(rendered.find((node) => node.props["data-testid"] === "deck-cover-input")?.props.accept).toBe("image/png,image/jpeg,image/webp");
    expect(rendered.some((node) => node.props["data-testid"] === "deck-cover-remove")).toBe(false);
  });

  it("uploads a selected file and disables upload and removal while busy", () => {
    const onUpload = vi.fn();
    const onRemove = vi.fn();
    const file = new File(["image"], "cover.png", { type: "image/png" });
    const rendered = nodes(<DeckCoverSettings coverAssetId="10000000-0000-4000-8000-000000000001" busy={false} onUpload={onUpload} onRemove={onRemove} />);
    const input = rendered.find((node) => node.props["data-testid"] === "deck-cover-input");
    (input?.props.onChange as (event: { target: { files: File[] }; currentTarget: { value: string } }) => void)({ target: { files: [file] }, currentTarget: { value: "cover.png" } });
    expect(onUpload).toHaveBeenCalledWith(file);

    const busy = nodes(<DeckCoverSettings coverAssetId="10000000-0000-4000-8000-000000000001" busy onUpload={onUpload} onRemove={onRemove} />);
    expect(busy.find((node) => node.props["data-testid"] === "deck-cover-input")?.props.disabled).toBe(true);
    expect(busy.find((node) => node.props["data-testid"] === "deck-cover-remove")?.props.disabled).toBe(true);
  });
});
