import type { SpellingDiffSegmentDto } from "@learning/contracts";

/** Sklejony zapis segmentów — pełny tekst do opisu dla czytników ekranu. */
export function joinedText(segments: SpellingDiffSegmentDto[]): string {
  return segments.map((segment) => segment.text).join("");
}

/**
 * Czy diff reprezentuje wyłącznie brakujące litery (zapis dziecka bez błędnych
 * liter): urwany początek/koniec, brakująca litera w środku albo wpisany środek
 * słowa (brak obu końców). Wtedy nie pokazujemy wiersza „Twój zapis”, lecz
 * jedno pełne słowo wzorca z ramkami na brakujących fragmentach.
 */
export function isIncompleteWord(
  given: SpellingDiffSegmentDto[],
  expected: SpellingDiffSegmentDto[],
): boolean {
  if (given.length === 0 || expected.length < 2) return false;
  if (!expected.some((segment) => segment.state === "plain")) return false;
  if (!given.every((segment) => segment.state === "plain")) return false;
  const pills = expected.filter((segment) => segment.state === "pill").length;
  // jedna brakująca dziura gdziekolwiek albo brak obu końców (środek słowa)
  if (pills === 1) return true;
  return (
    pills === 2 &&
    expected[0].state === "pill" &&
    expected[expected.length - 1].state === "pill"
  );
}

