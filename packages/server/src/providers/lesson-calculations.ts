import { CalculationSpecSchema, messages } from "@learning/contracts";
import { computeCalculationAnswer, renderCalculationPrompt } from "../domain/lessons/calculation";

/** Convert parameter-only model output before the common draft-shape guard. */
export function materializeGeneratedCalculations(exercises: unknown[]): unknown[] {
  return exercises.map((raw) => {
    if (!raw || typeof raw !== "object" || (raw as { exerciseType?: unknown }).exerciseType !== "lesson_calculation") return raw;
    const record = raw as Record<string, unknown>;
    try {
      const calculation = CalculationSpecSchema.parse(record.calculation);
      return {
        exerciseType: "lesson_calculation",
        objectiveId: record.objectiveId,
        // The model branch has no instruction; the code supplies the shared one.
        instructionPl: messages.kid.lessonCalculationInstruction,
        calculation,
        prompt: renderCalculationPrompt(calculation),
        answer: computeCalculationAnswer(calculation).answer,
        acceptedAnswers: [],
        focus: [],
        // Keep untrusted quotes for normal grounding validation and flag stripping.
        sourceRefs: record.sourceRefs,
      };
    } catch {
      // An injected answer must not let malformed params reach validators that
      // assume a valid spec. Keep the record counted, but force shape rejection.
      return { ...record, answer: undefined };
    }
  });
}
