/**
 * Adresy panelu rodzica (plan 2026-10-29-parent-ui-mantine, §4.1).
 * Czysta logika: odczyt widoku z adresu i adres widoku.
 */

export const PARENT_SECTIONS = ["decks", "children", "progress", "work-card"] as const;

export type ParentSection = (typeof PARENT_SECTIONS)[number];

/** Widok panelu: sekcja, a w sekcji Zestawy opcjonalnie otwarty zestaw albo nowa lekcja. */
export interface ParentRoute {
  section: ParentSection;
  deckId?: string;
  newLesson?: true;
}

export const PARENT_ROOT = "/parent";
export const DEFAULT_SECTION: ParentSection = "decks";
export const DEFAULT_ROUTE: ParentRoute = { section: DEFAULT_SECTION };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sectionPath(section: ParentSection): string {
  return `${PARENT_ROOT}/${section}`;
}

export function routePath(route: ParentRoute): string {
  if (route.deckId !== undefined) return `${sectionPath("decks")}/${route.deckId}`;
  if (route.newLesson) return `${PARENT_ROOT}/lessons/new`;
  return sectionPath(route.section);
}

/**
 * Widok dla ścieżki z adresu. `null` dla `/parent` i adresów nieznanych —
 * panel zastępuje je adresem domyślnej sekcji (bez nowego wpisu historii).
 */
export function routeFromPath(pathname: string): ParentRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (`/${segments[0]}` !== PARENT_ROOT) return null;
  const [, first, second] = segments;
  if (segments.length === 2 && (PARENT_SECTIONS as readonly string[]).includes(first!)) {
    return { section: first as ParentSection };
  }
  if (segments.length === 3 && first === "decks" && UUID.test(second!)) {
    return { section: "decks", deckId: second!.toLowerCase() };
  }
  if (segments.length === 3 && first === "lessons" && second === "new") {
    return { section: "decks", newLesson: true };
  }
  return null;
}
