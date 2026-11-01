import { describe, expect, it } from "vitest";
import { endpointKeyFromEnv, isSecureOpenRouterEndpoint } from "./openrouter-key";

const OR = "https://openrouter.ai/api/v1";
const SHARED = { OPENROUTER_API_KEY: "sk-or-v1-shared" };

describe("endpointKeyFromEnv — wspólny OPENROUTER_API_KEY", () => {
  it("trafia tylko na https OpenRouter, także regionalny i pisany wielkimi literami", () => {
    for (const url of [OR, "https://eu.openrouter.ai/api/v1", "https://us.openrouter.ai/api/v1", "https://OpenRouter.AI/api/v1"]) {
      expect(endpointKeyFromEnv(SHARED, "UMIEM_TTS", url, { allowShared: true }), url).toBe("sk-or-v1-shared");
    }
  });

  it("nigdy nie trafia na inny host, po http ani z userinfo w URL", () => {
    for (const url of [
      undefined,
      "https://api.openai.com/v1",
      "http://openrouter.ai/api/v1",
      "https://openrouter.ai.evil.example/v1",
      "https://openrouter.ai@evil.example/v1",
      "https://user:pass@openrouter.ai/api/v1",
      "nie-url",
    ]) {
      expect(endpointKeyFromEnv(SHARED, "UMIEM_LLM", url, { allowShared: true }), String(url)).toBeUndefined();
      expect(isSecureOpenRouterEndpoint(url), String(url)).toBe(false);
    }
  });

  it("własny klucz ma pierwszeństwo; bez zgody wspólny nie jest używany", () => {
    expect(endpointKeyFromEnv({ ...SHARED, UMIEM_LLM_API_KEY: "sk-or-v1-own" }, "UMIEM_LLM", OR, { allowShared: true })).toBe("sk-or-v1-own");
    expect(endpointKeyFromEnv(SHARED, "UMIEM_GRADER", OR, { allowShared: false })).toBeUndefined();
    expect(endpointKeyFromEnv({ ...SHARED, OPENROUTER_API_KEY: " " }, "UMIEM_TTS", OR, { allowShared: true })).toBeUndefined();
  });

  it("klucz w kształcie OpenAI skierowany na OpenRouter to błąd bez wartości klucza", () => {
    const own = () => endpointKeyFromEnv({ UMIEM_TTS_API_KEY: "sk-proj-secret" }, "UMIEM_TTS", OR, { allowShared: true });
    expect(own).toThrow("UMIEM_TTS_API_KEY looks like an OpenAI key");
    expect(own).not.toThrow(/sk-proj-secret/);
    expect(() => endpointKeyFromEnv({ OPENROUTER_API_KEY: "sk-proj-secret" }, "UMIEM_LLM", OR, { allowShared: true }))
      .toThrow("OPENROUTER_API_KEY looks like an OpenAI key");
    // ten sam klucz na api.openai.com jest poprawny
    expect(endpointKeyFromEnv({ UMIEM_TTS_API_KEY: "sk-proj-secret" }, "UMIEM_TTS", "https://api.openai.com/v1", { allowShared: true })).toBe("sk-proj-secret");
  });
});
