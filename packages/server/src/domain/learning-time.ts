import { LearningTimeDtoSchema, type LearningTimeDto } from "@learning/contracts";
import type { ReportPeriod } from "./report-period";
import { localDateBounds } from "./report-period";

type ActivityPoint = { sessionId: string; at: string };
type Interval = { start: number; end: number };

export function estimateLearningTime(input: {
  points: readonly ActivityPoint[];
  period: ReportPeriod;
  timezone: string;
  now: string;
  daysWithActivity: ReadonlySet<string>;
}): { byDate: ReadonlyMap<string, LearningTimeDto>; total: LearningTimeDto } {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new RangeError("Invalid learning time cutoff");
  const periodStart = Date.parse(input.period.startUtc);
  const periodEnd = Math.min(Date.parse(input.period.endExclusiveUtc), now);
  const pointsBySession = new Map<string, number[]>();

  for (const point of input.points) {
    const at = Date.parse(point.at);
    if (!point.sessionId || !Number.isFinite(at) || at > now) continue;
    const sessionPoints = pointsBySession.get(point.sessionId) ?? [];
    sessionPoints.push(at);
    pointsBySession.set(point.sessionId, sessionPoints);
  }

  const intervals: Interval[] = [];
  for (const sessionPoints of pointsBySession.values()) {
    const sorted = [...new Set(sessionPoints)].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      if (current <= previous || current - previous > 120_000) continue;
      const start = Math.max(previous, periodStart);
      const end = Math.min(current, periodEnd);
      if (end > start) intervals.push({ start, end });
    }
  }

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const union: Interval[] = [];
  for (const interval of intervals) {
    const last = union.at(-1);
    if (!last || interval.start > last.end) union.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }

  const byDate = new Map<string, LearningTimeDto>();
  for (const day of input.period.dates) {
    const bounds = localDateBounds(day, input.timezone);
    const startOfDay = Math.max(Date.parse(bounds.startUtc), periodStart);
    const endOfDay = Math.min(Date.parse(bounds.endExclusiveUtc), periodEnd);
    const activeMs = union.reduce((total, interval) => {
      const overlap = Math.max(0, Math.min(interval.end, endOfDay) - Math.max(interval.start, startOfDay));
      return total + overlap;
    }, 0);
    const seconds = input.daysWithActivity.has(day) && activeMs === 0
      ? null
      : Math.floor(activeMs / 1000);
    byDate.set(day, LearningTimeDtoSchema.parse({ seconds, estimated: true }));
  }

  const values = [...byDate.values()];
  const totalSeconds = values.some(({ seconds }) => seconds === null)
    ? null
    : values.reduce((sum, { seconds }) => sum + (seconds ?? 0), 0);
  return {
    byDate,
    total: LearningTimeDtoSchema.parse({ seconds: totalSeconds, estimated: true }),
  };
}
