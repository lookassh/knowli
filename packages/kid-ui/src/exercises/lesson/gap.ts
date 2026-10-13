/** Dzieli zdanie `lesson_gap` na część przed i po pierwszej luce (ciąg 2+ podkreśleń). */
export function splitGap(stem: string): { before: string; after: string; hasGap: boolean } {
  const match = /_{2,}/.exec(stem);
  if (match === null) return { before: stem, after: "", hasGap: false };
  return { before: stem.slice(0, match.index), after: stem.slice(match.index + match[0].length), hasGap: true };
}
