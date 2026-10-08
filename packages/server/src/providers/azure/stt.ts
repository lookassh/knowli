import type { AudioInput, SttProvider, TranscriptionResult } from "../../ports/ai";
import { AppError } from "../../errors";

/**
 * Adapter Azure Speech-to-text (REST, arch §11, SPEC §23). Rozpoznaje treść —
 * nie ocenia wymowy. Kształty odpowiedzi (w tym cisza jako Success z pustym
 * DisplayText) potwierdzone próbą techniczną zadania 0; klient musi wysyłać
 * WAV PCM, bo kompresja zwraca pusty wynik zamiast błędu (docs/speech-spike.md).
 */
export interface AzureSttOptions {
  subscriptionKey: string;
  region: string;
  fetchImpl?: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal },
  ) => Promise<Response>;
}

interface AzureRecognition {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: { Confidence?: number }[];
}

function failed(): TranscriptionResult {
  // bez szczegółów odpowiedzi usługi w błędzie — transkrypcja nie trafia do logów
  return { status: "failed", text: null, confidence: null };
}

export function createAzureSttProvider(options: AzureSttOptions): SttProvider {
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  return {
    name: "azure-stt",
    transcribe: async (audio: AudioInput, signal?: AbortSignal): Promise<TranscriptionResult> => {
      const url =
        `https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
        `?language=${encodeURIComponent(audio.locale)}&format=detailed`;
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": options.subscriptionKey,
            "Content-Type": audio.mimeType,
            Accept: "application/json",
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
        const payload = (await response.json()) as AzureRecognition;
        if (payload.RecognitionStatus === "Success") {
          return {
            status: "ok",
            text: payload.DisplayText?.trim() || null,
            confidence: payload.NBest?.[0]?.Confidence ?? null,
          };
        }
        // InitialSilenceTimeout/NoMatch/CandidateHasOnlyOffense itp. — nic
        // wiarygodnego nie rozpoznano; to nie jest błąd wiedzy dziecka
        return { status: "no_speech", text: null, confidence: null };
      } catch (error) {
        if (error instanceof AppError) throw error;
        return failed();
      }
    },
  };
}
