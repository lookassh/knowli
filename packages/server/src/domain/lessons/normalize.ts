import type { AnswerNormalizer } from "./types";

/** Apostrofy typograficzne ujednolicane do zwykłego `'` (także w zapisie słówek ze źródła). */
export const APOSTROPHE_VARIANTS = /[\u2019\u2018\u02bc\u00b4]/g;

/**
 * Znak dozwolony w tokenie: litera (z diakrytykami), cyfra lub apostrof.
 * Litery i cyfry obejmują alfabety spoza ASCII (przedmioty polskojęzyczne).
 */
const NON_WORD = /[^\p{L}\p{N}']+/gu;

/** Zewnętrzne apostrofy tokenu (np. z `'quote'`); wewnętrzne zostają. */
const EDGE_APOSTROPHES = /^'+|'+$/g;

/**
 * Bazowa normalizacja tekstu odpowiedzi (design „Normalizacja”): NFC,
 * przycięcie, ujednolicenie apostrofów, lowercase, usunięcie interpunkcji
 * poza apostrofem wewnątrz słowa, zwinięcie spacji i tokenizacja. Pusty tekst
 * daje pustą listę. Rozwijanie skrótów należy do normalizatora przedmiotu.
 */
export function normalizeTokens(text: string): string[] {
  const prepared = text
    .normalize("NFC")
    .replace(APOSTROPHE_VARIANTS, "'")
    .toLowerCase()
    .replace(NON_WORD, " ");
  return prepared
    .split(" ")
    .map((token) => token.replace(EDGE_APOSTROPHES, ""))
    .filter((token) => token !== "");
}

/**
 * Bazowy normalizator przedmiotowo-niezależny. Zwraca jedną sekwencję tokenów
 * (silnik nie zakłada wariantów); przedmioty dekorują go o własne rozwinięcia.
 */
export const baseNormalizer: AnswerNormalizer = {
  normalize(text: string): string[][] {
    return [normalizeTokens(text)];
  },
};
