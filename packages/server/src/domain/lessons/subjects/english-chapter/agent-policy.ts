import type { LessonExerciseType, SubjectAgentPolicy } from "../../types";
import { withTranslationInstruction } from "./validators";

/**
 * Polityka generowania puli dla przedmiotu `english_chapter`. Od etapu 5a (#362) rozdział generuje się
 * przebiegiem bazowym: z polityki działają rezerwa etapu samodzielnego, noty reguł w księdze reguł
 * (sekcja ogólna promptu paczki) i oczyszczenie świeżego wyjścia modelu. Listy kontroli agenta zostają,
 * bo typ je wymaga — znikają z typem w 5c. Bramki słów i ram kart, wymagane typy i pokrycie planu usunięte.
 *
 * Listy są literałami, nie importem z `module.ts`: ten importuje politykę, a cykl zostawiłby stałą
 * w strefie martwej; zgodność z typami przedmiotu pilnuje test.
 */

const BLIND_SOLVE_TYPES: readonly LessonExerciseType[] = [
  "lesson_choice",
  "lesson_gap",
  "lesson_cloze",
  "lesson_open_answer",
  "lesson_order",
  "lesson_match",
  "lesson_group",
];

const VARIANT_CHECK_TYPES: readonly LessonExerciseType[] = ["lesson_open_answer", "lesson_gap"];

/** Dopisek do duplikatu wariantu: skrót i pełna forma to osobne warianty (etap 3 #360). */
const CONTRACTIONS_NOTE = "Write contracted and full forms as separate accepted answers (doesn't and does not are different variants), " +
  "unless the instruction asks for one of them.";

export const chapterAgentPolicy: SubjectAgentPolicy = {
  blindSolveTypes: BLIND_SOLVE_TYPES,
  variantCheckTypes: VARIANT_CHECK_TYPES,
  checkerNeedsMaterial: false,
  independentReserve: 1,
  slack: 2,
  ruleNotes: {
    "variants.duplicate": CONTRACTIONS_NOTE,
  },
  sanitize(draft) {
    const clean = withTranslationInstruction(draft);
    return { draft: clean, removed: [] };
  },
};
