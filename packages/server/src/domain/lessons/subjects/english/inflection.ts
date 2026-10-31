import { FUNCTION_WORDS } from "./function-words";

/**
 * Prosta odmiana angielska (design „Angielski — rozdział” §4.4): heurystyka bez
 * morfologii i słownika, wspólna dla słownika materiału rozdziału i dopasowania
 * słówek do tekstu źródła (§6.2). Czyste funkcje nad znormalizowanym tokenem
 * (małe litery, zwykły apostrof).
 */

/**
 * Najkrótsza forma po odcięciu końcówki. Krótsze rdzenie to szum, który
 * przepuszczał nowe słowa przez kolizję („wing” → „we”, „ones” → „on”).
 */
const MIN_STEM_LENGTH = 3;

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
export function stemsOf(token: string): readonly string[] {
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

/**
 * Formy porównania tokenu: on sam i jego rdzenie poza słowami funkcyjnymi.
 * Rdzeń będący słowem funkcyjnym się nie liczy: „thing” nie jest odmianą „the”,
 * „cans” — „can”, a „noted” — „not”. Dwa tokeny są tym samym słowem w prostej
 * odmianie, gdy mają wspólną formę (`coats`/`coat`, `wearing`/`wears`).
 */
export function formsOf(token: string): readonly string[] {
  return [token, ...stemsOf(token).filter((stem) => !FUNCTION_WORDS.has(stem))];
}
