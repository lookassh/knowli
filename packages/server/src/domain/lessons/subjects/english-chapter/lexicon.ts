import { englishNormalizer } from "../english/normalizer";

/**
 * Słownik materiału rozdziału (design „Angielski — rozdział” §4.4): czy słowa
 * ćwiczenia wygenerowanego przez model pochodzą z wklejonego rozdziału. Działa
 * tylko na świeżym wyjściu modelu (`refineGeneratedPool`), więc nie ogranicza
 * rodzica. Heurystyka bez morfologii: tokeny materiału, ich części i rozwinięcia
 * skrótów oraz formy po odcięciu prostych końcówek. Czyste funkcje nad tekstem.
 */

/**
 * Słowa funkcyjne dozwolone w każdym elemencie, także spoza materiału: zaimki,
 * rodzajniki, formy „be”/„do”/„can”, typowe skróty, spójniki, przyimki, zaimki
 * pytające. Same nie wystarczają — element musi mieć słowo treści z materiału.
 * Zapis znormalizowany: małe litery, zwykły apostrof.
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

/** Apostrofy typograficzne ujednolicane do zwykłego `'` (jak normalizator bazowy). */
const APOSTROPHE_VARIANTS = /[\u2019\u2018\u02bc\u00b4]/gu;
/** Łączniki typograficzne ujednolicane do `-`. */
const HYPHEN_VARIANTS = /[\u2010\u2011]/gu;
/** Słowo materiału: litery i cyfry, z apostrofem lub łącznikiem wewnątrz. */
const MATERIAL_WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

/** Najkrótsza forma po odcięciu końcówki (krótsze to szum: „is” → „i”). */
const MIN_STEM_LENGTH = 2;

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Czy rdzeń kończy się podwojoną spółgłoską (`swimm`, `stopp`). */
function endsWithDoubledConsonant(stem: string): boolean {
  const last = stem.at(-1);
  return last !== undefined && last === stem.at(-2) && /\p{L}/u.test(last) && !VOWELS.has(last);
}

/**
 * Formy po odcięciu prostej końcówki: `-ies`→`-y`, `-es`, `-s`, `'s`, `-ing`, `-ed`
 * (także z przywróconym `-e` i bez podwojonej spółgłoski). Heurystyka bez
 * słownika: nadmiarowe formy („dresse”) są nieszkodliwe, bo słowo modelu
 * musi trafić w formę wyprowadzoną z materiału.
 */
function stemsOf(token: string): string[] {
  const stems: string[] = [];
  const add = (stem: string) => {
    if ([...stem].length >= MIN_STEM_LENGTH) stems.push(stem);
  };
  const addVerbBase = (base: string) => {
    add(base);
    add(`${base}e`);
    if (endsWithDoubledConsonant(base)) add(base.slice(0, -1));
  };
  if (token.endsWith("'s")) add(token.slice(0, -2)); // dopełniacz: Tom's → tom
  if (token.endsWith("ies")) add(`${token.slice(0, -3)}y`);
  if (token.endsWith("es")) add(token.slice(0, -2));
  if (token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("'s")) add(token.slice(0, -1));
  if (token.endsWith("ing")) addVerbBase(token.slice(0, -3));
  if (token.endsWith("ed")) addVerbBase(token.slice(0, -2));
  return stems;
}

/** NFC, małe litery, zwykły apostrof i łącznik. */
function prepare(text: string): string {
  return text.normalize("NFC").replace(APOSTROPHE_VARIANTS, "'").replace(HYPHEN_VARIANTS, "-").toLowerCase();
}

/**
 * Słownik materiału: każde słowo (z łącznikiem — także w całości), jego części
 * i rozwinięcia skrótów normalizatorem angielskim, a do tego formy po odcięciu
 * końcówek. Dzięki temu dopasowanie odmiany działa w obu kierunkach
 * (`boots` w materiale przyjmuje `boot`, `rain` w materiale przyjmuje `raining`).
 */
export function materialLexicon(material: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const word of prepare(material).match(MATERIAL_WORD) ?? []) {
    words.add(word);
    if (word.includes("-")) {
      for (const part of word.split("-")) words.add(part);
    }
    for (const sequence of englishNormalizer.normalize(word)) {
      for (const token of sequence) words.add(token);
    }
  }
  const lexicon = new Set(words);
  for (const word of words) {
    for (const stem of stemsOf(word)) lexicon.add(stem);
  }
  return lexicon;
}

/** Wynik sprawdzenia elementu ćwiczenia wobec słownika materiału. */
export type ElementCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Pierwsze słowo spoza materiału (małe litery) albo cały element bez słowa treści. */
      readonly unknown: string;
      /** Element składa się wyłącznie ze słów funkcyjnych (np. samo „the”). */
      readonly noContentWord?: true;
    };

function inLexicon(token: string, lexicon: ReadonlySet<string>): boolean {
  return lexicon.has(token) || stemsOf(token).some((stem) => lexicon.has(stem));
}

/** Pomija wiodące rodzajniki i „to”. */
function withoutLeading(tokens: readonly string[]): readonly string[] {
  let start = 0;
  while (start < tokens.length && LEADING_SKIPPED.has(tokens[start]!)) start += 1;
  return tokens.slice(start);
}

/**
 * Element (opcja, słowo luki, zdanie odpowiedzi) jest zgodny z materiałem, gdy
 * w którymś wariancie normalizacji (rozwinięcia skrótów) każdy token jest
 * w słowniku albo jest słowem funkcyjnym, a co najmniej jeden token jest
 * w słowniku i nie jest słowem funkcyjnym. Wiodące `a`/`an`/`the`/`to` pomijamy.
 * Przy niepowodzeniu podaje pierwsze słowo spoza materiału z pierwszego wariantu.
 */
export function checkElement(text: string, lexicon: ReadonlySet<string>): ElementCheck {
  const variants = englishNormalizer.normalize(prepare(text)).map(withoutLeading);
  let firstUnknown: string | undefined;
  for (const tokens of variants) {
    const unknown = tokens.find((token) => !FUNCTION_WORDS.has(token) && !inLexicon(token, lexicon));
    if (unknown === undefined) {
      if (tokens.some((token) => !FUNCTION_WORDS.has(token))) return { ok: true };
    } else {
      firstUnknown ??= unknown;
    }
  }
  if (firstUnknown !== undefined) return { ok: false, unknown: firstUnknown };
  return { ok: false, unknown: prepare(text).trim().replace(/\s+/gu, " "), noContentWord: true };
}
