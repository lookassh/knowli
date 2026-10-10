import { describe, expect, it } from "vitest";
import { chooseFeedback, feedbackExposureKeys } from "./feedback";
import { computeTargetKey } from "./target-key";
import type { Grade, Skill, SkillGrade } from "./types";

function sg(outcome: SkillGrade["outcome"], extra: Partial<SkillGrade> = {}): SkillGrade {
  return { outcome, independent: true, confirmationEligible: false, ...extra };
}

function grade(skills: Partial<Record<Skill, SkillGrade>>): Grade {
  return { skills, attempt: { independent: true, confirmationEligible: false } };
}

describe("chooseFeedback — feedback zgodny z rzeczywistym wynikiem (SPEC §16, §12.8)", () => {
  it("feedback great niesie fragmenty wymowy, content_matched nie", () => {
    const fragments = [{ text: "ch", verdict: "good" as const }, { text: "e", verdict: "almost" as const }];
    const base = {
      attempt: { independent: true, confirmationEligible: true },
      speechFragments: fragments,
    };
    const great = chooseFeedback(
      { ...base, skills: { pronunciation: { outcome: "correct", independent: true, confirmationEligible: true } } } as never,
      "cherry",
    );
    expect(great.kind).toBe("great");
    expect(great.fragments).toEqual(fragments);
    const matched = chooseFeedback(
      { ...base, skills: {}, speechAttempt: { contentMatched: true } } as never,
      "cherry",
    );
    expect(matched.kind).toBe("content_matched");
    expect(matched.fragments).toBeUndefined();
  });

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

  it("ćwiczenie wymowy: właściwe słowo bez oceny wymowy to wykonane ćwiczenie (SPEC §15.4)", () => {
    const g = grade({ pronunciation: sg("unevaluated") });
    g.speechAttempt = { contentMatched: true };
    expect(chooseFeedback(g, "Thursday")).toEqual({ kind: "content_matched" });
  });

  it("ćwiczenie wymowy: rozbieżna treść nie jest chwalona — prowadzi do wzorca", () => {
    const g = grade({});
    g.speechAttempt = { contentMatched: false };
    expect(chooseFeedback(g, "Thursday")).toEqual({ kind: "incorrect", correctText: "Thursday" });
  });

  it("shows public speech status separately from content outcome", () => {
    const matched = chooseFeedback({
      ...grade({ recall: sg("correct"), pronunciation: sg("unevaluated", { reason: "technical" }) }),
      recognizedText: "couch",
      speechFeedback: { recognition: "matched", pronunciation: "not_applicable", referenceText: "couch" },
    }, "sofa");
    expect(matched).toMatchObject({ heardText: "couch", speech: { recognition: "matched", pronunciation: "not_applicable", referenceText: "couch" } });
  });

  it("collects only disclosed canonical, reference and reliable heard text keys", () => {
    expect(feedbackExposureKeys({
      kind: "incorrect",
      correctText: "sofa",
      heardText: "couch!",
      speech: { recognition: "different", pronunciation: "not_applicable", referenceText: "sofa" },
    }, computeTargetKey("sofa", "en-GB"), "en-GB")).toEqual([
      computeTargetKey("sofa", "en-GB"),
      computeTargetKey("couch", "en-GB"),
    ]);
    expect(feedbackExposureKeys({
      kind: "not_assessed",
      speech: { recognition: "uncertain", pronunciation: "not_applicable" },
    }, computeTargetKey("sofa", "en-GB"), "en-GB")).toEqual([]);
  });
});
