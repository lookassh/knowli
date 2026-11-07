/**
 * Dydaktyka gramatyki dla generatora paczek (`LearningObjective.generationNotesEn`, etap 4 epiku #358):
 * zwykły tekst po angielsku, którego kod nie sprawdza. Trafia wyłącznie do promptu paczki — nie do
 * modelu oceniającego (ten dostaje `descriptionEn`). Wskazówki zastąpiły opisy reguł i heurystyki
 * walidatora gramatyki; teksty tematów Present Continuous i „to be” są w plikach tematów.
 */

/** Pułapka z dawnej reguły `grammar.pc_numberless_subject`: obie formy byłyby poprawne. */
export const NUMBERLESS_SUBJECT_NOTE =
  "Never use a subject whose singular and plural look the same (fish, sheep, deer) unless a number word decides the form.";

/** Pułapka z dawnej reguły `grammar.be_short_answer_contraction`: wariant ze skrótem dałby fałszywe „dobrze”. */
export const SHORT_ANSWER_CONTRACTION_NOTE =
  "An affirmative short answer never ends with a contraction: Yes, I am. / Yes, she is., never Yes, I'm. or Yes, she's.; " +
  "never list such a form in acceptedAnswers.";

/** Notatki zagadnienia: zdania oddzielone spacją. */
export function notes(...sentences: readonly string[]): string {
  return sentences.join(" ");
}
