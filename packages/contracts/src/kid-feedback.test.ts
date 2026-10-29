import { describe, expect, it } from "vitest";
import { FeedbackDtoSchema } from "./kid";

const diff = {
  given: [{ text: "We", state: "plain" }, { text: "nd", state: "pill" }, { text: "esday", state: "plain" }],
  expected: [{ text: "We", state: "plain" }, { text: "dn", state: "pill" }, { text: "esday", state: "plain" }],
};

describe("FeedbackDto — spelling_hint i spellingDiff (issue #9)", () => {
  it("przyjmuje spelling_hint z segmentami diffu", () => {
    const parsed = FeedbackDtoSchema.safeParse({ kind: "spelling_hint", correctText: "Wednesday", spellingDiff: diff });
    expect(parsed.success).toBe(true);
  });

  it("przyjmuje spelling_hint z opcjonalną wskazówką kapitalizacyjną", () => {
    const parsed = FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, capitalizationHint: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("odrzuca spelling_hint bez spellingDiff", () => {
    const parsed = FeedbackDtoSchema.safeParse({ kind: "spelling_hint", correctText: "Wednesday" });
    expect(parsed.success).toBe(false);
  });

  it("odrzuca spellingDiff przy innych rodzajach feedbacku", () => {
    for (const kind of ["great", "incorrect", "almost", "capitalization_hint", "not_assessed", "content_matched"] as const) {
      const parsed = FeedbackDtoSchema.safeParse({ kind, correctText: "Wednesday", spellingDiff: diff });
      expect(parsed.success).toBe(false);
    }
  });

  it("odrzuca puste segmenty i nieznane stany", () => {
    expect(FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, given: [{ text: "", state: "plain" }] },
    }).success).toBe(false);
    expect(FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, expected: [{ text: "x", state: "bold" }] },
    }).success).toBe(false);
  });

  it("odrzuca spelling_hint, gdy segmenty expected nie składają się na correctText", () => {
    const parsed = FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, expected: [{ text: "Thursday", state: "plain" }] },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("segmenty odpowiedzi lekcji — kategoria „nie na temat” (Etap 6 szkoły)", () => {
  it("feedback lekcji przyjmuje segmenty offtopic, diff pisowni słówek — nie", () => {
    const answerSegments = [{ text: "Linia na mapie.", state: "pill" }, { text: " Grałem w piłkę.", state: "offtopic" }];
    expect(FeedbackDtoSchema.safeParse({ kind: "lesson_hint", hintPl: "Usuń to, co nie odpowiada na pytanie.", answerSegments }).success).toBe(true);
    const spellingDiff = { ...diff, given: [{ text: "Wendsday", state: "offtopic" }] };
    expect(FeedbackDtoSchema.safeParse({ kind: "spelling_hint", correctText: "Wednesday", spellingDiff }).success).toBe(false);
  });
});
