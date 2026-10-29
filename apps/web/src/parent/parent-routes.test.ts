import { describe, expect, it } from "vitest";
import { routeFromPath, routePath, type ParentRoute } from "./parent-routes";

const DECK_ID = "3f2c1a9e-5b7d-4c8e-9a1b-2c3d4e5f6a7b";

describe("parent routes", () => {
  it("reads sections from their addresses", () => {
    expect(routeFromPath("/parent/decks")).toEqual({ section: "decks" });
    expect(routeFromPath("/parent/children/")).toEqual({ section: "children" });
    expect(routeFromPath("/parent/progress")).toEqual({ section: "progress" });
    expect(routeFromPath("/parent/work-card")).toEqual({ section: "work-card" });
  });

  it("reads an open deck and the new lesson form", () => {
    expect(routeFromPath(`/parent/decks/${DECK_ID}`)).toEqual({ section: "decks", deckId: DECK_ID });
    expect(routeFromPath(`/parent/decks/${DECK_ID.toUpperCase()}`)).toEqual({ section: "decks", deckId: DECK_ID });
    expect(routeFromPath("/parent/lessons/new")).toEqual({ section: "decks", newLesson: true });
  });

  it("has no view for the panel root and unknown addresses", () => {
    expect(routeFromPath("/parent")).toBeNull();
    expect(routeFromPath("/parent/")).toBeNull();
    expect(routeFromPath("/parent/unknown")).toBeNull();
    expect(routeFromPath("/parent/decks/extra")).toBeNull();
    expect(routeFromPath(`/parent/children/${DECK_ID}`)).toBeNull();
    expect(routeFromPath(`/parent/decks/${DECK_ID}/edit`)).toBeNull();
    expect(routeFromPath("/parent/lessons")).toBeNull();
    expect(routeFromPath("/kids/x/learn")).toBeNull();
  });

  it("round-trips every view", () => {
    const routes: ParentRoute[] = [
      { section: "decks" },
      { section: "children" },
      { section: "progress" },
      { section: "work-card" },
      { section: "decks", deckId: DECK_ID },
      { section: "decks", newLesson: true },
    ];
    for (const route of routes) {
      expect(routeFromPath(routePath(route))).toEqual(route);
    }
  });
});
