import { describe, expect, it } from "vitest";
import { feedbackSentenceText } from "./feedback-sentence-text";

const items = (...texts: string[]) => texts.map((text, i) => ({ id: `i${i}`, text }));

describe("feedbackSentenceText", () => {
  it("lesson_gap wstawia odpowiedź w lukę", () => {
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "She ___ football.", answer: "plays" })).toBe("She plays football.");
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "She ____ football.", answer: "plays" })).toBe("She plays football.");
  });

  it("lesson_gap bez dokładnie jednej luki daje null", () => {
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "___ ___ football.", answer: "plays" })).toBeNull();
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "She plays football.", answer: "plays" })).toBeNull();
  });

  it("lesson_choice wstawia tekst poprawnej opcji", () => {
    const options = [{ id: "a", text: "He" }, { id: "b", text: "She" }];
    expect(feedbackSentenceText({ exerciseType: "lesson_choice", stem: "___ is happy.", options, correctOption: "b" })).toBe("She is happy.");
    expect(feedbackSentenceText({ exerciseType: "lesson_choice", stem: "Is happy.", options, correctOption: "b" })).toBeNull();
    expect(feedbackSentenceText({ exerciseType: "lesson_choice", stem: "___ is happy.", options, correctOption: "z" })).toBeNull();
  });

  it("lesson_order skleja klocki w kolejności kanonicznej", () => {
    expect(feedbackSentenceText({ exerciseType: "lesson_order", items: items("She", "plays", "football", ".") })).toBe("She plays football.");
    expect(feedbackSentenceText({ exerciseType: "lesson_order", items: items("Yes", ",", "I", "am", ".") })).toBe("Yes, I am.");
  });

  it.each(["lesson_error_fix", "lesson_transform", "lesson_open_answer"])("%s czyta odpowiedź", (exerciseType) => {
    expect(feedbackSentenceText({ exerciseType, answer: "  She  plays football every day. " })).toBe("She plays football every day.");
  });

  it.each([
    "lesson_card", "lesson_notice", "lesson_short_answer", "lesson_match",
    "lesson_group", "lesson_cloze", "lesson_calculation", "lesson_keywords",
  ])("%s nie ma zdania", (exerciseType) => {
    expect(feedbackSentenceText({ exerciseType, answer: "She plays football." })).toBeNull();
  });

  it("odrzuca zdanie dłuższe niż 200 znaków", () => {
    expect(feedbackSentenceText({ exerciseType: "lesson_error_fix", answer: "a".repeat(201) })).toBeNull();
    expect(feedbackSentenceText({ exerciseType: "lesson_error_fix", answer: "a".repeat(200) })).toBe("a".repeat(200));
  });
});
