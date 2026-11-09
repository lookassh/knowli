import type { LessonRuleIssue } from "../../rules/catalog";
import type { LessonExerciseDraft, LessonExerciseType, SubjectModule } from "../../types";
import { snapQuote } from "./quote-normalize";
import { schoolIssue } from "./rules";

/**
 * Pola generowania puli przedmiotu `school` (spec katalogu reguł §5.1–5.2, etap 5b; `module.ts` składa
 * je w module): materiał lekcji w kontroli zamkniętych i oczyszczenie świeżego wyjścia modelu — usunięcie
 * każdej podpowiedzi (szkoła jej nie generuje) i cytaty wyrównane do dokładnego fragmentu materiału.
 * Tylko reguły domenowe nad przekazanymi danymi.
 */

/** Nota reguły `school.hint_open_answer_only`: podpowiedź z wyjścia modelu usunięta (szkoła jej nie generuje). */
function hintRemovedNote(exerciseType: LessonExerciseType): LessonRuleIssue {
  return schoolIssue("school.hint_open_answer_only", {
    pl: "hint: szkoła nie generuje podpowiedzi — podpowiedź została usunięta",
    found: `removed: ${exerciseType} takes no hint in school`,
  });
}

/**
 * Cytaty modelu (bez `parentAdded`) zastąpione dokładnym fragmentem materiału,
 * do którego pasują po normalizacji (`snapQuote`); wycinek, który sam nie
 * przeszedłby walidacji, zostawia cytat modelu. Bez zmian — ten sam obiekt.
 */
function snappedQuotes(draft: LessonExerciseDraft, material: string): LessonExerciseDraft {
  const refs = draft.sourceRefs;
  if (refs === undefined) return draft;
  let count = 0;
  const next = refs.map((ref) => {
    if (ref.parentAdded === true) return ref;
    const snapped = snapQuote(ref.quote, material);
    if (snapped === null || snapped === ref.quote) return ref;
    count += 1;
    return { ...ref, quote: snapped };
  });
  return count === 0 ? draft : { ...draft, sourceRefs: next };
}

export const schoolAgentPolicy: Pick<SubjectModule, "checkerNeedsMaterial" | "sanitize"> = {
  checkerNeedsMaterial: true,
  sanitize(draft: LessonExerciseDraft, ctx) {
    const notes: LessonRuleIssue[] = [];
    let current = draft;
    if (current.hint !== undefined) {
      const { hint: _hint, ...rest } = current;
      current = rest;
      notes.push(hintRemovedNote(current.exerciseType));
    }
    return { draft: snappedQuotes(current, ctx.material), notes };
  },
};
