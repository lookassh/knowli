import { describe, expect, it } from "vitest";
import { ApiCallError } from "./api";
import {
  isDefinitiveGenerationRejection,
  readGenerationAcceptance,
} from "./generation-request";

describe("readGenerationAcceptance", () => {
  it("accepts a response with valid run and deck UUIDs", () => {
    expect(readGenerationAcceptance({
      generationRunId: "00000000-0000-4000-8000-000000000001",
      deckId: "00000000-0000-4000-8000-000000000002",
    })).toEqual({
      generationRunId: "00000000-0000-4000-8000-000000000001",
      deckId: "00000000-0000-4000-8000-000000000002",
    });
  });

  it.each([
    null,
    {},
    { generationRunId: "bad", deckId: "00000000-0000-4000-8000-000000000002" },
    { generationRunId: "00000000-0000-4000-8000-000000000001" },
  ])("treats malformed acceptance %j as uncertain", (value) => {
    expect(readGenerationAcceptance(value)).toBeNull();
  });
});

describe("isDefinitiveGenerationRejection", () => {
  it("clears requests rejected by validation or authorization", () => {
    expect(isDefinitiveGenerationRejection(new ApiCallError("bad input", "validation", 400))).toBe(true);
    expect(isDefinitiveGenerationRejection(new ApiCallError("login", "unauthorized", 401))).toBe(true);
    expect(isDefinitiveGenerationRejection(new ApiCallError("denied", "forbidden", 403))).toBe(true);
  });

  it("keeps transport, malformed response and server errors retryable", () => {
    expect(isDefinitiveGenerationRejection(new TypeError("offline"))).toBe(false);
    expect(isDefinitiveGenerationRejection(new SyntaxError("invalid JSON"))).toBe(false);
    expect(isDefinitiveGenerationRejection(new ApiCallError("server error", "internal", 500))).toBe(false);
    expect(isDefinitiveGenerationRejection(new ApiCallError("bad request", "other", 400))).toBe(false);
  });
});
