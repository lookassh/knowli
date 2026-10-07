import { z } from "zod";
import { InstantSchema, UuidSchema } from "./common";

/**
 * Kontrakty Kid API (architecture.md §9). Publiczne DTO nigdy nie zawierają
 * klucza odpowiedzi, kryteriów oceny ani technicznych score'ów — te zostają
 * wyłącznie po stronie serwera w session_tasks.answer_key.
 */

export const EXERCISE_TYPES = [
  "exposure",
  "listening",
  "reading",
  "reverse_recognition",
  "recall",
  "speech",
  "letter_completion",
  "spelling",
] as const;
export type ExerciseTypeDto = (typeof EXERCISE_TYPES)[number];

export const ChoiceOptionSchema = z.object({
  id: UuidSchema,
  text: z.string().min(1),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

/** Publiczna treść zadania — discriminated union po polu kind = typ ćwiczenia. */
export const TaskPromptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exposure"),
    source: z.string().min(1),
    target: z.string().min(1),
    example: z.string().nullable(),
    audioAssetId: UuidSchema.nullable(),
  }),
  z.object({
    kind: z.literal("listening"),
    options: z.array(ChoiceOptionSchema).min(1),
    audioAssetId: UuidSchema,
  }),
  z.object({
    kind: z.literal("reading"),
    text: z.string().min(1),
    options: z.array(ChoiceOptionSchema).min(1),
  }),
  z.object({
    kind: z.literal("reverse_recognition"),
    prompt: z.string().min(1),
    options: z.array(ChoiceOptionSchema).min(1),
  }),
  z.object({ kind: z.literal("recall"), prompt: z.string().min(1) }),
  z.object({ kind: z.literal("spelling"), prompt: z.string().min(1) }),
  z.object({
    kind: z.literal("letter_completion"),
    prompt: z.string().min(1),
    fragment: z.string().min(1),
  }),
  z.object({
    kind: z.literal("speech"),
    text: z.string().min(1),
    audioAssetId: UuidSchema.nullable(),
  }),
]);
export type TaskPrompt = z.infer<typeof TaskPromptSchema>;

export const SessionInputSchema = z.object({
  childId: UuidSchema,
  deckId: UuidSchema,
  microphoneEnabled: z.boolean(),
});
export type SessionInput = z.infer<typeof SessionInputSchema>;

export const SessionDtoSchema = z.object({
  sessionId: UuidSchema,
  childId: UuidSchema,
  deckId: UuidSchema,
  deckVersionId: UuidSchema,
  policyId: z.string().min(1),
  microphoneEnabled: z.boolean(),
  state: z.enum(["active", "completed", "ended"]),
  /** Maksymalny budżet zadań ocenianych; prezentacje go nie powiększają. */
  taskBudget: z.number().int().positive(),
  tasksIssued: z.number().int().nonnegative(),
  assessedTasksIssued: z.number().int().nonnegative(),
  startedAt: InstantSchema,
  /** True, gdy zwrócono istniejącą aktywną sesję zamiast tworzyć nową. */
  resumed: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionDtoSchema>;

export const TaskDtoSchema = z.object({
  taskId: UuidSchema,
  sessionId: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  exerciseType: z.enum(EXERCISE_TYPES),
  direction: z.enum(["target_to_source", "source_to_target"]).nullable(),
  state: z.enum(["issued", "answered", "completed", "skipped"]),
  prompt: TaskPromptSchema,
  /** Zadania oceniane łącznie z bieżącym — podstawa komunikatu „Jeszcze N”. */
  remainingAssessed: z.number().int().positive(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const EventInputSchema = z.object({
  taskId: UuidSchema,
  clientEventId: UuidSchema,
  kind: z.enum(["display_confirmed", "audio_played"]),
  stepId: z.string().min(1).optional(),
});
export type EventInput = z.infer<typeof EventInputSchema>;

export const DisclosureInputSchema = z.object({
  taskId: UuidSchema,
  kind: z.enum(["audio", "hint"]),
});
export type DisclosureInput = z.infer<typeof DisclosureInputSchema>;

export const DisclosureDtoSchema = z.object({
  taskId: UuidSchema,
  /** Serwerowy identyfikator kroku — wspólne pole odpowiedzi i późniejszych ACK. */
  stepId: z.string().min(1),
  kind: z.enum(["audio", "hint"]),
  /** Rozwiązanie własnego zadania; tylko dla podpowiedzi (SPEC §16). */
  reveal: z.object({ target: z.string().min(1) }).nullable(),
});
export type DisclosureDto = z.infer<typeof DisclosureDtoSchema>;

export const PresentationCompletionInputSchema = z.object({
  taskId: UuidSchema,
  clientCommandId: UuidSchema.optional(),
});
export type PresentationCompletionInput = z.infer<typeof PresentationCompletionInputSchema>;

export const PresentationCompletionDtoSchema = z.object({
  taskId: UuidSchema,
  state: z.literal("completed"),
  completedAt: InstantSchema,
});
export type PresentationCompletionDto = z.infer<typeof PresentationCompletionDtoSchema>;

export const SessionSummaryDtoSchema = z.object({
  sessionId: UuidSchema,
  state: z.enum(["completed", "ended"]),
  tasksIssued: z.number().int().nonnegative(),
  assessedTasksIssued: z.number().int().nonnegative(),
  endedAt: InstantSchema,
});
export type SessionSummaryDto = z.infer<typeof SessionSummaryDtoSchema>;
