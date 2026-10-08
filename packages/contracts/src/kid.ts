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
    /**
     * Audio zdania przykładowego przygotowane z zestawem (SPEC §22); null, gdy
     * karta nie ma przykładu. Treść zdania jest już widoczna na prezentacji,
     * więc odsłuch nie wymaga osobnej ekspozycji (arch §12).
     */
    exampleAudioAssetId: UuidSchema.nullable(),
    /**
     * Zatwierdzona przez rodzica ilustracja — pomoc wizualna prezentacji
     * (SPEC §12.1, §24); null, gdy karta nie ma obrazu. Bajty przez route
     * media, bez dodatkowej ekspozycji (arch §12).
     */
    imageAssetId: UuidSchema.nullable(),
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
    /** Ilustracja karty; cel i tak jest widoczny w treści zadania (SPEC §24). */
    imageAssetId: UuidSchema.nullable(),
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

/** Widok profilu dla ekranu dziecka: tylko nazwa i awatar (arch §12). */
export const KidProfileDtoSchema = z.object({
  childId: UuidSchema,
  displayName: z.string().min(1),
  avatarKey: z.string().min(1),
});
export type KidProfileDto = z.infer<typeof KidProfileDtoSchema>;

/** Zestaw przypisany dziecku, dostępny do nauki (arch §12). */
export const KidDeckDtoSchema = z.object({
  deckId: UuidSchema,
  title: z.string().min(1),
  /** Termin sprawdzianu z przypisania (lokalna data rodziny) lub null. */
  testDate: z.string().nullable(),
  /**
   * Czy harmonogram ma teraz dla dziecka zaplanowaną pracę w tym zestawie
   * (należne sprawdzenia/powtórki albo nowy materiał)? Podstawa sekcji
   * „Rekomendowane”; ćwiczyć można każdy zestaw w dowolnym momencie.
   */
  recommended: z.boolean(),
});
export type KidDeckDto = z.infer<typeof KidDeckDtoSchema>;

/**
 * Feedback dla dziecka po próbie — wybór treści pochodzi z reguł domeny
 * (SPEC §16). `correctText` to rozwiązanie własnego zadania, ujawniane
 * wyłącznie wraz z ekspozycją zapisaną przed odpowiedzią HTTP.
 */
export const FeedbackDtoSchema = z.object({
  kind: z.enum(["great", "capitalization_hint", "almost", "incorrect", "not_assessed"]),
  correctText: z.string().min(1).optional(),
});
export type FeedbackDto = z.infer<typeof FeedbackDtoSchema>;

export const AttemptModalitySchema = z.enum(["choice", "text", "audio", "dont_remember", "skip"]);
export type AttemptModality = z.infer<typeof AttemptModalitySchema>;

/**
 * Odpowiedź dziecka na zadanie (arch §12). `clientAttemptId` zabezpiecza retry
 * transportowy; ponowne użycie tego samego klucza z inną treścią daje 409.
 * Odpowiedź audio idzie multipartem (bajty nagrania poza JSON) i jest
 * oceniana ścieżką mowy: rezerwacja processing → analiza → finalizacja.
 */
export const AttemptInputSchema = z.discriminatedUnion("modality", [
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("choice"),
    optionId: UuidSchema,
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("text"),
    text: z.string().max(500),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("audio"),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("dont_remember"),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("skip"),
  }),
]);
export type AttemptInput = z.infer<typeof AttemptInputSchema>;

export const AttemptDtoSchema = z.object({
  attemptId: UuidSchema,
  taskId: UuidSchema,
  state: z.enum(["processing", "completed"]),
  modality: AttemptModalitySchema,
  /** Reguły domeny; null dopóki ocena trwa (audio). */
  feedback: FeedbackDtoSchema.nullable(),
  /** Stan zadania po próbie: „issued” pozwala na drugie podejście. */
  taskState: z.enum(["issued", "answered", "completed", "skipped"]),
  /** Serwerowy krok ujawnienia feedbacku — pole dla późniejszych ACK obserwacji. */
  stepId: z.string().min(1).nullable(),
  receivedAt: InstantSchema,
  completedAt: InstantSchema.nullable(),
});
export type AttemptDto = z.infer<typeof AttemptDtoSchema>;
