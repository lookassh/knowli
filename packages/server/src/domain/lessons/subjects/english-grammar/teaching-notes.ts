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
  "never list such a form in acceptedAnswers and never use it as a wrong option either: options are compared with contractions " +
  "expanded, so Yes, I'm. is the same option as Yes, I am. and the exercise is rejected.";

/**
 * Bieg diagnostyczny #372 (`lesson.leak` w `short_answers`): krótkich odpowiedzi jest kilkanaście, więc tłumaczenie
 * samej odpowiedzi powtarza klucz ćwiczeń wyboru i odpada jako ujawnione; pełna wymiana ma własny klucz.
 * Od #373 detektor przecieków porównuje w gramatyce całe rozwiązane wymiany, więc wymiana powtórzona w innym typie odpada regułą `lesson.leak`, a paczka etapu samodzielnego dostaje rozwiązania wcześniejszych paczek zagadnienia jako zdania do unikania.
 */
export const SHORT_ANSWER_TRANSLATION_NOTE =
  "A lesson_open_answer translates the whole exchange, the question together with its short answer, never the short answer " +
  "alone: a bare short answer repeats the answer of a choice or gap exercise, which gives it away.";

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
