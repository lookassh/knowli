/**
 * Tekst „Uzupełnij tekst” (`lesson_cloze`, design szkoły §13): luka to ciąg
 * 2+ podkreśleń — ta sama reguła co `splitGap` w Kid UI i nagranie pytania.
 * Czyste funkcje nad tekstem payloadu, bez bazy i zegara.
 */

const GAP_PATTERN = /_{2,}/u;

/** Fragmenty tekstu między lukami: zawsze o jeden więcej niż luk (puste na brzegach). */
export function clozeParts(text: string): string[] {
  return text.split(new RegExp(GAP_PATTERN.source, "gu"));
}

export function clozeGapCount(text: string): number {
  return clozeParts(text).length - 1;
}

/** Tekst z wstawionymi słowami w kolejności luk (feedback, omówienie, podgląd rodzica). */
export function fillCloze(text: string, words: readonly string[]): string {
  return clozeParts(text).reduce((filled, part, index) => (index === 0 ? part : `${filled}${words[index - 1] ?? "___"}${part}`), "");
}

/** Kanoniczna odpowiedź `lesson_cloze` (`targetKey`, podgląd): słowa luk złączone „, ”. */
export function clozeAnswer(ex: { readonly gapAnswers?: readonly string[] }): string {
  return (ex.gapAnswers ?? []).join(", ");
}
