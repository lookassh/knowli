import type { DeckState, DeckSummaryDto } from "@learning/contracts";

/** Ton odznaki stanu zestawu — pary `--pp-status-*` z motywu (oba schematy). */
export const DECK_STATE_TONE: Record<DeckState, string> = {
  review: "warning",
  published: "success",
  draft: "neutral",
  archived: "neutral",
};

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

/** Polska forma liczby dla etykiet meta listy zestawów. */
export type PolishPlural = "one" | "few" | "many";

export function polishPlural(count: number): PolishPlural {
  if (count === 1) {
    return "one";
  }
  const lastDigit = Math.abs(count) % 10;
  const lastTwo = Math.abs(count) % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) {
    return "few";
  }
  return "many";
}
