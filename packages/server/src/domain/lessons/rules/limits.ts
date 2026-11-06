/**
 * Limity walidatorów lekcji potrzebne opisom reguł (spec katalogu reguł §2.1):
 * liczby w opisach biorą się wyłącznie ze stałych, którymi posługuje się
 * sprawdzenie. Liść zależności — bez importów z `pool-validation.ts`;
 * walidatory i katalogi importują stałe stąd. Wypełniany w kolejnych zadaniach
 * (limity kontraktu zostają w `@learning/contracts`).
 */

/** Najkrótsze polecenie rozdziału niosące polskie zdanie-bodziec (znaki po przycięciu). */
export const MIN_STIMULUS_INSTRUCTION_LENGTH = 12;
