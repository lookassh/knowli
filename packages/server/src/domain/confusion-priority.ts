import type { ExerciseType, ReadingDirection } from "./types";

const RECOGNITION_TYPES = new Set<ExerciseType>(["listening", "reading", "reverse_recognition", "picture_recognition"]);
const WINDOW_SIZE = 20;

export interface ConfusionObservation {
  attemptId: string;
  receivedAt: string;
  childId: string;
  expectedItemRevisionId: string;
  answeredItemRevisionId: string | null;
  exerciseType: ExerciseType;
  direction?: ReadingDirection;
  reliable: boolean;
}

export interface ConfusionPair {
  expectedItemRevisionId: string;
  answeredItemRevisionId: string;
  exerciseType: ExerciseType;
  direction?: ReadingDirection;
  count: number;
}

export function rankConfusions(observations: readonly ConfusionObservation[]): readonly ConfusionPair[] {
  const byAttempt = new Map<string, ConfusionObservation>();
  for (const observation of observations) {
    if (!RECOGNITION_TYPES.has(observation.exerciseType) || !observation.reliable) continue;
    const current = byAttempt.get(observation.attemptId);
    if (!current || observation.receivedAt > current.receivedAt) byAttempt.set(observation.attemptId, observation);
  }
  const recent = [...byAttempt.values()]
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.attemptId.localeCompare(a.attemptId))
    .slice(0, WINDOW_SIZE);
  const pairs = new Map<string, ConfusionPair & { firstSeen: number }>();
  recent.forEach((observation, index) => {
    const answered = observation.answeredItemRevisionId;
    if (!answered || answered === observation.expectedItemRevisionId) return;
    const key = [observation.childId, observation.expectedItemRevisionId, answered, observation.exerciseType, observation.direction ?? ""].join("\u0000");
    const existing = pairs.get(key);
    if (existing) existing.count += 1;
    else pairs.set(key, {
      expectedItemRevisionId: observation.expectedItemRevisionId,
      answeredItemRevisionId: answered,
      exerciseType: observation.exerciseType,
      ...(observation.direction === undefined ? {} : { direction: observation.direction }),
      count: 1,
      firstSeen: index,
    });
  });
  return [...pairs.values()]
    .filter((pair) => pair.count >= 2)
    .sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen)
    .map(({ firstSeen: _firstSeen, ...pair }) => pair);
}
