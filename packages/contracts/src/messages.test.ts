import { describe, expect, it } from "vitest";
import { messages } from "./messages";

describe("messages.decks", () => {
  it("zawiera komunikaty dla usuwania przypisania", () => {
    expect(messages.decks.unassign).toBe("Usuń przypisanie");
    expect(messages.decks.unassignConfirm).toBe("Czy na pewno chcesz usunąć przypisanie tego zestawu dziecku?");
  });
});

describe("messages.lessons.generationErrors", () => {
  it("kody porażki runu lekcji mają własny tekst zamiast ogólnego „nie udało się”", () => {
    const codes = [
      "validation", "attempts_exhausted", "internal", "provider", "deck_version_gone",
      "provider_configuration", "provider_rate_limit", "provider_timeout", "provider_refusal", "provider_incomplete", "provider_output",
      "lesson_agent_unavailable",
    ];
    for (const code of codes) {
      const text = messages.lessons.generationErrors[code];
      expect(text, code).toBeTruthy();
      expect(text, code).not.toBe(messages.lessons.generationFailed);
    }
  });
});
