import { defineRules } from "../../rules/catalog";
import { ENGLISH_RULES } from "../english/rules";

/**
 * Katalog reguł przedmiotu `english_chapter` (`validateExercise`,
 * `refineGeneratedPool`) ze wspólnym fragmentem angielskim. Wypełniany
 * w kolejnych zadaniach.
 */
export const CHAPTER_RULES = defineRules({ ...ENGLISH_RULES });
