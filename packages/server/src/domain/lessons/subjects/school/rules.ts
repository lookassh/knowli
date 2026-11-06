import {
  MAX_COMMON_ERRORS,
  MAX_REQUIRED_ELEMENTS,
  MAX_SUPPLEMENTARY_ELEMENTS,
  MIN_REQUIRED_ELEMENTS,
  MIN_SOURCE_QUOTE_LENGTH,
} from "@learning/contracts";
import { defineRules, issueFrom } from "../../rules/catalog";

/**
 * Katalog reguł przedmiotu `school` (`validateExercise`, `validatePoolExtra`,
 * bramki agenta i `sanitize`). Opisy po angielsku dla modelu agenta; liczby
 * wyłącznie ze stałych kontraktu, którymi posługuje się sprawdzenie.
 */
export const SCHOOL_RULES = defineRules({
  "school.quote_required": {
    field: "sourceRefs",
    kind: "reject",
    priority: "quote",
    description: "Every exercise except lesson_card cites at least one quote from the material in sourceRefs.",
  },
  "school.quote_too_short": {
    field: "sourceRefs",
    kind: "reject",
    priority: "quote",
    description: `Each quote in sourceRefs has at least ${MIN_SOURCE_QUOTE_LENGTH} characters (whitespace collapsed), enough to ground the exercise.`,
    limit: "MIN_SOURCE_QUOTE_LENGTH",
  },
  "school.quote_in_material": {
    field: "sourceRefs",
    kind: "reject",
    priority: "quote",
    description:
      "Each quote in sourceRefs is one continuous fragment copied word for word from the material: never join two " +
      "fragments (with “...” or otherwise) and add no list markers (a leading one is ignored); only letter case, " +
      "typographic quotes, dashes, the ellipsis character and whitespace may differ.",
  },
  "school.open_required_fields": {
    field: "exercise",
    kind: "reject",
    types: ["lesson_open_answer"],
    description:
      `lesson_open_answer needs a non-empty questionType and expectedForm and ${MIN_REQUIRED_ELEMENTS}–${MAX_REQUIRED_ELEMENTS} ` +
      `requiredElements {id, text}; supplementaryElements (at most ${MAX_SUPPLEMENTARY_ELEMENTS}) and commonErrors ` +
      `(at most ${MAX_COMMON_ERRORS}) are optional additions and never replace requiredElements.`,
  },
  "school.element_ids_unique": {
    field: "requiredElements",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "The ids of requiredElements are unique within the exercise.",
  },
  "school.v3_field_type": {
    field: "exercise",
    kind: "reject",
    description:
      "questionType, requiredElements, supplementaryElements, commonErrors and expectedForm belong only to lesson_open_answer, " +
      "and familyId only to lesson_open_answer and lesson_keywords; leave them out of other exercise types.",
  },
  "school.calculation_params_required": {
    field: "calculation",
    kind: "reject",
    types: ["lesson_calculation"],
    description: "lesson_calculation carries the calculation parameters in calculation.",
  },
  "school.calculation_invalid": {
    field: "calculation",
    kind: "reject",
    types: ["lesson_calculation"],
    description: "The calculation parameters and tolerance must be accepted by the calculator.",
  },
  "school.calculation_answer_computed": {
    field: "answer",
    kind: "reject",
    types: ["lesson_calculation"],
    description: "The answer of lesson_calculation equals the result the code computes from calculation.",
  },
  "school.calculation_prompt_template": {
    field: "prompt",
    kind: "reject",
    types: ["lesson_calculation"],
    description: "The prompt of lesson_calculation equals the template the code renders from calculation.",
  },
  "school.computed_lists_empty": {
    field: "exercise",
    kind: "reject",
    types: ["lesson_calculation", "lesson_keywords"],
    description: "lesson_calculation and lesson_keywords have empty acceptedAnswers and focus.",
  },
  "school.keywords_family_required": {
    field: "familyId",
    kind: "reject",
    types: ["lesson_keywords"],
    priority: "family",
    description: "lesson_keywords names in familyId the family of open questions it precedes.",
  },
  "school.family_prompt_repeated": {
    field: "prompt",
    kind: "reject",
    types: ["lesson_open_answer"],
    priority: "family",
    description: "Members of one question family (same objective and familyId) ask the question in different words.",
  },
  "school.family_answer_differs": {
    field: "answer",
    kind: "reject",
    types: ["lesson_open_answer"],
    priority: "family",
    description:
      "Members of one question family (same objective and familyId) share the same model answer, character for character.",
  },
  "school.family_elements_differ": {
    field: "requiredElements",
    kind: "reject",
    types: ["lesson_open_answer"],
    priority: "family",
    description:
      "Members of one question family (same objective and familyId) share the same set of requiredElements ids; their " +
      "texts should match too.",
  },
  "school.keywords_family_missing": {
    field: "familyId",
    kind: "reject",
    types: ["lesson_keywords"],
    priority: "family",
    description: "lesson_keywords needs a lesson_open_answer with the same familyId in the same objective.",
  },
  "school.keywords_family_rejected": {
    field: "familyId",
    kind: "reject",
    types: ["lesson_keywords"],
    priority: "family",
    description:
      "When the lesson_open_answer with the familyId of a lesson_keywords is rejected in the same call and the objective " +
      "has no other open question of that familyId, the keywords are rejected too; send them with a valid open question " +
      "or after it is accepted.",
  },
  "school.keyword_not_in_answer": {
    field: "keyOptionIds",
    kind: "reject",
    types: ["lesson_keywords"],
    description: "Every key term occurs in the model answer of its question family or in the material (inflected forms count).",
  },
  "school.calculation_family_mismatch": {
    field: "calculation",
    kind: "reject",
    types: ["lesson_calculation"],
    priority: "calculation_shape",
    description:
      "Calculations of one templateFamilyId in an objective share the calculation kind, the result unit and the input unit; only the numbers change.",
  },
  "hint.reveals_words": {
    field: "hint",
    kind: "sanitize",
    types: ["lesson_open_answer"],
    priority: "hint",
    description:
      "Every lesson_open_answer should get a short hint (recommended) that points to the reasoning or to where in the " +
      "material to look; leave hint null only when no such hint is possible. The hint is removed and the exercise is " +
      "accepted without it when, for the answer, an accepted variant or a required element, it contains all of its " +
      "content words (one or two words) or at least half of them, rounded up (more words), in any word form; words of " +
      "the question and function words do not count.",
  },
});

/** Fabryka zgłoszeń reguł szkoły. */
export const schoolIssue = issueFrom(SCHOOL_RULES);
