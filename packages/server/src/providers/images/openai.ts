import type { ImageGenerateInput, ImageProvider } from "../../ports/ai";

export interface OpenAiImageOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "gpt-image-1";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Adapter ilustracji (/v1/images/generations, b64_json). Niezweryfikowany do
 * czasu próby technicznej z zadania 0 (dobór modelu i rozmiaru).
 */
export function createOpenAiImageProvider(options: OpenAiImageOptions): ImageProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return {
    name: "openai",
    model,
    async generate(input: ImageGenerateInput, signal?: AbortSignal) {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, prompt: input.prompt, size: input.size }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`openai images failed: ${response.status} ${await response.text()}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string }>;
      };
      const b64 = payload.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error("openai images returned no data");
      }
      const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
      return { bytes, mimeType: "image/png" };
    },
  };
}
