import { describe, expect, it } from "vitest";
import { messages, UiAudioKeySchema } from "@learning/contracts";
import { isUiAudioAssetMetadata, UI_AUDIO_STYLES, UI_AUDIO_TEXTS } from "./ui-audio-catalog";

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

  it("przypisuje styl wypowiedzi każdemu z kluczy", () => {
    expect(Object.keys(UI_AUDIO_STYLES).sort()).toEqual([...UiAudioKeySchema.options].sort());
    expect(UI_AUDIO_STYLES.correct).toBe("ui_praise");
    expect(UI_AUDIO_STYLES.summary).toBe("ui_closing");
  });

  it("rozpoznaje tylko metadane UI z kluczem i stałym polskim TTS", () => {
    expect(isUiAudioAssetMetadata({
      purpose: "kid_ui_guidance", uiAudioKey: "summary", text: UI_AUDIO_TEXTS.summary,
      locale: "pl-PL", voice: "alloy", format: "mp3",
    })).toBe(true);
    expect(isUiAudioAssetMetadata({
      purpose: "kid_ui_guidance", uiAudioKey: "summary", text: UI_AUDIO_TEXTS.summary,
      locale: "pl-PL", voice: "Kore", format: "wav", instructions: "Mów po polsku.",
    })).toBe(true);
    expect(isUiAudioAssetMetadata({
      purpose: "kid_ui_guidance", uiAudioKey: "summary", text: UI_AUDIO_TEXTS.summary,
      locale: "pl-PL", voice: "Kore", format: "ogg",
    })).toBe(false);
    expect(isUiAudioAssetMetadata({
      purpose: "kid_ui_guidance", uiAudioKey: "summary", text: UI_AUDIO_TEXTS.summary,
      locale: "pl-PL", voice: "Kore", format: "wav", instructions: 7,
    })).toBe(false);
    expect(isUiAudioAssetMetadata({ purpose: "kid_ui_guidance", uiAudioKey: "unknown" })).toBe(false);
    expect(isUiAudioAssetMetadata({ purpose: "lesson", uiAudioKey: "summary" })).toBe(false);
  });
});
