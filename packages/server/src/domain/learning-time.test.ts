import { describe, expect, it } from "vitest";
import { buildReportPeriod } from "./report-period";
import { estimateLearningTime } from "./learning-time";

const time = (input: {
  points: { sessionId: string; at: string }[];
  now?: string;
  days?: number;
  activity?: string[];
}) => {
  const now = input.now ?? "2026-10-11T17:00:00.000Z";
  const period = buildReportPeriod(now, "Europe/Warsaw", input.days ?? 3);
  return estimateLearningTime({
    points: input.points,
    period,
    timezone: "Europe/Warsaw",
    now,
    daysWithActivity: new Set(input.activity ?? []),
  });
};

describe("estimateLearningTime", () => {
  it("counts only adjacent same-session activity gaps up to 120 seconds", () => {
    const result = time({
      points: [
        { sessionId: "s1", at: "2026-10-11T12:00:00Z" },
        { sessionId: "s1", at: "2026-10-11T12:01:00Z" },
        { sessionId: "s1", at: "2026-10-11T12:03:00Z" },
        { sessionId: "s1", at: "2026-10-11T12:10:00Z" },
      ],
    });
    expect(result.byDate.get("2026-10-11")).toEqual({ seconds: 180, estimated: true });
  });

  it("includes an exact 120-second gap, excludes longer gaps, and unions duplicates and overlaps", () => {
    const result = time({
      points: [
        { sessionId: "one", at: "2026-10-11T12:00:00Z" },
        { sessionId: "one", at: "2026-10-11T12:02:00Z" },
        { sessionId: "one", at: "2026-10-11T12:04:00.001Z" },
        { sessionId: "two", at: "2026-10-11T12:01:00Z" },
        { sessionId: "two", at: "2026-10-11T12:03:00Z" },
        { sessionId: "two", at: "2026-10-11T12:03:00Z" },
      ],
    });
    expect(result.byDate.get("2026-10-11")).toEqual({ seconds: 180, estimated: true });
  });

  it("distinguishes no activity from activity without a measurable interval", () => {
    const noActivity = time({ points: [] });
    expect(noActivity.byDate.get("2026-10-11")).toEqual({ seconds: 0, estimated: true });

    const tooFewPoints = time({
      points: [{ sessionId: "s1", at: "2026-10-11T12:00:00Z" }],
      activity: ["2026-10-11"],
    });
    expect(tooFewPoints.byDate.get("2026-10-11")).toEqual({ seconds: null, estimated: true });
    expect(tooFewPoints.total).toEqual({ seconds: null, estimated: true });
  });

  it("splits intervals at local midnight and clips them to the report and generated time", () => {
    const split = time({
      days: 2,
      now: "2026-10-10T22:00:30Z",
      points: [
        { sessionId: "s1", at: "2026-10-10T21:59:30Z" },
        { sessionId: "s1", at: "2026-10-10T22:00:30Z" },
      ],
    });
    expect(split.byDate.get("2026-10-10")).toEqual({ seconds: 30, estimated: true });
    expect(split.byDate.get("2026-10-11")).toEqual({ seconds: 30, estimated: true });
  });

  it.each([
    ["2026-03-29T00:59:00Z", "2026-03-29T01:01:00Z"],
    ["2026-10-25T00:59:00Z", "2026-10-25T01:01:00Z"],
  ])("uses elapsed instants across daylight-saving transition %s", (from, to) => {
    const result = time({
      days: 1,
      now: to,
      points: [
        { sessionId: "s1", at: from },
        { sessionId: "s1", at: to },
      ],
    });
    const day = buildReportPeriod(to, "Europe/Warsaw", 1).to;
    expect(result.byDate.get(day)).toEqual({ seconds: 120, estimated: true });
  });
});
