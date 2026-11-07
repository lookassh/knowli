import { trimTrailing } from "./text";

/**
 * Kolejne podziały linii karty na części: „ — ”, „ / ” i „ → ” (słówko — tłumaczenie /
 * przykład, zdanie → przekształcenie), etykieta „: ” („Na przykład: …”), „; ” i granica zdań po `.?!`
 * (także z cudzysłowem zamykającym za znakiem: „There is a bed.” „I like it.”).
 * Separatory dopasowują sam znak z otoczeniem w lookaroundach (bez `\s+`),
 * więc długi ciąg spacji nie wywołuje nawrotów; spacje części obcina `trim()`.
 */
const CARD_PART_SEPARATORS: readonly RegExp[] = [/(?<=\s)[—/→](?=\s)/u, /:(?=\s)/u, /;(?=\s)/u, /(?<=[.?!][”“"»]?)(?=\s)/u];
/** Punktor albo numeracja na początku części: „- ”, „• ”, „* ”, „1. ”, „1) ”. */
const CARD_BULLET = /^(?:[-•*]|\d+[.)])\s+/u;
/** Cudzysłowy na początku zdania; na końcu obcina je `trimTrailing` (liniowo, bez `[…]+$`). */
const CARD_LEADING_QUOTES = /^[„“”"«»]+/u;
const CARD_QUOTE_CHARS: ReadonlySet<string> = new Set(["„", "“", "”", "\"", "«", "»"]);
/** Zdanie angielskie: litery ASCII, cyfry („I have 2 cats.”), apostrof, spacje, interpunkcja zdania i łącznik wewnątrz słowa („T-shirt”). */
const CARD_SENTENCE = /^[A-Za-z](?:[A-Za-z0-9' ,.?!]|(?<=[A-Za-z])-(?=[A-Za-z]))*$/u;

/** Części linii po wszystkich separatorach, w kolejności występowania. */
function cardLineParts(line: string): string[] {
  return CARD_PART_SEPARATORS.reduce<string[]>(
    (parts, separator) => parts.flatMap((part) => part.split(separator)),
    [line],
  );
}

/** Część bez punktora, numeracji i cudzysłowów na brzegach; apostrof typograficzny → `'`. */
function cleanCardPart(part: string): string {
  const unbulleted = part.trim().replace(/[’‘]/gu, "'").replace(CARD_BULLET, "");
  return trimTrailing(unbulleted.replace(CARD_LEADING_QUOTES, ""), CARD_QUOTE_CHARS).trim();
}

/**
 * Teksty z treści kart, które dziecko widzi jako gotowe rozwiązania
 * (`SubjectModule.cardExposureTexts` rozdziału i gramatyki): zdania angielskie
 * z przykładów kart. Karta to polskie wyjaśnienie z przykładami angielskimi
 * (rama rozdziału: `objectivesRules`; gramatyka: przykłady w tekście), więc linie dzielą się kolejno po „ — ”, „ / ” i „ → ”, po
 * etykiecie „: ” („Na przykład: …”), po „; ” i na granicach zdań po `.?!`;
 * z każdej części odpada punktor lub numeracja („- ”, „• ”, „* ”, „1. ”, „1) ”)
 * i cudzysłowy na obu brzegach („…”, "…", «…»). Część zostaje, gdy jest
 * zdaniem: bez wielokropka (rama do uzupełnienia), złożona z liter ASCII,
 * apostrofu, spacji i interpunkcji zdania (polska część odpada na znakach
 * diakrytycznych) oraz zakończona `.?!` albo licząca ≥ 3 słowa (samo słówko
 * nie jest zdaniem). Świadomy koszt: polskie zdanie bez znaków diakrytycznych
 * przechodzi. Apostrof typograficzny → `'`, duplikaty usunięte. Używane tylko
 * przy generowaniu.
 */
export function englishCardSentences(cards: readonly { readonly body: string }[]): string[] {
  const sentences: string[] = [];
  for (const card of cards) {
    for (const rawLine of card.body.split(/\r?\n/u)) {
      for (const part of cardLineParts(rawLine)) {
        const text = cleanCardPart(part);
        if (text === "" || /…|\.\.\./u.test(text) || !CARD_SENTENCE.test(text)) continue;
        if (/[.?!]$/u.test(text) || text.split(/\s+/u).length >= 3) sentences.push(text);
      }
    }
  }
  return [...new Set(sentences)];
}
