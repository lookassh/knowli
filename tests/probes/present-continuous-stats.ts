import { scanTimeMarkers } from "../../packages/server/src/domain/lessons/subjects/english-grammar/time-markers";
import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";

/** Odrzucenie ze zrzutu sondy (podzbiór `RejectionLogEntry`): cel i powody `[id reguły] pole: found` w jednym `detail` (rozdzielone „; ”). */
export interface PcDumpRejection {
  readonly objectiveId: string;
  readonly detail: string;
}

/** Powód z id reguły na początku (`formatRuleReason`); powody bez id liczą się jako `other`. */
const REASON_RULE = /^\[([a-z0-9_]+(?:\.[a-z0-9_]+)+)\]/;

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
 * udział scenek i odrzuceń w celach porównania oraz liczba powodów odrzuceń po id reguły.
 */
export function pcPoolStats(
  exercises: readonly LessonExerciseDraft[],
  rejections: readonly PcDumpRejection[],
): {
  readonly sceneShare: number;
  readonly comparisonAccepted: number;
  readonly comparisonRejected: number;
  readonly rejectionShareComparison: number;
  readonly messagesByRule: Readonly<Record<string, number>>;
} {
  const accepted = exercises.filter((exercise) => exercise.exerciseType !== "lesson_card" && isComparison(exercise.objectiveId));
  const comparisonRejected = rejections.filter((rejection) => isComparison(rejection.objectiveId)).length;
  const messagesByRule: Record<string, number> = {};
  for (const rejection of rejections) {
    // Dzielimy tylko przed „[”, bo `found` może zawierać „; ”.
    for (const reason of rejection.detail.split(/; (?=\[)/)) {
      if (reason.trim() === "") continue;
      const key = REASON_RULE.exec(reason)?.[1] ?? "other";
      messagesByRule[key] = (messagesByRule[key] ?? 0) + 1;
    }
  }
  const total = accepted.length + comparisonRejected;
  return {
    sceneShare: accepted.length === 0 ? 0 : accepted.filter(hasScene).length / accepted.length,
    comparisonAccepted: accepted.length,
    comparisonRejected,
    rejectionShareComparison: total === 0 ? 0 : comparisonRejected / total,
    messagesByRule,
  };
}
