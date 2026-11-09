import { describe, expect, it } from "vitest";
import { computeTargetKey } from "../../../target-key";
import { lessonExerciseTargetKey, lessonTextTargetKey } from "../../exposure-key";
import type { LessonExerciseDraft } from "../../types";
import { normalizeEnglishExposureText } from "../english/exposure";
import { grammarExposureText } from "./exposure";
import { englishGrammarSubject } from "./module";

const OBJ = "english_grammar.to_be.short_answers";

function draft(overrides: Partial<LessonExerciseDraft>): LessonExerciseDraft {
  return { exerciseType: "lesson_gap", objectiveId: OBJ, answer: "", acceptedAnswers: [], focus: [], ...overrides };
}

describe("grammarExposureText — ekspozycją jest rozwiązane zdanie albo wymiana (#373)", () => {
  it("luka: zdanie z wstawioną odpowiedzią", () => {
    const gap = draft({ stem: "He ___ football.", answer: "plays", focus: ["plays"] });
    expect(grammarExposureText(gap)).toBe("He plays football");
    expect(lessonExerciseTargetKey(englishGrammarSubject, gap)).toBe(computeTargetKey("he plays football", "en-GB"));
  });

  it("luka w wymianie: cała wymiana", () => {
    const gap = draft({ stem: "Are you hungry? Yes, I ___.", answer: "am", focus: ["am"] });
    expect(grammarExposureText(gap)).toBe("Are you hungry? Yes, I am");
  });

  it("wybór z luką: zdanie z wstawioną poprawną opcją", () => {
    const choice = draft({
      exerciseType: "lesson_choice",
      stem: "We ___ in the park.",
      options: [
        { id: "a", text: "am" },
        { id: "b", text: "are" },
      ],
      correctOption: "b",
      answer: "are",
    });
    expect(grammarExposureText(choice)).toBe("We are in the park");
  });

  it("wybór z pytaniem bez luki: pytanie razem z poprawną odpowiedzią", () => {
    const choice = draft({
      exerciseType: "lesson_choice",
      stem: "Are you at school?",
      options: [
        { id: "a", text: "No, I'm not." },
        { id: "b", text: "No, you aren't." },
      ],
      correctOption: "a",
      answer: "No, I'm not.",
    });
    expect(grammarExposureText(choice)).toBe("Are you at school? No, I'm not");
  });

  it("wybór ze słuchu: jak wybór", () => {
    const listen = draft({
      exerciseType: "lesson_listen_choice",
      stem: "I ___ in the garden.",
      options: [
        { id: "a", text: "am" },
        { id: "b", text: "are" },
      ],
      correctOption: "a",
      answer: "am",
    });
    expect(grammarExposureText(listen)).toBe("I am in the garden");
  });

  it("krótka odpowiedź: pytanie z prompt razem z poprawną opcją", () => {
    const shortAnswer = draft({
      exerciseType: "lesson_short_answer",
      prompt: "Is she your sister?",
      options: [
        { id: "a", text: "Yes, she is." },
        { id: "b", text: "Yes, she does." },
      ],
      correctOption: "a",
      answer: "Yes, she is.",
    });
    expect(grammarExposureText(shortAnswer)).toBe("Is she your sister? Yes, she is");
  });

  it("krótka odpowiedź: prompt wygrywa ze stem, a bez prompt pytanie bierze się ze stem", () => {
    const base = {
      exerciseType: "lesson_short_answer" as const,
      options: [{ id: "a", text: "Yes, she is." }],
      correctOption: "a",
      answer: "Yes, she is.",
    };
    expect(grammarExposureText(draft({ ...base, prompt: "Is she ready?", stem: "Is she your sister?" }))).toBe("Is she ready? Yes, she is");
    expect(grammarExposureText(draft({ ...base, stem: "Is she your sister?" }))).toBe("Is she your sister? Yes, she is");
    expect(grammarExposureText(draft({ ...base, prompt: "  " }))).toBe("Yes, she is");
  });

  it("tłumaczenie całej wymiany i ćwiczenie rozwiązujące tę wymianę mają ten sam klucz", () => {
    const translation = draft({ exerciseType: "lesson_open_answer", prompt: "Czy tata się spóźnia? Nie, nie spóźnia się.", answer: "Is Dad late? No, he isn't." });
    const gap = draft({ stem: "Is Dad late? No, he ___.", answer: "isn't", focus: ["isn't"] });
    expect(grammarExposureText(translation)).toBe(grammarExposureText(gap));
    expect(lessonExerciseTargetKey(englishGrammarSubject, translation)).toBe(lessonExerciseTargetKey(englishGrammarSubject, gap));
  });

  it("pozostałe typy: odpowiedź kanoniczna po normalizacji", () => {
    expect(grammarExposureText(draft({ exerciseType: "lesson_order", answer: "She is reading now." }))).toBe("She is reading now");
    expect(grammarExposureText(draft({ exerciseType: "lesson_notice", answer: "am" }))).toBe("am");
  });

  it("wynik jest już znormalizowany (normalizacja nic nie zmienia), a przedmiot udostępnia oba haki", () => {
    const gap = draft({ stem: " I’m  wearing a pink ___ . ", answer: "coat" });
    expect(grammarExposureText(gap)).toBe("I'm wearing a pink coat");
    expect(normalizeEnglishExposureText(grammarExposureText(gap))).toBe(grammarExposureText(gap));
    expect(englishGrammarSubject.exposureText).toBe(grammarExposureText);
    expect(englishGrammarSubject.normalizeExposureText).toBe(normalizeEnglishExposureText);
    expect(lessonTextTargetKey(englishGrammarSubject, "I’m wearing a pink coat.")).toBe(lessonExerciseTargetKey(englishGrammarSubject, gap));
  });
});
