import { materializeRawExercise } from "../domain/lessons/raw-materialize";

/**
 * Słowa kluczowe z modelu niosą tylko pojęcia, ich klucz i rodzinę pytań; kod
 * dopisuje wspólne polecenie i kanoniczną odpowiedź (domenowe
 * `materializeRawExercise`). Opakowanie z dzisiejszym zachowaniem: odpowiedź
 * liczona zawsze od nowa, rekord o złym kształcie dostaje `answer: undefined`.
 */
export function materializeGeneratedKeywords(exercises: unknown[]): unknown[] {
  return exercises.map((raw) => {
    if (!raw || typeof raw !== "object" || (raw as { exerciseType?: unknown }).exerciseType !== "lesson_keywords") return raw;
    const record = { ...(raw as Record<string, unknown>), answer: undefined };
    const result = materializeRawExercise(record);
    return result.ok ? result.record : record;
  });
}
