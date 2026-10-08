import { describe, expect, it } from "vitest";
import { createAzureSttProvider } from "./stt";

// Kształty odpowiedzi potwierdzone próbą techniczną zadania 0 (REST Azure,
// format=detailed), w tym obserwacja, że cisza potrafi wrócić jako Success
// z pustym DisplayText — pusty tekst to brak odpowiedzi, nie pomyłka.
const liveShape = {
  RecognitionStatus: "Success",
  DisplayText: "Wednesday.",
  NBest: [{ Confidence: 0.6453759, Lexical: "wednesday", Display: "Wednesday." }],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", locale: "en-GB" };

describe("createAzureSttProvider", () => {
  it("rozpoznaje treść z Confidence z NBest[0]", async () => {
    const provider = createAzureSttProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse(liveShape),
    });
    const result = await provider.transcribe(audio);
    expect(result).toEqual({ status: "ok", text: "Wednesday.", confidence: 0.6453759 });
  });

  it("Success z pustym DisplayText (cisza w próbie) daje ok bez tekstu", async () => {
    const provider = createAzureSttProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () =>
        jsonResponse({ RecognitionStatus: "Success", DisplayText: "", NBest: [{ Confidence: 0 }] }),
    });
    const result = await provider.transcribe(audio);
    expect(result).toEqual({ status: "ok", text: null, confidence: 0 });
  });

  it("InitialSilenceTimeout to no_speech, nie błąd wiedzy dziecka", async () => {
    const provider = createAzureSttProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse({ RecognitionStatus: "InitialSilenceTimeout" }),
    });
    const result = await provider.transcribe(audio);
    expect(result).toEqual({ status: "no_speech", text: null, confidence: null });
  });

  it("odrzucone poświadczenia to błąd techniczny, nie failed", async () => {
    const provider = createAzureSttProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse({}, 401),
    });
    await expect(provider.transcribe(audio)).rejects.toMatchObject({ code: "internal" });
  });

  it("błąd HTTP kończy się failed bez szczegółów odpowiedzi", async () => {
    const provider = createAzureSttProvider({
      subscriptionKey: "k",
      region: "r",
      fetchImpl: async () => jsonResponse({}, 500),
    });
    const result = await provider.transcribe(audio);
    expect(result).toEqual({ status: "failed", text: null, confidence: null });
  });
});
