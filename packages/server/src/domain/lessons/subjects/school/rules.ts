import { MAX_REQUIRED_ELEMENTS, MIN_REQUIRED_ELEMENTS, MIN_SOURCE_QUOTE_LENGTH } from "@learning/contracts";
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
    description: "Every exercise except lesson_card cites at least one quote from the material in sourceRefs.",
  },
  "school.quote_too_short": {
    field: "sourceRefs",
    kind: "reject",
    description: `Each quote in sourceRefs has at least ${MIN_SOURCE_QUOTE_LENGTH} characters (whitespace collapsed), enough to ground the exercise.`,
    limit: "MIN_SOURCE_QUOTE_LENGTH",
  },
  "school.quote_in_material": {
    field: "sourceRefs",
    kind: "reject",
    description:
      "Each quote in sourceRefs is one continuous fragment copied word for word from the material: no list marker and no “...” joining two fragments; " +
      "only letter case, typographic quotes, dashes, the ellipsis character and whitespace may differ.",
  },
  "school.open_required_fields": {
    field: "exercise",
    kind: "reject",
    types: ["lesson_open_answer"],
    description:
      `lesson_open_answer needs questionType, expectedForm and ${MIN_REQUIRED_ELEMENTS}–${MAX_REQUIRED_ELEMENTS} requiredElements.`,
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
    description: "lesson_keywords names in familyId the family of open questions it precedes.",
  },
  "school.family_prompt_repeated": {
    field: "prompt",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "Members of one question family (same objective and familyId) ask the question in different words.",
  },
  "school.family_answer_differs": {
    field: "answer",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "Members of one question family (same objective and familyId) share the same model answer.",
  },
  "school.family_elements_differ": {
    field: "requiredElements",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "Members of one question family (same objective and familyId) share the same set of requiredElements ids.",
  },
  "school.keywords_family_missing": {
    field: "familyId",
    kind: "reject",
    types: ["lesson_keywords"],
    description: "lesson_keywords needs a lesson_open_answer with the same familyId in the same objective.",
  },
  "school.keywords_family_rejected": {
    field: "familyId",
    kind: "reject",
    types: ["lesson_keywords"],
    description:
      "The lesson_open_answer with this familyId was not accepted in this call or has no familyId; submit the keywords together with that open question.",
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
    description:
      "Calculations of one templateFamilyId in an objective share the calculation kind, the result unit and the input unit; only the numbers change.",
  },
  "hint.reveals_words": {
    field: "hint",
    kind: "sanitize",
    types: ["lesson_open_answer"],
    description:
      "The hint points to the reasoning or to where in the material to look; it must not contain most content words of the answer, an accepted variant " +
      "or a required element in any word form (words of the question and function words do not count). Such a hint is removed and the exercise is accepted without it.",
  },
});

/** Fabryka zgłoszeń reguł szkoły. */
export const schoolIssue = issueFrom(SCHOOL_RULES);
