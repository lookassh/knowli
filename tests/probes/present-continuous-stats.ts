import { scanTimeMarkers } from "../../packages/server/src/domain/lessons/subjects/english-grammar/time-markers";
import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";

/** Odrzucenie ze zrzutu sondy (podzbiór `RejectionLogEntry`): cel i komunikaty walidatora w jednym `detail`. */
export interface PcDumpRejection {
  readonly objectiveId: string;
  readonly detail: string;
}

/** Prefiksy komunikatów walidatora Present Continuous (spec §8); pozostałe komunikaty to `other`. */
const PC_PREFIXES = ["pc-marker:", "pc-ing:", "pc-be:", "pc-state:", "pc-error-fix:", "pc-notice:", "pc-shape:"] as const;

/** Cele porównania czasów (2 i 6): tu spec §11.3 mierzy odrzucenia i scenki. */
const COMPARISON_SUFFIXES = [".now_or_usually", ".now_or_usually_more"] as const;

const isComparison = (objectiveId: string): boolean => COMPARISON_SUFFIXES.some((suffix) => objectiveId.endsWith(suffix));

/** Scenka to polski wskaźnik czasu w poleceniu (`open_answer`: w prompcie), jak w walidatorze. */
function hasScene(exercise: LessonExerciseDraft): boolean {
  if (exercise.exerciseType === "lesson_open_answer") {
    return exercise.prompt !== undefined && scanTimeMarkers(exercise.prompt, "pl").groups.size > 0;
  }
  return exercise.instructionPl !== undefined && scanTimeMarkers(exercise.instructionPl, "pl", { instruction: true }).groups.size > 0;
}

/**
 * Statystyki puli PC dla kryteriów sondy (spec §11.3) z zrzutu `UMIEM_PROBE_AGENT_DUMP`:
 * udział scenek i odrzuceń w celach porównania oraz liczba komunikatów walidatora po prefiksach.
 */
export function pcPoolStats(
  exercises: readonly LessonExerciseDraft[],
  rejections: readonly PcDumpRejection[],
): {
  readonly sceneShare: number;
  readonly comparisonAccepted: number;
  readonly comparisonRejected: number;
  readonly rejectionShareComparison: number;
  readonly messagesByPrefix: Readonly<Record<string, number>>;
} {
  const accepted = exercises.filter((exercise) => exercise.exerciseType !== "lesson_card" && isComparison(exercise.objectiveId));
  const comparisonRejected = rejections.filter((rejection) => isComparison(rejection.objectiveId)).length;
  const messagesByPrefix: Record<string, number> = {};
  for (const rejection of rejections) {
    for (const message of rejection.detail.split("; ")) {
      if (message.trim() === "") continue;
      const key = PC_PREFIXES.find((prefix) => message.startsWith(prefix)) ?? "other";
      messagesByPrefix[key] = (messagesByPrefix[key] ?? 0) + 1;
    }
  }
  const total = accepted.length + comparisonRejected;
  return {
    sceneShare: accepted.length === 0 ? 0 : accepted.filter(hasScene).length / accepted.length,
    comparisonAccepted: accepted.length,
    comparisonRejected,
    rejectionShareComparison: total === 0 ? 0 : comparisonRejected / total,
    messagesByPrefix,
  };
}
