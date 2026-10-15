import { describe, expect, it } from "vitest";
import { messages, UiAudioKeySchema } from "@learning/contracts";
import { isUiAudioAssetMetadata, UI_AUDIO_TEXTS } from "./ui-audio-catalog";

describe("katalog stałych wskazówek audio", () => {
  it("ma polski, niepersonalizowany tekst dla każdego z 17 kluczy", () => {
    expect(Object.keys(UI_AUDIO_TEXTS)).toHaveLength(17);
    expect(Object.keys(UI_AUDIO_TEXTS).sort()).toEqual([...UiAudioKeySchema.options].sort());
    expect(UI_AUDIO_TEXTS).toEqual(messages.uiAudio);
    for (const text of Object.values(UI_AUDIO_TEXTS)) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/\b(?:Ala|Szymek|Krzyś)\b/);
    }
  });

  it("rozpoznaje tylko metadane UI z kluczem i stałym polskim TTS", () => {
    expect(isUiAudioAssetMetadata({
      purpose: "kid_ui_guidance", uiAudioKey: "summary", text: UI_AUDIO_TEXTS.summary,
      locale: "pl-PL", voice: "alloy", format: "mp3",
    })).toBe(true);
    expect(isUiAudioAssetMetadata({ purpose: "kid_ui_guidance", uiAudioKey: "unknown" })).toBe(false);
    expect(isUiAudioAssetMetadata({ purpose: "lesson", uiAudioKey: "summary" })).toBe(false);
  });
});
