/**
 * Adresy sekcji panelu rodzica (plan 2026-10-29-parent-ui-mantine, §4.1).
 * Czysta logika: odczyt sekcji z adresu i adres sekcji.
 */

export const PARENT_SECTIONS = ["decks", "children", "progress", "work-card"] as const;

export type ParentSection = (typeof PARENT_SECTIONS)[number];

export const PARENT_ROOT = "/parent";
export const DEFAULT_SECTION: ParentSection = "decks";

export function sectionPath(section: ParentSection): string {
  return `${PARENT_ROOT}/${section}`;
}

/**
 * Sekcja dla ścieżki z adresu. `null` dla `/parent` i adresów nieznanych —
 * panel zastępuje je adresem domyślnej sekcji (bez nowego wpisu historii).
 */
export function sectionFromPath(pathname: string): ParentSection | null {
  const [root, section] = pathname.split("/").filter(Boolean);
  if (`/${root}` !== PARENT_ROOT || section === undefined) return null;
  return (PARENT_SECTIONS as readonly string[]).includes(section) ? (section as ParentSection) : null;
}
