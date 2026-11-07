import { englishGrammarSubject } from "../../packages/server/src/domain/lessons/subjects/english-grammar/module";
import {
  PC_FORMS_TRANSLATION_GUIDANCE,
  PC_GUIDANCE,
  PC_NOW_OR_USUALLY_GUIDANCE,
  PC_NOW_OR_USUALLY_MORE_GUIDANCE,
  PC_TENSE_CHOICE_GUIDANCE,
} from "../../packages/server/src/domain/lessons/subjects/english-grammar/present-continuous-guidance";
import { GRAMMAR_RULES, PICTURE_CHOICE_GUIDANCE, TO_BE_GUIDANCE } from "../../packages/server/src/domain/lessons/subjects/english-grammar/rules";
import type { LessonRule } from "../../packages/server/src/domain/lessons/rules/catalog";
import type { SubjectModule } from "../../packages/server/src/domain/lessons/types";

/**
 * Moduł gramatyki bez heurystyk językowych — WYŁĄCZNIE dla sondy etapu 2 (spec etapu 2 §5): wariant
 * `agent_plain` i przebieg bazowy. Bez `validateExercise` i bez opisów reguł, które sprawdza; zostają
 * wskazówki dydaktyczne, których kod nie sprawdza (doklejone dziś do opisów reguł sprawdzanych), we
 * wpisach o tych samych id i polach — trafiają do promptu w tym samym miejscu co dziś.
 */

export const GUIDANCE_TEXTS: readonly string[] = [
  PC_GUIDANCE,
  PC_FORMS_TRANSLATION_GUIDANCE,
  PC_TENSE_CHOICE_GUIDANCE,
  PC_NOW_OR_USUALLY_GUIDANCE,
  PC_NOW_OR_USUALLY_MORE_GUIDANCE,
  TO_BE_GUIDANCE,
  PICTURE_CHOICE_GUIDANCE,
];

function guidanceRules(): Record<string, LessonRule> {
  const kept: Record<string, LessonRule> = {};
  for (const [id, rule] of Object.entries(GRAMMAR_RULES) as [string, LessonRule][]) {
    if (typeof rule.description !== "string") continue;
    const description = rule.description;
    const texts = GUIDANCE_TEXTS.filter((text) => description.includes(text));
    if (texts.length > 0) kept[id] = { ...rule, description: texts.map((text) => text.trim()).join(" ") };
  }
  return kept;
}

export function grammarPlainSubject(): SubjectModule {
  return { ...englishGrammarSubject, validateExercise: () => [], rules: guidanceRules() };
}

export type ProbeVariant = "agent" | "agent_plain" | "baseline";

/** Wariant sondy z `UMIEM_PROBE_AGENT_VARIANT`; brak = `agent`. */
export function probeVariantOf(raw: string | undefined): ProbeVariant {
  const value = raw?.trim() || "agent";
  if (value === "agent" || value === "agent_plain" || value === "baseline") return value;
  throw new Error("UMIEM_PROBE_AGENT_VARIANT: agent | agent_plain | baseline");
}
