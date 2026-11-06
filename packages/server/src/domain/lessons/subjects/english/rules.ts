import { defineRules, issueFrom } from "../../rules/catalog";

/**
 * Wspólny fragment katalogu reguł przedmiotów angielskich (`english_grammar`,
 * `english_chapter`): oba katalogi rozwijają ten obiekt, więc wpisy są tymi
 * samymi obiektami (rejestr dopuszcza wspólny wpis).
 */
export const ENGLISH_RULES = defineRules({
  "english.listen_sibilant_merge": {
    field: "stem",
    kind: "reject",
    types: ["lesson_listen_choice"],
    description:
      "In lesson_listen_choice, options that differ only by a final -s or -es must not be followed in the stem by a word " +
      "starting with an s, z or sh sound: in continuous speech the ending merges into that word and the difference is inaudible.",
  },
});

/** Fabryka zgłoszeń wspólnego fragmentu angielskiego. */
export const englishIssue = issueFrom(ENGLISH_RULES);
