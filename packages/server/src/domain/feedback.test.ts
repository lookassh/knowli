import { describe, expect, it } from "vitest";
import { chooseFeedback } from "./feedback";
import type { Grade, Skill, SkillGrade } from "./types";

function sg(outcome: SkillGrade["outcome"], extra: Partial<SkillGrade> = {}): SkillGrade {
  return { outcome, independent: true, confirmationEligible: false, ...extra };
}

function grade(skills: Partial<Record<Skill, SkillGrade>>): Grade {
  return { skills, attempt: { independent: true, confirmationEligible: false } };
}

describe("chooseFeedback — feedback zgodny z rzeczywistym wynikiem (SPEC §16, §12.8)", () => {
  it("w pełni poprawna odpowiedź zasługuje na pochwałę", () => {
    expect(chooseFeedback(grade({ recall: sg("correct"), spelling: sg("correct") }), "Monday")).toEqual({
      kind: "great",
    });
  });

  it("właściwe słowo bez wielkiej litery dostaje wskazówkę kapitalizacji z poprawną formą", () => {
    const g = grade({
      recall: sg("correct"),
      spelling: sg("incorrect", {
        details: {
          spelling: {
            matchedVariant: "Monday",
            wordMatched: true,
            letterOrderMatched: true,
            capitalizationCorrect: false,
            capitalizationOnlyDefect: true,
          },
        },
      }),
    });
    expect(chooseFeedback(g, "Monday")).toEqual({ kind: "capitalization_hint", correctText: "Monday" });
  });

  it("wynik częściowy dostaje łagodne „prawie”", () => {
    const g = grade({
      listening: sg("correct"),
      spelling: sg("incorrect", {
        details: {
          spelling: {
            matchedVariant: null,
            wordMatched: false,
            letterOrderMatched: false,
            capitalizationCorrect: false,
            capitalizationOnlyDefect: false,
          },
        },
      }),
    });
    expect(chooseFeedback(g, "Thursday")).toEqual({ kind: "almost" });
  });

  it("poprawna treść z nieocenioną wymową to nadal sukces treści (wynik częściowy, SPEC §15)", () => {
    const g = grade({ recall: sg("correct"), pronunciation: sg("unevaluated", { reason: "technical" }) });
    expect(chooseFeedback(g, "Thursday").kind).toBe("great");
  });

  it("niepoprawna odpowiedź nigdy nie jest chwalona — prowadzi do wzorca", () => {
    const g = grade({ recall: sg("incorrect"), spelling: sg("incorrect") });
    expect(chooseFeedback(g, "Thursday")).toEqual({ kind: "incorrect", correctText: "Thursday" });
  });

  it("całkowity brak oceny to komunikat techniczny, nie ocena wiedzy", () => {
    const g = grade({ pronunciation: sg("unevaluated", { reason: "technical" }) });
    expect(chooseFeedback(g, "Thursday")).toEqual({ kind: "not_assessed" });
  });
});
