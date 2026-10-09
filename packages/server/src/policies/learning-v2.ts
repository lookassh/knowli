import type { Policy } from "../domain/types";
import { LEARNING_V1_POLICY } from "./learning-v1";

/**
 * learning-v2 (design 2026-10-09): reguły identyczne z v1 plus domyślne pasma
 * wymowy z próby technicznej (docs/speech-spike.md — dorosły: poprawne 62–94).
 * „fake-pron” siedzi obok azure, żeby tryb bez kluczy (E2E/smoke) oceniał
 * deterministycznie; pasma nieużywanego providera są martwe.
 */
export const LEARNING_V2_POLICY: Policy = {
  ...LEARNING_V1_POLICY,
  version: "learning-v2",
  pronunciationBands: {
    "azure-pronunciation": { scaleMax: 100, correctMinScore: 70, partialMinScore: 50 },
    "fake-pron": { scaleMax: 100, correctMinScore: 70, partialMinScore: 50 },
  },
};
