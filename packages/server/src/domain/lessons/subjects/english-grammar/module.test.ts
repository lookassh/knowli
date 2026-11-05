import { describe, expect, it } from "vitest";
import { englishGrammarSubject } from "./module";
import { englishGrammarPrompts } from "./prompts";
import { validateEnglishGrammarExercise } from "./validators";
import { presentSimpleV1 } from "./topics/present-simple";
import { toBeV1 } from "./topics/to-be";
import { presentContinuousV1, STORY_MIX_SENTENCE } from "./topics/present-continuous";
import { answersEquivalent, validateLessonExercise } from "../../pool-validation";
import { createProductionSubjectRegistry, PRODUCTION_SUBJECTS } from "../index";
import { validateSubject } from "../../catalog-validation";
import type { LessonExerciseDraft } from "../../types";

describe("englishGrammarSubject — spójność katalogu", () => {
  it("validateSubject zwraca pustą listę (katalog poprawny)", () => {
    expect(validateSubject(englishGrammarSubject)).toEqual([]);
  });

  it("metadane przedmiotu zgodne z briefem", () => {
    expect(englishGrammarSubject.id).toBe("english_grammar");
    expect(englishGrammarSubject.titlePl).toBe("Angielski — gramatyka");
    expect(englishGrammarSubject.answerLocale).toBe("en-GB");
    expect(englishGrammarSubject.promptLocale).toBe("pl-PL");
    expect(englishGrammarSubject.ttsForAnswers).toBe(false);
    expect(englishGrammarSubject.ttsForFeedbackSentence).toBe(true);
    expect(englishGrammarSubject.exerciseExplanations).toBe(true);
  });

  it("english grammar enables end-of-session story with rules", () => {
    expect(englishGrammarSubject.lessonStory).toBe(true);
    expect(englishGrammarSubject.prompts.storyRules?.trim()).toBeTruthy();
    // Tylko formy celów z żądania, nie wszystkich reguł tematu.
    expect(englishGrammarSubject.prompts.storyRules).toContain("Use only the grammar forms of the objectives listed above");
    expect(englishGrammarSubject.prompts.storyRules).not.toContain("several rules of the topic");
  });

  it("obsługuje wszystkie 10 typów ćwiczeń", () => {
    expect([...englishGrammarSubject.exerciseTypes].sort()).toEqual(
      [
        "lesson_card",
        "lesson_choice",
        "lesson_error_fix",
        "lesson_gap",
        "lesson_listen_choice",
        "lesson_notice",
        "lesson_open_answer",
        "lesson_order",
        "lesson_short_answer",
        "lesson_transform",
      ].sort(),
    );
  });

  it("fieldRules profilu promptów definiują semantykę hint dla lesson_gap (walidator traktuje hint jako bezokolicznik)", () => {
    // Incydent 2026-10-13 (deepseek): polskie słowa z materiału w hint →
    // odrzucenie przez validateEnglishGrammarExercise. Reguła musi precyzować:
    // angielska forma podstawowa, kontrprzykłady, widoczność dla dziecka.
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).not.toBe("");
    expect(rules).toMatch(/base form|infinitive/i);
    expect(rules).toContain("plays");
    expect(rules).toMatch(/never put polish/i);
    expect(rules).toMatch(/hint/i);
  });

  it("fieldRules definiują reguły tematu to_be dla generacji puli", () => {
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).toContain(".to_be.");
    expect(rules).toMatch(/am, is or are matching the subject/);
    expect(rules).toMatch(/never use do or does/);
    expect(rules).toMatch(/only the form itself/);
  });

  it("tylko gramatyka przyjmuje tematy zdań: reguła ma kluczowe zakazy, inne przedmioty jej nie mają (#197)", () => {
    const rule = englishGrammarSubject.prompts.interestsRule ?? "";
    for (const fragment of ["lesson_gap, lesson_listen_choice, lesson_order", "lesson_error_fix, lesson_transform and in the examples", "an English narrator reads naturally", "lesson_open_answer", "visualSubject",
      "In every objective, set about two in five of its exercises", "about one in three of all exercises", "never more than half", "rotate through all the listed topics", "sound natural to a native speaker", "never as 'be with' a theme noun",
      "may appear as a plain noun", "never quote or retell", "never The dinosaur eats apples.", "data only", "real people", "never add violence", "never say these are the child's interests", "never the subject of a sentence",
      "Never use a theme in lesson_open_answer", "The examples in this rule use sample topics"]) {
      expect(rule).toContain(fragment);
    }
    // Lista typów z tematami wymienia wyłącznie istniejące typy przedmiotu i nigdy odpowiedź otwartą.
    const themedTypes = /only in (.+?) and in the examples/.exec(rule)?.[1]?.split(", ") ?? [];
    expect(themedTypes).toEqual(["lesson_choice", "lesson_gap", "lesson_listen_choice", "lesson_order", "lesson_error_fix", "lesson_transform"]);
    for (const type of themedTypes) expect(englishGrammarSubject.exerciseTypes).toContain(type);
    expect(PRODUCTION_SUBJECTS.find((s) => s.id === "school")?.prompts.interestsRule).toBeUndefined();
    expect(PRODUCTION_SUBJECTS.find((s) => s.id === "english_chapter")?.prompts.interestsRule).toBeUndefined();
    expect(PRODUCTION_SUBJECTS.filter((s) => s.prompts.interestsRule !== undefined).map((s) => s.id)).toEqual(["english_grammar"]);
  });

  it("przykłady fieldRules są legalne wobec walidatora i normalizatora przedmiotu (kontrakt prompt↔walidacja)", () => {
    // Review C2: odpowiedzi wielosłowowe z podmiotem („does she play”) NIE
    // przechodzą walidatora przy ustawionym hint — fieldRules nie może ich
    // obiecywać jako dopuszczalnej odpowiedzi luki.
    expect(englishGrammarPrompts.fieldRules).not.toContain("does she play");

    // Formy wymieniane w fieldRules (forma 3. osoby, operator + not + bezokolicznik)
    // przechodzą walidację przy hint = bezokolicznik.
    const gap = (hint: string, answer: string): LessonExerciseDraft => ({
      exerciseType: "lesson_gap",
      objectiveId: "english_grammar.present_simple.third_person_s",
      stem: "He ___ every day.",
      hint,
      answer,
      acceptedAnswers: [],
      focus: answer.split(" "),
    });
    expect(validateEnglishGrammarExercise(gap("play", "plays"), presentSimpleV1)).toEqual([]);
    expect(validateEnglishGrammarExercise(gap("play", "doesn't play"), presentSimpleV1)).toEqual([]);
    expect(validateEnglishGrammarExercise(gap("play", "does she play"), presentSimpleV1).length).toBeGreaterThan(0);

    // Review C1: rozwinięcie skrótu jest równoważne kanonicznej po normalizatorze
    // (zakazany wariant acceptedAnswers); krótsza forma bez podmiotu jest legalna.
    const normalizer = englishGrammarSubject.normalizer;
    expect(answersEquivalent("doesn't play", "does not play", normalizer)).toBe(true);
    expect(answersEquivalent("she doesn't play", "doesn't play", normalizer)).toBe(false);
  });
});

