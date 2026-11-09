import { allExamples, orderedLesson, type LessonAgentState } from "../../../domain/lessons/agent/state";
import { avoidSentencesFor } from "../../../domain/lessons/avoid-sentences";
import { cardExposureSources } from "../../../domain/lessons/card-exposure-sources";
import type { LessonExerciseDraft, LessonTopic, SubjectModule } from "../../../domain/lessons/types";

/** Przykłady bez zdań z treści kart — te idą na koniec listy zdań do unikania. */
function withoutTexts(examples: Record<string, string[]>, texts: readonly string[]): Record<string, string[]> {
  const drop = new Set(texts);
  return Object.fromEntries(Object.entries(examples).map(([id, lines]) => [id, lines.filter((line) => !drop.has(line))]));
}

/**
 * Zdania do unikania z bieżącego stanu lekcji (#328): przykłady kart (bez zdań z treści kart), ćwiczenia
 * lekcji i na końcu zdania kart — wspólny materiał, nigdy z historii dziecka. Czysta funkcja.
 */
export function lessonAvoidSentences(subject: SubjectModule, topic: LessonTopic, state: LessonAgentState, extraExercises: readonly LessonExerciseDraft[] = []): string[] {
  const cardSentences = Object.values(cardExposureSources(subject, topic)).flat();
  return avoidSentencesFor({ examples: withoutTexts(allExamples(state), cardSentences), exercises: [...orderedLesson(state), ...extraExercises], subject, cardSentences });
}
