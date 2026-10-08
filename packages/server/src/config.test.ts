import { describe, expect, it } from "vitest";
import { defaultMediaSettings, mediaSettingsFromEnv } from "./config";

describe("mediaSettingsFromEnv", () => {
  it("bez env zwraca domyślne ustawienia (low + webp)", () => {
    expect(mediaSettingsFromEnv({})).toEqual(defaultMediaSettings);
    expect(defaultMediaSettings.image).toMatchObject({ quality: "low", format: "webp" });
  });

  it("zmienne UMIEM_IMAGE_* nadpisują model, rozmiar, jakość i format", () => {
    const settings = mediaSettingsFromEnv({
      UMIEM_IMAGE_MODEL: "gpt-image-1-mini",
      UMIEM_IMAGE_SIZE: "1024x1536",
      UMIEM_IMAGE_QUALITY: "medium",
      UMIEM_IMAGE_FORMAT: "png",
    });
    expect(settings.image).toEqual({
      provider: "openai",
      model: "gpt-image-1-mini",
      size: "1024x1536",
      quality: "medium",
      format: "png",
    });
    expect(settings.tts).toEqual(defaultMediaSettings.tts);
  });
});