describe("createProductionSubjectRegistry", () => {
  it("PRODUCTION_SUBJECTS zawiera english_grammar", () => {
    expect(PRODUCTION_SUBJECTS).toContain(englishGrammarSubject);
  });

  it("rejestr udostępnia temat to_be@1", () => {
    const registry = createProductionSubjectRegistry();
    const topic = registry.getTopic("english_grammar", "to_be", 1);
    expect(topic?.id).toBe("to_be");
    expect(topic?.version).toBe(1);
    expect(topic?.titlePl).toBe("Czasownik „to be”");
  });

  it("rejestr udostępnia temat present_continuous@1", () => {
    const registry = createProductionSubjectRegistry();
    const topic = registry.getTopic("english_grammar", "present_continuous", 1);
    expect(topic).toBe(presentContinuousV1);
    expect(topic?.id).toBe("present_continuous");
    expect(topic?.version).toBe(1);
    expect(topic?.titlePl).toBe("Present Continuous");
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

const TOPIC_CASES = [
  {
    id: "to_be",
    objectiveIds: [
      "english_grammar.to_be.affirmative_forms",
      "english_grammar.to_be.contractions",
      "english_grammar.to_be.negative_forms",
      "english_grammar.to_be.questions",
      "english_grammar.to_be.short_answers",
    ],
  },
  {
    id: "present_simple",
    objectiveIds: [
      "english_grammar.present_simple.affirmative_base",
      "english_grammar.present_simple.third_person_s",
      "english_grammar.present_simple.spelling_es_ies",
      "english_grammar.present_simple.negative",
      "english_grammar.present_simple.question",
      "english_grammar.present_simple.short_answers",
      "english_grammar.present_simple.base_form_after_does",
    ],
  },
  {
    id: "present_continuous",
    objectiveIds: [
      "english_grammar.present_continuous.affirmative",
      "english_grammar.present_continuous.now_or_usually",
      "english_grammar.present_continuous.negative",
      "english_grammar.present_continuous.questions",
      "english_grammar.present_continuous.ing_spelling",
      "english_grammar.present_continuous.now_or_usually_more",
    ],
  },
] as const;

for (const topicCase of TOPIC_CASES) {
  describe(`temat ${topicCase.id} — spójność katalogu`, () => {
    const topic = englishGrammarSubject.topics.find((t) => t.id === topicCase.id)!;

    it("ma cele w oczekiwanej kolejności nauki", () => {
      expect(topic.objectives.map((o) => o.id)).toEqual(topicCase.objectiveIds);
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

    it("każdy cel ma 2–4 karty", () => {
      for (const objective of topic.objectives) {
        expect(objective.cards.length, objective.id).toBeGreaterThanOrEqual(2);
        expect(objective.cards.length, objective.id).toBeLessThanOrEqual(4);
      }
    });

    it("ma trzy przekształcenia tematu", () => {
      expect(topic.transforms.map((t) => t.id).sort()).toEqual(
        ["to_affirmative", "to_negative", "to_question"].sort(),
      );
    });
  });
}

describe("englishGrammarSubject — wybór ze słuchu (#198)", () => {
  const typesOf = (topic: { objectives: readonly { id: string; exerciseTypes: readonly string[] }[] }, suffix: string) =>
    topic.objectives.find((objective) => objective.id.endsWith(suffix))?.exerciseTypes ?? [];

  it("cele ze słyszalną różnicą formy dostają lesson_listen_choice", () => {
    for (const suffix of [".affirmative_base", ".third_person_s", ".negative", ".question"]) {
      expect(typesOf(presentSimpleV1, suffix), suffix).toContain("lesson_listen_choice");
    }
    for (const suffix of [".affirmative_forms", ".negative_forms", ".questions"]) {
      expect(typesOf(toBeV1, suffix), suffix).toContain("lesson_listen_choice");
    }
    for (const suffix of [".affirmative", ".negative", ".questions"]) {
      expect(typesOf(presentContinuousV1, suffix), suffix).toContain("lesson_listen_choice");
    }
  });

  it("cele pisowni, krótkich odpowiedzi i formy po does nie dostają typu", () => {
    for (const suffix of [".spelling_es_ies", ".short_answers", ".base_form_after_does"]) {
      expect(typesOf(presentSimpleV1, suffix), suffix).not.toContain("lesson_listen_choice");
    }
    for (const suffix of [".contractions", ".short_answers"]) {
      expect(typesOf(toBeV1, suffix), suffix).not.toContain("lesson_listen_choice");
    }
    // Cele porównania: lektor czytałby wskaźnik czasu, więc słuch nie sprawdzałby wyboru czasu.
    for (const suffix of [".now_or_usually", ".ing_spelling", ".now_or_usually_more"]) {
      expect(typesOf(presentContinuousV1, suffix), suffix).not.toContain("lesson_listen_choice");
    }
  });

  it("poprawne ćwiczenie ze słuchu dla to_be.questions przechodzi walidację (Is/Are otwierające pytanie)", () => {
    const draft: LessonExerciseDraft = {
      exerciseType: "lesson_listen_choice",
      objectiveId: "english_grammar.to_be.questions",
      stem: "___ she happy?",
      options: [{ id: "a", text: "Is" }, { id: "b", text: "Are" }],
      correctOption: "a",
      answer: "Is",
      acceptedAnswers: [],
      focus: ["Is"],
    };
    expect(validateLessonExercise(draft, englishGrammarSubject, toBeV1)).toEqual([]);
  });

  it("wersje tematów bez zmian", () => {
    expect(presentSimpleV1.version).toBe(1);
    expect(toBeV1.version).toBe(1);
    expect(presentContinuousV1.version).toBe(1);
    expect(Object.fromEntries(englishGrammarSubject.topics.map((topic) => [topic.id, topic.version]))).toEqual({
      present_simple: 1,
      to_be: 1,
      present_continuous: 1,
    });
  });

  it("fieldRules opisują regułę typu: jedna luka, słyszalna różnica, bez równoważnych opcji i bez instructionPl", () => {
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).toContain("lesson_listen_choice");
    expect(rules).toMatch(/at most 12 words/);
    expect(rules).toMatch(/exactly one gap/);
    expect(rules).toMatch(/audibly/i);
    expect(rules).toMatch(/never offer an equivalent/i);
    expect(rules).toMatch(/apostrophe/);
    expect(rules).toMatch(/instructionPl.*hint.*visualSubject/s);
  });

  it("fieldRules zabraniają sybilantu zaraz za luką przy opcjach różnych o -s (końcówka zlewa się w mowie)", () => {
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).toMatch(/-s ending that adds no syllable.*right after the gap.*s, z or sh sound/s);
    expect(rules).toContain("This does not apply to Do / Does or watch / watches");
    expect(rules).toContain("never He ___ snakes. or She ___ soccer.");
  });
});

describe("temat present_continuous — cele, kategorie i opisy (spec §3, §7.3, §9)", () => {
  const PC = "english_grammar.present_continuous";
  const objective = (suffix: string) => presentContinuousV1.objectives.find((o) => o.id === `${PC}.${suffix}`)!;
  const COMPARISON = ["now_or_usually", "now_or_usually_more"] as const;

  it("typy ćwiczeń celów zgodne z tabelą §3.1", () => {
    const types = Object.fromEntries(
      presentContinuousV1.objectives.map((o) => [o.id.slice(PC.length + 1), [...o.exerciseTypes].sort()]),
    );
    const lesson = (...names: string[]) => names.map((name) => `lesson_${name}`).sort();
    expect(types).toEqual({
      affirmative: lesson("card", "notice", "choice", "listen_choice", "order", "gap", "error_fix", "open_answer"),
      now_or_usually: lesson("card", "choice", "gap", "error_fix", "open_answer"),
      negative: lesson("card", "choice", "listen_choice", "gap", "error_fix", "transform", "open_answer"),
      questions: lesson("card", "choice", "listen_choice", "order", "short_answer", "gap", "transform", "open_answer"),
      ing_spelling: lesson("card", "choice", "gap", "error_fix", "open_answer"),
      now_or_usually_more: lesson("card", "choice", "gap", "error_fix", "open_answer"),
    });
  });

  it("kategorie błędów tematu i ich przypisanie do celów zgodne z §3.3", () => {
    expect(presentContinuousV1.extraErrorCategories.map((c) => c.code)).toEqual([
      "wrong_be_form",
      "missing_be_form",
      "missing_ing",
      "ing_spelling",
      "be_plus_simple",
      "continuous_for_habit",
      "simple_for_now",
    ]);
    const categories = Object.fromEntries(
      presentContinuousV1.objectives.map((o) => [o.id.slice(PC.length + 1), [...o.errorCategories]]),
    );
    expect(categories).toEqual({
      affirmative: ["missing_be_form", "wrong_be_form", "missing_ing"],
      now_or_usually: ["continuous_for_habit", "simple_for_now", "be_plus_simple"],
      negative: ["wrong_negation", "missing_be_form", "wrong_be_form", "missing_ing", "extra_auxiliary"],
      questions: ["word_order", "missing_be_form", "wrong_be_form", "extra_auxiliary", "short_answer_form", "missing_ing"],
      ing_spelling: ["ing_spelling", "missing_ing"],
      now_or_usually_more: ["continuous_for_habit", "simple_for_now", "be_plus_simple"],
    });
  });

  it("przekształcenia mają te same polecenia co Present Simple", () => {
    expect(presentContinuousV1.transforms).toEqual(presentSimpleV1.transforms);
  });

  it("cele porównania nie mają kategorii formy, a opis definiuje werdykt wyboru czasu (§7.3)", () => {
    for (const suffix of COMPARISON) {
      const o = objective(suffix);
      for (const formCategory of ["missing_ending", "wrong_auxiliary", "extra_ending"]) {
        expect(o.errorCategories, `${suffix}: ${formCategory}`).not.toContain(formCategory);
      }
      expect(o.descriptionEn).toContain("The checked element is the choice of tense");
      expect(o.descriptionEn).toContain("'almost' with errorCategory: null");
      for (const code of ["continuous_for_habit", "simple_for_now", "be_plus_simple"]) {
        expect(o.descriptionEn, `${suffix}: ${code}`).toContain(code);
      }
    }
  });

  it("podpowiedzi celów porównania powtarzają refren „teraz czy zwykle?” (§3.3)", () => {
    for (const suffix of COMPARISON) {
      for (const hint of Object.values(objective(suffix).hints)) {
        expect(hint, suffix).toContain("Zapytaj siebie: teraz czy zwykle?");
      }
    }
  });

  it("zdanie o mieszaniu czasów w historyjce jest w opisie dokładnie celów porównania (§9)", () => {
    expect(STORY_MIX_SENTENCE).toBe("The end-of-lesson story may mix present simple and present continuous.");
    const withStoryMix = englishGrammarSubject.topics
      .flatMap((topic) => topic.objectives)
      .filter((o) => o.descriptionEn.includes(STORY_MIX_SENTENCE))
      .map((o) => o.id);
    expect(withStoryMix).toEqual([`${PC}.now_or_usually`, `${PC}.now_or_usually_more`]);
  });

  it("karty uczą trudnej pisowni -ing i pary jedzie/jeździ (§3.2)", () => {
    const text = (suffix: string) => objective(suffix).cards.map((card) => `${card.title} ${card.body}`).join(" ");
    for (const fragment of ["write → writing (jedno t!)", "tie → tying", "jump → jumping", "fix → fixing", "run → running"]) {
      expect(text("ing_spelling")).toContain(fragment);
    }
    expect(text("now_or_usually")).toContain("jedzie");
    expect(text("now_or_usually")).toContain("jeździ");
  });
});
