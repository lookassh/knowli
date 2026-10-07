import type { AudioInput, PronunciationProvider, PronunciationResult } from "../../ports/ai";
import { AppError } from "../../errors";

/**
 * Adapter Azure Pronunciation Assessment (REST, arch §11, SPEC §23). Ocenia
 * wymowę względem JEDNEGO oczekiwanego tekstu — poprawności treści rozstrzyga
 * osobna transkrypcja STT, nigdy ten wynik. UWAGA: niezweryfikowany względem
 * żywej usługi — wymaga próby technicznej z zadania 0 (klucze, progi pasm).
 */
export interface AzurePronunciationOptions {
  subscriptionKey: string;
  region: string;
  fetchImpl?: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal },
  ) => Promise<Response>;
}

interface AzurePronunciationResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: {
    Confidence?: number;
    PronunciationAssessment?: { AccuracyScore?: number };
  }[];
}

function failed(): PronunciationResult {
  return { status: "failed", overallScore: null, recognizedText: null };
}

export function createAzurePronunciationProvider(options: AzurePronunciationOptions): PronunciationProvider {
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  return {
    name: "azure-pronunciation",
    assess: async (
      audio: AudioInput,
      expectedText: string,
      signal?: AbortSignal,
    ): Promise<PronunciationResult> => {
      const url =
        `https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
        `?language=${encodeURIComponent(audio.locale)}&format=detailed`;
      // parametry oceny jadą w nagłówku base64 — ReferenceText to tekst klucza
      // odpowiedzi zadania, nie dane dziecka; bajty nagrania tylko w body
      const assessmentParams = Buffer.from(
        JSON.stringify({
          ReferenceText: expectedText,
          GradingSystem: "HundredMark",
          Granularity: "Word",
          Dimension: "Comprehensive",
        }),
        "utf8",
      ).toString("base64");
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": options.subscriptionKey,
            "Content-Type": audio.mimeType,
            Accept: "application/json",
            "Pronunciation-Assessment": assessmentParams,
          },
          body: audio.bytes,
          signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new AppError("internal", { message: "azure speech credentials rejected" });
        }
        if (!response.ok) {
          return failed();
        }
        const payload = (await response.json()) as AzurePronunciationResponse;
        const best = payload.NBest?.[0];
        if (payload.RecognitionStatus !== "Success" || !best) {
          return { status: "no_speech", overallScore: null, recognizedText: null };
        }
        const score = best.PronunciationAssessment?.AccuracyScore;
        return {
          status: "ok",
          overallScore: typeof score === "number" ? score : null,
          recognizedText: payload.DisplayText?.trim() || null,
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        return failed();
      }
    },
  };
}
