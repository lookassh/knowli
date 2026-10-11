import type { KidDeckDto } from "@learning/contracts";

export type DeckPage = {
  kind: "recommended" | "other";
  decks: readonly KidDeckDto[];
};

export function buildDeckPages(
  decks: readonly KidDeckDto[],
  cardsPerPage: 1 | 2,
): readonly DeckPage[] {
  const pages: DeckPage[] = [];
  for (const [kind, group] of [
    ["recommended", decks.filter((deck) => deck.recommended)],
    ["other", decks.filter((deck) => !deck.recommended)],
  ] as const) {
    for (let start = 0; start < group.length; start += cardsPerPage) {
      pages.push({ kind, decks: group.slice(start, start + cardsPerPage) });
    }
  }
  return pages;
}

export function clampDeckPageIndex(pageIndex: number, pageCount: number): number {
  if (!Number.isFinite(pageIndex) || pageCount <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(pageIndex), pageCount - 1));
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
