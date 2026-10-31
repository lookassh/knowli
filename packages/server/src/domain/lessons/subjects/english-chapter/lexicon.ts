import { FUNCTION_WORDS, withoutLeading } from "../english/function-words";
import { formsOf, stemsOf } from "../english/inflection";
import { englishNormalizer } from "../english/normalizer";

/**
 * Słownik materiału rozdziału (design „Angielski — rozdział” §4.4): czy słowa
 * ćwiczenia wygenerowanego przez model pochodzą z wklejonego rozdziału. Działa
 * tylko na świeżym wyjściu modelu (`refineGeneratedPool`), więc nie ogranicza
 * rodzica. Heurystyka bez morfologii: tokeny materiału, ich części i rozwinięcia
 * skrótów oraz formy po odcięciu prostych końcówek. Czyste funkcje nad tekstem.
 */

/** Słowa funkcyjne przedmiotów angielskich (lista wspólna, `english/function-words.ts`). */
export { FUNCTION_WORDS };

/** Apostrofy typograficzne ujednolicane do zwykłego `'` (jak normalizator bazowy). */
const APOSTROPHE_VARIANTS = /[\u2019\u2018\u02bc\u00b4]/gu;
/** Łączniki typograficzne ujednolicane do `-`. */
const HYPHEN_VARIANTS = /[\u2010\u2011]/gu;
/** Słowo materiału: litery i cyfry, z apostrofem lub łącznikiem wewnątrz. */
const MATERIAL_WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

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

/**
 * Token jest w słowniku wprost albo przez rdzeń (`formsOf`). Rdzeń będący słowem
 * funkcyjnym się nie liczy: „thing” nie jest odmianą „the”, a „cans” — „can”.
 */
function inLexicon(token: string, lexicon: ReadonlySet<string>): boolean {
  return formsOf(token).some((form) => lexicon.has(form));
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
