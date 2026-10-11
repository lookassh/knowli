import { describe, expect, it } from "vitest";
import { normalizeSpokenAnswerText } from "./spoken-answer";

describe("normalizeSpokenAnswerText", () => {
  it("preserves matching semantics while normalizing NFC, whitespace and boundary punctuation", () => {
    expect(normalizeSpokenAnswerText("  “Cafe\u0301!”  ")).toBe("Café");
    expect(normalizeSpokenAnswerText("  (Monday.)  ")).toBe("Monday");
    expect(normalizeSpokenAnswerText("don't")).toBe("don't");
    expect(normalizeSpokenAnswerText("  ")).toBe("");
  });
});
