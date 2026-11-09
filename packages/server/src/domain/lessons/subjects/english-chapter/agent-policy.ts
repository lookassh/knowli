import type { SubjectModule } from "../../types";
import { withTranslationInstruction } from "./validators";

/** Dopisek do duplikatu wariantu: skrót i pełna forma to osobne warianty (etap 3 #360). */
const CONTRACTIONS_NOTE = "Write contracted and full forms as separate accepted answers (doesn't and does not are different variants), " +
  "unless the instruction asks for one of them.";

/**
 * Pola generowania puli przedmiotu `english_chapter` (przebieg bazowy, `module.ts` składa je w module):
 * nota reguły rdzenia w księdze reguł (sekcja ogólna promptu paczki) i oczyszczenie świeżego wyjścia modelu.
 */
export const chapterAgentPolicy: Pick<SubjectModule, "checkerNeedsMaterial" | "ruleNotes" | "sanitize"> = {
  checkerNeedsMaterial: false,
  ruleNotes: {
    "variants.duplicate": CONTRACTIONS_NOTE,
  },
  sanitize(draft) {
    return { draft: withTranslationInstruction(draft) };
  },
};
