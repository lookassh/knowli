/**
 * Ucina z końca tekstu znaki z `chars` w czasie liniowym — zamiast wyrażenia
 * w rodzaju `/[.!?\s]+$/`, które przy długim ciągu spacji w środku tekstu
 * wraca wielokrotnie (nawroty o złożoności kwadratowej).
 */
export function trimTrailing(text: string, chars: ReadonlySet<string>): string {
  let end = text.length;
  while (end > 0 && chars.has(text[end - 1]!)) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}
