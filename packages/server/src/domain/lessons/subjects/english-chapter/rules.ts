import { defineRules, issueFrom } from "../../rules/catalog";

/**
 * Katalog reguł przedmiotu `english_chapter` (`validateExercise`): od etapu 5a (#362) wyłącznie reguły
 * strukturalne. Opisy po angielsku dla modelu; liczby wyłącznie ze stałych sprawdzeń.
 */
export const CHAPTER_RULES = defineRules({
  "chapter.stem_single_gap": {
    field: "stem",
    kind: "reject",
    types: ["lesson_choice"],
    description: "The stem of lesson_choice contains exactly one gap written as three underscores.",
  },
  "chapter.translation_instruction_required": {
    field: "instructionPl",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "lesson_open_answer (translation) has an instructionPl telling the child to translate.",
  },
  "chapter.hint_not_allowed": {
    field: "hint",
    kind: "reject",
    description: "Leave hint out: the Polish stimulus sentence belongs to instructionPl, and a hint would be dropped from the quiz gap.",
  },
  "chapter.order_items_distinct": {
    field: "items",
    kind: "reject",
    types: ["lesson_order"],
    description: "Every item of lesson_order has a different text (compared after normalization), so tiles are never interchangeable.",
  },
});

/** Fabryka zgłoszeń katalogu rozdziału. */
export const chapterIssue = issueFrom(CHAPTER_RULES);
