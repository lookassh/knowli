import { describe, expect, it } from "vitest";
import { lessonPromptStyle, sentenceCount } from "./tts-style";

describe("sentenceCount", () => {
  it("liczy zdania po normalizacji odstępów, także z końcem tekstu bez kropki", () => {
    expect(sentenceCount("  Ala ma kota.  Kot ma Alę ")).toBe(2);
    expect(sentenceCount("Ala\n\nma   kota.\tKot ma Alę")).toBe(2);
  });

  it("zwraca 0 dla pustego tekstu i samych odstępów lub interpunkcji", () => {
    expect(sentenceCount("")).toBe(0);
    expect(sentenceCount("   \n ")).toBe(0);
    expect(sentenceCount("...")).toBe(0);
  });

  it("uznaje ., !, ? i … za koniec zdania", () => {
    expect(sentenceCount("Ile? Dwa!")).toBe(2);
    expect(sentenceCount("Cisza… Słychać sowę.")).toBe(2);
  });

  it("traktuje ciąg znaków kończących jak jedną granicę", () => {
    expect(sentenceCount("Czy wiesz, że…? Sowy widzą w nocy.")).toBe(2);
    expect(sentenceCount("Co?! Naprawdę...")).toBe(2);
  });

  it("nie dzieli na kropce w środku wyrazu lub liczby", () => {
    expect(sentenceCount("To kosztuje 3.5 zł.")).toBe(1);
  });
});

describe("lessonPromptStyle", () => {
  it("bez tonu zwraca rolę", () => {
    expect(lessonPromptStyle("lesson_card", undefined, "A.")).toBe("lesson_card");
    expect(lessonPromptStyle("lesson_question", undefined, "A.")).toBe("lesson_question");
  });

  it("z tonem zwraca ton", () => {
    expect(lessonPromptStyle("lesson_question", "cheerful", "A.")).toBe("cheerful");
    expect(lessonPromptStyle("lesson_card", "gentle", "A.")).toBe("gentle");
    expect(lessonPromptStyle("lesson_card", "curious", "A.")).toBe("curious");
  });

  it("zamienia szept na ciekawość, gdy tekst ma mniej niż dwa zdania", () => {
    expect(lessonPromptStyle("lesson_card", "mysterious", "Czy wiesz, że sowy widzą w nocy?")).toBe("curious");
    expect(lessonPromptStyle("lesson_question", "mysterious", "")).toBe("curious");
  });

  it("zostawia szept dla tekstu z co najmniej dwoma zdaniami", () => {
    expect(lessonPromptStyle("lesson_card", "mysterious", "Czy wiesz, że…? Sowy widzą w nocy.")).toBe("mysterious");
    expect(lessonPromptStyle("lesson_question", "mysterious", "Cisza. Co to?")).toBe("mysterious");
  });
});
