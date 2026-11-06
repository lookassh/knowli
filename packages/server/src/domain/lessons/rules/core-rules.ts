import {
  MAX_COMMON_ERRORS,
  MAX_LESSON_TEXT_LENGTH,
  MAX_OPTIONS,
  MAX_ORDER_ITEMS,
  MAX_REQUIRED_ELEMENTS,
  MAX_SOURCE_REFS,
  MAX_SUPPLEMENTARY_ELEMENTS,
  MIN_OPTIONS,
  MIN_ORDER_ITEMS,
  MIN_REQUIRED_ELEMENTS,
  MIN_SOURCE_REFS,
} from "@learning/contracts";
import type { RuleCatalog } from "./catalog";
import {
  FEEDBACK_SENTENCE_MAX_LENGTH,
  MAX_ACCEPTED_ANSWERS,
  MAX_GAP_ANSWER_TOKENS,
  MAX_NOTICE_SEGMENTS,
  MAX_NOTICE_SENTENCES,
  MIN_NOTICE_SEGMENTS,
  MIN_NOTICE_SENTENCES,
} from "./limits";

/**
 * Katalog reguł rdzenia (spec katalogu reguł §2.2): kontrakt, kształt rekordu
 * agenta, pola wspólne i reguły typów z `pool-validation.ts`, rachunki,
 * `explanationPl`. Wypełniany w kolejnych zadaniach (pary, grupy, luki z
 * bankiem, słowa kluczowe i rachunki — Task 4).
 *
 * Bez importu wartości z `./catalog` (cykl przez `ENGINE_CATALOGS`): katalog
 * deklaruje się przez `satisfies RuleCatalog`, a id sprawdza `defineRules`
 * przy składaniu `ENGINE_CATALOGS`. Liczby w opisach biorą się ze stałych
 * kontraktu albo `./limits`.
 */
