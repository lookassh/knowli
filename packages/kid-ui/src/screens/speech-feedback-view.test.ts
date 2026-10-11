import { describe, expect, it } from "vitest";
import { messages, type FeedbackDto } from "@learning/contracts";
import { describeSpeechFeedback } from "./speech-feedback-view";

const speech = {
  recognition: "matched" as const,
  pronunciation: "practice" as const,
  referenceText: "Thursday",
};

describe("describeSpeechFeedback", () => {
  it.each([
    [{ kind: "great", heardText: "Thursday", speech: { ...speech, pronunciation: "good" } }, messages.kid.feedbackGreat, "correct"],
    [{ kind: "almost", heardText: "Thursday", speech }, messages.kid.feedbackAlmost, "practice"],
    [{ kind: "incorrect", correctText: "Thursday", heardText: "Tuesday", speech: { ...speech, recognition: "different", pronunciation: "not_applicable" } }, "Ćwiczymy: Thursday", "practice"],
    [{ kind: "not_assessed", speech: { recognition: "uncertain", pronunciation: "not_applicable" } }, messages.kid.feedbackSpeechUncertain, "neutral"],
    [{ kind: "not_assessed", speech: { recognition: "no_speech", pronunciation: "not_applicable" } }, messages.kid.feedbackSpeechNoSpeech, "neutral"],
    [{ kind: "not_assessed", speech: { recognition: "unavailable", pronunciation: "not_applicable" } }, messages.kid.feedbackSpeechUnavailable, "neutral"],
  ] as const)("maps %j to an honest message and tone", (dto, message, tone) => {
    expect(describeSpeechFeedback(dto as FeedbackDto)).toMatchObject({ message, tone });
  });

  it("keeps a correct spoken answer positive while reporting pronunciation failure separately", () => {
    const view = describeSpeechFeedback({
      kind: "great",
      heardText: "Thursday",
      speech: { ...speech, pronunciation: "unavailable" },
    });
    expect(view).toMatchObject({
      message: messages.kid.feedbackGreat,
      pronunciationMessage: messages.kid.feedbackPronunciationUnavailable,
      tone: "correct",
    });
  });

  it("does not invent recognition details for legacy or null feedback", () => {
    expect(describeSpeechFeedback(null)).toEqual({
      message: messages.kid.feedbackNotAssessed,
      fragments: [],
      tone: "neutral",
    });
    expect(describeSpeechFeedback({ kind: "great" })).toEqual({
      message: messages.kid.feedbackGreat,
      fragments: [],
      tone: "correct",
    });
  });

  it("only gives local practice guidance when a fragment is explicitly marked almost", () => {
    const neutral = describeSpeechFeedback({
      kind: "almost",
      speech,
      fragments: [{ text: "Thurs", verdict: "unknown" }],
    });
    expect(neutral.fragments.some((fragment) => fragment.verdict === "almost")).toBe(false);
    const practice = describeSpeechFeedback({
      kind: "almost",
      speech,
      fragments: [{ text: "Thurs", verdict: "almost" }],
    });
    expect(practice.fragments.some((fragment) => fragment.verdict === "almost")).toBe(true);
    expect(practice.fragments).toEqual([{ text: "Thurs", verdict: "almost" }]);
  });
});
