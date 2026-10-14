export const WORK_KINDS = ["deck", "lesson", "tts", "illustration"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface WorkerCandidate<T> {
  kind: WorkKind;
  value: T;
}

export interface IdentifiedWorkerCandidate<T> extends WorkerCandidate<T> {
  key: string;
}

/** Un tentativo già completato non deve bloccare il retry del medesimo run. */
export function workerAttemptKey(id: string, attempts: number): string {
  return `${id}:${attempts}`;
}

export function workerIdFromAttemptKey(key: string): string {
  return key.slice(0, key.lastIndexOf(":"));
}

export function workerAttemptFromKey(key: string): number {
  return Number(key.slice(key.lastIndexOf(":") + 1));
}

/** Drain due work up to a concurrency limit, refilling a slot after each completion. */
export async function runWorkerSlots<T>(options: {
  concurrency: number;
  refillPollMs?: number;
  loadNext: (
    active: readonly IdentifiedWorkerCandidate<T>[],
    seenKeys: ReadonlySet<string>,
  ) => Promise<IdentifiedWorkerCandidate<T> | undefined>;
  execute: (candidate: IdentifiedWorkerCandidate<T>) => Promise<void>;
  onError?: (error: unknown) => void;
  onProgress?: () => void;
}): Promise<number> {
  const active = new Map<string, { candidate: IdentifiedWorkerCandidate<T>; settled: Promise<{ key: string }> }>();
  const seenKeys = new Set<string>();
  let processed = 0;
  while (true) {
    while (active.size < options.concurrency) {
      const candidate = await options.loadNext([...active.values()].map(({ candidate: item }) => item), seenKeys);
      if (!candidate || active.has(candidate.key) || seenKeys.has(candidate.key)) break;
      seenKeys.add(candidate.key);
      const settled = Promise.resolve()
        .then(() => options.execute(candidate))
        .catch((error: unknown) => { options.onError?.(error); })
        .then(() => ({ key: candidate.key }));
      active.set(candidate.key, { candidate, settled });
    }
    if (active.size === 0) break;
    if (active.size < options.concurrency) {
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        pollTimer = setTimeout(() => resolve(null), options.refillPollMs ?? 1_000);
      });
      const completion = Promise.race([...active.values()].map(({ settled }) => settled));
      const result = await Promise.race([completion, timeout]);
      if (pollTimer) clearTimeout(pollTimer);
      if (result === null) {
        // Re-read external state after a poll interval. A parent can reset a
        // queued run's attempt counter during this pass, restoring the same
        // (id, attempts) key; it must become eligible while another task is held.
        seenKeys.clear();
        continue;
      }
      active.delete(result.key);
    } else {
      const { key } = await Promise.race([...active.values()].map(({ settled }) => settled));
      active.delete(key);
    }
    processed += 1;
    options.onProgress?.();
  }
  return processed;
}

export function selectFairWorkerWork<T>(
  queues: Record<WorkKind, T[]>,
  limits: Record<WorkKind, number>,
  total: number,
  initialCursor: number,
): { work: WorkerCandidate<T>[]; nextCursor: number } {
  const work: WorkerCandidate<T>[] = [];
  const counts: Record<WorkKind, number> = { deck: 0, lesson: 0, tts: 0, illustration: 0 };
  let cursor = ((initialCursor % WORK_KINDS.length) + WORK_KINDS.length) % WORK_KINDS.length;
  while (work.length < total) {
    let selected = false;
    for (let checked = 0; checked < WORK_KINDS.length; checked += 1) {
      const kind = WORK_KINDS[cursor]!;
      cursor = (cursor + 1) % WORK_KINDS.length;
      if (counts[kind] >= limits[kind] || queues[kind].length === 0) continue;
      work.push({ kind, value: queues[kind].shift()! });
      counts[kind] += 1;
      selected = true;
      break;
    }
    if (!selected) break;
  }
  return { work, nextCursor: cursor };
}
