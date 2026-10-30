import { fillCloze } from "../../cloze";
import type { LessonExerciseDraft } from "../../types";

/**
 * Tekst ekspozycji ćwiczenia rozdziału (design „Angielski — rozdział” §4.5).
 * Lekcja sprawdza użycie słowa w zdaniu, więc dziecko „widzi rozwiązane”
 * całe zdanie, a nie pojedyncze słowo: wybór i luka dają zdanie ze wstawioną
 * odpowiedzią, tekst z lukami — cały uzupełniony tekst, układanka
 * i tłumaczenie — odpowiedź, pary i grupy — złączoną odpowiedź jak dotąd.
 * Wynik jest znormalizowany (bez zewnętrznych i wielokrotnych spacji, bez
 * końcowej interpunkcji `.!?…`), więc „It's snowing.” i „It's snowing” to ta
 * sama ekspozycja; małe litery dokłada `computeTargetKey`.
 */

/** Luka w zdaniu: ciąg 2+ podkreśleń (ta sama reguła co `cloze.ts` i Kid UI). */
const GAP = /_{2,}/u;
const TRAILING_PUNCTUATION = /[.!?…\s]+$/u;

function normalizeExposure(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim().replace(TRAILING_PUNCTUATION, "");
}

/** Zdanie ze wstawionym słowem w miejscu luki; zdanie bez luki daje samo słowo. */
function fillStem(stem: string | undefined, word: string): string {
  return stem !== undefined && GAP.test(stem) ? stem.replace(GAP, () => word) : word;
}

/** Tekst poprawnej opcji wyboru; bez niej — odpowiedź kanoniczna. */
function correctOptionText(draft: LessonExerciseDraft): string {
  return draft.options?.find((option) => option.id === draft.correctOption)?.text ?? draft.answer;
}

export function chapterExposureText(draft: LessonExerciseDraft): string {
  switch (draft.exerciseType) {
    case "lesson_choice":
      return normalizeExposure(fillStem(draft.stem, correctOptionText(draft)));
    case "lesson_gap":
      return normalizeExposure(fillStem(draft.stem, draft.answer));
    case "lesson_cloze":
      return normalizeExposure(draft.clozeText === undefined ? draft.answer : fillCloze(draft.clozeText, draft.gapAnswers ?? []));
    default:
      return normalizeExposure(draft.answer);
  }
}
