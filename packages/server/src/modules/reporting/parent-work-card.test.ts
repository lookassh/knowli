import { describe, expect, it } from "vitest";
import { responseOutcome, type StoredAssessment } from "./parent-work-card";

const row = (skill: string, outcome: string, details: Record<string, unknown> = {}): StoredAssessment => ({ skill, outcome, details });

describe("responseOutcome", () => {
  it("łączy oceny umiejętności jednej odpowiedzi", () => {
    expect(responseOutcome("text", [row("recall", "correct")])).toBe("correct");
    expect(responseOutcome("text", [row("recall", "incorrect")])).toBe("incorrect");
    // treść dobra, pisownia błędna
    expect(responseOutcome("text", [row("recall", "correct"), row("spelling", "incorrect")])).toBe("partial");
    // ocena nieoceniona nie rozstrzyga poprawności
    expect(responseOutcome("text", [row("recall", "correct"), row("spelling", "unassessed")])).toBe("correct");
    expect(responseOutcome("audio", [row("pronunciation", "unassessed")])).toBeNull();
    expect(responseOutcome("choice", undefined)).toBeNull();
  });

  it("ocena częściowa zapisana jako błąd nie jest „Błędnie”: wymowa „ćwicz” i „prawie” modelu", () => {
    expect(responseOutcome("audio", [row("pronunciation", "incorrect", { pronunciation: { provider: "azure", score: 70, band: "partial" } })])).toBe("partial");
    expect(responseOutcome("audio", [row("recall", "correct"), row("pronunciation", "incorrect", { pronunciation: { band: "partial" } })])).toBe("partial");
    expect(responseOutcome("text", [row("objective", "incorrect", { verdict: "model_almost", knowledge: "partial" })])).toBe("partial");
    // gramatyka „prawie” (błąd poza sprawdzaną regułą) i literówka: cel zaliczony, ale dziecko usłyszało „prawie”
    expect(responseOutcome("text", [row("objective", "correct", { verdict: "model_almost" })])).toBe("partial");
    expect(responseOutcome("text", [row("objective", "correct", { verdict: "minor_typo", typoToken: "runs" })])).toBe("partial");
    expect(responseOutcome("text", [row("objective", "correct", { verdict: "exact" })])).toBe("correct");
    // decyzja „błędnie” mimo częściowej wiedzy modelu zostaje błędem
    expect(responseOutcome("text", [row("objective", "incorrect", { verdict: "model_incorrect", knowledge: "partial" })])).toBe("incorrect");
  });

  it("pominięcie i „Nie pamiętam” nie mają wyniku poprawności", () => {
    expect(responseOutcome("skip", [row("recall", "incorrect")])).toBeNull();
    expect(responseOutcome("dont_remember", [row("recall", "incorrect")])).toBeNull();
  });
});
