/**
 * Słowa i ramy zapisane w materiale rodzica rozdziału (listy „en — pl” i
 * sekcje zwrotów) oraz porównania tekstów angielskich pod bramki agenta puli
 * (`agent-policy.ts`). To nie jest słownik dozwolonych słów — ten żyje w
 * `lexicon.ts`; tutaj czytamy wyłącznie to, co rodzic wkleił do materiału.
 */

export interface MaterialLexicon {
  /** Słowa angielskie z linii „en — pl”, w kolejności materiału. */
  readonly words: string[];
  /** Ramy zdaniowe z sekcji zwrotów (z wielokropkami), w kolejności materiału. */
  readonly frames: string[];
}

/** Najwięcej wyrazów angielskiej strony linii „en — pl”, żeby nie brać zdań za słówka. */
const MAX_WORD_TOKENS = 3;

/**
 * Słowa z linii „en — pl” (bez pytań i zdań) oraz ramy z sekcji, której nagłówek
 * zawiera „zwroty” albo „ramy”. Nagłówek to linia kończąca się „:” bez „ — ”.
 */
export function parseMaterialLexicon(material: string): MaterialLexicon {
  const words: string[] = [];
  const frames: string[] = [];
  let section = "";
  for (const raw of material.split(/\r?\n/u)) {
    const text = raw.trim();
    if (text === "") continue;
    if (text.endsWith(":") && !text.includes(" — ")) {
      section = text.toLowerCase();
      continue;
    }
    if (/zwroty|ramy/u.test(section)) {
      frames.push(text);
      continue;
    }
    // Pierwsza „ — ” otoczona białymi znakami (bez `.+?`, który nawraca); linia jest obcięta, więc obie strony są niepuste.
    const dash = /\s—\s/u.exec(text);
    const english = dash === null ? undefined : text.slice(0, dash.index);
    if (english !== undefined && !/[?.!]/u.test(english) && english.trim().split(/\s+/u).length <= MAX_WORD_TOKENS) {
      words.push(english.trim());
    }
  }
  return { words, frames };
}

/** Tekst do porównań ram: małe litery, prosty apostrof, bez interpunkcji i podwójnych spacji. */
export function plainText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[?.!,;:"“”„]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Stała część ramy do wyszukania: najdłuższy fragment bez wielokropka (`plainText`). */
export function frameKey(frame: string): string {
  return frame
    .split(/…|\.\.\./u)
    .map(plainText)
    .sort((a, b) => b.length - a.length)[0]!;
}

/** Czy tekst zawiera słowo jako całość (z końcówką `s`/`es`): „beds” tak, „bedroom” nie. */
export function mentions(haystack: string, word: string): boolean {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(s|es)?([^a-z]|$)`, "u").test(haystack.toLowerCase().replace(/[’‘]/gu, "'"));
}
