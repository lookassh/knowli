/**
 * Słowa funkcyjne przedmiotów angielskich. Używają ich słownik materiału
 * rozdziału (`english-chapter/lexicon.ts`, design „Angielski — rozdział” §4.4),
 * odmiana (`inflection.ts`: rdzeń będący słowem funkcyjnym to szum) i
 * dopasowanie słówek do tekstu źródła (`material-phrase.ts`, §6.2).
 */

/**
 * Słowa funkcyjne dozwolone w każdym elemencie, także spoza materiału: zaimki,
 * rodzajniki, formy „be”/„do”/„can”, typowe skróty, spójniki, przyimki, zaimki
 * pytające oraz posiłkowe z rozwinięć skrótów normalizatora (`can't` → `cannot`,
 * `it's` → `it has`, `I'll` → `I will`, `I'd` → `I would`/`I had`). Same nie
 * wystarczają — element musi mieć słowo treści z materiału. Zapis
 * znormalizowany: małe litery, zwykły apostrof.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // zaimki osobowe i dzierżawcze
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their",
  // rodzajniki
  "a", "an", "the",
  // „be”, „do”, „can”
  "am", "is", "are", "was", "were", "be",
  "do", "does", "don't", "doesn't",
  "can", "can't", "cannot",
  // posiłkowe z rozwinięć skrótów
  "has", "have", "had", "will", "would", "did",
  // skróty
  "i'm", "it's", "he's", "she's", "you're", "we're", "they're", "isn't", "aren't", "what's",
  // spójniki i partykuły
  "and", "or", "but", "not", "no", "yes",
  // zaimki wskazujące
  "this", "that", "these", "those",
  // przyimki
  "in", "on", "at", "to", "of", "with", "for",
  // zaimki pytające
  "what", "where", "who", "how",
  // przysłówki
  "today", "very",
]);

/** Wiodące słowa pomijane w elemencie („a coat”, „to swim”). */
const LEADING_SKIPPED: ReadonlySet<string> = new Set(["a", "an", "the", "to"]);

/** Pomija wiodące rodzajniki i „to” w znormalizowanej sekwencji tokenów. */
export function withoutLeading(tokens: readonly string[]): readonly string[] {
  let start = 0;
  while (start < tokens.length && LEADING_SKIPPED.has(tokens[start]!)) start += 1;
  return tokens.slice(start);
}
