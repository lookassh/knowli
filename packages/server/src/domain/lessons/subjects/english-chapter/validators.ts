import { answersEquivalent, MAX_TEXT_LENGTH } from "../../pool-validation";
import type { LessonExerciseDraft, LessonExerciseType, LessonTopic } from "../../types";
import { englishNormalizer } from "../english/normalizer";
import { checkElement, materialLexicon, type ElementCheck } from "./lexicon";

/**
 * Reguły przedmiotu `english_chapter` (design „Angielski — rozdział” §4.1, §4.4):
 * `validateChapterExercise` obowiązuje zawsze (generacja, edycja rodzica,
 * publikacja), a `refineChapterPool` czyści wyłącznie świeże wyjście modelu
 * walidacją słownikową, więc rodzic może dopisać słowo spoza rozdziału.
 * Komunikaty po polsku, z nazwą pola — jak reszta walidatorów lekcji.
 */

/**
 * Stałe polecenia typów bez polskiego zdania-bodźca. Takie polecenie nie mówi
 * dziecku, jakie zdanie ma powstać, więc ćwiczenie byłoby zgadywanką.
 */
export const GENERIC_CHAPTER_INSTRUCTIONS: readonly string[] = [
  "Wybierz słowo",
  "Wybierz",
  "Wpisz brakujące słowo",
  "Wpisz słowo",
  "Ułóż zdanie",
  "Uzupełnij",
  "Uzupełnij zdanie",
];

/** Najkrótsze polecenie niosące polskie zdanie-bodziec (znaki po przycięciu). */
export const MIN_STIMULUS_INSTRUCTION_LENGTH = 12;

/** Najdłuższy powód odrzucenia w raporcie rodzica (słowo modelu nie tworzy dowolnie długich kluczy). */
export const MAX_REJECTION_REASON_LENGTH = 80;

/** Typy, w których polskie zdanie-bodziec jest w `instructionPl`. */
const STIMULUS_IN_INSTRUCTION: ReadonlySet<LessonExerciseType> = new Set<LessonExerciseType>([
  "lesson_choice",
  "lesson_gap",
  "lesson_order",
]);

/** Typy ze zdaniem z luką w `stem`. */
const GAP_STEM_TYPES: ReadonlySet<LessonExerciseType> = new Set<LessonExerciseType>(["lesson_choice", "lesson_gap"]);

const GAP = /_{2,}/gu;

/** Polecenie do porównania ze stałymi: bez wielkości liter, spacji i końcowej kropki. */
function comparableInstruction(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim().replace(/[.!:…\s]+$/u, "").toLocaleLowerCase("pl-PL");
}

const GENERIC_INSTRUCTION_KEYS: ReadonlySet<string> = new Set(GENERIC_CHAPTER_INSTRUCTIONS.map(comparableInstruction));

function carriesStimulus(instruction: string | undefined): boolean {
  if (instruction === undefined) return false;
  return [...instruction.trim()].length >= MIN_STIMULUS_INSTRUCTION_LENGTH && !GENERIC_INSTRUCTION_KEYS.has(comparableInstruction(instruction));
}

export function validateChapterExercise(ex: LessonExerciseDraft, _topic: LessonTopic): string[] {
  const errors: string[] = [];

  if (GAP_STEM_TYPES.has(ex.exerciseType)) {
    const gaps = ex.stem?.match(GAP)?.length ?? 0;
    if (gaps !== 1) {
      errors.push(`stem: zdanie musi mieć dokładnie jedną lukę „___” (znaleziono ${gaps})`);
    }
  }

  if (STIMULUS_IN_INSTRUCTION.has(ex.exerciseType) && !carriesStimulus(ex.instructionPl)) {
    errors.push("instructionPl: polecenie musi zawierać polskie zdanie, np. „Dziś pada deszcz. Wybierz słowo.”");
  }

  // Bodziec jest w poleceniu: kartkówka usuwa podpowiedź z luki, więc nie może jej nieść.
  if (ex.hint !== undefined) {
    errors.push("hint: pole niedozwolone w tym przedmiocie — polskie zdanie należy do polecenia");
  }

  if (ex.exerciseType === "lesson_order") {
    // Ocena porównuje identyfikatory klocków: zamiana dwóch „a” dałaby fałszywy błąd.
    const items = ex.items ?? [];
    items.forEach((item, index) => {
      const earlier = items.slice(0, index).find((other) => answersEquivalent(other.text, item.text, englishNormalizer));
      if (earlier !== undefined) {
        errors.push(`items: klocek „${item.text}” powtarza klocek „${earlier.text}” — każdy klocek musi mieć inny tekst`);
      }
    });
  }

  // Limit przedmiotów bez payloadu v3 (te same komunikaty co walidacja ogólna).
  if ([...ex.answer].length > MAX_TEXT_LENGTH) {
    errors.push(`answer: przekracza ${MAX_TEXT_LENGTH} znaków`);
  }
  if (ex.acceptedAnswers.some((variant) => [...variant].length > MAX_TEXT_LENGTH)) {
    errors.push(`acceptedAnswers: przekracza ${MAX_TEXT_LENGTH} znaków`);
  }

  return errors;
}

