import type { SpellingDiffSegmentDto } from "@learning/contracts";

/** Sklejony zapis segmentów — pełny tekst do opisu dla czytników ekranu. */
export function joinedText(segments: SpellingDiffSegmentDto[]): string {
  return segments.map((segment) => segment.text).join("");
}
