/** Termin sprawdzianu (YYYY-MM-DD, dzień rodziny) jako DD.MM.RRRR. */
export function formatFamilyDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