export const CORE_RULES = {
  // Kontrakt (Zod, spec §4.2). Liczności list i długości odpowiedzi, które mają
  // własną regułę rdzenia (opcje, klocki, warianty, zdania notice, odpowiedź),
  // zgłaszane są pod jej id.
  "field.empty": {
    field: "exercise",
    kind: "reject",
    description: "Leave an optional text field out instead of sending an empty string; required text fields and list entries are never empty.",
  },
  "field.max_length": {
    field: "exercise",
    kind: "reject",
    description:
      `Each text field (instructionPl, stem, statement, prompt, hint, explanationPl, focus words, option and item texts) ` +
      `has at most ${MAX_LESSON_TEXT_LENGTH} characters; other text fields keep the length limits of the tool schema.`,
    limit: "MAX_LESSON_TEXT_LENGTH",
  },
  "field.count": {
    field: "exercise",
    kind: "reject",
    description:
      `Lists keep the item counts of the tool schema: requiredElements ${MIN_REQUIRED_ELEMENTS}–${MAX_REQUIRED_ELEMENTS}, ` +
      `supplementaryElements up to ${MAX_SUPPLEMENTARY_ELEMENTS}, commonErrors up to ${MAX_COMMON_ERRORS}, ` +
      `sourceRefs ${MIN_SOURCE_REFS}–${MAX_SOURCE_REFS}.`,
    limit: "MAX_COMMON_ERRORS",
  },
  "field.invalid": {
    field: "exercise",
    kind: "reject",
    description:
      "Every field has the type and the allowed values of the tool schema (enums such as questionType and expectedForm " +
      "take only the listed values), and the exercise has no fields outside the schema.",
  },

  // Ćwiczenie jako całość.
  "exercise.card_not_allowed": {
    field: "exerciseType",
    kind: "reject",
    description: "Never submit lesson_card: cards come from the topic, not from the exercise pool.",
    fixedMessage: true,
  },
  "exercise.unknown_objective": {
    field: "objectiveId",
    kind: "reject",
    description: "objectiveId is the id of an objective of the topic, copied exactly.",
  },
  "exercise.type_unsupported": {
    field: "exerciseType",
    kind: "reject",
    description: "exerciseType is one of the exercise types of the subject.",
  },
  "exercise.type_not_allowed": {
    field: "exerciseType",
    kind: "reject",
    description: "exerciseType is one of the types allowed for the objective of the exercise.",
  },
  "exercise.v3_field_not_allowed": {
    field: "exercise",
    kind: "reject",
    description:
      "Subjects without the extended payload leave out questionType, requiredElements, supplementaryElements, " +
      "commonErrors, expectedForm, familyId, sourceRefs and calculation.",
  },
  "answer.max_length": {
    field: "answer",
    kind: "reject",
    description: (ctx) => `answer and every acceptedAnswers variant have at most ${ctx.answerMaxLength} characters.`,
    limit: "MAX_TEXT_LENGTH",
  },
  "voice_tone.not_allowed": {
    field: "voiceTone",
    kind: "reject",
    description: "voiceTone is set only in subjects that record questions, and never on lesson_calculation.",
  },

  // Wyjaśnienie błędu (`explanationPl`): agent dostaje ćwiczenie bez pola i notę.
  "explanation.not_allowed": {
    field: "explanationPl",
    kind: "sanitize",
    description: "explanationPl is set only in subjects that show error explanations; elsewhere leave it out.",
  },
  "explanation.empty": {
    field: "explanationPl",
    kind: "sanitize",
    description: "explanationPl, when set, is not blank.",
  },
  "explanation.max_length": {
    field: "explanationPl",
    kind: "sanitize",
    description: `explanationPl has at most ${MAX_LESSON_TEXT_LENGTH} characters after trimming.`,
    limit: "MAX_LESSON_TEXT_LENGTH",
  },
  "explanation.line_break": {
    field: "explanationPl",
    kind: "sanitize",
    description: "explanationPl is a single line without line breaks.",
  },
  "explanation.markup": {
    field: "explanationPl",
    kind: "sanitize",
    description: "explanationPl is plain text without the markup characters * and _.",
  },
  "explanation.one_sentence": {
    field: "explanationPl",
    kind: "sanitize",
    description: "explanationPl is exactly one sentence.",
  },

  // Pola wspólne.
  "fields.type_specific": {
    field: "exercise",
    kind: "reject",
    description:
      "Type-specific fields stay on their type: calculation on lesson_calculation, keywordOptions and keyOptionIds on " +
      "lesson_keywords, pairs and extraRight on lesson_match, groups and groupItems on lesson_group, clozeText, " +
      "gapAnswers and extraWords on lesson_cloze.",
  },
  "visual.choice_only": {
    field: "visualSubject",
    kind: "reject",
    description: "visualSubject (a pictogram of the person or animal) is used only with lesson_choice.",
  },
  "focus.empty": {
    field: "focus",
    kind: "reject",
    types: ["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"],
    description: "Free-text types (lesson_gap, lesson_error_fix, lesson_transform, lesson_open_answer) list the checked words of the answer in focus.",
  },
  "focus.not_contiguous": {
    field: "focus",
    kind: "reject",
    types: ["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"],
    description: "focus is a contiguous run of words of the answer, in the same order.",
  },
  "variants.count": {
    field: "acceptedAnswers",
    kind: "reject",
    description: `acceptedAnswers has at most ${MAX_ACCEPTED_ANSWERS} variants.`,
    limit: "MAX_ACCEPTED_ANSWERS",
  },
  "variants.empty": {
    field: "acceptedAnswers",
    kind: "reject",
    description: "No acceptedAnswers variant is blank.",
  },
  "variants.duplicate": {
    field: "acceptedAnswers",
    kind: "reject",
    description: "No acceptedAnswers variant repeats the answer after normalization; the answer is accepted anyway.",
  },
  "computed.no_variants": {
    field: "acceptedAnswers",
    kind: "internal",
    types: ["lesson_match", "lesson_group", "lesson_cloze"],
    description: "Pairs, groups and cloze with a word bank are graded by assignments, so acceptedAnswers and focus stay empty.",
    internalReason:
      "Materialization of lesson_match, lesson_group and lesson_cloze sets acceptedAnswers and focus to empty lists; the agent does not send them.",
  },

  // Typy z wyborem.
  "choice.stem_required": {
    field: "stem",
    kind: "reject",
    types: ["lesson_choice"],
    description: "lesson_choice has the sentence or question in stem.",
  },
  "short_answer.prompt_required": {
    field: "prompt",
    kind: "reject",
    types: ["lesson_short_answer"],
    description: "lesson_short_answer has the question in prompt (or in stem).",
  },
  "options.count": {
    field: "options",
    kind: "reject",
    types: ["lesson_choice", "lesson_short_answer", "lesson_listen_choice"],
    description: `Choice exercises (lesson_choice, lesson_short_answer, lesson_listen_choice) have ${MIN_OPTIONS}–${MAX_OPTIONS} options.`,
    limit: "MAX_OPTIONS",
  },
  "options.duplicate": {
    field: "options",
    kind: "reject",
    types: ["lesson_choice", "lesson_short_answer", "lesson_listen_choice"],
    description: "Option texts are distinct after normalization.",
  },
  "options.correct_unknown": {
    field: "correctOption",
    kind: "reject",
    types: ["lesson_choice", "lesson_short_answer", "lesson_listen_choice"],
    description: "correctOption is the id of one of the options.",
  },

  // Wybór ze słuchu.
  "listen.instruction_not_allowed": {
    field: "instructionPl",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description: "lesson_listen_choice has a fixed instruction, so instructionPl is left out.",
  },
  "listen.hint_not_allowed": {
    field: "hint",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description: "lesson_listen_choice has no hint, because the child hears the sentence and a hint would give the answer away.",
  },
  "listen.gap_count": {
    field: "stem",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description: "The stem of lesson_listen_choice has exactly one gap written as a run of underscores (at least two).",
  },
  "listen.option_apostrophe": {
    field: "options",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description: "Options of lesson_listen_choice are whole words: none starts with an apostrophe.",
  },
  "listen.options_equivalent": {
    field: "options",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description:
      "Each option of lesson_listen_choice put into the gap gives a sentence that is not equivalent to the sentence of " +
      "another option after normalization (doesn't and does not count as the same).",
  },
  "listen.sentence_length": {
    field: "stem",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description:
      `The stem of lesson_listen_choice with the correct option in the gap is a non-empty sentence of at most ` +
      `${FEEDBACK_SENTENCE_MAX_LENGTH} characters, because it is recorded.`,
    limit: "FEEDBACK_SENTENCE_MAX_LENGTH",
  },

  // Wskazanie słowa (`lesson_notice`).
  "notice.options_not_allowed": {
    field: "options",
    kind: "reject",
    types: ["lesson_notice"],
    description: "lesson_notice has no options: the child points at a word in the sentences.",
  },
  "notice.segments_required": {
    field: "noticeSegments",
    kind: "reject",
    types: ["lesson_notice"],
    description: "lesson_notice carries its sentences, split into word segments, in noticeSegments.",
  },
  "notice.sentence_count": {
    field: "noticeSegments",
    kind: "reject",
    types: ["lesson_notice"],
    description: `noticeSegments of lesson_notice has ${MIN_NOTICE_SENTENCES}–${MAX_NOTICE_SENTENCES} sentences.`,
    limit: "MAX_NOTICE_SENTENCES",
  },
  "notice.segment_count": {
    field: "noticeSegments",
    kind: "reject",
    types: ["lesson_notice"],
    description: `Each sentence in noticeSegments has ${MIN_NOTICE_SEGMENTS}–${MAX_NOTICE_SEGMENTS} segments.`,
    limit: "MAX_NOTICE_SEGMENTS",
  },
  "notice.segment_empty": {
    field: "noticeSegments",
    kind: "reject",
    types: ["lesson_notice"],
    description: "No segment in noticeSegments is blank.",
  },
  "notice.correct_required": {
    field: "correctOption",
    kind: "reject",
    types: ["lesson_notice"],
    description: "correctOption of lesson_notice is the word the child points at.",
  },
  "notice.correct_not_segment": {
    field: "correctOption",
    kind: "reject",
    types: ["lesson_notice"],
    description: "correctOption of lesson_notice equals one of the segments of the sentences after normalization.",
  },

  // Kolejność (`lesson_order`).
  "order.items_count": {
    field: "items",
    kind: "reject",
    types: ["lesson_order"],
    description: `lesson_order has ${MIN_ORDER_ITEMS}–${MAX_ORDER_ITEMS} items.`,
    limit: "MIN_ORDER_ITEMS",
  },
  "order.items_join": {
    field: "items",
    kind: "reject",
    types: ["lesson_order"],
    description: "The items of lesson_order joined with spaces in their order give the answer (after normalization).",
  },

  // Typy tekstowe.
  "gap.marker_count": {
    field: "stem",
    kind: "reject",
    types: ["lesson_gap"],
    description: "The stem of lesson_gap has exactly one gap marker ___ (three underscores).",
  },
  "gap.answer_tokens": {
    field: "answer",
    kind: "reject",
    types: ["lesson_gap"],
    description: `The answer of lesson_gap has at most ${MAX_GAP_ANSWER_TOKENS} words.`,
    limit: "MAX_GAP_ANSWER_TOKENS",
  },
  "gap.focus": {
    field: "focus",
    kind: "reject",
    types: ["lesson_gap"],
    description: "In lesson_gap the words of focus and of the gap answer cover each other: all words of one appear in the other.",
  },
  "error_fix.statement_required": {
    field: "statement",
    kind: "reject",
    types: ["lesson_error_fix"],
    description: "lesson_error_fix has the sentence with the mistake in statement.",
  },
  "error_fix.same_as_answer": {
    field: "statement",
    kind: "reject",
    types: ["lesson_error_fix"],
    description: "The statement of lesson_error_fix differs from the corrected answer after normalization.",
  },
  "transform.statement_required": {
    field: "statement",
    kind: "reject",
    types: ["lesson_transform"],
    description: "lesson_transform has the sentence to transform in statement.",
  },
  "transform.unknown": {
    field: "transformId",
    kind: "reject",
    types: ["lesson_transform"],
    description: "transformId of lesson_transform is the id of one of the transforms of the topic.",
  },
  "open.prompt_required": {
    field: "prompt",
    kind: "reject",
    types: ["lesson_open_answer"],
    description: "lesson_open_answer has the question in prompt.",
  },

  // Przejściowe: reguły par, grup, luk z bankiem i słów kluczowych dostają własne id w Task 4.
  "transitional.type_rules": {
    field: "exercise",
    kind: "internal",
    types: ["lesson_match", "lesson_group", "lesson_cloze", "lesson_keywords"],
    description: "Rules of lesson_match, lesson_group, lesson_cloze and lesson_keywords before they get their own ids.",
    internalReason: "Transitional id for type rules that are not catalogued yet; removed when they get their own rules.",
  },
} as const satisfies RuleCatalog;
