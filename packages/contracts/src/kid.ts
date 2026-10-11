import { z } from "zod";
import { InstantSchema, UuidSchema } from "./common";
import { isVisualDataValid, RecordingModeSchema, VisualTypeSchema } from "./decks";

const visualPromptFields = {
  visualType: VisualTypeSchema.default("none"),
  visualData: z.record(z.string(), z.unknown()).optional(),
};

function validateVisualPrompt(
  prompt: { visualType: z.infer<typeof VisualTypeSchema>; visualData?: Record<string, unknown>; target: string },
  ctx: z.RefinementCtx,
) {
  if (!isVisualDataValid(prompt.visualType, prompt.visualData, prompt.target)) {
    ctx.addIssue({ code: "custom", path: ["visualData"], message: "visualData does not match visualType" });
  }
}

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
    ...visualPromptFields,
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
    ...visualPromptFields,
  }),
]).superRefine((prompt, ctx) => {
  if (prompt.kind === "exposure" || prompt.kind === "speech") {
    validateVisualPrompt({
      visualType: prompt.visualType,
      ...(prompt.visualData === undefined ? {} : { visualData: prompt.visualData }),
      target: prompt.kind === "exposure" ? prompt.target : prompt.text,
    }, ctx);
  }
});
export type TaskPrompt = z.infer<typeof TaskPromptSchema>;

export const SessionInputSchema = z.object({
  mode: z.enum(["training", "mock_test"]).optional(),
  childId: UuidSchema,
  deckId: UuidSchema,
  microphoneEnabled: z.boolean(),
});
export type SessionInput = z.infer<typeof SessionInputSchema>;

export const SessionDtoSchema = z.object({
  mode: z.enum(["training", "mock_test"]),
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

export const FeedbackAudioDtoSchema = z.object({
  attemptId: UuidSchema,
  taskId: UuidSchema,
  stepId: z.string().min(1),
  audioAssetId: UuidSchema,
});
export type FeedbackAudioDto = z.infer<typeof FeedbackAudioDtoSchema>;

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

export const SessionSummaryResultsSchema = z.object({
  independentSuccesses: z.object({
    recall: z.number().int().nonnegative(),
    spelling: z.number().int().nonnegative(),
  }),
  practiceItems: z.array(z.object({
    itemId: UuidSchema,
    target: z.string().min(1),
    skills: z.array(z.enum(["recall", "spelling"])).min(1),
  })),
});
export type SessionSummaryResults = z.infer<typeof SessionSummaryResultsSchema>;

export const SessionSummaryDtoSchema = SessionSummaryResultsSchema.extend({
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
  recordingMode: RecordingModeSchema,
});
export type KidProfileDto = z.infer<typeof KidProfileDtoSchema>;

/** Zestaw przypisany dziecku, dostępny do nauki (arch §12). */
export const KidDeckDtoSchema = z.object({
  mockTestAvailable: z.boolean().default(false),
  activeSession: z.object({ sessionId: UuidSchema, mode: z.enum(["training", "mock_test"]) }).nullable().default(null),
  deckId: UuidSchema,
  title: z.string().min(1),
  /** Liczba słów w przypiętej, opublikowanej wersji zestawu. */
  itemCount: z.number().int().nonnegative(),
  /** Elementy z opanowaną umiejętnością samodzielnego Recall. */
  independentlyRecalledCount: z.number().int().nonnegative(),
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
export const PronunciationFragmentDtoSchema = z.object({
  text: z.string().min(1),
  verdict: z.enum(["good", "almost", "unknown"]),
});
export type PronunciationFragmentDto = z.infer<typeof PronunciationFragmentDtoSchema>;

export const SpeechFeedbackDtoSchema = z.object({
  recognition: z.enum(["matched", "different", "uncertain", "no_speech", "unavailable"]),
  pronunciation: z.enum(["good", "practice", "unreliable", "unavailable", "not_configured", "not_applicable"]),
  referenceText: z.string().min(1).max(200).optional(),
}).strict().superRefine((speech, ctx) => {
  if (["uncertain", "no_speech", "unavailable"].includes(speech.recognition) && speech.referenceText !== undefined) {
    ctx.addIssue({ code: "custom", path: ["referenceText"], message: "uncertain recognition cannot disclose a reference text" });
  }
});
export type SpeechFeedbackDto = z.infer<typeof SpeechFeedbackDtoSchema>;

export const FeedbackDtoSchema = z.object({
  kind: z.enum(["great", "capitalization_hint", "almost", "incorrect", "content_matched", "not_assessed"]),
  correctText: z.string().min(1).optional(),
  heardText: z.string().min(1).max(200).optional(),
  fragments: z.array(PronunciationFragmentDtoSchema).max(6).optional(),
  speech: SpeechFeedbackDtoSchema.optional(),
  /** Wskazówka prezentacji; endpoint odsłuchu zawsze ponownie sprawdza uprawnienie. */
  referenceAudioAvailable: z.boolean().optional(),
}).strict().superRefine((feedback, ctx) => {
  if (feedback.speech && ["uncertain", "no_speech", "unavailable"].includes(feedback.speech.recognition)) {
    for (const field of ["heardText", "correctText", "fragments"] as const) {
      if (feedback[field] !== undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: "uncertain recognition cannot disclose speech content" });
      }
    }
  }
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
