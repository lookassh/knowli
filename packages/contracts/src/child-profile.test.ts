import { describe, expect, it } from "vitest";
import { ChildDtoSchema, ChildPatchSchema, RecordingModeSchema } from "./decks";
import { KidProfileDtoSchema } from "./kid";

const child = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Ala",
  avatarKey: "fox",
};

describe("child profile patch", () => {
  it("trims the name and preserves omitted fields", () => {
    expect(ChildPatchSchema.parse({ displayName: "  Krzyś  " })).toEqual({ displayName: "Krzyś" });
    expect(ChildPatchSchema.parse({ avatarKey: "cat" })).toEqual({ avatarKey: "cat" });
    expect(ChildPatchSchema.parse({ displayName: "Ala", avatarKey: "owl" }))
      .toEqual({ displayName: "Ala", avatarKey: "owl" });
  });

  it("accepts a recording-mode-only update", () => {
    expect(ChildPatchSchema.parse({ recordingMode: "toggle" })).toEqual({ recordingMode: "toggle" });
  });

  it.each([
    {}, null, { displayName: "  " }, { avatarKey: "" }, { displayName: 7 },
    { recordingMode: "tap" },
    { displayName: "Ala", birthYear: 2018 }, { displayName: "Ala", id: "x" },
    { displayName: "Ala", policyId: "learning-v2" }, { avatarKey: null },
    { displayName: undefined }, { displayName: "a".repeat(81) }, { avatarKey: "a".repeat(41) },
  ])("rejects invalid or protected input %j", (input) => {
    expect(ChildPatchSchema.safeParse(input).success).toBe(false);
  });

  it("accepts boundary lengths after trimming and existing custom avatars", () => {
    expect(ChildPatchSchema.parse({ displayName: ` ${"a".repeat(80)} ` }).displayName).toHaveLength(80);
    expect(ChildPatchSchema.parse({ avatarKey: "a".repeat(40) }).avatarKey).toHaveLength(40);
    expect(ChildPatchSchema.parse({ avatarKey: "legacy" })).toEqual({ avatarKey: "legacy" });
  });

  it("shares the supported recording modes and requires them in profile DTOs", () => {
    expect(RecordingModeSchema.parse("hold")).toBe("hold");
    expect(RecordingModeSchema.parse("toggle")).toBe("toggle");
    expect(RecordingModeSchema.safeParse("tap").success).toBe(false);
    expect(ChildDtoSchema.parse({ ...child, recordingMode: "hold" }).recordingMode).toBe("hold");
    expect(ChildDtoSchema.safeParse(child).success).toBe(false);
    expect(KidProfileDtoSchema.parse({ childId: child.id, displayName: child.displayName, avatarKey: child.avatarKey, recordingMode: "toggle" }).recordingMode).toBe("toggle");
    expect(KidProfileDtoSchema.safeParse({ childId: child.id, displayName: child.displayName, avatarKey: child.avatarKey }).success).toBe(false);
  });
});
