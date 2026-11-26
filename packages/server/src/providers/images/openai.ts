import type { ImageGenerateInput, ImageProvider } from "../../ports/ai";
import { timeoutAsProviderError } from "../../ports/generation-error";
import { providerFromBaseUrl, type UsageRecorder } from "../../ports/usage";
import { recordHttpError, recordResponse, recordTransportFailure, recordUnreadable } from "../usage/record-http";

export interface OpenAiImageOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Zapis kosztów wywołań (spec cost-tracking §4.2); bez niego adapter działa jak dotąd. */
  usage?: UsageRecorder;
  /** Limit jednego żądania (#412); domyślnie 180 s, poniżej lease mediów 5 min. */
  requestTimeoutMs?: number;
  /** Funkcja produktu zapisywana w kosztach: ilustracje elementów (domyślnie) albo okładka talii. */
  feature?: "illustration" | "deck_cover";
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
  const provider = providerFromBaseUrl(baseUrl);
  const feature = options.feature ?? "illustration";
  return {
    name: "openai",
    model: options.model ?? DEFAULT_MODEL,
    async generate(input: ImageGenerateInput, signal?: AbortSignal) {
      // jedno żądanie HTTP = jeden zapis
      const base = { feature, provider, model: input.model };
      const timeoutSignal = AbortSignal.timeout(options.requestTimeoutMs ?? 180_000);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/images/generations`, {
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
          signal: requestSignal,
        });
      } catch (error) {
        recordTransportFailure(options.usage, base);
        throw timeoutAsProviderError(error);
      }
      if (!response.ok) {
        recordHttpError(options.usage, base, response.status);
        throw new Error(`provider_http_${response.status}`);
      }
      let payload: {
        data?: Array<{ b64_json?: string }>;
      };
      try {
        payload = (await response.json()) as typeof payload;
      } catch (error) {
        recordUnreadable(options.usage, base, response.status);
        throw timeoutAsProviderError(error);
      }
      // płatna odpowiedź jest zapisana zanim treść zostanie zwalidowana
      const images = Array.isArray(payload?.data) ? payload.data.length : 0;
      recordResponse(options.usage, { ...base, images }, response.status, payload);
      const b64 = payload?.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error("openai images returned no data");
      }
      const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
      return { bytes, mimeType: MIME_BY_FORMAT[input.format] ?? "image/png" };
    },
  };
}
