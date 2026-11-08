import { lessonGapParts } from "@learning/contracts";
import { z } from "zod";
import { groupItemsInViewOrder, solverView } from "./agent/solver";
import { feedbackSentenceText } from "./feedback-sentence-text";
import { answersEquivalent } from "./pool-validation";
import type { AnswerNormalizer, LessonExerciseDraft, LessonExerciseType, LessonTopic } from "./types";

/**
 * Kontrola zadań zamkniętych przebiegu bazowego (spec etapu 2 §2, spec zbiorczy §5): widok dla
 * modelu i porównanie jego wyniku z kluczem. Czyste funkcje — model nie zna klucza ani celu, a o
 * przejściu decyduje kod: wybór przechodzi tylko przy komplecie równym kluczowi, rozsypanka tylko
 * przy „yes”. Ćwiczenie z przypisaniem (match, group, cloze; spec etapu 5 §3) to jedna pozycja na
 * pole w tym samym kontrakcie wyboru: przechodzi, gdy przechodzi każde pole.
 */

export type ClosedCheckContract = "choice" | "order";

const CONTRACTS: Partial<Record<LessonExerciseType, ClosedCheckContract>> = {
  lesson_choice: "choice",
  lesson_listen_choice: "choice",
  lesson_short_answer: "choice",
  lesson_notice: "choice",
  lesson_order: "order",
  lesson_match: "choice",
  lesson_group: "choice",
  lesson_cloze: "choice",
};

/** Kontrakt kontroli typu; `null` = typ bez kontroli generowania (zadania tekstowe). */
export function closedCheckContract(type: LessonExerciseType): ClosedCheckContract | null {
  return CONTRACTS[type] ?? null;
}

/** Kandydat do przypisania tekstu modelu: opcja, segment, prawa strona, grupa albo słowo banku. */
interface Choice {
  readonly key: string;
  readonly text: string;
}

/** Pole ćwiczenia z przypisaniem: etykieta w widoku, kandydaci (posortowani jak w widoku) i klucz. */
interface Field {
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly key: readonly string[];
}

/** Kandydaci z tekstów; kluczem jest tekst (cele o równym tekście odrzuca już struktura). */
const textChoices = (texts: readonly string[]): Choice[] =>
  [...texts].sort((a, b) => a.localeCompare(b, "en")).map((text) => ({ key: text, text }));

/** Pola ćwiczenia z przypisaniem w kolejności widoku; `null` dla typów jednego pola. */
function multiFields(draft: LessonExerciseDraft): Field[] | null {
  switch (draft.exerciseType) {
    case "lesson_match": {
      const pairs = draft.pairs ?? [];
      const choices = textChoices([...pairs.map((pair) => pair.right), ...(draft.extraRight ?? [])]);
      return pairs.map((pair) => ({ label: pair.left, choices, key: [pair.right] }));
    }
    case "lesson_group": {
      const groups = draft.groups ?? [];
      const choices = textChoices(groups.map((entry) => entry.label));
      return groupItemsInViewOrder(draft).map((item) => ({
        label: item.text,
        choices,
        key: groups.filter((entry) => entry.id === item.groupId).map((entry) => entry.label),
      }));
    }
    case "lesson_cloze": {
      const answers = draft.gapAnswers ?? [];
      const choices = textChoices([...answers, ...(draft.extraWords ?? [])]);
      return answers.map((answer, index) => ({ label: `gap ${index + 1}`, choices, key: [answer] }));
    }
    default:
      return null;
  }
}

/** Kandydaci typu jednego pola: opcje (`id`, tekst) albo segmenty `lesson_notice` (pozycja, tekst). */
function choicesOf(draft: LessonExerciseDraft): Choice[] {
  if (draft.exerciseType === "lesson_notice") {
    return (draft.noticeSegments ?? []).flat().map((text, index) => ({ key: String(index), text }));
  }
  return (draft.options ?? []).map((option) => ({ key: option.id, text: option.text }));
}

/** Klucze kandydatów równoważnych kluczowi ćwiczenia (notice: segmenty równe słowu `correctOption`). */
function keyChoices(draft: LessonExerciseDraft, choices: readonly Choice[], normalizer: AnswerNormalizer): string[] {
  if (draft.exerciseType !== "lesson_notice") return draft.correctOption === undefined ? [] : [draft.correctOption];
  return choices.filter((choice) => answersEquivalent(choice.text, draft.correctOption ?? "", normalizer)).map((choice) => choice.key);
}

/** Tekst z lukami z numerami — tylko widok kontroli (`solverView` agenta zostaje bez numerów). */
function numberedCloze(text: string): string {
  return lessonGapParts(text).reduce((joined, part, index) => (index === 0 ? part : `${joined}___ (${index})${part}`), "");
}

