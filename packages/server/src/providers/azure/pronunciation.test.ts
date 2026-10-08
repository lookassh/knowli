import { describe, expect, it } from "vitest";
import { createAzurePronunciationProvider } from "./pronunciation";

// Kształt odpowiedzi potwierdzony próbą techniczną zadania 0 (REST Azure,
// format=detailed): score ląduje bezpośrednio na NBest[0], a nie w zagnieżdżonym
// PronunciationAssessment (to forma SDK, nie REST).
const liveShape = {
  RecognitionStatus: "Success",
  DisplayText: "Wednesday.",
  NBest: [
    {
      Confidence: 0.93967015,
      Lexical: "wednesday",
      Display: "Wednesday.",
      AccuracyScore: 88,
      FluencyScore: 100,
      CompletenessScore: 100,
      PronScore: 92.8,
      Words: [{ Word: "wednesday", AccuracyScore: 88, ErrorType: "None" }],
    },
  ],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", locale: "en-GB" };

describe("createAzurePronunciationProvider", () => {
  it("odczytuje AccuracyScore bezpośrednio z NBest[0] (kształt z próby zadania 0)", async () => {
    const provider = createAzurePronunciationProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse(liveShape),
    });
    const result = await provider.assess(audio, "wednesday");
    expect(result).toEqual({ status: "ok", overallScore: 88, recognizedText: "Wednesday." });
  });

  it("inne słowo niż expectedText ma niski Confidence — treść rozstrzyga STT", async () => {
    const wrongWord = structuredClone(liveShape);
    wrongWord.NBest[0]!.Confidence = 0.19226873;
    wrongWord.NBest[0]!.AccuracyScore = 61;
    const provider = createAzurePronunciationProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse(wrongWord),
    });
    const result = await provider.assess(audio, "wednesday");
    expect(result.overallScore).toBe(61);
  });

  it("cisza (InitialSilenceTimeout) daje no_speech bez oceny", async () => {
    const provider = createAzurePronunciationProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse({ RecognitionStatus: "InitialSilenceTimeout" }),
    });
    const result = await provider.assess(audio, "wednesday");
    expect(result).toEqual({ status: "no_speech", overallScore: null, recognizedText: null });
  });

  it("odpowiedź bez Success nie jest oceną", async () => {
    const provider = createAzurePronunciationProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse({ RecognitionStatus: "NoMatch" }),
    });
    const result = await provider.assess(audio, "wednesday");
    expect(result.status).toBe("no_speech");
  });

  it("błąd HTTP kończy się failed bez szczegółów odpowiedzi", async () => {
    const provider = createAzurePronunciationProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse({}, 500),
    });
    const result = await provider.assess(audio, "wednesday");
    expect(result).toEqual({ status: "failed", overallScore: null, recognizedText: null });
  });
});
