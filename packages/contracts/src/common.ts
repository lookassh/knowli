import { z } from "zod";

/** Identyfikatory nadawane przez aplikację (UUID v4). */
export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/** Moment w czasie: ISO 8601 w UTC z sufiksem "Z". */
export const InstantSchema = z.iso.datetime();
export type Instant = z.infer<typeof InstantSchema>;

/** Lokalna data rodziny bez czasu (YYYY-MM-DD), np. termin sprawdzianu. */
export const DaySchema = z.iso.date();
export type Day = z.infer<typeof DaySchema>;

/** Wspólny format błędu API: {code, message, retryable, requestId}. */
export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  requestId: UuidSchema,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
