import { z } from "zod";
import { UuidSchema } from "@learning/contracts";
import { ApiCallError } from "./api";

const GenerationAcceptanceSchema = z.object({
  generationRunId: UuidSchema,
  deckId: UuidSchema,
}).strict();

export interface GenerationAcceptance {
  generationRunId: string;
  deckId: string;
}

/** A 202 is confirmed only when the server returns both valid identifiers. */
export function readGenerationAcceptance(value: unknown): GenerationAcceptance | null {
  const parsed = GenerationAcceptanceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const LessonAcceptanceSchema = z.object({
  runId: UuidSchema,
  deckId: UuidSchema,
}).strict();

export interface LessonAcceptance {
  runId: string;
  deckId: string;
}

/**
 * Akceptacja tworzenia lekcji (`POST /parent/lessons` → 202 `{runId, deckId}`).
 * Osobny kształt niż generacja słówek (`{generationRunId, deckId}`), więc nie
 * rozluźniamy `GenerationAcceptanceSchema` — ta sama semantyka pewności (oba
 * identyfikatory obecne = przyjęte).
 */
export function readLessonAcceptance(value: unknown): LessonAcceptance | null {
  const parsed = LessonAcceptanceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Whether the server definitively says this command was not accepted. */
export function isDefinitiveGenerationRejection(error: unknown): boolean {
  if (!(error instanceof ApiCallError)) {
    return false;
  }
  return error.status === 401 || error.status === 403 || (error.status === 400 && error.code === "validation");
}
