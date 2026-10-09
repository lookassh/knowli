/**
 * Fragmenty wymowy dla dziecka (design 2026-10-09): fonemy Azure mapowane na
 * grupy liter słowa docelowego, z werdyktem good/almost z pasm dziecka.
 * Wyłącznie wizualne — o ocenie umiejętności decyduje score całej wypowiedzi.
 * Bez liczb i IPA w DTO dziecka (SPEC §7).
 */

export interface PronunciationFragment {
  text: string;
  verdict: "good" | "almost";
}

export interface FragmentInput {
  text: string;
  errorType: string | null;
  phonemes: Array<{ phoneme: string; accuracyScore: number | null }>;
}

const VOWEL_LETTERS = new Set(["a", "e", "i", "o", "u", "y"]);
const VOWEL_PHONEMES = new Set([
  "æ", "ɛ", "ɪ", "ɒ", "ʌ", "ʊ", "ə", "ɜ", "ɐ", "ɑ", "ɔ", "i", "u", "e", "o", "a",
  "iː", "uː", "ɔː", "ɑː", "ɜː", "eɪ", "aɪ", "ɔɪ", "aʊ", "əʊ", "oʊ", "ɪə", "eə", "ʊə",
]);
const DIGRAPHS = new Set([
  "ch", "sh", "th", "ph", "wh", "ck", "ng", "qu", "ee", "ea", "oo", "ou", "ai", "ay",
  "oa", "oi", "oy", "au", "aw", "er", "ir", "ur", "ar", "or", "ie", "ue", "ui",
]);
const GROUP_PHONEMES: Record<string, string[]> = {
  ch: ["tʃ"], sh: ["ʃ"], th: ["θ", "ð"], ph: ["f"], wh: ["w"], ck: ["k"], ng: ["ŋ"],
  qu: ["kw", "k"], ee: ["iː"], ea: ["iː", "ɛ", "eɪ"], oo: ["uː", "ʊ"], ou: ["aʊ", "uː", "ə"],
  ai: ["eɪ"], ay: ["eɪ", "e"], oa: ["əʊ", "oʊ"], oi: ["ɔɪ"], oy: ["ɔɪ"], au: ["ɔː"], aw: ["ɔː"],
  er: ["ɜː", "ər"], ir: ["ɜː", "ər"], ur: ["ɜː", "ər"], ar: ["ɑː", "ər"], or: ["ɔː", "ər"],
  ie: ["iː", "aɪ"], ue: ["uː", "juː"], ui: ["uː", "juː", "ʊ"],
};
const LETTER_PHONEMES: Record<string, string[]> = {
  a: ["eɪ", "æ", "ɑː", "ə"], b: ["b"], c: ["k", "s"], d: ["d"], e: ["iː", "e", "ə", "ɪ"],
  f: ["f"], g: ["ɡ", "dʒ"], h: ["h"], i: ["ɪ", "aɪ"], j: ["dʒ"], k: ["k"], l: ["l"],
  m: ["m"], n: ["n", "ŋ"], o: ["ɒ", "əʊ", "oʊ", "ɔː", "ə"], p: ["p"], q: ["kw"],
  r: ["r", "ɹ"], s: ["s", "z"], t: ["t"], u: ["ʌ", "uː", "juː", "ʊ", "ə"],
  v: ["v"], w: ["w"], x: ["ks", "kz"], y: ["j", "aɪ", "i"], z: ["z"],
};

/** Zachłanny podział słowa na grupy liter: digrafy przed pojedynczymi literami. */
export function letterGroups(word: string): string[] {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "").split("");
  const groups: string[] = [];
  let i = 0;
  while (i < letters.length) {
    const pair = letters.slice(i, i + 2).join("");
    const rDigraphBeforeDoubleR = ["er", "ir", "ur", "ar", "or"].includes(pair) && letters[i + 2] === "r";
    const repeatedConsonant = pair.length === 2 && pair[0] === pair[1] && !VOWEL_LETTERS.has(pair[0]!);
    if (i + 1 < letters.length && ((DIGRAPHS.has(pair) && !rDigraphBeforeDoubleR) || repeatedConsonant)) {
      groups.push(pair);
      i += 2;
    } else {
      groups.push(letters[i]!);
      i += 1;
    }
  }
  return groups;
}

