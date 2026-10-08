import { describe, expect, it } from "vitest";
import { illustrationPrompt, ttsFingerprint, imageFingerprint } from "./media-fingerprint";

const ttsBase = {
  text: "Thursday",
  locale: "en-GB",
  provider: "openai",
  model: "gpt-4o-mini-tts",
  voice: "alloy",
  format: "mp3",
} as const;

describe("ttsFingerprint", () => {
  it("jest deterministyczny dla tych samych ustawień", () => {
    expect(ttsFingerprint(ttsBase)).toBe(ttsFingerprint({ ...ttsBase }));
    expect(ttsFingerprint(ttsBase)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("różni się dla tekstu, locale, głosu, modelu i providera", () => {
    const base = ttsFingerprint(ttsBase);
    expect(ttsFingerprint({ ...ttsBase, text: "Friday" })).not.toBe(base);
    expect(ttsFingerprint({ ...ttsBase, locale: "en-US" })).not.toBe(base);
    expect(ttsFingerprint({ ...ttsBase, voice: "verse" })).not.toBe(base);
    expect(ttsFingerprint({ ...ttsBase, model: "tts-1-hd" })).not.toBe(base);
    expect(ttsFingerprint({ ...ttsBase, provider: "azure" })).not.toBe(base);
  });
});

describe("imageFingerprint", () => {
  const imageBase = {
    prompt: "cat",
    provider: "openai",
    model: "gpt-image-1",
    size: "1024x1024",
    quality: "low",
    format: "webp",
  } as const;

  it("obejmuje prompt, provider, model i rozmiar", () => {
    const base = imageFingerprint(imageBase);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(imageFingerprint({ ...imageBase })).toBe(base);
    expect(imageFingerprint({ ...imageBase, prompt: "dog" })).not.toBe(base);
    expect(imageFingerprint({ ...imageBase, provider: "azure" })).not.toBe(base);
    expect(imageFingerprint({ ...imageBase, model: "gpt-image-1-mini" })).not.toBe(base);
    expect(imageFingerprint({ ...imageBase, size: "512x512" })).not.toBe(base);
  });

  it("różni się dla jakości i formatu — zmiana kosztu/formatu to inne żądanie", () => {
    const base = imageFingerprint(imageBase);
    expect(imageFingerprint({ ...imageBase, quality: "high" })).not.toBe(base);
    expect(imageFingerprint({ ...imageBase, format: "png" })).not.toBe(base);
  });
});

describe("illustrationPrompt", () => {
  it("jest deterministyczny i wynika z treści karty", () => {
    const item = { source: "czwartek", target: "Thursday" };
    expect(illustrationPrompt(item)).toBe(illustrationPrompt({ ...item }));
    expect(illustrationPrompt(item)).toContain("Thursday");
    expect(illustrationPrompt(item)).toContain("czwartek");
    expect(illustrationPrompt({ source: "czwartek", target: "Friday" })).not.toBe(illustrationPrompt(item));
  });

  it("uwzględnia jawne doprecyzowanie imagePrompt", () => {
    const item = { source: "czwartek", target: "Thursday" };
    const withHint = illustrationPrompt({
      ...item,
      visualData: { imagePrompt: "flat vector, pastel colors" },
    });
    expect(withHint).toContain("flat vector, pastel colors");
    expect(withHint).not.toBe(illustrationPrompt(item));
  });
});
