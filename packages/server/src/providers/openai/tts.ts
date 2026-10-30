import type { TtsProvider, TtsSynthesizeInput } from "../../ports/ai";
import { pcmToWav, wavDurationMs } from "../audio/wav";

export interface OpenAiTtsOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * `audio/pcm;rate=24000;channels=1` → format próbek; brak częstotliwości = nieznany
 * format. `audio/L16` celowo odrzucony: jest big-endian, a nagłówek WAV deklaruje
 * little-endian.
 */
function pcmFormatOf(contentType: string): { sampleRate: number; channels: number } | null {
  const [type, ...params] = contentType.split(";").map((part) => part.trim().toLowerCase());
  if (type !== "audio/pcm") return null;
  const values = Object.fromEntries(params.map((param) => param.split("=") as [string, string]));
  const sampleRate = Number(values.rate);
  const channels = values.channels === undefined ? 1 : Number(values.channels);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) return null;
  return { sampleRate, channels };
}

/**
 * Adapter TTS (/v1/audio/speech). Głos bierze z żądania (fingerprint uwzględnia
 * provider/model/głos). Format `wav` prosi o surowe PCM (jedyny format Gemini
 * TTS na OpenRouter) i opakowuje je nagłówkiem WAV; `instructions` (np. język
 * wymowy) idzie osobnym polem, nie w czytanym tekście.
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
          response_format: input.format === "wav" ? "pcm" : input.format,
          ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (input.format === "mp3") return { bytes, mimeType: "audio/mpeg" };
      const contentType = response.headers.get("content-type") ?? "";
      const pcm = pcmFormatOf(contentType);
      const wav = /^audio\/(wav|x-wav|wave)\b/i.test(contentType) ? bytes : pcm && pcmToWav(bytes, pcm);
      // Do logów trafia tylko kod. Zgadnięty format albo ucięty/pusty plik
      // zostałby zapisany jako gotowe nagranie bez ponowienia.
      if (wav === null || wavDurationMs(wav) === null) throw new Error("provider_unexpected_audio");
      return { bytes: wav, mimeType: "audio/wav" };
    },
  };
}
