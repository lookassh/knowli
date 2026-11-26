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

describe("messages.kid", () => {
  // Profil dziecka nie ma płci: 2. osoba czasu przeszłego/trybu przypuszczającego („Ćwiczyłeś”, „zrobiłabyś”)
  // zakłada formę męską albo żeńską. 1. osoba systemu („Usłyszałem”) to świadoma persona — nie łapiemy jej.
  it("nie zwraca się do dziecka formą zależną od płci", () => {
    const gendered = /\p{L}(?:łeś|łaś|łbyś|łabyś)(?!\p{L})/iu;
    const texts = (value: unknown): string[] =>
      typeof value === "string" ? [value] : Object.values(value as object).flatMap(texts);
    expect(texts(messages.kid).filter((text) => gendered.test(text))).toEqual([]);
  });
});
