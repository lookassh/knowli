import { describe, expect, it } from "vitest";
import type { FeedbackDto } from "@learning/contracts";
import { withFeedbackSentenceAudio } from "./lesson-attempts";

type Key = Parameters<typeof withFeedbackSentenceAudio>[1];

const ASSET = "11111111-1111-4111-8111-111111111111";
const key = (feedbackAudioAssetId?: string): Key => ({
  exerciseType: "lesson_gap", answer: "goes", acceptedAnswers: [], focus: ["goes"],
  objectiveId: "o", subjectId: "english_grammar", targetKey: "tk",
  ...(feedbackAudioAssetId ? { feedbackAudioAssetId } : {}),
}) as Key;

describe("withFeedbackSentenceAudio", () => {
  it.each<FeedbackDto>([
    { kind: "great" },
    { kind: "incorrect", correctText: "goes" },
    { kind: "lesson_almost", correctText: "goes" },
    { kind: "lesson_hint", hintPl: "Dodaj -s.", correctText: "goes" },
  ])("feedback ujawniający rozwiązanie ($kind) dostaje nagranie z klucza", (feedback) => {
    expect(withFeedbackSentenceAudio(feedback, key(ASSET))).toEqual({ ...feedback, correctAudioAssetId: ASSET });
  });

  it.each<FeedbackDto | null>([
    null,
    { kind: "not_assessed" },
    { kind: "lesson_hint", hintPl: "Dodaj -s." },
    { kind: "lesson_precision_hint", hintPl: "Skróć odpowiedź." },
  ])("bez ujawnienia rozwiązania albo przy ofercie trenera — bez nagrania (%o)", (feedback) => {
    expect(withFeedbackSentenceAudio(feedback, key(ASSET))).toEqual(feedback);
  });

  it("klucz bez nagrania (kartkówka, nagranie niegotowe przy wydaniu) zostawia feedback", () => {
    expect(withFeedbackSentenceAudio({ kind: "great" }, key())).toEqual({ kind: "great" });
  });
});
