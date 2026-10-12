import { describe, expect, it } from "vitest";
import { FeedbackDtoSchema } from "@learning/contracts";
import { chooseFeedback, feedbackExposureKeys } from "./feedback";
import { computeTargetKey } from "./target-key";
import type { SpellingComparison } from "./spelling-diff";
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

describe("chooseFeedback — diagnoza liter po błędzie pisowni (issue #9)", () => {
  const typoDiff: SpellingComparison = {
    variant: "Wednesday",
    distance: 1,
    withinThreshold: true,
    capitalizationHint: false,
    given: [{ text: "Wenesday", state: "plain" }],
    expected: [
      { text: "We", state: "plain" },
      { text: "d", state: "pill" },
      { text: "nesday", state: "plain" },
    ],
  };

  it("literówka w progu daje spelling_hint z segmentami i wariantem jako correctText", () => {
    const result = chooseFeedback(grade({ recall: sg("incorrect"), spelling: sg("incorrect") }), "Wednesday", typoDiff);
    expect(result.kind).toBe("spelling_hint");
    expect(result.correctText).toBe("Wednesday");
    expect(result.spellingDiff).toEqual({
      given: typoDiff.given,
      expected: typoDiff.expected,
    });
  });

  it("correctText przy spelling_hint to najbliższy wariant, nie kanoniczny target", () => {
    const colourDiff: SpellingComparison = {
      variant: "colour",
      distance: 1,
      withinThreshold: true,
      capitalizationHint: false,
      given: [{ text: "colur", state: "plain" }],
      expected: [
        { text: "colou", state: "plain" },
        { text: "r", state: "pill" },
      ],
    };
    const result = chooseFeedback(grade({ recall: sg("incorrect"), spelling: sg("incorrect") }), "color", colourDiff);
    expect(result.correctText).toBe("colour");
  });

  it("spelling_hint dokleja wskazówkę kapitalizacyjną, gdy jedyna pozostała różnica to wielkość liter", () => {
    const result = chooseFeedback(
      grade({ recall: sg("incorrect"), spelling: sg("incorrect") }),
      "Wednesday",
      { ...typoDiff, capitalizationHint: true },
    );
    expect(result.spellingDiff).toEqual({ given: typoDiff.given, expected: typoDiff.expected, capitalizationHint: true });
  });

  it("odległość poza progiem pozostaje przy incorrect z pełnym rozwiązaniem", () => {
    const result = chooseFeedback(
      grade({ recall: sg("incorrect"), spelling: sg("incorrect") }),
      "Wednesday",
      { ...typoDiff, withinThreshold: false, distance: 4 },
    );
    expect(result.kind).toBe("incorrect");
    expect(result.spellingDiff).toBeUndefined();
  });

  it("kapitalizacja bez literówek pozostaje przy capitalization_hint (diff nie nadpisuje)", () => {
    const result = chooseFeedback(
      grade({
        recall: sg("correct"),
        spelling: sg("incorrect", { details: { spelling: { matchedVariant: "Wednesday", wordMatched: true, letterOrderMatched: true, capitalizationCorrect: false, capitalizationOnlyDefect: true } } }),
      }),
      "Wednesday",
      typoDiff,
    );
    expect(result.kind).toBe("capitalization_hint");
  });

  it("diff nie zmienia pochwały ani „Prawie” przy zaliczonych umiejętnościach", () => {
    expect(chooseFeedback(grade({ recall: sg("correct"), spelling: sg("correct") }), "Wednesday", typoDiff).kind).toBe("great");
  });

  it("feedbackExposureKeys uwzględnia ujawniony correctText (wariant, nie tylko canonical)", () => {
    const feedback = FeedbackDtoSchema.parse({
      kind: "spelling_hint",
      correctText: "colour",
      spellingDiff: { given: [{ text: "colur", state: "pill" }], expected: [{ text: "colou", state: "plain" }, { text: "r", state: "pill" }] },
    });
    const keys = feedbackExposureKeys(feedback, computeTargetKey("color", "en-GB"), "en-GB");
    expect(keys).toContain(computeTargetKey("color", "en-GB"));
    expect(keys).toContain(computeTargetKey("colour", "en-GB"));
  });
});
