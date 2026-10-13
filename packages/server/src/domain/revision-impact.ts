import { createHash } from "node:crypto";
import type { VocabularyItemInput } from "@learning/contracts";
import { VOCABULARY_SKILLS, type VocabularySkill } from "./types";

/**
 * Jawna mapa wpływu zmiany treści na klucze umiejętności (architecture.md §6.1).
 * Nie ma automatycznego „wszystko zachowaj” — każda zmiana ma przypisany skutek:
 *
 *  - example, visualType, visualData → kosmetyka, brak nowych kluczy;
 *  - source (polskie znaczenie)      → listening, reading, recall;
 *  - target, acceptedAnswers, locale → wszystkie pięć (kryteria rozpoznawania,
 *    przypominania, wymowy i pisowni obejmują te pola — zmiana wariantu zmienia
 *    to, co uznajemy za poprawną odpowiedź, więc klucze powstają nowe).
 *
 * Umiejętność 'objective' lekcji nie jest tu obecna: zmiany treści słówek nigdy
 * nie dotyczą celów lekcji (iterujemy VOCABULARY_SKILLS, nie SKILLS).
 */
const MEANING_SKILLS: readonly VocabularySkill[] = ["listening", "reading", "recall"];
const ALL_SKILLS: readonly VocabularySkill[] = VOCABULARY_SKILLS;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function classifyRevisionImpact(
  oldItem: VocabularyItemInput,
  newItem: VocabularyItemInput,
): Set<VocabularySkill> {
  const impacted = new Set<VocabularySkill>();
  if (!sameJson(oldItem.source, newItem.source)) {
    for (const skill of MEANING_SKILLS) impacted.add(skill);
  }
  if (
    !sameJson(oldItem.target, newItem.target) ||
    !sameJson([...oldItem.acceptedAnswers].sort(), [...newItem.acceptedAnswers].sort()) ||
    !sameJson(oldItem.locales, newItem.locales)
  ) {
    for (const skill of ALL_SKILLS) impacted.add(skill);
  }
  return impacted;
}

/**
 * Kryteria umiejętności zapisywane w skill_versions.criteria (niezmienne).
 * Kryterium zawiera wyłącznie pola, od których ocena tej umiejętności zależy —
 * dzięki temu hash jest stabilny i hash-porównywalny między wersjami.
 */
export function buildSkillCriteria(
  item: VocabularyItemInput,
  skill: VocabularySkill,
): { criteria: Record<string, unknown>; criteriaHash: string } {
  const base = {
    target: item.target,
    acceptedAnswers: [...item.acceptedAnswers].sort(),
    targetLocale: item.locales.target,
  };
  const withMeaning = {
    ...base,
    source: item.source,
    sourceLocale: item.locales.source,
  };
  let criteria: Record<string, unknown>;
  switch (skill) {
    case "listening":
      criteria = { kind: "listening-v1", ...withMeaning };
      break;
    case "reading":
      criteria = { kind: "reading-v1", ...withMeaning };
      break;
    case "recall":
      criteria = { kind: "recall-v1", ...withMeaning };
      break;
    case "pronunciation":
      criteria = { kind: "pronunciation-v1", ...base };
      break;
    case "spelling":
      criteria = { kind: "spelling-v1", ...base };
      break;
  }
  const criteriaHash = createHash("sha256").update(JSON.stringify(criteria)).digest("hex");
  return { criteria, criteriaHash };
}