/**
 * Widoki dziecka dla kontroli: `solverView` bez tytułu celu (wstawiany przy braku `instructionPl`
 * naprowadzałby na ćwiczoną formę), w słuchaniu z transkrypcją nagrania, w rozsypance z ułożonym
 * kluczem; ćwiczenie z przypisaniem — jedna pozycja na pole z wierszem pola i jego opcjami.
 * `null` dla typu bez kontroli albo słuchania bez zdania nagrania.
 */
export function closedCheckItems(draft: LessonExerciseDraft, topic: LessonTopic): string[] | null {
  if (closedCheckContract(draft.exerciseType) === null) return null;
  const untitled: LessonTopic = { ...topic, objectives: topic.objectives.map((objective) => ({ ...objective, titlePl: "" })) };
  const fields = multiFields(draft);
  if (fields !== null) {
    const shown = draft.exerciseType === "lesson_cloze" ? { ...draft, clozeText: numberedCloze(draft.clozeText ?? "") } : draft;
    const view = solverView(shown, untitled);
    return fields.map((field) =>
      [
        view,
        `Field: ${field.label} (judge this field on its own: the other fields do not narrow the choice)`,
        `Options: ${field.choices.map((choice) => choice.text).join(" | ")}`,
      ].join("\n"),
    );
  }
  const lines = [solverView(draft, untitled)];
  if (draft.exerciseType === "lesson_listen_choice") {
    const sentence = feedbackSentenceText(draft);
    if (sentence === null) return null;
    lines.push(`Recording (transcript): ${sentence}`);
  }
  if (draft.exerciseType === "lesson_order") lines.push(`Arranged answer: ${draft.answer}`);
  return [lines.join("\n")];
}

/** Wynik wyboru: komplet poprawnych tekstów; `[]` = żadna, `null` = nie wiem. */
export const CHOICE_CHECK_RESULT = z.object({ answers: z.array(z.string()).nullable() });
export const ORDER_CHECK_RESULT = z.object({ verdict: z.enum(["yes", "no", "unknown"]) });

export type ClosedCheckCode = "check_wrong_set" | "check_unknown" | "check_order_no";

export type ClosedCheckVerdict = { readonly pass: true } | { readonly pass: false; readonly code: ClosedCheckCode };

/** Komplet pola: każdy tekst modelu ma kandydata, a przypisani kandydaci to dokładnie klucz pola. */
function fieldVerdict(raw: unknown, choices: readonly Choice[], key: readonly string[], normalizer: AnswerNormalizer): ClosedCheckVerdict {
  const parsed = CHOICE_CHECK_RESULT.safeParse(raw);
  if (!parsed.success || parsed.data.answers === null) return { pass: false, code: "check_unknown" };
  const chosen = new Set<string>();
  for (const answer of parsed.data.answers) {
    const matches = choices.filter((choice) => answersEquivalent(answer, choice.text, normalizer));
    if (matches.length === 0) return { pass: false, code: "check_wrong_set" };
    for (const match of matches) chosen.add(match.key);
  }
  const exact = key.length === 1 && chosen.size === 1 && chosen.has(key[0]!);
  return exact ? { pass: true } : { pass: false, code: "check_wrong_set" };
}

/**
 * Werdykt kontroli z wyników pozycji ćwiczenia (kolejność {@link closedCheckItems}): wybór przechodzi,
 * gdy każdy tekst modelu jest równoważny opcji (segmentowi, celowi pola), a przypisane opcje to
 * dokładnie klucz — równoważność normalizatorem przedmiotu, jak duplikaty opcji w walidacji i wybór
 * segmentu w materializacji Kid. Notice wymaga słowa klucza w dokładnie jednym segmencie (Kid ocenia
 * po pierwszym pasującym). Przypisanie przechodzi tylko przy przejściu wszystkich pól; brak wyniku
 * pola albo zły kształt = nie wiem.
 */
export function closedCheckVerdict(draft: LessonExerciseDraft, results: readonly unknown[], normalizer: AnswerNormalizer): ClosedCheckVerdict {
  if (closedCheckContract(draft.exerciseType) === "order") {
    const parsed = ORDER_CHECK_RESULT.safeParse(results[0]);
    if (!parsed.success || parsed.data.verdict === "unknown") return { pass: false, code: "check_unknown" };
    return parsed.data.verdict === "yes" ? { pass: true } : { pass: false, code: "check_order_no" };
  }
  const fields = multiFields(draft);
  if (fields === null) {
    const choices = choicesOf(draft);
    return fieldVerdict(results[0], choices, keyChoices(draft, choices, normalizer), normalizer);
  }
  const verdicts = fields.map((field, index) => fieldVerdict(results[index], field.choices, field.key, normalizer));
  return verdicts.find((entry) => !entry.pass && entry.code === "check_unknown") ?? verdicts.find((entry) => !entry.pass) ?? { pass: true };
}
