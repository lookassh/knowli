import { materializeRawExercise } from "../domain/lessons/raw-materialize";

const ASSIGNMENT_TYPES: ReadonlySet<unknown> = new Set(["lesson_match", "lesson_group", "lesson_cloze"]);

/**
 * Pary, grupy (design szkoły §10.6) i luki z bankiem (§13.6) z modelu niosą
 * tylko teksty i przypisania; kod dopisuje polecenie (gdy model go nie podał) i
 * kanoniczną odpowiedź (domenowe `materializeRawExercise`). Opakowanie z
 * dzisiejszym zachowaniem: odpowiedź liczona zawsze od nowa, rekord o złym
 * kształcie dostaje `answer: undefined`.
 */
export function materializeGeneratedAssignments(exercises: unknown[]): unknown[] {
  return exercises.map((raw) => {
    if (!raw || typeof raw !== "object" || !ASSIGNMENT_TYPES.has((raw as { exerciseType?: unknown }).exerciseType)) return raw;
    const record = { ...(raw as Record<string, unknown>), answer: undefined };
    const result = materializeRawExercise(record);
    return result.ok ? result.record : record;
  });
}
