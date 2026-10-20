import { describe, expect, it } from "vitest";
import { localDateAt, validRewardTimezone } from "./reward-activity";

describe("reward report date helpers", () => {
  it("falls back to the family default timezone for invalid values", () => {
    expect(validRewardTimezone(undefined)).toBe("Europe/Warsaw");
    expect(validRewardTimezone(42)).toBe("Europe/Warsaw");
    expect(validRewardTimezone("Not/AZone")).toBe("Europe/Warsaw");
    expect(validRewardTimezone("Europe/Warsaw")).toBe("Europe/Warsaw");
  });

  it("maps an instant to the local calendar date", () => {
    expect(localDateAt(new Date("2026-10-19T22:30:00Z"), "Europe/Warsaw")).toBe("2026-10-20");
    expect(localDateAt(new Date("2026-10-19T22:30:00Z"), "UTC")).toBe("2026-10-19");
  });
});
