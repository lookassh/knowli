import { z } from "zod";
import { UuidSchema, VocabularyFormatSchema } from "./common";
import { MAX_DECK_ITEMS } from "./limits";

/**
 * Polecenie wygenerowania zestawu. `idempotencyKey` pochodzi od klienta:
 * powtórzone żądanie o tym samym kluczu dołącza do istniejącego runu.
 * Limity z architecture.md §7 (4000 znaków promptu, maksymalnie 100 elementów).
 */
export const GenerationCommandSchema = z.object({
  prompt: z.string().min(1).max(4000),
  idempotencyKey: z.string().min(8).max(200),
  title: z.string().min(1).max(200).optional(),
  vocabularyFormat: VocabularyFormatSchema.default("standard"),
  maxItems: z.number().int().min(1).max(MAX_DECK_ITEMS).optional(),
  locales: z
    .object({
      source: z.string().min(2).max(10),
      target: z.string().min(2).max(10),
    })
    .optional(),
});
export type GenerationCommand = z.input<typeof GenerationCommandSchema>;

export const GenerationStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "superseded",
]);
export type GenerationState = z.infer<typeof GenerationStateSchema>;

/** Widok runu generacji dla rodzica (polling). Bez treści LLM ani promptu. */
export const GenerationDtoSchema = z.object({
  id: UuidSchema,
  deckId: UuidSchema.nullable(),
  deckVersionId: UuidSchema.nullable(),
  state: GenerationStateSchema,
  attempts: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
});
export type GenerationDto = z.infer<typeof GenerationDtoSchema>;