function candidatesFor(group: string): string[] | undefined {
  if (GROUP_PHONEMES[group]) return GROUP_PHONEMES[group];
  // Podwojona spółgłoska (rr, ll, ss…) brzmi jak pojedyncza.
  if (group.length === 2 && group[0] === group[1]) return LETTER_PHONEMES[group[0]!];
  return LETTER_PHONEMES[group];
}

function groupMatches(group: string, phoneme: string): boolean {
  const candidates = candidatesFor(group);
  if (candidates?.includes(phoneme)) return true;
  if (phoneme === group) return true; // symbole literowe (fake provider)
  const last = group[group.length - 1]!;
  return VOWEL_LETTERS.has(last) && VOWEL_PHONEMES.has(phoneme);
}

interface AlignedGroup {
  text: string;
  scores: number[];
}

/** Zachłanne dopasowanie grup liter do fonemów; null = brak pewnego dopasowania. */
function align(target: string, phonemes: FragmentInput["phonemes"]): AlignedGroup[] | null {
  const groups = letterGroups(target);
  const aligned: AlignedGroup[] = [];
  let p = 0;
  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]!;
    const head = phonemes[p];
    if (head && groupMatches(group, head.phoneme)) {
      aligned.push({ text: group, scores: head.accuracyScore === null ? [] : [head.accuracyScore] });
      p += 1;
    } else if (group === "e" && p >= phonemes.length - (groups.length - g - 1)) {
      // Nieme „e” konsumuje zero fonemów, gdy reszta wystarcza pozostałym literom.
      aligned.push({ text: group, scores: [] });
    } else {
      return null;
    }
  }
  if (phonemes.length - p > 1) return null; // tolerujemy najwyżej jeden nadmiarowy fonem
  return aligned;
}

export function buildPronunciationFragments(
  target: string,
  word: FragmentInput | undefined,
  bands: { correctMinScore: number; partialMinScore: number },
  overallBand: "correct" | "partial",
): PronunciationFragment[] {
  const normalized = target.trim().toLowerCase();
  const fallback: PronunciationFragment[] = [
    { text: target, verdict: overallBand === "correct" ? "good" : "almost" },
  ];
  const phonemes = word?.phonemes ?? [];
  if (!word || word.text.trim().toLowerCase() !== normalized || word.errorType !== null || phonemes.length < 2) return fallback;
  const aligned = align(normalized, phonemes);
  if (!aligned) return fallback;

  const marked = aligned.map<PronunciationFragment>((group) => {
    // Brak score'u traktujemy optymistycznie — fragmenty są wyłącznie wizualne.
    const scores = group.scores.length > 0 ? group.scores : [bands.correctMinScore];
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return { text: group.text, verdict: mean >= bands.correctMinScore ? "good" : "almost" };
  });

  const merged: PronunciationFragment[] = [];
  for (const fragment of marked) {
    const last = merged[merged.length - 1];
    if (last && last.verdict === fragment.verdict) last.text += fragment.text;
    else merged.push({ ...fragment });
  }
  while (merged.length > 6) {
    let idx = 0;
    let bestLength = Infinity;
    for (let i = 0; i + 1 < merged.length; i += 1) {
      const length = merged[i]!.text.length + merged[i + 1]!.text.length;
      if (length < bestLength) {
        bestLength = length;
        idx = i;
      }
    }
    const first = merged[idx]!;
    const second = merged[idx + 1]!;
    merged.splice(idx, 2, {
      text: first.text + second.text,
      verdict: first.verdict === "almost" || second.verdict === "almost" ? "almost" : "good",
    });
  }
  return merged;
}
