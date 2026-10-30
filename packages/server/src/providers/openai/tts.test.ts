import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiTtsProvider } from "./tts";
import { pcmToWav } from "../audio/wav";

afterEach(() => vi.unstubAllGlobals());

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("createOpenAiTtsProvider", () => {
  it("does not expose provider response bodies in HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider detail", { status: 400 })));
    const provider = createOpenAiTtsProvider({ apiKey: "test" });
    const failure = provider.synthesize({ text: "hello", locale: "en-GB", voice: "alloy", format: "mp3" });
    await expect(failure).rejects.toThrow(/400/);
    await expect(failure).rejects.not.toThrow(/private provider detail/);
  });

  it("wysyła model zapisany w zasobie zamiast bieżącego modelu adaptera", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiTtsProvider({ apiKey: "test", model: "openai/gpt-4o-mini-tts-2025-12-15" });
    await provider.synthesize({ text: "Ile nóg ma pająk?", locale: "pl-PL", voice: "alloy", format: "mp3", model: "gpt-4o-mini-tts" });
    expect(bodyOf(fetchMock).model).toBe("gpt-4o-mini-tts");
  });

  it("mp3 bez instrukcji: żądanie mp3 bez pola instructions, wynik audio/mpeg", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiTtsProvider({ apiKey: "test" });
    const result = await provider.synthesize({ text: "cat", locale: "en-GB", voice: "alloy", format: "mp3" });
    expect(bodyOf(fetchMock)).toEqual({ model: "gpt-4o-mini-tts", voice: "alloy", input: "cat", response_format: "mp3" });
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("wav: prosi o pcm, przekazuje instrukcję i opakowuje odpowiedź nagłówkiem WAV", async () => {
    const pcm = new Uint8Array([0, 1, 2, 3]);
    const fetchMock = vi.fn(async () => new Response(pcm, { status: 200, headers: { "content-type": "audio/pcm;rate=24000;channels=1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiTtsProvider({ apiKey: "test", model: "google/gemini-3.8-flash-tts" });
    const result = await provider.synthesize({
      text: "pies", locale: "pl-PL", voice: "Kore", format: "wav", instructions: "Mów po polsku, z polską wymową.",
    });
    expect(bodyOf(fetchMock)).toEqual({
      model: "google/gemini-3.8-flash-tts",
      voice: "Kore",
      input: "pies",
      response_format: "pcm",
      instructions: "Mów po polsku, z polską wymową.",
    });
    expect(result.mimeType).toBe("audio/wav");
    expect(String.fromCharCode(...result.bytes.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint32(24, true)).toBe(24000);
    expect([...result.bytes.subarray(44)]).toEqual([...pcm]);
  });

  it("wav: poprawna odpowiedź już w WAV przechodzi bez zmian", async () => {
    const wav = pcmToWav(new Uint8Array(480), { sampleRate: 24000, channels: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(wav, { status: 200, headers: { "content-type": "audio/wav" } })));
    const provider = createOpenAiTtsProvider({ apiKey: "test" });
    const result = await provider.synthesize({ text: "kot", locale: "pl-PL", voice: "Kore", format: "wav" });
    expect(result).toEqual({ bytes: wav, mimeType: "audio/wav" });
  });

  it("wav: ucięty WAV albo puste PCM to błąd — zasób nie może zostać gotowy bez dźwięku", async () => {
    const provider = createOpenAiTtsProvider({ apiKey: "test" });
    const full = pcmToWav(new Uint8Array(480), { sampleRate: 24000, channels: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(full.subarray(0, 100), { status: 200, headers: { "content-type": "audio/wav" } })));
    await expect(provider.synthesize({ text: "kot", locale: "pl-PL", voice: "Kore", format: "wav" })).rejects.toThrow("provider_unexpected_audio");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "audio/pcm;rate=24000;channels=1" } })));
    await expect(provider.synthesize({ text: "kot", locale: "pl-PL", voice: "Kore", format: "wav" })).rejects.toThrow("provider_unexpected_audio");
  });

  it("wav: audio/L16 (big-endian) jest odrzucane, a nie zapisywane jako zniekształcony WAV", async () => {
    const provider = createOpenAiTtsProvider({ apiKey: "test" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0, 1, 2, 3]), { status: 200, headers: { "content-type": "audio/L16;rate=24000" } })));
    await expect(provider.synthesize({ text: "kot", locale: "pl-PL", voice: "Kore", format: "wav" })).rejects.toThrow("provider_unexpected_audio");
  });

  it("wav: inny typ odpowiedzi albo PCM bez częstotliwości to błąd, a nie zgadywanie formatu", async () => {
    const provider = createOpenAiTtsProvider({ apiKey: "test" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/mpeg" } })));
    await expect(provider.synthesize({ text: "kot", locale: "pl-PL", voice: "Kore", format: "wav" })).rejects.toThrow("provider_unexpected_audio");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/pcm" } })));
    await expect(provider.synthesize({ text: "kot", locale: "pl-PL", voice: "Kore", format: "wav" })).rejects.toThrow("provider_unexpected_audio");
  });
});
