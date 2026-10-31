import { describe, expect, it } from "vitest";
import type { FeedbackDto } from "@learning/contracts";
import { withFeedbackSentenceAudio } from "./lesson-attempts";

type Key = Parameters<typeof withFeedbackSentenceAudio>[1];

const ASSET = "11111111-1111-4111-8111-111111111111";
const key = (feedbackAudioAssetId?: string, extra: Partial<Key> = {}): Key => ({
  exerciseType: "lesson_gap", answer: "goes", acceptedAnswers: [], focus: ["goes"],
  objectiveId: "o", subjectId: "english_grammar", targetKey: "tk",
  ...(feedbackAudioAssetId ? { feedbackAudioAssetId } : {}),
  ...extra,
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

  describe("bramka wariantu: dziecko nie słyszy innego zdania, niż pokazuje omówienie", () => {
    const translation = key(ASSET, {
      exerciseType: "lesson_open_answer", answer: "I'm wearing a coat today.", acceptedAnswers: ["Today I'm wearing a coat."], focus: ["coat"],
      subjectId: "english_chapter",
    });

    it.each<FeedbackDto>([
      { kind: "lesson_almost", correctText: "Today I'm wearing a coat." },
      { kind: "lesson_hint", hintPl: "Sprawdź słowo.", correctText: "Today I'm wearing a coat." },
      { kind: "incorrect", correctText: "Today I'm wearing a coat." },
    ])("$kind z innym zatwierdzonym wariantem niż kanoniczny — bez nagrania", (feedback) => {
      expect(withFeedbackSentenceAudio(feedback, translation)).toEqual(feedback);
    });

    it("pokazany wariant równy kanonicznemu — z nagraniem; `great` bez correctText — z nagraniem", () => {
      const almost: FeedbackDto = { kind: "lesson_almost", correctText: "I'm wearing a coat today." };
      expect(withFeedbackSentenceAudio(almost, translation)).toEqual({ ...almost, correctAudioAssetId: ASSET });
      expect(withFeedbackSentenceAudio({ kind: "great" }, translation)).toEqual({ kind: "great", correctAudioAssetId: ASSET });
    });

    it.each([
      { exerciseType: "lesson_transform", answer: "She plays football.", variant: "Yes, she plays football." },
      { exerciseType: "lesson_error_fix", answer: "He goes to school.", variant: "He goes to school every day." },
    ])("gramatyka ($exerciseType): „prawie” z innym zatwierdzonym wariantem — bez nagrania; z kanoniczną odpowiedzią — z nagraniem", ({ exerciseType, answer, variant }) => {
      const grammar = key(ASSET, { exerciseType, answer, acceptedAnswers: [variant], subjectId: "english_grammar" } as Partial<Key>);
      const shownVariant: FeedbackDto = { kind: "lesson_almost", correctText: variant };
      expect(withFeedbackSentenceAudio(shownVariant, grammar)).toEqual(shownVariant);
      const shownCanonical: FeedbackDto = { kind: "lesson_almost", correctText: answer };
      expect(withFeedbackSentenceAudio(shownCanonical, grammar)).toEqual({ ...shownCanonical, correctAudioAssetId: ASSET });
    });

    it("tekst kanoniczny typu zamkniętego to pokazany tekst rozwiązania (opcja, luki z bankiem, klocki)", () => {
      const choice = key(ASSET, { exerciseType: "lesson_choice", answer: "coat", correctOptionId: "o1", optionValues: { o1: "coat", o2: "dress" } });
      expect(withFeedbackSentenceAudio({ kind: "incorrect", correctText: "coat" }, choice)?.correctAudioAssetId).toBe(ASSET);
      expect(withFeedbackSentenceAudio({ kind: "incorrect", correctText: "dress" }, choice)?.correctAudioAssetId).toBeUndefined();

      const cloze = key(ASSET, { exerciseType: "lesson_cloze", answer: "coat, boots", filledText: "I'm wearing a coat and boots." });
      expect(withFeedbackSentenceAudio({ kind: "incorrect", correctText: "I'm wearing a coat and boots." }, cloze)?.correctAudioAssetId).toBe(ASSET);
      expect(withFeedbackSentenceAudio({ kind: "incorrect", correctText: "coat, boots" }, cloze)?.correctAudioAssetId).toBeUndefined();

      const order = key(ASSET, { exerciseType: "lesson_order", answer: "I'm wearing a coat", itemIds: ["a", "b", "c"], itemValues: { a: "I'm", b: "wearing", c: "a coat" } });
      expect(withFeedbackSentenceAudio({ kind: "incorrect", correctText: "I'm wearing a coat" }, order)?.correctAudioAssetId).toBe(ASSET);
    });
  });
});
