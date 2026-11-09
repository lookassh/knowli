import { rejectionOf, type Rejection } from "../../../domain/lessons/agent/admission";
import { materializeRawExercise } from "../../../domain/lessons/raw-materialize";
import { foreignObjectiveIssues, rawShapeIssues } from "../../../domain/lessons/raw-shape";
import type { LessonRuleIssue } from "../../../domain/lessons/rules/catalog";
import type { LessonExerciseDraft, SubjectModule } from "../../../domain/lessons/types";
import { stripParentAddedFlags, toExerciseDraft } from "./lesson-drafts";
import { sanitizeFreshLessonDraft } from "./lesson-pool-acceptance";

/**
 * Parsowanie surowych rekordów ćwiczeń z wyjścia modelu i wpisy odrzuceń przebiegu bazowego.
 */

/** Wpis odrzucenia: `code`, `ruleIds` i `exerciseType` bez treści (logi). */
export interface RejectionLogEntry {
  readonly objectiveId: string;
  readonly exerciseType: string;
  readonly kind: Rejection["kind"];
  readonly code: string;
  readonly ruleIds: readonly string[];
}

export type ParsedRecord =
  | { readonly ok: true; readonly draft: LessonExerciseDraft }
  | { readonly ok: false; readonly exerciseType: string; readonly rejection: Rejection };

function rawExerciseType(raw: unknown): string {
  return exerciseTypeOf(raw) ?? "unknown";
}

/** `exerciseType` surowego rekordu, gdy jest napisem. */
function exerciseTypeOf(raw: unknown): string | null {
  const type = raw !== null && typeof raw === "object" ? (raw as { exerciseType?: unknown }).exerciseType : undefined;
  return typeof type === "string" ? type : null;
}

/** Odrzucenie kształtu: zgłoszenia reguł `shape.*`. */
function shapeRejection(
  exerciseType: string,
  code: "shape_malformed" | "shape_objective",
  issues: readonly LessonRuleIssue[],
): ParsedRecord {
  return { ok: false, exerciseType, rejection: rejectionOf("shape", code, issues) };
}

/**
 * Surowy rekord → szkic (spec katalogu reguł §4.3): materializacja typów liczonych przez kod,
 * kształt rekordu i zagadnienie. Zgłoszenia materializacji i kształtu mają kod `shape_malformed`,
 * obce zagadnienie `shape_objective`.
 */
export function parseLessonRecord(raw: unknown, objectiveId: string, subject: SubjectModule, familyScope: string | null): ParsedRecord {
  const materialized = materializeRawExercise(raw);
  if (!materialized.ok) return shapeRejection(materialized.exerciseType, "shape_malformed", materialized.issues);
  const shapeIssues = rawShapeIssues(materialized.record);
  if (shapeIssues.length > 0) return shapeRejection(rawExerciseType(raw), "shape_malformed", shapeIssues);
  const draft = toExerciseDraft(materialized.record);
  const foreign = foreignObjectiveIssues(draft.objectiveId, objectiveId);
  if (foreign.length > 0) return shapeRejection(draft.exerciseType, "shape_objective", foreign);
  return { ok: true, draft: stripParentAddedFlags([sanitizeFreshLessonDraft(draft, subject, familyScope)])[0]! };
}
