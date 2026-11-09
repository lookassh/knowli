import type { LessonExerciseType, SubjectModule } from "../../types";
import { englishNormalizer } from "../english/normalizer";
import { englishCardSentences } from "../english/card-sentences";
import { normalizeEnglishExposureText } from "../english/exposure";
import { grammarAgentPolicy } from "./agent-policy";
import { ENGLISH_GRAMMAR_ERROR_CATEGORIES } from "./error-categories";
import { grammarExposureText } from "./exposure";
import { englishGrammarPrompts } from "./prompts";
import { presentSimpleV1 } from "./topics/present-simple";
import { toBeV1, toBeV2 } from "./topics/to-be";
import { presentContinuousV1 } from "./topics/present-continuous";

/**
 * Przedmiot `english_grammar` jako wtyczka silnika lekcji (design „Przedmiot
 * i katalog”). Składa dane modułu: 10 typów ćwiczeń gramatyki, kategorie błędów,
 * normalizator skrótów, tematy Present Simple, „to be” i Present Continuous,
 * i profil promptów (bez walidatora przedmiotu i reguł: etap 4 #358). Rejestracja = ten obiekt + jeden wpis w `subjects/index.ts`.
 */

/** 10 typów ćwiczeń, które wspiera gramatyka; każdy cel wybiera własny podzbiór. */
const ALL_EXERCISE_TYPES: readonly LessonExerciseType[] = [
  "lesson_card",
  "lesson_notice",
  "lesson_choice",
  "lesson_listen_choice",
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
  topics: [presentSimpleV1, toBeV1, toBeV2, presentContinuousV1],
  prompts: englishGrammarPrompts,
  poolDeduplication: "exercise",
  // Bez walidatora przedmiotu i reguł gramatyki (etap 4 #358): treść językową ocenia model, kod — strukturę.
  validateExercise: () => [],
  // Zdania angielskie z kart są gotowymi rozwiązaniami (#328): źródło ujawnień przy generowaniu puli.
  // Polskie fragmenty bez diakrytyków też przechodzą, ale nie zrównają się z angielską odpowiedzią.
  cardExposureTexts: englishCardSentences,
  // Ekspozycją jest rozwiązane zdanie albo cała wymiana, jak w rozdziale (#373).
  exposureText: grammarExposureText,
  normalizeExposureText: normalizeEnglishExposureText,
  // Gramatyka ćwiczy zastosowanie reguły; audio odpowiedzi ujawniałoby rozwiązanie.
  ttsForAnswers: false,
  ttsForPrompts: false,
  ttsForFeedbackSentence: true,
  exerciseExplanations: true,
  // Sesja kończy się krótką historyjką z pytaniami o treść (reguły w `prompts.storyRules`).
  lessonStory: true,
  // Pola generowania puli: nota reguły rdzenia, przykłady typów.
  ...grammarAgentPolicy,
  rules: {},
};
