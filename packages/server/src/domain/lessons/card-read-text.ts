import type { RenderedCard } from "./card";

/**
 * Górna granica tekstu nagrania karty (design szkoły §12.1). Schemat karty
 * daje dziś najwyżej ok. 1700 znaków; powyżej granicy karta nie ma nagrania,
 * żeby podniesienie limitów karty nie wysłało niekontrolowanie długiego tekstu.
 */
export const CARD_READ_MAX_LENGTH = 2000;

/** Znaki wypunktowania czytane jako granica zdania. */
const BULLET = /[•▪◦‣]/;

/**
 * Zapis matematyczny, który lektor bywa czyta błędnie (§12.1, §12.7): cyfra–`/`/`:`–cyfra,
 * `^` przy literze lub cyfrze, `*`/`<`/`>`/`x` między liczbami, ułamki i kreska ułamkowa
 * Unicode, indeksy górne i dolne, symbole działań i relacji, `=` między operandami.
 */
const MATH_NOTATION: readonly RegExp[] = [
  /\d\s*[/:]\s*\d/,
  /[\p{L}\p{N}]\s*\^\s*[\p{L}\p{N}]/u,
  /\d\s*[*<>xX]\s*\d/,
  /[\u00B2\u00B3\u00B9\u2070-\u209F\u00BC-\u00BE\u2150-\u215F\u2044]/,
  /[·×÷√π≤≥≠≈±∞°]/,
  /[\p{L}\p{N})\]]\s*=\s*[\p{L}\p{N}([−-]/u,
];

/**
 * Tekst nagrania „Posłuchaj karty” (design szkoły §12.1) z wyrenderowanej karty,
 * którą widzi dziecko: tytuł, treść (wypunktowanie jako pauza), przykłady
 * w kolejności z ekranu — bez dopowiadanych słów. `null`, gdy karta zawiera
 * zapis matematyczny, gdy tekst przekracza `CARD_READ_MAX_LENGTH` albo nie ma
 * czego czytać.
 */
export function cardReadText(card: RenderedCard): string | null {
  const sources = [card.title, card.body, ...card.examples];
  if (sources.some(hasMathNotation)) return null;
  const parts = [
    clean(card.title),
    ...card.body.split(BULLET).map(clean),
    ...card.examples.map(clean),
  ].filter((part): part is string => part !== undefined);
  if (parts.length === 0) return null;
  const spoken = parts.map(withStop).join(" ");
  return spoken.length > CARD_READ_MAX_LENGTH ? null : spoken;
}

/** Pełna data z ukośnikami (`12/03/2026`) — jednoznacznie data, nie ułamek. */
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;

export function hasMathNotation(text: string): boolean {
  const withoutDates = text.replace(SLASH_DATE, " ");
  return MATH_NOTATION.some((pattern) => pattern.test(withoutDates));
}

function clean(text: string): string | undefined {
  // Spacja przed znakiem interpunkcji zostaje po usunięciu `{{examples}}` z treści.
  const trimmed = text.trim().replace(/\s+/g, " ").replace(/ ([.,;:!?…])/g, "$1");
  return trimmed ? trimmed : undefined;
}

/** Kropka po fragmencie bez znaku końca zdania (przecinek/średnik przed punktem znika). */
function withStop(text: string): string {
  if (/[.!?:…]$/.test(text)) return text;
  let end = text.length;
  while (end > 0 && (text[end - 1] === "," || text[end - 1] === ";")) end -= 1;
  return `${text.slice(0, end)}.`;
}
