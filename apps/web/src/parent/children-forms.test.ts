import { describe, expect, it } from "vitest";
import { messages, type ChildDto } from "@learning/contracts";
import { childPatch, interestsError, parseInterestsInput, validateThresholds } from "./children-forms";

const child: ChildDto = {
  id: "3f2c1a9e-5b7d-4c8e-9a1b-2c3d4e5f6a7b",
  displayName: "  Ala  ",
  avatarKey: "fox",
  recordingMode: "hold",
  canRead: true,
  interests: [],
};
const unchanged = { displayName: child.displayName, avatarKey: "fox", recordingMode: "hold" as const, canRead: true, interests: [] as string[] };

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

describe("childPatch interests", () => {
  const withInterests: ChildDto = { ...child, interests: ["piłka nożna", "Minecraft"] };
  const same = { ...unchanged, interests: ["piłka nożna", "Minecraft"] };

  it("omits interests when the list is the same", () => {
    expect(childPatch(withInterests, same)).toEqual({});
  });

  it("sends interests when the order changes", () => {
    expect(childPatch(withInterests, { ...same, interests: ["Minecraft", "piłka nożna"] }))
      .toEqual({ interests: ["Minecraft", "piłka nożna"] });
  });

  it("sends added, replaced and cleared lists", () => {
    expect(childPatch(child, { ...unchanged, interests: ["lego"] })).toEqual({ interests: ["lego"] });
    expect(childPatch(withInterests, { ...same, interests: ["piłka nożna", "lego"] })).toEqual({ interests: ["piłka nożna", "lego"] });
    expect(childPatch(withInterests, { ...same, interests: [] })).toEqual({ interests: [] });
  });
});

describe("parseInterestsInput", () => {
  it("normalizes entries and drops empty ones and duplicates after normalization", () => {
    expect(parseInterestsInput(["  piłka   nożna ", "Minecraft", "   ", "PIŁKA NOŻNA", "minecraft"]))
      .toEqual(["piłka nożna", "Minecraft"]);
  });

  it("keeps invalid entries so the form can show an error", () => {
    expect(parseInterestsInput(["lego", "<b>"])).toEqual(["lego", "<b>"]);
  });
});

describe("interestsError", () => {
  it("returns null for a valid list", () => {
    expect(interestsError([])).toBeNull();
    expect(interestsError(["piłka nożna", "Minecraft"])).toBeNull();
  });

  it("flags characters outside the allowed set and entries that are too long", () => {
    const invalid = messages.children.interestsInvalid.replace("{max}", "40");
    expect(interestsError(["lego", "<b>"])).toBe(invalid);
    expect(interestsError(["a".repeat(41)])).toBe(invalid);
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
