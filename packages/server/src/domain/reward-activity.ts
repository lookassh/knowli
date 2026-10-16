import { localDateBounds } from "./report-period";

export const REWARD_ACTIVITY_POLICY_VERSION = "1";
export const REWARD_ACTIVITY_SIGNAL_INTERVAL_MS = 15_000;
export const MAX_ACTIVITY_GAP_MS = 30_000;
export const REWARD_ACTIVITY_IDLE_MS = 60_000;

export type RewardPauseReason = "idle" | "signal_timeout";
export interface CappedActivityInterval {
  start: Date;
  end: Date;
  milliseconds: number;
  pauseReason: RewardPauseReason | null;
}

/** Klient nie przekazuje czasu: ograniczamy odcinek między znacznikami serwera. */
export function capActivityInterval(start: Date, confirmedAt: Date, idleAt: number): CappedActivityInterval {
  const startMs = start.getTime();
  const confirmedMs = confirmedAt.getTime();
  const idleEnded = idleAt <= confirmedMs;
  const gapExpired = confirmedMs - startMs > MAX_ACTIVITY_GAP_MS;
  const endMs = gapExpired ? startMs : Math.min(confirmedMs, idleAt);
  const end = new Date(Math.max(startMs, endMs));
  return {
    start,
    end,
    milliseconds: end.getTime() - startMs,
    pauseReason: gapExpired ? "signal_timeout" : idleEnded ? "idle" : null,
  };
}

export function eligibleActivityMilliseconds(start: Date, confirmedAt: Date, lastInteraction: Date, playback: boolean): CappedActivityInterval {
  const cutoff = lastInteraction.getTime() + REWARD_ACTIVITY_IDLE_MS;
  const interval = capActivityInterval(start, confirmedAt, cutoff);
  if (playback) return interval;
  return interval;
}

/** Rozliczanie jest sumą unikalnych przedziałów; nigdy nie zaokrąglaj per sesja. */
export function creditedSeconds(intervals: readonly { start: Date; end: Date }[]): number {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  let total = 0;
  let lastEnd = -Infinity;
  for (const interval of sorted) {
    const from = Math.max(interval.start.getTime(), lastEnd);
    const to = Math.max(from, interval.end.getTime());
    total += to - from;
    lastEnd = Math.max(lastEnd, to);
  }
  return Math.floor(total / 1000);
}
export const REWARD_POINT_INTERVAL_MS = 60_000;
export const DAILY_REWARD_GOAL_MS = 1_800_000;

export function xboxPacksForDay(creditedMilliseconds: number): number {
  if (!Number.isSafeInteger(creditedMilliseconds) || creditedMilliseconds < 0) throw new RangeError("Invalid daily reward duration");
  return Math.floor(creditedMilliseconds / DAILY_REWARD_GOAL_MS);
}

export function rewardAward(totalMilliseconds: number, carriedRemainderMilliseconds: number): { points: number; remainderMilliseconds: number } {
  if (!Number.isSafeInteger(totalMilliseconds) || totalMilliseconds < 0 || !Number.isSafeInteger(carriedRemainderMilliseconds) || carriedRemainderMilliseconds < 0 || carriedRemainderMilliseconds >= REWARD_POINT_INTERVAL_MS) {
    throw new RangeError("Invalid reward activity duration");
  }
  const total = totalMilliseconds + carriedRemainderMilliseconds;
  if (!Number.isSafeInteger(total)) throw new RangeError("Invalid reward activity duration");
  return { points: Math.floor(total / REWARD_POINT_INTERVAL_MS), remainderMilliseconds: total % REWARD_POINT_INTERVAL_MS };
}

export function validRewardTimezone(value: unknown): string {
  if (typeof value !== "string") return "Europe/Warsaw";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "Europe/Warsaw";
  }
}

export function localDateAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Splits one server-recorded interval at local midnight, including 23/25-hour DST days. */
export function splitRewardIntervalByLocalDay(start: Date, end: Date, timezone: string): Map<string, number> {
  if (end.getTime() < start.getTime()) throw new RangeError("Invalid reward activity interval");
  const result = new Map<string, number>();
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const day = localDateAt(new Date(cursor), timezone);
    const bounds = localDateBounds(day, timezone);
    const next = Math.min(endMs, Date.parse(bounds.endExclusiveUtc));
    if (next <= cursor) throw new RangeError("Could not split reward interval by local day");
    result.set(day, (result.get(day) ?? 0) + next - cursor);
    cursor = next;
  }
  return result;
}
