import { describe, expect, it } from "vitest";
import { ChildPatchSchema } from "./decks";

describe("child profile patch", () => {
  it("trims the name and preserves omitted fields", () => {
    expect(ChildPatchSchema.parse({ displayName: "  Krzyś  " })).toEqual({ displayName: "Krzyś" });
    expect(ChildPatchSchema.parse({ avatarKey: "cat" })).toEqual({ avatarKey: "cat" });
    expect(ChildPatchSchema.parse({ displayName: "Ala", avatarKey: "owl" }))
      .toEqual({ displayName: "Ala", avatarKey: "owl" });
  });

  it.each([
    {}, null, { displayName: "  " }, { avatarKey: "" }, { displayName: 7 },
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
});
