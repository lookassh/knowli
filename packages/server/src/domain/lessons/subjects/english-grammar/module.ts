import type { LessonExerciseType, SubjectModule } from "../../types";
import { englishNormalizer } from "./normalizer";
import { ENGLISH_GRAMMAR_ERROR_CATEGORIES } from "./error-categories";
import { englishGrammarPrompts } from "./prompts";
import { validateEnglishGrammarExercise } from "./validators";
import { presentSimpleV1 } from "./topics/present-simple";
import { toBeV1 } from "./topics/to-be";

/**
 * Przedmiot `english_grammar` jako wtyczka silnika lekcji (design „Przedmiot
 * i katalog”). Składa dane modułu: wszystkie 9 typów ćwiczeń, kategorie błędów,
 * normalizator skrótów, tematy Present Simple i „to be”, profil promptów i walidator
 * przedmiotu. Rejestracja = ten obiekt + jeden wpis w `subjects/index.ts`.
 */

/** Wszystkie 9 typów ćwiczeń silnika — przedmiot wspiera komplet. */
const ALL_EXERCISE_TYPES: readonly LessonExerciseType[] = [
  "lesson_card",
  "lesson_notice",
  "lesson_choice",
  "lesson_order",
  "lesson_short_answer",
  "lesson_gap",
  "lesson_error_fix",
  "lesson_transform",
  "lesson_open_answer",
];

export const englishGrammarSubject: SubjectModule = {
  id: "english_grammar",
  titlePl: "Angielski — gramatyka",
  answerLocale: "en-GB",
  promptLocale: "pl-PL",
  exerciseTypes: ALL_EXERCISE_TYPES,
  errorCategories: ENGLISH_GRAMMAR_ERROR_CATEGORIES,
  normalizer: englishNormalizer,
  topics: [presentSimpleV1, toBeV1],
  prompts: englishGrammarPrompts,
  poolDeduplication: "exercise",
  validateExercise: validateEnglishGrammarExercise,
  // Gramatyka ćwiczy zastosowanie reguły; audio odpowiedzi ujawniałoby rozwiązanie.
  ttsForAnswers: false,
  ttsForPrompts: false,
  ttsForFeedbackSentence: true,
};
