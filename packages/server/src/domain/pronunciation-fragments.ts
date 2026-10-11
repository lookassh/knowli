/**
 * Fragmenty wymowy dla dziecka (design 2026-10-09): fonemy Azure mapowane na
 * grupy liter słowa docelowego, z werdyktem good/almost z pasm dziecka.
 * Wyłącznie wizualne — o ocenie umiejętności decyduje score całej wypowiedzi.
 * Bez liczb i IPA w DTO dziecka (SPEC §7).
 */

export interface PronunciationFragment {
  text: string;
  verdict: "good" | "almost" | "unknown";
}

export interface FragmentInput {
  text: string;
  errorType: string | null;
  phonemes: Array<{ phoneme: string; accuracyScore: number | null }>;
}

const VOWEL_LETTERS = new Set(["a", "e", "i", "o", "u", "y"]);
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
  a: ["eɪ", "æ", "ɑː", "ə"], b: ["b"], c: ["k", "s"], d: ["d"], e: ["iː", "e", "ə", "ɪ", "ɛ"],
  f: ["f"], g: ["ɡ", "dʒ"], h: ["h"], i: ["ɪ", "aɪ"], j: ["dʒ"], k: ["k"], l: ["l"],
  m: ["m"], n: ["n", "ŋ"], o: ["ɒ", "əʊ", "oʊ", "ɔː", "ə"], p: ["p"], q: ["kw"],
  r: ["r", "ɹ"], s: ["s", "z"], t: ["t"], u: ["ʌ", "uː", "juː", "ʊ", "ə", "ɜː"],
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
  return false;
}

interface AlignedGroup {
  text: string;
  scores: Array<number | null>;
}

/** Zachłanne dopasowanie grup liter do fonemów; null = brak pewnego dopasowania. */
function align(target: string, phonemes: FragmentInput["phonemes"]): AlignedGroup[] | null {
  const groups = letterGroups(target);
  const aligned: AlignedGroup[] = [];
  let p = 0;
  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]!;
    const head = phonemes[p];
    const next = phonemes[p + 1];
    const rDigraph = ["er", "ir", "ur", "ar", "or"].includes(group);
    if (rDigraph && head && next && groupMatches(group[0]!, head.phoneme) && groupMatches("r", next.phoneme)) {
      aligned.push(
        { text: group[0]!, scores: head.accuracyScore === null ? [] : [head.accuracyScore] },
        { text: "r", scores: next.accuracyScore === null ? [] : [next.accuracyScore] },
      );
      p += 2;
      continue;
    }
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
  if (phonemes.length !== p) return null;
  return aligned;
}

export function buildPronunciationFragments(
  target: string,
  word: FragmentInput | undefined,
  bands: { correctMinScore: number; partialMinScore: number },
  _overallBand: "correct" | "partial",
): PronunciationFragment[] {
  const normalized = target.trim().toLowerCase();
  const fallback: PronunciationFragment[] = [{ text: target, verdict: "unknown" }];
  const phonemes = word?.phonemes ?? [];
  if (!word || word.text.trim().toLowerCase() !== normalized || ![null, "None", "Mispronunciation"].includes(word.errorType) || phonemes.length === 0) return fallback;
  const aligned = align(normalized, phonemes);
  if (!aligned) return fallback;

  const restored = restoreOriginalText(target, aligned);
  if (!restored) return fallback;
  const marked = aligned.map<PronunciationFragment>((group, index) => {
    const text = restored[index]!;
    if (group.scores.length === 0 || group.scores.some((score) => score === null || !Number.isFinite(score))) {
      return { text, verdict: "unknown" };
    }
    const mean = group.scores.reduce<number>((sum, score) => sum + score!, 0) / group.scores.length;
    return { text, verdict: mean >= bands.correctMinScore ? "good" : "almost" };
  });

  const merged: PronunciationFragment[] = [];
  for (const fragment of marked) {
    const last = merged[merged.length - 1];
    if (last && last.verdict === fragment.verdict) last.text += fragment.text;
    else merged.push({ ...fragment });
  }
  if (merged.length > 6 || merged.map((fragment) => fragment.text).join("") !== target) return fallback;
  return merged;
}

/** Restore original case and punctuation without inventing or dropping characters. */
function restoreOriginalText(target: string, aligned: AlignedGroup[]): string[] | null {
  const result: string[] = [];
  let groupIndex = 0;
  let lettersInGroup = 0;
  let current = "";
  for (const char of target) {
    if (!/[a-z]/i.test(char)) {
      if (groupIndex < aligned.length) current += char;
      else if (result.length > 0) result[result.length - 1] += char;
      else return null;
      continue;
    }
    const group = aligned[groupIndex];
    if (!group) return null;
    current += char;
    lettersInGroup += 1;
    if (lettersInGroup === group.text.length) {
      result.push(current);
      current = "";
      lettersInGroup = 0;
      groupIndex += 1;
    }
  }
  if (groupIndex !== aligned.length || lettersInGroup !== 0 || current.length > 0) return null;
  return result;
}
