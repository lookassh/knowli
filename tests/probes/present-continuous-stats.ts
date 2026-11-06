import { isNowUsuallyChoice } from "../../packages/server/src/domain/lessons/subjects/english-grammar/present-continuous-tense-choice";
import { scanTimeMarkers, TIME_MARKER_LISTS } from "../../packages/server/src/domain/lessons/subjects/english-grammar/time-markers";
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

/** Polska scenka: polski wskaźnik czasu w poleceniu (`open_answer`: w prompcie), jak w walidatorze. */
function hasPolishScene(exercise: LessonExerciseDraft): boolean {
  if (exercise.exerciseType === "lesson_open_answer") {
    return exercise.prompt !== undefined && scanTimeMarkers(exercise.prompt, "pl").groups.size > 0;
  }
  return exercise.instructionPl !== undefined && scanTimeMarkers(exercise.instructionPl, "pl", { instruction: true }).groups.size > 0;
}

/** Angielskie wykrzyknienia-scenki z listy „teraz” (Look!, Listen!, Shh!, Be quiet!, Look at …!). */
const EN_EXCLAMATIONS: ReadonlySet<string> = new Set(TIME_MARKER_LISTS.nowEn.filter((entry) => entry.endsWith("!")));

/**
 * Scenka w szerszej mierze (decyzja właściciela z 2026-11-06, spec §11.3): dziecko wnioskuje czas
 * z sytuacji — (a) polska scenka, (b) angielskie wykrzyknienie w bodźcu, zdaniu z błędem albo
 * angielskim prompcie, (c) wybór całych zdań, którego bodziec to zdanie kontekstu bez luki (bez
 * sprawdzenia znaczenia „now / usually”, w którym czas ustala forma czasownika).
 */
function hasScene(exercise: LessonExerciseDraft): boolean {
  if (hasPolishScene(exercise)) return true;
  const english = [exercise.stem, exercise.statement, exercise.exerciseType === "lesson_open_answer" ? undefined : exercise.prompt];
  if (english.some((text) => text !== undefined && scanTimeMarkers(text, "en").nowMarkers.some((entry) => EN_EXCLAMATIONS.has(entry)))) return true;
  return exercise.exerciseType === "lesson_choice" && exercise.stem !== undefined && !/_{2,}/u.test(exercise.stem) && !isNowUsuallyChoice(exercise);
}

/**
 * Statystyki puli PC dla kryteriów sondy (spec §11.3) z zrzutu `UMIEM_PROBE_AGENT_DUMP`:
 * udział scenek (szeroka miara `sceneShare` i dawna polska `sceneSharePolish`) i odrzuceń w celach porównania oraz liczba id reguł odrzuceń według rodzaju odrzucenia.
 */
export function pcPoolStats(
  exercises: readonly LessonExerciseDraft[],
  rejections: readonly PcDumpRejection[],
): {
  readonly sceneShare: number;
  readonly sceneSharePolish: number;
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
  const share = (isScene: (exercise: LessonExerciseDraft) => boolean): number =>
    accepted.length === 0 ? 0 : accepted.filter(isScene).length / accepted.length;
  return {
    sceneShare: share(hasScene),
    sceneSharePolish: share(hasPolishScene),
    comparisonAccepted: accepted.length,
    comparisonRejected,
    rejectionShareComparison: total === 0 ? 0 : comparisonRejected / total,
    ruleIdsByKind,
  };
}
