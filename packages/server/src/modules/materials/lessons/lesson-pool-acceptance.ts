import { stripListenChoiceExtras } from "../../../domain/lessons/material-creation";
import { V3_EXERCISE_FIELDS, withoutRedundantAcceptedVariants, type V3ExerciseField } from "../../../domain/lessons/pool-validation";
import type { LessonExerciseDraft, SubjectModule } from "../../../domain/lessons/types";
import {
  scopeFamiliesToRun,
  withoutEmptyOptionalArrays,
  withoutInvalidExplanation,
  withoutVoiceToneUnlessAllowed,
} from "./lesson-drafts";

/**
 * Pola v3 (przedmioty szkolne), których przedmiot bez `usesV3Payload` nie żąda: prompt każe zwracać dla nich
 * null, ale prawdziwy model potrafi wypełnić je dla całej partii, a walidacja ogólna odrzuca takie ćwiczenie
 * w całości. To niepożądany dodatek modelu, nie dane rodzica, więc na świeżym wyjściu go usuwamy (dawniej
 * tylko rozdział, od etapu 5a #362 każdy przedmiot bez v3). Bez `calculation`: specyfikacja rachunku to inny
 * typ ćwiczenia, który ma zostać odrzucony, a nie po cichu naprawiony.
 */
export const UNSOLICITED_V3_FIELDS: readonly Exclude<V3ExerciseField, "calculation">[] =
  V3_EXERCISE_FIELDS.filter((field): field is Exclude<V3ExerciseField, "calculation"> => field !== "calculation");

function withoutUnsolicitedV3Fields(draft: LessonExerciseDraft, subject: SubjectModule): LessonExerciseDraft {
  if (subject.usesV3Payload === true || UNSOLICITED_V3_FIELDS.every((field) => draft[field] === undefined)) return draft;
  const copy: Partial<Record<keyof LessonExerciseDraft, unknown>> = { ...draft };
  for (const field of UNSOLICITED_V3_FIELDS) delete copy[field];
  return copy as unknown as LessonExerciseDraft;
}

/**
 * Sanityzacja jednego świeżego ćwiczenia z wyjścia modelu (przebieg bazowy, przez `parseLessonRecord`).
 * Kolejność kroków jest częścią kontraktu: niezamówione pola v3 → ton głosu → wyjaśnienie → puste tablice
 * → dodatki ćwiczenia słuchowego → rodziny runu → warianty redundantne. Bez
 * `stripParentAddedFlags` (woła go wywołujący). Warianty acceptedAnswers redundantne
 * wobec odpowiedzi kanonicznej (równe po neutralnej normalizacji; skrót i pełna forma
 * to od etapu 3 #360 osobne warianty) porzucamy — bez tego walidacja fazy 1 odrzucałaby całe ćwiczenie za wpis
 * nieznoszący informacji (odpowiedź kanoniczna jest akceptowana automatycznie).
 * Funkcja czysta.
 */
export function sanitizeFreshLessonDraft(
  draft: LessonExerciseDraft,
  subject: SubjectModule,
  familyScope: string | null,
): LessonExerciseDraft {
  const toned = withoutVoiceToneUnlessAllowed(withoutUnsolicitedV3Fields(draft, subject), subject);
  const explained = withoutInvalidExplanation(toned, subject);
  // Ćwiczenie słuchowe nie ma polecenia, podpowiedzi ani piktogramu: dodatek modelu usuwamy, nie odrzucamy ćwiczenia.
  const stripped = stripListenChoiceExtras(withoutEmptyOptionalArrays(explained));
  const scoped = familyScope === null ? stripped : scopeFamiliesToRun(stripped, familyScope);
  return withoutRedundantAcceptedVariants(scoped);
}
