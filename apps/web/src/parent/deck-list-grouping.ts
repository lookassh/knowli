import type { DeckSummaryDto } from "@learning/contracts";

/** Prezentacyjny filtr rodzaju materiału na liście zestawów. */
export type DeckKindFilter = "all" | "vocabulary" | "lesson";

/** Brak pola kind oznacza „vocabulary" (zgodność wsteczna kontraktu). */
export function filterByKind(decks: DeckSummaryDto[], kind: DeckKindFilter): DeckSummaryDto[] {
  if (kind === "all") {
    return decks;
  }
  return decks.filter((deck) => (deck.kind ?? "vocabulary") === kind);
}

export type DeckGroupId = "review" | "published" | "draft" | "archived";

export interface DeckGroup {
  id: DeckGroupId;
  decks: DeckSummaryDto[];
}

/**
 * Grupuje zestawy po stanie w stałej kolejności priorytetów dla rodzica:
 * „Wymaga Twojej uwagi" → „Gotowe do nauki" → „Szkice" → „Archiwum".
 * Kolejność wewnątrz grupy = kolejność wejściowa (najnowsze pierwsze z listDecks).
 */
export function groupDecksByState(decks: DeckSummaryDto[]): DeckGroup[] {
  const buckets: Record<DeckGroupId, DeckSummaryDto[]> = { review: [], published: [], draft: [], archived: [] };
  for (const deck of decks) {
    buckets[deck.state as DeckGroupId].push(deck);
  }
  return (Object.keys(buckets) as DeckGroupId[])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, decks: buckets[id] }));
}
