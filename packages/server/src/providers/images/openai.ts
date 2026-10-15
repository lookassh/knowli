import type { ImageGenerateInput, ImageProvider } from "../../ports/ai";

export interface OpenAiImageOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

/**
 * Adapter ilustracji (/v1/images/generations, b64_json). Model, jakość i format
 * (output_format) pochodzą z żądania, nie z konstruktora — fingerprint zasobu
 * i faktyczne wywołanie API nie mogą się rozjechać.
 */
export function createOpenAiImageProvider(options: OpenAiImageOptions): ImageProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return {
    name: "openai",
    model: options.model ?? DEFAULT_MODEL,
    async generate(input: ImageGenerateInput, signal?: AbortSignal) {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          output_format: input.format,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string }>;
      };
      const b64 = payload.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error("openai images returned no data");
      }
      const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
      return { bytes, mimeType: MIME_BY_FORMAT[input.format] ?? "image/png" };
    },
  };
}
