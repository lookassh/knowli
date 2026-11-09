import type { SubjectModule } from "../../types";
import { grammarTypeExamples } from "./type-examples";

/** Dopisek do duplikatu wariantu: skrót i pełna forma to osobne warianty (etap 3 #360). */
const CONTRACTIONS_NOTE = "Write contracted and full forms as separate accepted answers (doesn't and does not are different variants), " +
  "unless the instruction asks for one of them.";

/**
 * Pola generowania puli przedmiotu `english_grammar` (przebieg bazowy, `module.ts` składa je w module):
 * nota reguły rdzenia `variants.duplicate` w sekcji ogólnej księgi reguł i przykłady typów tematów „to be”
 * i Present Continuous (`typeExamples`).
 */
export const grammarAgentPolicy: Pick<SubjectModule, "checkerNeedsMaterial" | "ruleNotes" | "typeExamples"> = {
  checkerNeedsMaterial: false,
  ruleNotes: {
    "variants.duplicate": CONTRACTIONS_NOTE,
  },
  typeExamples: grammarTypeExamples,
};
