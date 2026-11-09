import { fillCloze } from "../../cloze";
import type { LessonExposureSource } from "../../types";
import { correctOptionText, fillGapStem, normalizeEnglishExposureText } from "../english/exposure";

/**
 * Tekst ekspozycji ćwiczenia rozdziału (design „Angielski — rozdział” §4.5).
 * Lekcja sprawdza użycie słowa w zdaniu, więc dziecko „widzi rozwiązane”
 * całe zdanie, a nie pojedyncze słowo: wybór i luka dają zdanie ze wstawioną
 * odpowiedzią, tekst z lukami — cały uzupełniony tekst, układanka
 * i tłumaczenie — odpowiedź, pary i grupy — złączoną odpowiedź jak dotąd.
 * Wynik jest znormalizowany wspólną normalizacją angielską, więc „It's
 * snowing.” i „It’s snowing” to ta sama ekspozycja; małe litery dokłada
 * `computeTargetKey`.
 */

/**
 * Normalizacja tekstu ekspozycji rozdziału (`SubjectModule.normalizeExposureText`):
 * wspólna normalizacja angielska z `subjects/english/exposure.ts`. Kontrakt
 * utrwalony w `target_key` — zmiana wymaga decyzji o migracji kluczy.
 */
export const normalizeChapterExposureText = normalizeEnglishExposureText;

export function chapterExposureText(draft: LessonExposureSource): string {
  switch (draft.exerciseType) {
    case "lesson_choice":
    case "lesson_listen_choice":
      return normalizeChapterExposureText(fillGapStem(draft.stem, correctOptionText(draft)));
    case "lesson_gap":
      return normalizeChapterExposureText(fillGapStem(draft.stem, draft.answer));
    case "lesson_cloze":
      return normalizeChapterExposureText(draft.clozeText === undefined ? draft.answer : fillCloze(draft.clozeText, draft.gapAnswers ?? []));
    default:
      return normalizeChapterExposureText(draft.answer);
  }
}
