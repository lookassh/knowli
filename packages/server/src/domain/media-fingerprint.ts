import { createHash } from "node:crypto";

/**
 * Fingerprint mediów identyfikuje pełne żądanie generacji: treść, locale,
 * provider, model, głos i parametry (architecture.md §8). Nie jest to
 * target_key ekspozycji. Locale tekstu pochodzi z payloadu karty.
 */

function hashOf(canonical: Record<string, unknown>): string {
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash("sha256").update(json).digest("hex");
}

export interface TtsFingerprintInput {
  text: string;
  locale: string;
  provider: string;
  model: string;
  voice: string;
  format: string;
}

export function ttsFingerprint(input: TtsFingerprintInput): string {
  return hashOf({
    kind: "tts",
    text: input.text,
    locale: input.locale,
    provider: input.provider,
    model: input.model,
    voice: input.voice,
    format: input.format,
  });
}

export interface ImageFingerprintInput {
  prompt: string;
  provider: string;
  model: string;
  size: string;
}

export function imageFingerprint(input: ImageFingerprintInput): string {
  return hashOf({
    kind: "illustration",
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
    size: input.size,
  });
}

export interface IllustratableItem {
  source: string;
  target: string;
  visualData?: Record<string, unknown>;
}

/** Deterministyczny prompt ilustracji z treści karty; imagePrompt doprecyzowuje. */
export function illustrationPrompt(item: IllustratableItem): string {
  const raw = item.visualData?.imagePrompt;
  const hint = typeof raw === "string" && raw.trim() ? ` ${raw.trim()}` : "";
  return `Simple child-friendly illustration of "${item.target}" (${item.source}). No text in the image.${hint}`;
}
