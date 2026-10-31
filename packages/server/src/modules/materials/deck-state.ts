import type { DeckState } from "@learning/contracts";

/**
 * Stan zestawu widoczny dla rodzica: archiwum, edytowalna wersja (szkic albo
 * przegląd), w przeciwnym razie opublikowany albo pusty szkic. Plik-liść bez
 * importów kodu serwera: korzystają z niego `decks.ts` i `source-materials.ts`,
 * a `decks.ts` czyta też pochodzenie zestawu ze źródeł — bez cyklu importów.
 */
export function deckStateOf(deck: { archivedAt: Date | null; publishedVersionId: string | null }, editableState: "draft" | "review" | null): DeckState {
  if (deck.archivedAt) {
    return "archived";
  }
  if (editableState) {
    return editableState;
  }
  return deck.publishedVersionId ? "published" : "draft";
}
