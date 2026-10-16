import { z } from "zod";
import { InstantSchema, UuidSchema } from "./common";

export const RewardActivityPauseReasonSchema = z.enum(["background", "blur", "offline", "idle", "technical_wait", "signal_timeout", "task_changed", "session_ended"]);
export type RewardActivityPauseReason = z.infer<typeof RewardActivityPauseReasonSchema>;

/** Rodzic potwierdza ręczne dodanie czasu albo odrzuca pakiet przed jego dodaniem. */
export const XboxRewardRequestDecisionSchema = z.enum(["fulfilled", "rejected"]);
export type XboxRewardRequestDecision = z.infer<typeof XboxRewardRequestDecisionSchema>;

/** Klient podaje wyłącznie sygnał; czas i wartość rozliczenia ustala serwer. */
export const RewardActivitySignalSchema = z.object({
  sessionId: UuidSchema,
  taskId: UuidSchema,
  streamId: UuidSchema,
  sequence: z.number().int().positive(),
  kind: z.enum(["interaction", "heartbeat", "playback_start", "playback_end", "pause", "takeover"]),
  pauseReason: z.enum(["background", "blur", "offline", "idle", "technical_wait", "task_changed", "session_ended"]).optional(),
  playbackAuthorizationId: UuidSchema.optional(),
  playbackAssetId: UuidSchema.optional(),
}).strict().superRefine((signal, ctx) => {
  const playback = signal.kind === "playback_start" || signal.kind === "playback_end";
  if (playback && (!signal.playbackAuthorizationId || !signal.playbackAssetId)) {
    ctx.addIssue({ code: "custom", message: "playback signals require server authorization and an asset id" });
  }
  if (!playback && (signal.playbackAuthorizationId || signal.playbackAssetId)) {
    ctx.addIssue({ code: "custom", message: "playback authorization is only valid for playback signals" });
  }
  if (signal.pauseReason !== undefined && signal.kind !== "pause") {
    ctx.addIssue({ code: "custom", message: "pause reason is only valid for pause signals" });
  }
});
export type RewardActivitySignal = z.infer<typeof RewardActivitySignalSchema>;

export const RewardActivityPlaybackAuthorizationInputSchema = z.object({ sessionId: UuidSchema, taskId: UuidSchema, streamId: UuidSchema, assetId: UuidSchema }).strict();
export type RewardActivityPlaybackAuthorizationInput = z.infer<typeof RewardActivityPlaybackAuthorizationInputSchema>;
export const RewardActivityPlaybackAuthorizationDtoSchema = z.object({ authorizationId: UuidSchema }).strict();
export type RewardActivityPlaybackAuthorizationDto = z.infer<typeof RewardActivityPlaybackAuthorizationDtoSchema>;

export const RewardActivitySignalDtoSchema = z.object({
  streamId: UuidSchema,
  sequence: z.number().int().positive(),
  acceptedAt: InstantSchema,
  paused: z.boolean(),
  pauseReason: RewardActivityPauseReasonSchema.nullable(),
}).strict();
export type RewardActivitySignalDto = z.infer<typeof RewardActivitySignalDtoSchema>;

export const RewardActivitySummaryDtoSchema = z.object({
  childId: UuidSchema,
  sessions: z.array(z.object({
    sessionId: UuidSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema.nullable(),
    creditedSeconds: z.number().int().nonnegative(),
    pauseReasons: z.array(RewardActivityPauseReasonSchema),
  }).strict()),
  creditedSeconds: z.number().int().nonnegative(),
}).strict();
export type RewardActivitySummaryDto = z.infer<typeof RewardActivitySummaryDtoSchema>;
