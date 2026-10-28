import { describe, expect, it } from "vitest";
import { chatRequestExtrasFromEnv, withChatRequestExtras } from "./chat-request-options";

describe("chatRequestExtrasFromEnv", () => {
  it("is empty without configuration, so plain OpenAI-compatible requests stay unchanged", () => {
    expect(chatRequestExtrasFromEnv({}, "UMIEM_LLM")).toEqual({});
    expect(chatRequestExtrasFromEnv({ UMIEM_LLM_REASONING: "", UMIEM_LLM_PROVIDER_ORDER: " " }, "UMIEM_LLM")).toEqual({});
    expect(chatRequestExtrasFromEnv({ UMIEM_LLM_REASONING: "default" }, "UMIEM_LLM")).toEqual({});
  });

  it("maps reasoning to OpenRouter's reasoning object", () => {
    expect(chatRequestExtrasFromEnv({ UMIEM_LLM_REASONING: "off" }, "UMIEM_LLM")).toEqual({ reasoning: { enabled: false } });
    expect(chatRequestExtrasFromEnv({ UMIEM_GRADER_REASONING: "Low" }, "UMIEM_GRADER")).toEqual({ reasoning: { effort: "low" } });
    expect(() => chatRequestExtrasFromEnv({ UMIEM_LLM_REASONING: "max" }, "UMIEM_LLM")).toThrow(/UMIEM_LLM_REASONING/);
  });

  it("builds provider routing and always requires the sent parameters", () => {
    expect(chatRequestExtrasFromEnv({
      UMIEM_LLM_PROVIDER_ORDER: "Nebius, DeepInfra",
      UMIEM_LLM_PROVIDER_QUANTIZATIONS: "FP8,bf16",
      UMIEM_LLM_PROVIDER_ALLOW_FALLBACKS: "false",
      UMIEM_LLM_PROVIDER_DATA_COLLECTION: "deny",
    }, "UMIEM_LLM")).toEqual({
      provider: { order: ["Nebius", "DeepInfra"], quantizations: ["fp8", "bf16"], allow_fallbacks: false, data_collection: "deny", require_parameters: true },
    });
  });

  it("reads only its own prefix and rejects malformed values", () => {
    expect(chatRequestExtrasFromEnv({ UMIEM_LLM_PROVIDER_QUANTIZATIONS: "fp8" }, "UMIEM_GRADER")).toEqual({});
    expect(() => chatRequestExtrasFromEnv({ UMIEM_GRADER_PROVIDER_ALLOW_FALLBACKS: "no" }, "UMIEM_GRADER")).toThrow(/ALLOW_FALLBACKS/);
    expect(() => chatRequestExtrasFromEnv({ UMIEM_GRADER_PROVIDER_DATA_COLLECTION: "maybe" }, "UMIEM_GRADER")).toThrow(/DATA_COLLECTION/);
    expect(() => chatRequestExtrasFromEnv({ UMIEM_LLM_PROVIDER_ORDER: "Nebius;rm" }, "UMIEM_LLM")).toThrow(/PROVIDER_ORDER/);
  });
});

describe("withChatRequestExtras", () => {
  it("never lets configuration override the adapter's own fields", () => {
    const body = withChatRequestExtras({ model: "other", reasoning: { enabled: false } }, { model: "deepseek", messages: [] });
    expect(body).toEqual({ reasoning: { enabled: false }, model: "deepseek", messages: [] });
    expect(withChatRequestExtras(undefined, { model: "m" })).toEqual({ model: "m" });
  });
});
