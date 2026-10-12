import { describe, expect, it } from "vitest";
import { englishGrammarSubject } from "./module";
import { createProductionSubjectRegistry, PRODUCTION_SUBJECTS } from "../index";
import { validateSubject } from "../../catalog-validation";

describe("englishGrammarSubject — spójność katalogu", () => {
  it("validateSubject zwraca pustą listę (katalog poprawny)", () => {
    expect(validateSubject(englishGrammarSubject)).toEqual([]);
  });

  it("metadane przedmiotu zgodne z briefem", () => {
    expect(englishGrammarSubject.id).toBe("english_grammar");
    expect(englishGrammarSubject.titlePl).toBe("Angielski — gramatyka");
    expect(englishGrammarSubject.answerLocale).toBe("en-GB");
    expect(englishGrammarSubject.promptLocale).toBe("pl-PL");
    expect(englishGrammarSubject.ttsForAnswers).toBe(true);
  });

  it("obsługuje wszystkie 9 typów ćwiczeń", () => {
    expect([...englishGrammarSubject.exerciseTypes].sort()).toEqual(
      [
        "lesson_card",
        "lesson_choice",
        "lesson_error_fix",
        "lesson_gap",
        "lesson_notice",
        "lesson_open_answer",
        "lesson_order",
        "lesson_short_answer",
        "lesson_transform",
      ].sort(),
    );
  });
});

describe("createProductionSubjectRegistry", () => {
  it("PRODUCTION_SUBJECTS zawiera english_grammar", () => {
    expect(PRODUCTION_SUBJECTS).toContain(englishGrammarSubject);
  });

  it("rejestr udostępnia przedmiot i temat present_simple@1", () => {
    const registry = createProductionSubjectRegistry();
    expect(registry.getSubject("english_grammar")).toBe(englishGrammarSubject);
    const topic = registry.getTopic("english_grammar", "present_simple", 1);
    expect(topic?.id).toBe("present_simple");
    expect(topic?.version).toBe(1);
    expect(topic?.titlePl).toBe("Present Simple");
  });
});

describe("temat present_simple — 7 celów", () => {
  const topic = englishGrammarSubject.topics.find((t) => t.id === "present_simple")!;

  it("ma dokładnie 7 celów w kolejności nauki", () => {
    expect(topic.objectives.map((o) => o.id)).toEqual([
      "english_grammar.present_simple.affirmative_base",
      "english_grammar.present_simple.third_person_s",
      "english_grammar.present_simple.spelling_es_ies",
      "english_grammar.present_simple.negative",
      "english_grammar.present_simple.question",
      "english_grammar.present_simple.short_answers",
      "english_grammar.present_simple.base_form_after_does",
    ]);
  });

  it("każdy cel ma kategorie błędów z szablonami podpowiedzi", () => {
    for (const objective of topic.objectives) {
      expect(objective.errorCategories.length).toBeGreaterThanOrEqual(2);
      for (const code of objective.errorCategories) {
        expect(objective.hints[code]).toBeTruthy();
      }
    }
  });

  it("każdy cel ma co najmniej jedną kartę z miejscem {{examples}}", () => {
    for (const objective of topic.objectives) {
      const hasExamples = objective.cards.some(
        (card) => card.title.includes("{{examples}}") || card.body.includes("{{examples}}"),
      );
      expect(hasExamples, `cel ${objective.id} bez {{examples}}`).toBe(true);
    }
  });

  it("ma trzy przekształcenia tematu", () => {
    expect(topic.transforms.map((t) => t.id).sort()).toEqual(
      ["to_affirmative", "to_negative", "to_question"].sort(),
    );
  });
});
