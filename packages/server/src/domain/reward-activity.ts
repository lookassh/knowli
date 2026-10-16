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
