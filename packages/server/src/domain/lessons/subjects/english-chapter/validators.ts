import { answersEquivalent } from "../../pool-validation";
import { clip, type LessonRuleIssue } from "../../rules/catalog";
import type { LessonExerciseDraft, LessonTopic } from "../../types";
import { englishNormalizer } from "../english/normalizer";
import { chapterIssue } from "./rules";

/**
 * Reguły strukturalne przedmiotu `english_chapter` (design „Angielski — rozdział” §4.1; od etapu 5a
 * #362 bez heurystyk językowych): obowiązują zawsze (generacja, edycja rodzica, publikacja). Limit
 * 120 znaków odpowiedzi i jedną lukę w `lesson_gap` pilnuje walidacja ogólna silnika. Zgłoszenia
 * reguł katalogu rozdziału (`rules.ts`): `pl` po polsku z nazwą pola, `found` po angielsku dla modelu.
 */

/** Stałe polecenie tłumaczenia (prompt i oczyszczenie tłumaczenia bez polecenia z modelu). */
export const TRANSLATION_INSTRUCTION = "Przetłumacz na angielski.";

/** Luka w zdaniu wyboru (luka `lesson_gap` ma już regułę silnika). */
const GAP = /_{2,}/gu;

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === "";
}

export function validateChapterExercise(ex: LessonExerciseDraft, _topic: LessonTopic): LessonRuleIssue[] {
  const issues: LessonRuleIssue[] = [];

  if (ex.exerciseType === "lesson_choice") {
    const gaps = ex.stem?.match(GAP)?.length ?? 0;
    if (gaps !== 1) {
      issues.push(
        chapterIssue("chapter.stem_single_gap", {
          pl: `stem: zdanie musi mieć dokładnie jedną lukę „___” (znaleziono ${gaps})`,
          found: `stem ${clip(ex.stem ?? "")} has ${gaps} gaps, expected exactly one`,
        }),
      );
    }
  }

  // Bez polecenia dziecko widziałoby tylko tytuł zagadnienia i nie wiedziałoby, że ma tłumaczyć.
  if (ex.exerciseType === "lesson_open_answer" && isBlank(ex.instructionPl)) {
    issues.push(
      chapterIssue("chapter.translation_instruction_required", {
        pl: `instructionPl: tłumaczenie wymaga polecenia, np. „${TRANSLATION_INSTRUCTION}”`,
        found: "instructionPl is empty on a translation exercise",
      }),
    );
  }

  // Bodziec jest w poleceniu: kartkówka usuwa podpowiedź z luki, więc nie może jej nieść.
  if (ex.hint !== undefined) {
    issues.push(
      chapterIssue("chapter.hint_not_allowed", {
        pl: "hint: pole niedozwolone w tym przedmiocie — polskie zdanie należy do polecenia",
        found: `hint ${clip(ex.hint)} is set, but this subject has no hints`,
      }),
    );
  }

  if (ex.exerciseType === "lesson_order") {
    // Ocena porównuje identyfikatory klocków: zamiana dwóch „a” dałaby fałszywy błąd.
    const items = ex.items ?? [];
    items.forEach((item, index) => {
      const earlierIndex = items.slice(0, index).findIndex((other) => answersEquivalent(other.text, item.text, englishNormalizer));
      const earlier = items[earlierIndex];
      if (earlier !== undefined) {
        issues.push(
          chapterIssue("chapter.order_items_distinct", {
            field: `items[${index}].text`,
            pl: `items: klocek „${item.text}” powtarza klocek „${earlier.text}” — każdy klocek musi mieć inny tekst`,
            found: `items[${index}] ${clip(item.text)} repeats items[${earlierIndex}] ${clip(earlier.text)}`,
          }),
        );
      }
    });
  }

  return issues;
}

/**
 * Oczyszczenie świeżego wyjścia modelu (spec etapu 5 §4.4): tłumaczenie bez polecenia (próba: `instructionPl: null`
 * w 20–50% tłumaczeń) dostaje stałe polecenie zamiast odrzucenia. Naprawa wyjścia modelu, nie danych rodzica.
 */
export function withTranslationInstruction(draft: LessonExerciseDraft): LessonExerciseDraft {
  if (draft.exerciseType !== "lesson_open_answer" || !isBlank(draft.instructionPl)) return draft;
  return { ...draft, instructionPl: TRANSLATION_INSTRUCTION };
}
