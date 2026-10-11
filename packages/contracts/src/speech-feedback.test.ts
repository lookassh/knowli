import { describe, expect, it } from "vitest";
import { FeedbackDtoSchema, SpeechFeedbackDtoSchema } from "./kid";

describe("speech feedback contract", () => {
  it("keeps legacy feedback valid and accepts only public speech statuses", () => {
    expect(FeedbackDtoSchema.parse({ kind: "great" })).toEqual({ kind: "great" });
    expect(FeedbackDtoSchema.parse({
      kind: "almost",
      heardText: "Thursday",
      correctText: "Thursday",
      fragments: [{ text: "th", verdict: "unknown" }],
      speech: { recognition: "matched", pronunciation: "practice", referenceText: "Thursday" },
    }).speech).toEqual({ recognition: "matched", pronunciation: "practice", referenceText: "Thursday" });
    expect(SpeechFeedbackDtoSchema.safeParse({ recognition: "mystery", pronunciation: "good" }).success).toBe(false);
    expect(FeedbackDtoSchema.safeParse({ kind: "great", heardText: "a".repeat(201) }).success).toBe(false);
    expect(FeedbackDtoSchema.safeParse({ kind: "great", debugScore: 0.99 }).success).toBe(false);
  });

  it.each(["uncertain", "no_speech", "unavailable"] as const)(
    "does not permit disclosed text or fragments for %s recognition",
    (recognition) => {
      expect(FeedbackDtoSchema.safeParse({
        kind: "not_assessed",
        heardText: "Thursday",
        correctText: "Thursday",
        fragments: [{ text: "Th", verdict: "good" }],
        speech: { recognition, pronunciation: "not_applicable", referenceText: "Thursday" },
      }).success).toBe(false);
    },
  );
});
