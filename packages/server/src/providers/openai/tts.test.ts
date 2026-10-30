import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiTtsProvider } from "./tts";

afterEach(() => vi.unstubAllGlobals());

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
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("gpt-4o-mini-tts");
  });
});
