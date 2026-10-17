import { describe, expect, it, vi } from "vitest";
import React from "react";
import { DeckCard } from "./DeckScreen";
import type { KidDeckDto } from "@learning/contracts";

const base: KidDeckDto = {
  deckId: "10000000-0000-4000-8000-000000000001", title: "Dni tygodnia", itemCount: 7,
  independentlyRecalledCount: 2, testDate: "2026-10-20", recommended: true,
  mockTestAvailable: true, activeSession: null,
};
const callbacks = { onStart: vi.fn(), onMockTest: vi.fn() };

function nodes(element: React.ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!React.isValidElement(element)) return [];
  const node = element as React.ReactElement<Record<string, unknown>>;
  const rendered = typeof node.type === "function" ? (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props) : node.props.children as React.ReactNode;
  return [{ type: node.type, props: node.props }, ...nodes(rendered)];
}

describe("DeckCard cover", () => {
  it("prefers the shared cover while keeping title, progress, date and actions", () => {
    const rendered = nodes(<DeckCard deck={{ ...base, coverAssetId: "10000000-0000-4000-8000-000000000002", coverVisual: { kind: "color", color: "#ff0000" } }} mediaUrl={(id) => `/media/${id}`} {...callbacks} />);
    expect(rendered.find((node) => node.props["data-testid"] === "kid-deck-cover")?.props.src).toBe("/media/10000000-0000-4000-8000-000000000002");
    expect(rendered.some((node) => node.props.className === "kid-visual")).toBe(false);
    expect(rendered.some((node) => node.props["data-testid"] === "kid-deck-title")).toBe(true);
    expect(rendered.some((node) => node.props["data-testid"] === "kid-deck-stars")).toBe(true);
    expect(rendered.some((node) => node.props["data-testid"] === "kid-deck")).toBe(true);
    expect(rendered.some((node) => node.props["data-testid"] === "kid-mock-start")).toBe(true);
  });

  it("keeps the legacy first-item visual when no dedicated cover exists", () => {
    const rendered = nodes(<DeckCard deck={{ ...base, coverVisual: { kind: "color", color: "#ff0000" } }} mediaUrl={() => "/media/item"} {...callbacks} />);
    expect(rendered.some((node) => node.props["data-testid"] === "kid-deck-cover")).toBe(false);
    expect(rendered.some((node) => node.props.className === "kid-visual")).toBe(true);
  });

  it("shows no retired daily-round action", () => {
    const rendered = nodes(<DeckCard deck={base} mediaUrl={() => "/media/item"} {...callbacks} />);
    expect(rendered.some((node) => String(node.props["data-testid"] ?? "").includes("daily-round"))).toBe(false);
  });
});
