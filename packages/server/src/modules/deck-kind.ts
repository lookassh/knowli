import { eq } from "drizzle-orm";
import type { Executor } from "../db/client";
import { decks } from "../db/schema";
import { AppError } from "../errors";

export type DeckKind = "vocabulary" | "lesson";

/**
 * Jedno źródło prawdy o rodzaju zestawu (zadanie 9). Istniejące moduły słówek
 * nie powielają tego samego SQL — pytają tu. Nieznany zestaw → `not_found`,
 * żeby wywołujący nie musiał rozróżniać „brak zestawu” od „zły rodzaj”.
 */
export async function readDeckKind(exec: Executor, deckId: string): Promise<DeckKind> {
  const row = (await exec.select({ kind: decks.kind }).from(decks).where(eq(decks.id, deckId)))[0];
  if (!row) {
    throw new AppError("not_found");
  }
  return row.kind as DeckKind;
}

/**
 * Bramka ścieżek słówek: rzuca `deck_kind_mismatch`, gdy zestaw jest lekcją.
 * Tymczasowa dla ścieżek, które zadania 13/17 zastąpią delegacją do silnika
 * lekcji (start sesji, próba, kartkówka, raport postępu słówek).
 */
export function assertVocabularyDeck(kind: DeckKind): void {
  if (kind !== "vocabulary") {
    throw new AppError("deck_kind_mismatch", { message: `operacja słówek na zestawie rodzaju ${kind}` });
  }
}
