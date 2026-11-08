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

/** Pułapka z przebiegu kontrolnego etapu 4 (sędzia 2, W1): zaimek niezgodny z podmiotem pytania albo klucz sprzeczny z materiałem. */
export const SHORT_ANSWER_PRONOUN_NOTE =
  "The pronoun in a short answer matches the question's subject as a beginner learns it: you → I (ask with you only about one person), " +
  "a person (Mum, Tom) → he or she, an animal or a thing (the dog, the ball) → it, several people or things → they. " +
  "When a question asks about something stated in the material, the key agrees with the material.";

/** Pułapka z przebiegu kontrolnego etapu 4 (sędzia 2, W3): pytanie w szyku zdania jest poprawne w mowie. */
export const QUESTION_DISTRACTOR_NOTE =
  "A wrong question option must be wrong even in spoken English: never use statement word order with a question mark " +
  "(Mum is at school?) as a wrong option, because rising intonation makes it acceptable; use a wrong verb form or an extra do/does instead.";

/** Notatki zagadnienia: zdania oddzielone spacją. */
export function notes(...sentences: readonly string[]): string {
  return sentences.join(" ");
}
