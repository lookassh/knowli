import type { LessonRuleIssue } from "../../rules/catalog";
import type { LessonExerciseDraft, LessonExerciseType, SubjectAgentPolicy } from "../../types";
import { snapQuote } from "./quote-normalize";
import { schoolIssue } from "./rules";

/**
 * Polityka agenta puli dla przedmiotu `school` (design etapu 1 §4.4, spec
 * katalogu reguł §5.1–5.2, etap 5b): typy rozwiązywane na ślepo i sanityzacja świeżego
 * wyjścia modelu — usunięcie każdej podpowiedzi (szkoła jej nie generuje) i cytaty wyrównane
 * do dokładnego fragmentu materiału. Bez kontroli 2b (kod usuwa etap 5c). Tylko reguły domenowe
 * nad przekazanymi danymi.
 *
 * Listy typów są literałami, nie importem z `module.ts` (ten importuje politykę;
 * cykl zostawiłby stałą w strefie martwej). Zgodność z typami przedmiotu pilnuje test.
 */

/** Zamknięte typy z jednoznaczną odpowiedzią; otwarte, układanki, rachunki i słowa kluczowe bez ślepego rozwiązania. */
const BLIND_SOLVE_TYPES: readonly LessonExerciseType[] = ["lesson_choice", "lesson_match", "lesson_group", "lesson_cloze", "lesson_gap"];

/** Warianty odpowiedzi sprawdza niezależny model tylko przy lukach. */
const VARIANT_CHECK_TYPES: readonly LessonExerciseType[] = ["lesson_gap"];

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
function snappedQuotes(draft: LessonExerciseDraft, material: string): { draft: LessonExerciseDraft; count: number } {
  const refs = draft.sourceRefs;
  if (refs === undefined) return { draft, count: 0 };
  let count = 0;
  const next = refs.map((ref) => {
    if (ref.parentAdded === true) return ref;
    const snapped = snapQuote(ref.quote, material);
    if (snapped === null || snapped === ref.quote) return ref;
    count += 1;
    return { ...ref, quote: snapped };
  });
  return count === 0 ? { draft, count } : { draft: { ...draft, sourceRefs: next }, count };
}

export const schoolAgentPolicy: SubjectAgentPolicy = {
  blindSolveTypes: BLIND_SOLVE_TYPES,
  variantCheckTypes: VARIANT_CHECK_TYPES,
  checkerNeedsMaterial: true,
  independentReserve: 1,
  slack: 2,
  ruleNotes: {
    "lesson.leak": "If it leaks, ask about a different fact of the material or phrase the question differently.",
    "lesson.leak_source": "Use a different fact or phrase the question differently.",
    // Jednoznaczność typów rozwiązywanych na ślepo (sprawdza ją tylko ślepe rozwiązanie).
    "check.blind_solve":
      "lesson_choice has exactly one correct option; in lesson_cloze exactly one bank word fits each gap: never two gaps " +
      "whose words could be swapped.",
  },
  sanitize(draft: LessonExerciseDraft, ctx) {
    const removed: string[] = [];
    const notes: LessonRuleIssue[] = [];
    let current = draft;
    if (current.hint !== undefined) {
      const { hint: _hint, ...rest } = current;
      current = rest;
      removed.push("hint");
      notes.push(hintRemovedNote(current.exerciseType));
    }
    const snapped = snappedQuotes(current, ctx.material);
    if (snapped.count > 0) current = snapped.draft;
    return { draft: current, removed, notes, quotesSnapped: snapped.count };
  },
};
