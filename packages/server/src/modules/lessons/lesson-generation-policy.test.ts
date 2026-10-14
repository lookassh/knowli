import { describe, expect, it } from "vitest";
import { DEFAULT_LESSON_GENERATION_POLICY, lessonGenerationPolicyFromEnv } from "./lesson-generation-policy";

describe("lessonGenerationPolicyFromEnv", () => {
  it("uses bounded defaults and accepts valid overrides", () => {
    expect(lessonGenerationPolicyFromEnv({})).toEqual({ requestTimeoutMs: 90_000, runTimeoutMs: 600_000, cancelPollMs: 1_000 });
    expect(lessonGenerationPolicyFromEnv({
      UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS: "1000",
      UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS: "2000",
      UMIEM_LESSON_GENERATION_CANCEL_POLL_MS: "100",
    })).toEqual({ requestTimeoutMs: 1_000, runTimeoutMs: 2_000, cancelPollMs: 100 });
    expect(DEFAULT_LESSON_GENERATION_POLICY.requestTimeoutMs).toBe(90_000);
  });

  it.each(["0", "-1", "NaN", "Infinity", "1.5"])("rejects invalid duration %s", (value) => {
    expect(() => lessonGenerationPolicyFromEnv({ UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS: value })).toThrow(/positive integer/);
  });

  it("rejects request timeout greater than whole-run timeout", () => {
    expect(() => lessonGenerationPolicyFromEnv({
      UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS: "2000",
      UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS: "1000",
    })).toThrow(/must not exceed/);
  });
});
