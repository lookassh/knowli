import type { SpellingDiffSegmentDto } from "@learning/contracts";

/** Sklejony zapis segmentów — pełny tekst do opisu dla czytników ekranu. */
export function joinedText(segments: SpellingDiffSegmentDto[]): string {
  return segments.map((segment) => segment.text).join("");
}

/**
 * Czy diff reprezentuje urwane słowo (brakujący prefiks lub sufiks bez błędnych liter w zapisie).
 * Wtedy nie pokazujemy wiersza „Twój zapis”, lecz jedno pełne słowo wzorca z ramką.
 */
export function isIncompleteWord(
  given: SpellingDiffSegmentDto[],
  expected: SpellingDiffSegmentDto[],
): boolean {
  if (given.length === 0 || expected.length < 2) return false;
  if (!expected.some((segment) => segment.state === "plain")) return false;
  const noGivenMistakes = given.every((segment) => segment.state === "plain");
  if (!noGivenMistakes) return false;
  const pillCount = expected.filter((segment) => segment.state === "pill").length;
  if (pillCount !== 1) return false;
  const isPrefixOrSuffix =
    expected[0]?.state === "pill" || expected[expected.length - 1]?.state === "pill";
  return isPrefixOrSuffix;
}

