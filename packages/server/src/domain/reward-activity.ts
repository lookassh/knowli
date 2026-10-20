/**
 * Pomocnicze strefy czasowe i daty lokalne dla raportów nagrody. Rozliczanie
 * czasu/punktów żyje w kontraktach (`sessionActivityAward`) i module
 * `session-activity`; tutaj zostają tylko deterministyczne przeliczenia dat.
 */

export function validRewardTimezone(value: unknown): string {
  if (typeof value !== "string") return "Europe/Warsaw";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "Europe/Warsaw";
  }
}

export function localDateAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
