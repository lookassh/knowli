/**
 * Limity walidatorów lekcji potrzebne opisom reguł (spec katalogu reguł §2.1):
 * liczby w opisach biorą się wyłącznie ze stałych, którymi posługuje się
 * sprawdzenie. Liść zależności — bez importów z `pool-validation.ts`;
 * walidatory i katalogi importują stałe stąd. Wypełniany w kolejnych zadaniach
 * (limity kontraktu zostają w `@learning/contracts`).
 */

/** Najkrótsze polecenie rozdziału niosące polskie zdanie-bodziec (znaki po przycięciu). */
export const MIN_STIMULUS_INSTRUCTION_LENGTH = 12;

/** Maksymalna liczba wariantów `acceptedAnswers`. */
export const MAX_ACCEPTED_ANSWERS = 40;

/** `lesson_notice`: zakres liczby zdań i segmentów-słów na zdanie. */
export const MIN_NOTICE_SENTENCES = 2;
export const MAX_NOTICE_SENTENCES = 3;
export const MIN_NOTICE_SEGMENTS = 1;
export const MAX_NOTICE_SEGMENTS = 15;

/** Maksymalna liczba tokenów odpowiedzi dla `lesson_gap`. */
export const MAX_GAP_ANSWER_TOKENS = 3;

/** Najdłuższe zdanie, które nagrywamy (jak limit odpowiedzi dziecka). */
export const FEEDBACK_SENTENCE_MAX_LENGTH = 200;
