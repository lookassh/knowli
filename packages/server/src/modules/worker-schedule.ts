export const WORK_KINDS = ["deck", "lesson", "tts", "illustration"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface WorkerCandidate<T> {
  kind: WorkKind;
  value: T;
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
