import { describe, expect, it } from "vitest";
import type { FeedbackDto } from "@learning/contracts";
import { feedbackTone } from "./LearnScreen";

/** Regresja SPEC §16: tło feedbacku odpowiada wynikowi — błąd nigdy na zielono. */
describe("feedbackTone — tło feedbacku odpowiada wynikowi (SPEC §16)", () => {
  it("poprawna odpowiedź i podpowiedź kapitalizacji to sukces", () => {
    expect(feedbackTone({ kind: "great" })).toBe("kid-feedback--correct");
    expect(feedbackTone({ kind: "capitalization_hint", correctText: "Monday" })).toBe(
      "kid-feedback--correct",
    );
  });

  it("błąd i „prawie” dostają tło pomyłki, nie sukcesu", () => {
    expect(feedbackTone({ kind: "incorrect", correctText: "march" })).toBe("kid-feedback--retry");
    expect(feedbackTone({ kind: "almost" })).toBe("kid-feedback--retry");
  });

  it("nieoceniona próba i brak feedbacku są neutralne", () => {
    expect(feedbackTone({ kind: "not_assessed" })).toBe("");
    expect(feedbackTone(null)).toBe("");
  });

  it("wymowa usłyszana bez oceny pozostaje neutralna — bez udawanego wyniku", () => {
    expect(feedbackTone({ kind: "content_matched" })).toBe("");
  });
});
