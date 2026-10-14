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
});
