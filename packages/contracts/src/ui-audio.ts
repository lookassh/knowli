import { z } from "zod";

export const UiAudioKeySchema = z.enum([
  "profile_select",
  "deck_select",
  "exposure",
  "listening",
  "speech",
  "recall",
  "correct",
  "partial",
  "incorrect",
  "unevaluated",
  "skip",
  "dont_remember",
  "end",
  "retry",
  "mic_unavailable",
  "audio_unavailable",
  "summary",
]);
export type UiAudioKey = z.infer<typeof UiAudioKeySchema>;

export const UiAudioCatalogDtoSchema = z.object({
  ready: z.boolean(),
  assets: z.partialRecord(UiAudioKeySchema, z.uuid()),
});
export type UiAudioCatalogDto = z.infer<typeof UiAudioCatalogDtoSchema>;
