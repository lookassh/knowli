import { z } from "zod";
import { solverView } from "./agent/solver";
import { feedbackSentenceText } from "./feedback-sentence-text";
import { answersEquivalent } from "./pool-validation";
import type { AnswerNormalizer, LessonExerciseDraft, LessonExerciseType, LessonTopic } from "./types";

/**
 * Kontrola zadań zamkniętych przebiegu bazowego (spec etapu 2 §2, spec zbiorczy §5): widok dla
 * modelu i porównanie jego wyniku z kluczem. Czyste funkcje — model nie zna klucza ani celu, a o
 * przejściu decyduje kod: wybór przechodzi tylko przy komplecie równym kluczowi, rozsypanka tylko
 * przy „yes”.
 */

export type ClosedCheckContract = "choice" | "order";

const CONTRACTS: Partial<Record<LessonExerciseType, ClosedCheckContract>> = {
  lesson_choice: "choice",
  lesson_listen_choice: "choice",
  lesson_short_answer: "choice",
  lesson_notice: "choice",
  lesson_order: "order",
};

/** Kontrakt kontroli typu; `null` = typ bez kontroli generowania (zadania tekstowe). */
export function closedCheckContract(type: LessonExerciseType): ClosedCheckContract | null {
  return CONTRACTS[type] ?? null;
}

/**
 * Widok dziecka dla kontroli: `solverView` bez tytułu celu (wstawiany przy braku `instructionPl`
 * naprowadzałby na ćwiczoną formę), w słuchaniu z transkrypcją nagrania, w rozsypance z ułożonym
 * kluczem. `null` dla typu bez kontroli albo słuchania bez zdania nagrania.
 */
export function closedCheckItem(draft: LessonExerciseDraft, topic: LessonTopic): { contract: ClosedCheckContract; view: string } | null {
  const contract = closedCheckContract(draft.exerciseType);
  if (contract === null) return null;
  const untitled: LessonTopic = { ...topic, objectives: topic.objectives.map((objective) => ({ ...objective, titlePl: "" })) };
  const lines = [solverView(draft, untitled)];
  if (draft.exerciseType === "lesson_listen_choice") {
    const sentence = feedbackSentenceText(draft);
    if (sentence === null) return null;
    lines.push(`Recording (transcript): ${sentence}`);
  }
  if (draft.exerciseType === "lesson_order") lines.push(`Arranged answer: ${draft.answer}`);
  return { contract, view: lines.join("\n") };
}

/** Wynik wyboru: komplet poprawnych tekstów; `[]` = żadna, `null` = nie wiem. */
export const CHOICE_CHECK_RESULT = z.object({ answers: z.array(z.string()).nullable() });
export const ORDER_CHECK_RESULT = z.object({ verdict: z.enum(["yes", "no", "unknown"]) });

export type ClosedCheckCode = "check_wrong_set" | "check_unknown" | "check_order_no";

export type ClosedCheckVerdict = { readonly pass: true } | { readonly pass: false; readonly code: ClosedCheckCode };

/** Kandydaci do przypisania tekstu modelu: opcje (`id`, tekst) albo segmenty `lesson_notice` (pozycja, tekst). */
function choicesOf(draft: LessonExerciseDraft): { readonly key: string; readonly text: string }[] {
  if (draft.exerciseType === "lesson_notice") {
    return (draft.noticeSegments ?? []).flat().map((text, index) => ({ key: String(index), text }));
  }
  return (draft.options ?? []).map((option) => ({ key: option.id, text: option.text }));
}

/** Klucze kandydatów równoważnych kluczowi ćwiczenia (notice: segmenty równe słowu `correctOption`). */
function keyChoices(draft: LessonExerciseDraft, choices: ReturnType<typeof choicesOf>, normalizer: AnswerNormalizer): Set<string> {
  if (draft.exerciseType !== "lesson_notice") return new Set(draft.correctOption === undefined ? [] : [draft.correctOption]);
  return new Set(choices.filter((choice) => answersEquivalent(choice.text, draft.correctOption ?? "", normalizer)).map((choice) => choice.key));
}

/**
 * Werdykt kontroli: wybór przechodzi, gdy każdy tekst modelu jest równoważny opcji (segmentowi), a
 * przypisane opcje to dokładnie opcja klucza — równoważność normalizatorem przedmiotu, jak duplikaty
 * opcji w walidacji i wybór segmentu w materializacji Kid. Notice wymaga słowa klucza w dokładnie
 * jednym segmencie (Kid ocenia po pierwszym pasującym). Zły kształt wyniku = nie wiem.
 */
export function closedCheckVerdict(draft: LessonExerciseDraft, raw: unknown, normalizer: AnswerNormalizer): ClosedCheckVerdict {
  if (closedCheckContract(draft.exerciseType) === "order") {
    const parsed = ORDER_CHECK_RESULT.safeParse(raw);
    if (!parsed.success || parsed.data.verdict === "unknown") return { pass: false, code: "check_unknown" };
    return parsed.data.verdict === "yes" ? { pass: true } : { pass: false, code: "check_order_no" };
  }
  const parsed = CHOICE_CHECK_RESULT.safeParse(raw);
  if (!parsed.success || parsed.data.answers === null) return { pass: false, code: "check_unknown" };
  const choices = choicesOf(draft);
  const key = keyChoices(draft, choices, normalizer);
  const chosen = new Set<string>();
  for (const answer of parsed.data.answers) {
    const matches = choices.filter((choice) => answersEquivalent(answer, choice.text, normalizer));
    if (matches.length === 0) return { pass: false, code: "check_wrong_set" };
    for (const match of matches) chosen.add(match.key);
  }
  const exact = key.size === 1 && chosen.size === 1 && [...chosen].every((choice) => key.has(choice));
  return exact ? { pass: true } : { pass: false, code: "check_wrong_set" };
}
