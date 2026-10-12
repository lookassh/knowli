import type { ErrorCategory } from "../../types";

/**
 * Kategorie błędów przedmiotu `english_grammar` (dane katalogu, nie silnika).
 * Każda ma polską etykietę dla rodzica (panel postępu i werdyktów). Kody po
 * angielsku; etykiety poprawne językowo i zrozumiałe dla rodzica bez żargonu.
 * Kategorie bazowe (`other`, `incomplete`, `wrong_order`) są wspólne i NIE są
 * tu powtarzane (walidacja katalogu odrzuciłaby duplikat kodu bazowego).
 */
export const ENGLISH_GRAMMAR_ERROR_CATEGORIES: readonly ErrorCategory[] = [
  { code: "wrong_verb_form", labelPl: "Zła forma czasownika" },
  { code: "missing_ending", labelPl: "Brak końcówki (np. -s)" },
  { code: "extra_ending", labelPl: "Niepotrzebna końcówka" },
  { code: "ending_spelling", labelPl: "Błąd w pisowni końcówki (-es/-ies)" },
  { code: "wrong_auxiliary", labelPl: "Zły operator (do/does)" },
  { code: "missing_auxiliary", labelPl: "Brak operatora (do/does)" },
  { code: "extra_auxiliary", labelPl: "Niepotrzebny operator" },
  { code: "wrong_negation", labelPl: "Źle utworzone przeczenie" },
  { code: "word_order", labelPl: "Zła kolejność słów" },
  { code: "wrong_subject_agreement", labelPl: "Niezgodność z osobą (he/she/it)" },
  { code: "short_answer_form", labelPl: "Zła krótka odpowiedź" },
  { code: "irregular_form", labelPl: "Zła forma nieregularna" },
  { code: "wrong_tense", labelPl: "Zły czas gramatyczny" },
];
