import { scanTimeMarkers } from "../../packages/server/src/domain/lessons/subjects/english-grammar/time-markers";
import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";

/**
 * Odrzucenie ze zrzutu sondy (podzbiór `RejectionLogEntry`): cel, rodzaj odrzucenia i id reguł jego
 * powodów. Liczymy `ruleIds`, nie `detail`: powód ofiary („adding this exercise would make…: [reguła]”)
 * nie zaczyna się od id reguły, więc parsowanie `detail` go gubiło (krytyk C, Task 19).
 */
export interface PcDumpRejection {
  readonly objectiveId: string;
  readonly kind: string;
  readonly ruleIds: readonly string[];
}

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
 * udział scenek i odrzuceń w celach porównania oraz liczba id reguł odrzuceń według rodzaju odrzucenia.
 */
export function pcPoolStats(
  exercises: readonly LessonExerciseDraft[],
  rejections: readonly PcDumpRejection[],
): {
  readonly sceneShare: number;
  readonly comparisonAccepted: number;
  readonly comparisonRejected: number;
  readonly rejectionShareComparison: number;
  readonly ruleIdsByKind: Readonly<Record<string, Readonly<Record<string, number>>>>;
} {
  const accepted = exercises.filter((exercise) => exercise.exerciseType !== "lesson_card" && isComparison(exercise.objectiveId));
  const comparisonRejected = rejections.filter((rejection) => isComparison(rejection.objectiveId)).length;
  const ruleIdsByKind: Record<string, Record<string, number>> = {};
  for (const { kind, ruleIds } of rejections) {
    const counts = (ruleIdsByKind[kind] ??= {});
    // Odrzucenie bez id reguły liczy się jako `other`, żeby suma zgadzała się z liczbą odrzuceń.
    for (const ruleId of ruleIds.length === 0 ? ["other"] : ruleIds) counts[ruleId] = (counts[ruleId] ?? 0) + 1;
  }
  const total = accepted.length + comparisonRejected;
  return {
    sceneShare: accepted.length === 0 ? 0 : accepted.filter(hasScene).length / accepted.length,
    comparisonAccepted: accepted.length,
    comparisonRejected,
    rejectionShareComparison: total === 0 ? 0 : comparisonRejected / total,
    ruleIdsByKind,
  };
}
