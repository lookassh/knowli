/**
 * Limity walidatorów lekcji potrzebne opisom reguł (spec katalogu reguł §2.1):
 * liczby w opisach biorą się wyłącznie ze stałych, którymi posługuje się
 * sprawdzenie. Liść zależności — bez importów z `pool-validation.ts`;
 * walidatory i katalogi importują stałe stąd. Wypełniany w kolejnych zadaniach
 * (limity kontraktu zostają w `@learning/contracts`).
 */

/** Najkrótsze polecenie rozdziału niosące polskie zdanie-bodziec (znaki po przycięciu). */
export const MIN_STIMULUS_INSTRUCTION_LENGTH = 12;

/**
 * Liczba wariantów `acceptedAnswers` i zakresy `lesson_notice`: jedno źródło z kontraktem
 * (tę samą granicę sprawdza schemat i walidator), tu reeksport dla walidatorów i opisów.
 */
export {
  MAX_ACCEPTED_ANSWERS,
  MAX_NOTICE_SEGMENTS,
  MAX_NOTICE_SENTENCES,
  MIN_NOTICE_SEGMENTS,
  MIN_NOTICE_SENTENCES,
} from "@learning/contracts";

/** Znacznik luki w `stem` ćwiczenia `lesson_gap` (podaje go opis reguły). */
export const GAP_MARKER = "___";

/** Maksymalna liczba tokenów odpowiedzi dla `lesson_gap`. */
export const MAX_GAP_ANSWER_TOKENS = 3;

/** Najdłuższe zdanie, które nagrywamy (jak limit odpowiedzi dziecka). */
export const FEEDBACK_SENTENCE_MAX_LENGTH = 200;
