import type { LessonExerciseDraft, SubjectModule } from "../types";
import type { LessonRuleIssue } from "../rules/catalog";
import { historyLikeSubject } from "./history-like-subject";
import { testIssue } from "./test-issue";

/**
 * Przedmiot testowy przyjmowania i walidacji puli (poza skanem domeny, bo importuje przedmioty):
 * `historyLikeSubject` z dodanymi typami `lesson_keywords` i `lesson_listen_choice`
 * oraz hakiem przedmiotu `validatePoolExtra` z deterministycznym wyzwalaczem.
 */

/** Rodzina żyje w obrębie zagadnienia (jak `validateSchoolPool` i `withoutOrphanKeywords`). */
function validatePoolExtra(drafts: readonly LessonExerciseDraft[]): ReadonlyMap<number, readonly LessonRuleIssue[]> {
  const errors = new Map<number, readonly LessonRuleIssue[]>();
  const familyKey = (draft: LessonExerciseDraft) => JSON.stringify([draft.objectiveId, draft.familyId]);
  const openFamilies = new Set(
    drafts.flatMap((draft) => (draft.exerciseType === "lesson_open_answer" && draft.familyId ? [familyKey(draft)] : [])),
  );
  drafts.forEach((draft, index) => {
    if (draft.exerciseType !== "lesson_keywords") return;
    if (!draft.familyId || !openFamilies.has(familyKey(draft))) errors.set(index, [testIssue("keywords without open-answer family")]);
  });
  return errors;
}

export const agentTestSubject: SubjectModule = {
  ...historyLikeSubject,
  exerciseTypes: [...historyLikeSubject.exerciseTypes, "lesson_keywords", "lesson_listen_choice"],
  validatePoolExtra,
};
