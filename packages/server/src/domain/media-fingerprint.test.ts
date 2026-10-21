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

  it("bez przykładu zachowuje dotychczasowy prompt (fingerprint bez zmian)", () => {
    expect(illustrationPrompt({ source: "czwartek", target: "Thursday" })).toBe(
      `Simple child-friendly illustration of "Thursday" (czwartek). No text in the image.`,
    );
  });

  it("wstawia zdanie przykładu przed końcówkę promptu", () => {
    const prompt = illustrationPrompt({
      source: "gorąco",
      target: "hot",
      example: "It is hot in summer.",
    });
    expect(prompt).toBe(
      `Simple child-friendly illustration of "hot" (gorąco). It is hot in summer. No text in the image.`,
    );
  });

  it("domyka przykład bez interpunkcji końcowej i zmienia prompt", () => {
    const closed = illustrationPrompt({
      source: "gorąco",
      target: "hot",
      example: "It is hot in summer.",
    });
    const open = illustrationPrompt({
      source: "gorąco",
      target: "hot",
      example: "It is hot in summer",
    });
    expect(open).toBe(closed);
    expect(illustrationPrompt({ source: "gorąco", target: "hot" })).not.toBe(closed);
  });

  it("pusty przykład nie zmienia promptu", () => {
    expect(illustrationPrompt({ source: "czwartek", target: "Thursday", example: "  " })).toBe(
      illustrationPrompt({ source: "czwartek", target: "Thursday" }),
    );
  });

  it("flaga includeExampleInImage=false pomija przykład (prompt jak bez przykładu)", () => {
    const withoutExample = illustrationPrompt({ source: "czwartek", target: "Thursday" });
    expect(
      illustrationPrompt({
        source: "czwartek",
        target: "Thursday",
        example: "See you on Thursday.",
        visualData: { includeExampleInImage: false },
      }),
    ).toBe(withoutExample);
  });

  it("flaga includeExampleInImage=true zachowuje przykład", () => {
    expect(
      illustrationPrompt({
        source: "czwartek",
        target: "Thursday",
        example: "See you on Thursday.",
        visualData: { includeExampleInImage: true },
      }),
    ).toBe(
      illustrationPrompt({ source: "czwartek", target: "Thursday", example: "See you on Thursday." }),
    );
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
