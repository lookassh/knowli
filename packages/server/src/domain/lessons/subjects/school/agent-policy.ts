import { baseNormalizer } from "../../normalize";
import { clip, type LessonRuleIssue } from "../../rules/catalog";
import type { LessonExerciseDraft, LessonExerciseType, SubjectAgentPolicy } from "../../types";
import { hintRevealing, type HintRevealing } from "./hint-gate";
import { snapQuote } from "./quote-normalize";
import { schoolIssue } from "./rules";

/**
 * Polityka agenta puli dla przedmiotu `school` (design etapu 1 §4.4, spec
 * katalogu reguł §5.1–5.2): typy rozwiązywane na ślepo i sanityzacja —
 * podpowiedź poza pytaniem otwartym, podpowiedź pytania otwartego zdradzająca
 * odpowiedź (usuwana z notą zamiast odrzucenia ćwiczenia) i cytaty wyrównane
 * do dokładnego fragmentu materiału. Tylko reguły domenowe nad przekazanymi danymi.
 *
 * Listy typów są literałami, nie importem z `module.ts` (ten importuje politykę;
 * cykl zostawiłby stałą w strefie martwej). Zgodność z typami przedmiotu pilnuje test.
 */

/** Zamknięte typy z jednoznaczną odpowiedzią; otwarte, układanki, rachunki i słowa kluczowe bez ślepego rozwiązania. */
const BLIND_SOLVE_TYPES: readonly LessonExerciseType[] = ["lesson_choice", "lesson_match", "lesson_group", "lesson_cloze", "lesson_gap"];

/** Warianty odpowiedzi sprawdza niezależny model tylko przy lukach. */
const VARIANT_CHECK_TYPES: readonly LessonExerciseType[] = ["lesson_gap"];

/** Podpowiedź ma sens wyłącznie przy pytaniu otwartym; rodzic dopisuje ją innym typom w edytorze. */
const HINT_TYPE: LessonExerciseType = "lesson_open_answer";

/** Kontrola otwarta (rozwiązujący + grader) dotyczy wyłącznie pytania otwartego. */
const OPEN_CHECK_TYPE: LessonExerciseType = "lesson_open_answer";

const normalizer = baseNormalizer;

/** Dopisek dla podagenta: odpowiednik `sanitize` (podpowiedź poza pytaniem otwartym i tak jest usuwana). */
const PROMPT_NOTES: readonly string[] = [
  "Hint only for lesson_open_answer: the hint field must be null for every other exercise type.",
];

const TARGET_LABELS: Readonly<Record<HintRevealing["target"], string>> = {
  answer: "the answer",
  acceptedAnswer: "the accepted variant",
  requiredElement: "the required element",
};

/** Nota reguły `hint.reveals_words`: zdradzony cel i jego słowa obecne w podpowiedzi. */
function hintRemovedNote(revealing: HintRevealing): LessonRuleIssue {
  const words = revealing.words.map((word) => clip(word)).join(", ");
  return schoolIssue("hint.reveals_words", {
    pl: "hint: podpowiedź zdradzała odpowiedź albo element wymagany i została usunięta",
    found: `hint removed: shares ${words} with ${TARGET_LABELS[revealing.target]} ${clip(revealing.text)}`,
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
  hintJudgeTypes: [HINT_TYPE],
  openAnswerCheckTypes: [OPEN_CHECK_TYPE],
  checkerNeedsMaterial: true,
  independentReserve: 1,
  slack: 2,
  promptNotes: PROMPT_NOTES,
  rejectionTexts: {
    leakVictim:
      "An independent answer must not be visible earlier — ask about a different fact of the material or phrase the question differently.",
    leakSource: "Use a different fact or phrase the question differently.",
    hintUnsupported:
      "The hint states something the material does not support. Rewrite the hint using only facts from the material, or set hint to null.",
    hintLanguage: "The hint is not correct Polish. Fix the wording, or set hint to null.",
    hintReveals:
      "The hint gives away the answer or a required element in other words. Hint at the reasoning, not the content, or set hint to null.",
    openMissing:
      "A correct answer that follows the question was not accepted: it lacks required elements the question does not actually demand. " +
      "Make requiredElements match what the question asks (for “any two”, require what every valid choice satisfies and move specific examples to supplementaryElements), " +
      "or make the question ask for exactly those elements. Do not drop elements the question genuinely requires; " +
      "if the answer below is wrong according to the material, make the question more precise.",
    openWrong:
      "An answer based on the material was graded as containing errors. Check that the model answer and the criteria agree with the material; " +
      "if the answer below is wrong according to the material, make the question more precise or add the mistake to commonErrors.",
  },
  sanitize(draft: LessonExerciseDraft, ctx) {
    const removed: string[] = [];
    const notes: LessonRuleIssue[] = [];
    let current = draft;
    if (current.hint !== undefined) {
      // Poza pytaniem otwartym podpowiedź zawsze odpada (bez noty, jak dotąd); w pytaniu
      // otwartym — tylko gdy zdradza odpowiedź, wariant albo element wymagany.
      const revealing = current.exerciseType === HINT_TYPE ? hintRevealing(current.hint, current, normalizer) : null;
      if (current.exerciseType !== HINT_TYPE || revealing !== null) {
        const { hint: _hint, ...rest } = current;
        current = rest;
        removed.push("hint");
        if (revealing !== null) notes.push(hintRemovedNote(revealing));
      }
    }
    const snapped = snappedQuotes(current, ctx.material);
    if (snapped.count > 0) current = snapped.draft;
    return { draft: current, removed, notes, quotesSnapped: snapped.count };
  },
};
