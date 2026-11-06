/**
 * `Retry-After` w sekundach albo jako data HTTP; brak, pusta lub nieczytelna
 * wartość = brak wskazówki (wywołujący bierze własny odstęp), nie 0 ms.
 */
export function retryAfterMs(raw: string | null | undefined, now = Date.now()): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1_000;
  // Data HTTP zawsze ma nazwy dnia i miesiąca; V8 czyta luźne liczby jak „-5” jako rok.
  if (!/[a-z]/i.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
