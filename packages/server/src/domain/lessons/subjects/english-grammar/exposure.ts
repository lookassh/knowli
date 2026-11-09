import type { LessonExposureSource } from "../../types";
import { correctOptionText, fillGapStem, hasGapMarker, normalizeEnglishExposureText } from "../english/exposure";

/**
 * Tekst ekspozycji ćwiczenia gramatyki (#373): dziecko widzi rozwiązane całe
 * zdanie albo całą wymianę, a nie samą formę czasownika. Luka i wybór z luką
 * dają zdanie ze wstawioną odpowiedzią; krótka odpowiedź i wybór z pytaniem
 * bez luki — pytanie razem z poprawną odpowiedzią (jak klucz tłumaczenia
 * całej wymiany w `short_answers`); pozostałe typy — odpowiedź kanoniczną.
 * Czysto strukturalne: składanie pól szkicu, bez rozumienia języka.
 */

function nonBlank(text: string | undefined): string | undefined {
  return text !== undefined && text.trim() !== "" ? text : undefined;
}

/** Pytanie krótkiej odpowiedzi: `prompt`, a bez niego `stem` (jak edytor rodzica). */
function questionOf(draft: LessonExposureSource): string | undefined {
  return nonBlank(draft.prompt) ?? nonBlank(draft.stem);
}

/** Rozwiązany wybór: luka wypełniona poprawną opcją, a bodziec bez luki — razem z poprawną opcją. */
function solvedChoice(draft: LessonExposureSource): string {
  const word = correctOptionText(draft);
  if (hasGapMarker(draft.stem)) return fillGapStem(draft.stem, word);
  const stem = nonBlank(draft.stem);
  return stem === undefined ? word : `${stem} ${word}`;
}

export function grammarExposureText(draft: LessonExposureSource): string {
  switch (draft.exerciseType) {
    case "lesson_choice":
    case "lesson_listen_choice":
      return normalizeEnglishExposureText(solvedChoice(draft));
    case "lesson_short_answer": {
      const question = questionOf(draft);
      const word = correctOptionText(draft);
      return normalizeEnglishExposureText(question === undefined ? word : `${question} ${word}`);
    }
    case "lesson_gap":
      return normalizeEnglishExposureText(fillGapStem(draft.stem, draft.answer));
    default:
      return normalizeEnglishExposureText(draft.answer);
  }
}
