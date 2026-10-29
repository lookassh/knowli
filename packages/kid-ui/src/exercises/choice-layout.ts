/** Longest option label (in characters) that still fits a half-width card on a phone. */
const SHORT_CHOICE_MAX_CHARS = 14;
const SHORT_CHOICE_COUNT = 4;

/**
 * Four short text options sit in a 2×2 grid on compact widths; anything else
 * stays in a single column. Spread counts code points, so Polish letters
 * (and any emoji) are one character each.
 */
export function isShortChoiceSet(labels: readonly string[]): boolean {
  return labels.length === SHORT_CHOICE_COUNT
    && labels.every((label) => [...label.trim()].length <= SHORT_CHOICE_MAX_CHARS);
}
