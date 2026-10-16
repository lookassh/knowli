import { describe, expect, it } from "vitest";
import { messages } from "./messages";

describe("messages.decks", () => {
  it("zawiera komunikaty dla usuwania przypisania", () => {
    expect(messages.decks.unassign).toBe("Usuń przypisanie");
    expect(messages.decks.unassignConfirm).toBe("Czy na pewno chcesz usunąć przypisanie tego zestawu dziecku?");
  });
});
