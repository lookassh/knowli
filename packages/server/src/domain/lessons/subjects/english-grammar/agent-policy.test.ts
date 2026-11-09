import { describe, expect, it } from "vitest";
import { grammarAgentPolicy } from "./agent-policy";
import { englishGrammarSubject } from "./module";

describe("grammarAgentPolicy", () => {
  it("moduł gramatyki składa pola generowania z polityki, bez sanitize", () => {
    expect(englishGrammarSubject.checkerNeedsMaterial).toBe(false);
    expect(englishGrammarSubject.ruleNotes).toBe(grammarAgentPolicy.ruleNotes);
    expect(englishGrammarSubject.typeExamples).toBe(grammarAgentPolicy.typeExamples);
    expect(englishGrammarSubject.sanitize).toBeUndefined();
  });

  it("przykłady typów: w tematach „to be” i Present Continuous każdy cel ma przykład każdego swojego typu, poza nimi przykłady kart", () => {
    for (const topic of englishGrammarSubject.topics) {
      for (const objective of topic.objectives) {
        const examples = grammarAgentPolicy.typeExamples?.({ topicId: topic.id, objectiveId: objective.id });
        if (topic.id !== "to_be" && topic.id !== "present_continuous") {
          expect(examples, objective.id).toBeUndefined();
          continue;
        }
        expect(Object.keys(examples ?? {}).sort(), objective.id)
          .toEqual(objective.exerciseTypes.filter((type) => type !== "lesson_card").sort());
        for (const [type, example] of Object.entries(examples ?? {})) expect(example?.exerciseType, objective.id).toBe(type);
      }
    }
    expect(grammarAgentPolicy.typeExamples?.({ topicId: "to_be", objectiveId: "english_grammar.to_be.unknown" })).toBeUndefined();
    // Cele o tej samej nazwie w dwóch tematach (questions) mają przykłady swojego tematu.
    expect(grammarAgentPolicy.typeExamples?.({ topicId: "present_continuous", objectiveId: "english_grammar.present_continuous.questions" })?.lesson_choice)
      .not.toEqual(grammarAgentPolicy.typeExamples?.({ topicId: "to_be", objectiveId: "english_grammar.to_be.questions" })?.lesson_choice);
  });

  it("jedyny dopisek reguły to duplikat wariantu (reguła rdzenia w sekcji ogólnej księgi)", () => {
    expect(Object.keys(grammarAgentPolicy.ruleNotes ?? {})).toEqual(["variants.duplicate"]);
  });
});
