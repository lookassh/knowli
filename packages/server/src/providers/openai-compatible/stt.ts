import type { AudioInput, SttProvider, TranscriptionResult } from "../../ports/ai";
import { AppError } from "../../errors";
import { isOpenRouterEndpoint } from "../chat-request-options";

/**
 * Adapter transkrypcji w formacie OpenAI `POST {baseUrl}/audio/transcriptions`
 * (JSON z `input_audio` base64), używany dla dyktowania odpowiedzi lekcji
 * (design szkoły §5.2: `elevenlabs/scribe-v2` przez OpenRouter). Rozpoznaje
 * treść — nie ocenia wymowy.
 *
 * Prywatność: do usługi trafiają tylko bajty nagrania, język i model — bez
 * `user`, `session_id`, `keyterms` ani treści materiału. Dla OpenRouter adapter
 * zawsze żąda Zero Data Retention i zakazu zbierania danych; brak takiego
 * endpointu kończy się błędem, nigdy cichym przejściem do providera z retencją.
 */
export interface OpenAiCompatibleSttOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal },
  ) => Promise<Response>;
}

interface TranscriptionPayload {
  text?: unknown;
  confidence?: unknown;
  words?: { confidence?: unknown; type?: unknown }[];
}

function failed(): TranscriptionResult {
  // bez treści odpowiedzi usługi — transkrypcja nie trafia do błędów ani logów
  return { status: "failed", text: null, confidence: null };
}

/** „pl-PL” → „pl” (ISO-639-1, jak w API transkrypcji). */
function languageOf(locale: string): string {
  return locale.split("-")[0]!.toLowerCase();
}

function formatOf(mimeType: string): string {
  if (/^audio\/(x-)?wa(v|ve)\b/.test(mimeType)) return "wav";
  if (/^audio\/webm\b/.test(mimeType)) return "webm";
  if (/^audio\/(mp4|m4a|x-m4a)\b/.test(mimeType)) return "m4a";
  if (/^audio\/ogg\b/.test(mimeType)) return "ogg";
  return "wav";
}

/**
 * Znaczniki zdarzeń dźwiękowych („[szum]”, „[śmiech]”) nie są wypowiedzią
 * dziecka: tekst złożony wyłącznie z nich to cisza (spike §5.1 pkt 8).
 */
export function stripAudioEventTags(text: string): string {
  return text.replace(/\[[^\]\n]{0,40}\]/g, " ").replace(/\s+/g, " ").trim();
}

function confidenceOf(payload: TranscriptionPayload): number | null {
  if (typeof payload.confidence === "number" && Number.isFinite(payload.confidence)) return payload.confidence;
  const words = (payload.words ?? [])
    .filter((word) => word.type !== "audio_event" && word.type !== "spacing")
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return words.length > 0 ? words.reduce((sum, value) => sum + value, 0) / words.length : null;
}

/** Adres bazowy bez końcowych „/” — pętla zamiast wyrażenia z cofaniem. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

export function createOpenAiCompatibleSttProvider(options: OpenAiCompatibleSttOptions): SttProvider {
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  const endpoint = `${withoutTrailingSlashes(options.baseUrl)}/audio/transcriptions`;
  const openRouter = isOpenRouterEndpoint(options.baseUrl);
  return {
    name: options.model,
    transcribe: async (audio: AudioInput, signal?: AbortSignal): Promise<TranscriptionResult> => {
      const request = (responseFormat: "verbose_json" | "json") => doFetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          model: options.model,
          input_audio: { data: Buffer.from(audio.bytes).toString("base64"), format: formatOf(audio.mimeType) },
          language: languageOf(audio.locale),
          temperature: 0,
          response_format: responseFormat,
          ...(responseFormat === "verbose_json" ? { timestamp_granularities: ["word"] } : {}),
          ...(openRouter ? { provider: { zdr: true, data_collection: "deny" } } : {}),
        }),
        ...(signal ? { signal } : {}),
      });
      try {
        let response = await request("verbose_json");
        // część modeli nie zwraca verbose_json (np. gpt-4o-transcribe) — wtedy sam tekst
        if (response.status === 400) {
          await response.body?.cancel().catch(() => undefined);
          response = await request("json");
        }
        if (response.status === 401 || response.status === 403) {
          throw new AppError("internal", { message: "speech-to-text credentials rejected" });
        }
        if (!response.ok) return failed();
        const payload = (await response.json()) as TranscriptionPayload;
        const raw = typeof payload.text === "string" ? stripAudioEventTags(payload.text) : "";
        if (raw === "") return { status: "no_speech", text: null, confidence: null };
        return { status: "ok", text: raw, confidence: confidenceOf(payload) };
      } catch (error) {
        if (error instanceof AppError) throw error;
        return failed();
      }
    },
  };
}
