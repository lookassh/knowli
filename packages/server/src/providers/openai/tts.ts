import type { TtsProvider, TtsSynthesizeInput } from "../../ports/ai";

export interface OpenAiTtsOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Adapter TTS (/v1/audio/speech). Głos bierze z żądania (fingerprint uwzględnia
 * provider/model/głos); dobór modelu i kodeka czeka na próbę z zadania 0.
 */
export function createOpenAiTtsProvider(options: OpenAiTtsOptions): TtsProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return {
    name: "openai",
    model,
    async synthesize(input: TtsSynthesizeInput, signal?: AbortSignal) {
      const response = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model || model,
          voice: input.voice,
          input: input.text,
          response_format: input.format,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { bytes, mimeType: "audio/mpeg" };
    },
  };
}
