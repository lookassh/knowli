import { messages } from "@learning/contracts";
import { keywordsAnswer } from "../domain/lessons/pool-validation";

/**
 * Słowa kluczowe z modelu niosą tylko pojęcia, ich klucz i rodzinę pytań.
 * Kod dopisuje wspólne polecenie i kanoniczną odpowiedź (pojęcia kluczowe),
 * zanim rekord trafi do wspólnej walidacji kształtu i puli.
 */
export function materializeGeneratedKeywords(exercises: unknown[]): unknown[] {
  return exercises.map((raw) => {
    if (!raw || typeof raw !== "object" || (raw as { exerciseType?: unknown }).exerciseType !== "lesson_keywords") return raw;
    const record = raw as Record<string, unknown>;
    const keywordOptions = Array.isArray(record.keywordOptions) ? record.keywordOptions : [];
    const keyOptionIds = Array.isArray(record.keyOptionIds) ? record.keyOptionIds : [];
    const wellFormed = keywordOptions.every((option) =>
      option !== null && typeof option === "object" &&
      typeof (option as { id?: unknown }).id === "string" && typeof (option as { text?: unknown }).text === "string",
    ) && keyOptionIds.every((id) => typeof id === "string");
    // Rekord o złym kształcie zostaje odrzucony przez walidację kształtu (bez odpowiedzi).
    if (!wellFormed) return { ...record, answer: undefined };
    return {
      exerciseType: "lesson_keywords",
      objectiveId: record.objectiveId,
      instructionPl: messages.kid.lessonKeywordsInstruction,
      familyId: record.familyId,
      keywordOptions,
      keyOptionIds,
      answer: keywordsAnswer({
        keywordOptions: keywordOptions as { id: string; text: string }[],
        keyOptionIds: keyOptionIds as string[],
      }),
      acceptedAnswers: [],
      focus: [],
      sourceRefs: record.sourceRefs,
      ...(typeof record.voiceTone === "string" ? { voiceTone: record.voiceTone } : {}),
    };
  });
}
