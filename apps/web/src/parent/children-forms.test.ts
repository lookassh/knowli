import { describe, expect, it } from "vitest";
import { messages, type ChildDto } from "@learning/contracts";
import { childPatch, validateThresholds } from "./children-forms";

const child: ChildDto = {
  id: "3f2c1a9e-5b7d-4c8e-9a1b-2c3d4e5f6a7b",
  displayName: "  Ala  ",
  avatarKey: "fox",
  recordingMode: "hold",
  canRead: true,
};
const unchanged = { displayName: child.displayName, avatarKey: "fox", recordingMode: "hold" as const, canRead: true };

describe("childPatch", () => {
  it("sends nothing when only surrounding spaces differ", () => {
    expect(childPatch(child, unchanged)).toEqual({});
    expect(childPatch(child, { ...unchanged, displayName: "Ala" })).toEqual({});
  });

  it("sends only the changed fields with a trimmed name", () => {
    expect(childPatch(child, { ...unchanged, displayName: " Ola " })).toEqual({ displayName: "Ola" });
    expect(childPatch(child, { ...unchanged, avatarKey: "cat", canRead: false }))
      .toEqual({ avatarKey: "cat", canRead: false });
    expect(childPatch(child, { ...unchanged, recordingMode: "toggle" })).toEqual({ recordingMode: "toggle" });
  });
});

describe("validateThresholds", () => {
  it("accepts integers 0–100 with good above almost", () => {
    expect(validateThresholds({ good: 75, almost: 55 })).toEqual({});
    expect(validateThresholds({ good: 100, almost: 0 })).toEqual({});
  });

  it("rejects empty, fractional and out-of-range values", () => {
    expect(validateThresholds({ good: "", almost: 50 })).toEqual({ good: messages.children.pronunciationThresholdRange });
    expect(validateThresholds({ good: 70, almost: 50.5 })).toEqual({ almost: messages.children.pronunciationThresholdRange });
    expect(validateThresholds({ good: 101, almost: -1 })).toEqual({
      good: messages.children.pronunciationThresholdRange,
      almost: messages.children.pronunciationThresholdRange,
    });
  });

  it("requires good to be strictly above almost, like the API", () => {
    expect(validateThresholds({ good: 50, almost: 50 })).toEqual({ good: messages.children.pronunciationThresholdOrder });
    expect(validateThresholds({ good: 40, almost: 60 })).toEqual({ good: messages.children.pronunciationThresholdOrder });
  });
});
