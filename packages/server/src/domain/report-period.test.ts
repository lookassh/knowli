import { describe, expect, it } from "vitest";
import { buildReportPeriod } from "./report-period";

describe("buildReportPeriod", () => {
  it("uses the local calendar date and includes the partial current day", () => {
    expect(buildReportPeriod("2026-10-11T17:00:00Z", "Europe/Warsaw", 3)).toMatchObject({
      from: "2026-10-09",
      to: "2026-10-11",
      days: 3,
      dates: ["2026-10-09", "2026-10-10", "2026-10-11"],
    });
    expect(buildReportPeriod("2026-10-11T22:00:00Z", "Europe/Warsaw", 1).to).toBe(
      "2026-10-12",
    );
  });

  it.each([
    ["2026-03-29T12:00:00Z", "2026-03-29", 23],
    ["2026-10-25T12:00:00Z", "2026-10-25", 25],
  ])("uses the real day length for DST date %s", (now, day, hours) => {
    const period = buildReportPeriod(now, "Europe/Warsaw", 1);
    expect(period.dates).toEqual([day]);
    expect(Date.parse(period.endExclusiveUtc) - Date.parse(period.startUtc)).toBe(
      Number(hours) * 3_600_000,
    );
  });

  it("rejects an invalid instant, timezone, and period length", () => {
    expect(() => buildReportPeriod("invalid", "Europe/Warsaw", 7)).toThrow();
    expect(() => buildReportPeriod("2026-10-11T17:00:00Z", "Mars/Olympus", 7)).toThrow();
    expect(() => buildReportPeriod("2026-10-11T17:00:00Z", "Europe/Warsaw", 0)).toThrow();
  });
});
