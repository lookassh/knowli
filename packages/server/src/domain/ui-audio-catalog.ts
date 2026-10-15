import { messages, UiAudioKeySchema, type UiAudioKey } from "@learning/contracts";

export const UI_AUDIO_TEXTS = messages.uiAudio satisfies Record<UiAudioKey, string>;

export function isUiAudioAssetMetadata(value: unknown): value is {
  purpose: "kid_ui_guidance";
  uiAudioKey: UiAudioKey;
  text: string;
  locale: "pl-PL";
  voice: string;
  format: "mp3";
} {
  if (typeof value !== "object" || value === null) return false;
  const metadata = value as Record<string, unknown>;
  const parsedKey = UiAudioKeySchema.safeParse(metadata.uiAudioKey);
  return metadata.purpose === "kid_ui_guidance"
    && parsedKey.success
    && metadata.text === UI_AUDIO_TEXTS[parsedKey.data]
    && typeof metadata.text === "string"
    && metadata.locale === "pl-PL"
    && typeof metadata.voice === "string"
    && metadata.format === "mp3";
}
