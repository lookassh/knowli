import { computeTargetKey } from "../target-key";
import type { LessonExerciseDraft, SubjectModule } from "./types";

/**
 * `target_key` ćwiczenia lekcji: klucz ekspozycji liczony z tekstu, który
 * dziecko faktycznie widzi rozwiązany. Domyślnie to odpowiedź kanoniczna
 * (przedmioty bez `exposureText` zachowują dotychczasowy klucz); przedmiot
 * może wskazać inny tekst (np. całe zdanie ze wstawioną odpowiedzią).
 * Jedno miejsce dla zapisu rewizji z generacji i z edycji rodzica.
 */
export function lessonExerciseTargetKey(
  subject: Pick<SubjectModule, "answerLocale" | "exposureText">,
  draft: LessonExerciseDraft,
): string {
  return computeTargetKey(subject.exposureText?.(draft) ?? draft.answer, subject.answerLocale);
}
