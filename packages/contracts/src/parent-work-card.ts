import { z } from "zod";
import { DaySchema, InstantSchema, UuidSchema } from "./common";

export const ParentWorkCardQuerySchema = z.object({ childId: UuidSchema, date: DaySchema }).strict();
export type ParentWorkCardQuery = z.infer<typeof ParentWorkCardQuerySchema>;

const NonNegativeInt = z.number().int().nonnegative();
export const ParentWorkCardDtoSchema = z.object({
  childId: UuidSchema,
  date: DaySchema,
  creditedSeconds: NonNegativeInt,
  sessions: z.array(z.object({
    sessionId: UuidSchema,
    mode: z.enum(["training", "mock_test", "daily_round"]),
    state: z.enum(["active", "completed", "ended"]),
    startedAt: InstantSchema,
    endedAt: InstantSchema.nullable(),
    deckTitle: z.string(),
    deckVersionNumber: z.number().int().positive(),
    creditedSeconds: NonNegativeInt,
    remainingSteps: NonNegativeInt,
    steps: z.array(z.object({
      taskId: UuidSchema,
      ordinal: NonNegativeInt,
      exerciseType: z.string(),
      state: z.enum(["issued", "answered", "completed", "skipped"]),
      issuedAt: InstantSchema,
      responses: z.array(z.object({
        modality: z.enum(["choice", "text", "audio", "dont_remember", "skip", "sequence"]),
        answerExample: z.string().max(160).nullable(),
        feedbackKind: z.string().nullable(),
        assessment: z.enum(["assessed", "unassessed", "mixed", "none"]).nullable(),
        responseSeconds: NonNegativeInt,
      }).strict()),
    }).strict()),
  }).strict()),
  dailyRound: z.object({
    state: z.enum(["active", "completed", "ended"]).nullable(),
    sessionId: UuidSchema.nullable(),
    deckTitle: z.string().nullable(),
    steps: NonNegativeInt.nullable(),
    answered: NonNegativeInt.nullable(),
  }).strict(),
}).strict();
export type ParentWorkCardDto = z.infer<typeof ParentWorkCardDtoSchema>;
