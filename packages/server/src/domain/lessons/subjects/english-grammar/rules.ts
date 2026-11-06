import { defineRules } from "../../rules/catalog";
import { ENGLISH_RULES } from "../english/rules";

/**
 * Katalog reguł przedmiotu `english_grammar` (`validateExercise` i haki puli)
 * ze wspólnym fragmentem angielskim. Wypełniany w kolejnych zadaniach.
 */
export const GRAMMAR_RULES = defineRules({ ...ENGLISH_RULES });
