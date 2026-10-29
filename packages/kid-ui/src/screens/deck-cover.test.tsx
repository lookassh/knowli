// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KidDeckDto } from "@learning/contracts";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { DeckCard } from "./DeckScreen";

afterEach(cleanup);

const base: KidDeckDto = {
  deckId: "10000000-0000-4000-8000-000000000001", title: "Dni tygodnia", itemCount: 7,
  independentlyRecalledCount: 2, testDate: "2026-10-20", recommended: true,
  mockTestAvailable: true, activeSession: null,
};
const callbacks = { onStart: vi.fn(), onMockTest: vi.fn() };

describe("DeckCard cover", () => {
  it("prefers the shared cover while keeping title, progress, date and actions", () => {
    const { container } = renderKid(<DeckCard deck={{ ...base, coverAssetId: "10000000-0000-4000-8000-000000000002", coverVisual: { kind: "color", color: "#ff0000" } }} mediaUrl={(id) => `/media/${id}`} {...callbacks} />);
    expect(screen.getByTestId("kid-deck-cover").getAttribute("src")).toBe("/media/10000000-0000-4000-8000-000000000002");
    expect(container.querySelector(".kid-visual")).toBeNull();
    expect(screen.getByTestId("kid-deck-title").textContent).toBe("Dni tygodnia");
    expect(screen.getByTestId("kid-deck-meta").textContent).toBe("7 słów");
    expect(screen.getByTestId("kid-deck-stars")).toBeTruthy();
    expect(screen.getByTestId("kid-deck")).toBeTruthy();
    expect(screen.getByTestId("kid-mock-start")).toBeTruthy();
  });

  it("keeps the legacy first-item visual when no dedicated cover exists", () => {
    const { container } = renderKid(<DeckCard deck={{ ...base, coverVisual: { kind: "color", color: "#ff0000" } }} mediaUrl={() => "/media/item"} {...callbacks} />);
    expect(screen.queryByTestId("kid-deck-cover")).toBeNull();
    expect(container.querySelector(".kid-visual")).toBeTruthy();
  });

  it("shows no retired daily-round action", () => {
    renderKid(<DeckCard deck={base} mediaUrl={() => "/media/item"} {...callbacks} />);
    expect(screen.queryByTestId(/daily-round/)).toBeNull();
  });
});
