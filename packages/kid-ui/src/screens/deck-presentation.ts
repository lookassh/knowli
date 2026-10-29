import type { KidDeckDto } from "@learning/contracts";

export type DeckGroups = {
  recommended: readonly KidDeckDto[];
  other: readonly KidDeckDto[];
};

/** Zestaw z trwającą sesją: serwer nie oznacza go jako rekomendowanego, a dziecko musi dostać duży przycisk wznowienia. */
export function hasActiveSessionDeck(deck: KidDeckDto): boolean {
  return Boolean(deck.resumeOnly && deck.activeSession);
}

/**
 * Karty (grupa `recommended`) dostają zestawy z trwającą sesją (zawsze na początku, niezależnie od `recommended`)
 * i zestawy rekomendowane, każdą grupę w kolejności API. Reszta trafia do listy wierszy.
 */
export function groupDecks(decks: readonly KidDeckDto[]): DeckGroups {
  const active = decks.filter(hasActiveSessionDeck);
  const rest = decks.filter((deck) => !hasActiveSessionDeck(deck));
  return {
    recommended: [...active, ...rest.filter((deck) => deck.recommended)],
    other: rest.filter((deck) => !deck.recommended),
  };
}

const POLISH_MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

export function formatDeckTestDate(date: string | null, currentYear: number): string | null {
  if (date === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    return null;
  }
  const yearSuffix = year === currentYear ? "" : ` ${year}`;
  return `${day} ${POLISH_MONTHS[month - 1]}${yearSuffix}`;
}
