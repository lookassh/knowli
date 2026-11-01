import { describe, expect, it } from "vitest";
import { ChildDtoSchema, ChildInputSchema, ChildPatchSchema, RecordingModeSchema, toChildDto } from "./decks";
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
    expect(ChildDtoSchema.parse({ ...child, recordingMode: "hold", canRead: true, interests: [] }).recordingMode).toBe("hold");
    expect(ChildDtoSchema.safeParse(child).success).toBe(false);
    expect(KidProfileDtoSchema.parse({ childId: child.id, displayName: child.displayName, avatarKey: child.avatarKey, recordingMode: "toggle", canRead: true }).recordingMode).toBe("toggle");
    expect(KidProfileDtoSchema.safeParse({ childId: child.id, displayName: child.displayName, avatarKey: child.avatarKey }).success).toBe(false);
    expect(KidProfileDtoSchema.parse({ childId: child.id, displayName: child.displayName, avatarKey: child.avatarKey, recordingMode: "hold" }).todayActivitySeconds).toBeUndefined();
    expect(KidProfileDtoSchema.safeParse({ childId: child.id, displayName: child.displayName, avatarKey: child.avatarKey, recordingMode: "hold", todayActivitySeconds: -1 }).success).toBe(false);
  });

  it("defaults canRead to true and preserves an explicit false profile setting", () => {
    expect(ChildInputSchema.parse({ displayName: "Ala", avatarKey: "fox" })).toMatchObject({ canRead: true });
    expect(ChildInputSchema.parse({ displayName: "Ala", avatarKey: "fox", canRead: false })).toMatchObject({ canRead: false });
    expect(ChildPatchSchema.safeParse({ canRead: "false" }).success).toBe(false);
    expect(ChildPatchSchema.parse({ canRead: false })).toEqual({ canRead: false });
    expect(toChildDto({ ...child, birthYear: null, recordingMode: "hold", canRead: false, interests: [] }))
      .toMatchObject({ canRead: false });
  });

  it("carries a single general points counter and rejects negative dorobek", () => {
    const profile = KidProfileDtoSchema.parse({ childId: child.id, displayName: "Ala", avatarKey: "fox", recordingMode: "hold" });
    expect(profile.rewardPoints).toBe(0);
    expect(KidProfileDtoSchema.parse({
      childId: child.id, displayName: "Ala", avatarKey: "fox", recordingMode: "hold", rewardPoints: 30,
    }).rewardPoints).toBe(30);
    expect(KidProfileDtoSchema.safeParse({
      childId: child.id, displayName: "Ala", avatarKey: "fox", recordingMode: "hold", rewardPoints: -1,
    }).success).toBe(false);
  });
});

describe("child profile interests", () => {
  it("accepts an interests-only patch, including clearing the list", () => {
    expect(ChildPatchSchema.parse({ interests: [] })).toEqual({ interests: [] });
    expect(ChildPatchSchema.parse({ interests: ["  piłka   nożna ", "Minecraft"] }))
      .toEqual({ interests: ["piłka nożna", "Minecraft"] });
  });

  it.each([
    { interests: ["a", "b", "c", "d", "e", "f"] }, { interests: ["Dino", "dino"] },
    { interests: ["<b>"] }, { interests: "dino" }, { interests: null },
  ])("rejects invalid interests %j", (input) => {
    expect(ChildPatchSchema.safeParse(input).success).toBe(false);
  });

  it("does not normalize stored interests in the DTO and carries them through toChildDto", () => {
    expect(ChildDtoSchema.parse({ ...child, recordingMode: "hold", canRead: true, interests: ["  a  "] }).interests)
      .toEqual(["  a  "]);
    expect(ChildDtoSchema.safeParse({ ...child, recordingMode: "hold", canRead: true }).success).toBe(false);
    expect(toChildDto({ ...child, birthYear: null, recordingMode: "hold", canRead: true, interests: ["Minecraft"] }).interests)
      .toEqual(["Minecraft"]);
  });
});
