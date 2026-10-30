import { messages, UiAudioKeySchema, type UiAudioKey } from "@learning/contracts";

import type { TtsRoleStyle } from "./tts-style";

export const UI_AUDIO_TEXTS = messages.uiAudio satisfies Record<UiAudioKey, string>;

/** Styl wypowiedzi komunikatu; klucz bez stylu nie przejdzie typecheck. Nie trafia do kontraktów ani metadanych zasobu. */
export const UI_AUDIO_STYLES = {
  correct: "ui_praise",
  partial: "ui_gentle",
  incorrect: "ui_gentle",
  unevaluated: "ui_gentle",
  skip: "ui_gentle",
  dont_remember: "ui_gentle",
  retry: "ui_gentle",
  mic_unavailable: "ui_gentle",
  audio_unavailable: "ui_gentle",
  profile_select: "ui_guidance",
  deck_select: "ui_guidance",
  exposure: "ui_guidance",
  listening: "ui_guidance",
  speech: "ui_guidance",
  recall: "ui_guidance",
  end: "ui_closing",
  summary: "ui_closing",
} satisfies Record<UiAudioKey, TtsRoleStyle>;

export function isUiAudioAssetMetadata(value: unknown): value is {
  purpose: "kid_ui_guidance";
  uiAudioKey: UiAudioKey;
  text: string;
  locale: "pl-PL";
  voice: string;
  format: "mp3" | "wav";
  instructions?: string;
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
    && (metadata.format === "mp3" || metadata.format === "wav")
    && (metadata.instructions === undefined || typeof metadata.instructions === "string");
}
