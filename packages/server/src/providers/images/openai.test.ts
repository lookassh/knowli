import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiImageProvider } from "./openai";

function okResponse(b64: string) {
  return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
}

const REQUEST = {
  prompt: "Simple child-friendly illustration of \"apple\" (jabłko). No text in the image.",
  model: "gpt-image-1-mini",
  size: "1024x1024",
  quality: "low",
  format: "webp",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOpenAiImageProvider", () => {
  it("wysyła model, jakość i output_format z żądania i zwraca webp", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(Buffer.from("webp-bytes").toString("base64")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiImageProvider({ apiKey: "test-key" });
    const result = await provider.generate(REQUEST);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v1/images/generations");
    expect(init!.headers).toMatchObject({ authorization: "Bearer test-key" });
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "gpt-image-1-mini",
      prompt: REQUEST.prompt,
      size: "1024x1024",
      quality: "low",
      output_format: "webp",
    });
    expect(Array.from(result.bytes)).toEqual(Array.from(Buffer.from("webp-bytes")));
    expect(result.mimeType).toBe("image/webp");
  });

  it("zwraca image/png dla formatu png", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(Buffer.from("png").toString("base64"))));
    const provider = createOpenAiImageProvider({ apiKey: "k" });
    const result = await provider.generate({ ...REQUEST, format: "png" });
    expect(result.mimeType).toBe("image/png");
  });

  it("nie przekazuje body dostawcy w błędzie HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("credit_balance_exhausted", { status: 400 })),
    );
    const provider = createOpenAiImageProvider({ apiKey: "k" });
    const failure = provider.generate(REQUEST);
    await expect(failure).rejects.toThrow(/400/);
    await expect(failure).rejects.not.toThrow(/credit_balance_exhausted/);
  });
});
