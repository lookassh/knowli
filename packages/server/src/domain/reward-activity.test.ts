import { describe, expect, it } from "vitest";
import { capActivityInterval, MAX_ACTIVITY_GAP_MS, rewardAward, splitRewardIntervalByLocalDay, validRewardTimezone, xboxPacksForDay } from "./reward-activity";

describe("reward activity accounting", () => {
  it("caps a confirmed interval at its accepted signals and idle boundary", () => {
    const started = new Date("2026-10-16T10:00:00.000Z");
    expect(capActivityInterval(started, new Date(started.getTime() + MAX_ACTIVITY_GAP_MS), started.getTime() + 60_000))
      .toEqual({ start: started, end: new Date(started.getTime() + MAX_ACTIVITY_GAP_MS), milliseconds: MAX_ACTIVITY_GAP_MS, pauseReason: null });
  });

  it("does not count offline gaps or client-supplied elapsed time", () => {
    const started = new Date("2026-10-16T10:00:00.000Z");
    expect(capActivityInterval(started, new Date(started.getTime() + 120_000), started.getTime() + 120_000))
      .toEqual({ start: started, end: started, milliseconds: 0, pauseReason: "signal_timeout" });
  });

  it("carries sub-minute work between sessions and assigns the point to the minute closer", () => {
    expect(rewardAward(30_000, 0)).toEqual({ points: 0, remainderMilliseconds: 30_000 });
    expect(rewardAward(30_000, 30_000)).toEqual({ points: 1, remainderMilliseconds: 0 });
    expect(rewardAward(59_000, 0)).toEqual({ points: 0, remainderMilliseconds: 59_000 });
    expect(rewardAward(1_000, 59_000)).toEqual({ points: 1, remainderMilliseconds: 0 });
  });

  it("rejects an unsafe sum and falls back for invalid stored timezones", () => {
    expect(() => rewardAward(Number.MAX_SAFE_INTEGER, 59_999)).toThrow(RangeError);
    expect(validRewardTimezone("Definitely/Not_A_Zone")).toBe("Europe/Warsaw");
    expect(validRewardTimezone("America/New_York")).toBe("America/New_York");
  });

  it("splits exact time at local midnight and preserves elapsed time through DST", () => {
    expect([...splitRewardIntervalByLocalDay(new Date("2026-10-16T21:59:50.000Z"), new Date("2026-10-16T22:00:10.000Z"), "Europe/Warsaw")])
      .toEqual([["2026-10-16", 10_000], ["2026-10-17", 10_000]]);
    const spring = splitRewardIntervalByLocalDay(new Date("2026-03-29T00:59:50.000Z"), new Date("2026-03-29T01:00:10.000Z"), "Europe/Warsaw");
    expect([...spring.values()].reduce((sum, ms) => sum + ms, 0)).toBe(20_000);
    expect([...spring.keys()]).toEqual(["2026-03-29"]);
  });

  it("opens a package at exactly 30 minutes within one local day", () => {
    expect(xboxPacksForDay(1_799_000)).toBe(0);
    expect(xboxPacksForDay(1_800_000)).toBe(1);
    expect(xboxPacksForDay(3_600_000)).toBe(2);
    expect(xboxPacksForDay(1_200_000) + xboxPacksForDay(600_000)).toBe(0);
  });
});
