import { defineRules, issueFrom } from "../../rules/catalog";
import { ENGLISH_RULES } from "../english/rules";

/**
 * Katalog reguł przedmiotu `english_grammar` (`validateExercise`) ze wspólnym
 * fragmentem angielskim. Opisy po angielsku dla modelu agenta; zgłoszenia
 * składają walidatory przez `grammarIssue`.
 */
export const GRAMMAR_RULES = defineRules({
  ...ENGLISH_RULES,
  "grammar.visual_answer_pronoun": {
    field: "answer",
    kind: "reject",
    description:
      "When visualSubject is set, the answer starts with the personal pronoun the picture requires " +
      "(boy and man: he, girl and woman: she, group: they, dog: it).",
  },
  "grammar.visual_option_pronoun": {
    field: "options",
    kind: "reject",
    description: "When visualSubject is set, the option marked correct starts with the personal pronoun the picture requires.",
  },
  "grammar.visual_stem_pronoun": {
    field: "stem",
    kind: "reject",
    description:
      "When visualSubject is set, a subject pronoun in the stem (next to a form of be or right before the gap) is the one the picture requires.",
  },
  "grammar.visual_stem_be_form": {
    field: "stem",
    kind: "reject",
    description: "When visualSubject is set, every form of be in the stem agrees with the person in the picture.",
  },
  "grammar.translation_prompt_equals_answer": {
    field: "prompt",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "The prompt of a translation exercise is never equal to the answer or to an accepted answer (compared after normalization).",
  },
  "grammar.be_gap_hint": {
    field: "hint",
    kind: "reject",
    types: ["lesson_gap"],
    description: "In the to_be topic the hint of a lesson_gap is either \"be\" or empty.",
  },
  "grammar.be_bare_not": {
    field: "answer",
    kind: "reject",
    types: ["lesson_gap"],
    description: "In the to_be topic a gap answer consisting only of \"not\" is allowed only in the negative_forms objective, where the form of be already stands in the sentence.",
  },
  "grammar.be_adverb_before_gap": {
    field: "stem",
    kind: "reject",
    types: ["lesson_gap"],
    description: "In the to_be topic a frequency adverb (always, usually, often, never...) stands after am, is or are, so the gap cannot directly follow it.",
  },
  "grammar.be_answer_not_be_form": {
    field: "answer",
    kind: "reject",
    types: ["lesson_gap"],
    description: "In the to_be topic every gap answer and accepted variant is a form of be (am, is, are), possibly contracted or negated.",
  },
  "grammar.be_contraction_person": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic a contracted answer (I'm, he's, they're...) pairs the pronoun with the matching form of be.",
  },
  "grammar.be_short_answer_contraction": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic an affirmative short answer does not end with a contraction (write Yes, I am, not Yes, I'm); negative short answers may contract.",
  },
  "grammar.be_short_answer_you": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic a short answer to a question about you speaks about the speaker: it uses I, not you.",
  },
  "grammar.be_answer_person": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic the pronoun in the answer matches the subject next to the gap; a short answer follows the perspective of the question.",
  },
  "grammar.be_form_subject": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic the form of be in the answer agrees with the subject next to the gap (am, is or are).",
  },
  "grammar.be_sentence_person_form": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic the form of be in a full sentence agrees with its subject pronoun; a compound subject takes are.",
  },
  "grammar.be_no_do_does": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic sentences do not use do or does.",
  },
  "grammar.be_yes_negative": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic an answer that starts with Yes is not negated.",
  },
  "grammar.be_no_affirmative": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic an answer that starts with No is negated.",
  },
  "grammar.be_negative_in_affirmative_objective": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic an answer for the affirmative_forms or contractions objective is not negated.",
  },
  "grammar.be_missing_negation": {
    field: "answer",
    kind: "reject",
    description: "In the to_be topic an answer for the negative_forms objective contains the negation not.",
  },
  "grammar.gap_operator_mismatch": {
    field: "answer",
    kind: "reject",
    types: ["lesson_gap"],
    description:
      "A gap answered with an operator (do, does, don't, doesn't) fits the objective, agrees with the subject near the gap " +
      "and is followed by the base form of the verb.",
  },
  "grammar.gap_present_simple_form": {
    field: "answer",
    kind: "reject",
    types: ["lesson_gap"],
    description: "When the hint of a lesson_gap is a verb, the gap answer is a Present Simple form of that verb (base form, third person singular, or with do and does).",
  },
});

/** Fabryka zgłoszeń reguł gramatyki (także `english.*` dzielone z rozdziałem). */
export const grammarIssue = issueFrom(GRAMMAR_RULES);