/** Elementy sprawdzane słownikiem materiału (§4.4); niepowodzenie odrzuca ćwiczenie. */
function checkedElements(ex: LessonExerciseDraft): readonly string[] {
  switch (ex.exerciseType) {
    case "lesson_match":
      return (ex.pairs ?? []).map((pair) => pair.left);
    case "lesson_group":
      return (ex.groupItems ?? []).map((item) => item.text);
    case "lesson_cloze":
      return [...(ex.gapAnswers ?? []), ...(ex.extraWords ?? [])];
    case "lesson_choice":
      return (ex.options ?? []).map((option) => option.text);
    case "lesson_order":
    case "lesson_gap":
    case "lesson_open_answer":
      return [ex.answer];
    default:
      return [];
  }
}

/** Typy, w których wariant odpowiedzi spoza materiału jest usuwany, a ćwiczenie zostaje. */
const VARIANT_TYPES: ReadonlySet<LessonExerciseType> = new Set<LessonExerciseType>(["lesson_gap", "lesson_open_answer"]);

/** Powód odrzucenia dla rodzica, przycięty do `MAX_REJECTION_REASON_LENGTH` znaków. */
function rejectionReason(failure: Extract<ElementCheck, { ok: false }>): string {
  const prefix = failure.noContentWord === true ? "brak słowa z materiału: " : "słowo spoza materiału: ";
  const chars = [...`${prefix}${failure.unknown}`];
  return chars.length <= MAX_REJECTION_REASON_LENGTH ? chars.join("") : `${chars.slice(0, MAX_REJECTION_REASON_LENGTH - 1).join("")}…`;
}

function firstFailure(elements: readonly string[], lexicon: ReadonlySet<string>): Extract<ElementCheck, { ok: false }> | undefined {
  for (const element of elements) {
    const result = checkElement(element, lexicon);
    if (!result.ok) return result;
  }
  return undefined;
}

/**
 * Walidacja słownikowa świeżo wygenerowanej puli: ćwiczenie, którego element
 * sprawdzany (lewa strona pary, element grupy, słowo luki lub pułapka, opcja,
 * odpowiedź) ma słowo spoza materiału, jest odrzucane z powodem dla rodzica;
 * w luce i tłumaczeniu warianty spoza materiału są usuwane, a ćwiczenie zostaje.
 * Ćwiczenie zgodne wraca bez kopii.
 */
export function refineChapterPool(
  drafts: readonly LessonExerciseDraft[],
  ctx: { material: string },
): { kept: LessonExerciseDraft[]; rejected: { exercise: LessonExerciseDraft; reason: string }[] } {
  const lexicon = materialLexicon(ctx.material);
  const kept: LessonExerciseDraft[] = [];
  const rejected: { exercise: LessonExerciseDraft; reason: string }[] = [];
  for (const draft of drafts) {
    const failure = firstFailure(checkedElements(draft), lexicon);
    if (failure !== undefined) {
      rejected.push({ exercise: draft, reason: rejectionReason(failure) });
      continue;
    }
    if (!VARIANT_TYPES.has(draft.exerciseType)) {
      kept.push(draft);
      continue;
    }
    const variants = draft.acceptedAnswers.filter((variant) => checkElement(variant, lexicon).ok);
    kept.push(variants.length === draft.acceptedAnswers.length ? draft : { ...draft, acceptedAnswers: variants });
  }
  return { kept, rejected };
}
