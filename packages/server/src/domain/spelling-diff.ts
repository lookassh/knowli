import type { AnswerKey } from "./types";

/** Fragment zapisu w porównaniu pisowni; `pill` = różnica do wyróżnienia (issue #9). */
export interface SpellingDiffSegment {
  text: string;
  state: "plain" | "pill";
}

/** Porównanie odpowiedzi z jednym zatwierdzonym wariantem (SPEC §12.8, design 2026-10-12). */
export interface SpellingComparison {
  /** Wariant, do którego dopasowano odpowiedź (najbliższy edycyjnie). */
  variant: string;
  /** Odległość Damerau–Levenshteina bez rozróżniania wielkości liter. */
  distance: number;
  /** Czy odległość mieści się w progu diagnozy liter. */
  withinThreshold: boolean;
  /** Różnica wielkości liter w obrębie zgodnych pozycji. */
  capitalizationHint: boolean;
  given: SpellingDiffSegment[];
  expected: SpellingDiffSegment[];
}

type Step =
  | { op: "match"; a: number; b: number }
  | { op: "substitute"; a: number; b: number }
  | { op: "delete"; a: number }
  | { op: "insert"; b: number }
  | { op: "transpose"; a: number; b: number };

/**
 * Odległość Damerau–Levenshtein (restricted: przestawienia pary sąsiednich
 * liter) z odczytem alignmentu. Odpowiedź i warianty to krótkie pojedyncze
 * słowa, więc pełna macierz O(n·m) jest wystarczająca.
 */
function align(a: string, b: string): { distance: number; steps: Step[] } {
  const x = [...a.toLowerCase()];
  const y = [...b.toLowerCase()];
  const n = x.length;
  const m = y.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      steps.push({ op: "transpose", a: i - 2, b: j - 2 });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)) {
      steps.push({ op: x[i - 1] === y[j - 1] ? "match" : "substitute", a: i - 1, b: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      steps.push({ op: "delete", a: i - 1 });
      i -= 1;
    } else {
      steps.push({ op: "insert", b: j - 1 });
      j -= 1;
    }
  }
  steps.reverse();
  return { distance: d[n][m], steps };
}

function pushSegment(segments: SpellingDiffSegment[], text: string, pill: boolean): void {
  const state = pill ? "pill" : "plain";
  const last = segments[segments.length - 1];
  if (last !== undefined && last.state === state) {
    last.text += text;
  } else {
    segments.push({ text, state });
  }
}

/**
 * Porównuje odpowiedź dziecka z najbliższym zatwierdzonym wariantem klucza.
 * Diagnoza liter jest komunikatem, nigdy podstawą oceny: podobieństwo tekstu
 * nie zalicza znaczenia (A16). Zwraca null dla pustej odpowiedzi.
 */
export function compareSpelling(answer: string, key: AnswerKey): SpellingComparison | null {
  const given = answer.normalize("NFC").trim();
  if (given === "") {
    return null;
  }
  const candidates = [key.target, ...key.acceptedAnswers]
    .map((candidate) => candidate.normalize("NFC").trim())
    .filter((candidate) => candidate !== "");
  if (candidates.length === 0) {
    return null;
  }
  const threshold = Math.min(...candidates.map((candidate) => [...candidate].length)) <= 4 ? 1 : 2;
  let best: { variant: string; distance: number; steps: Step[] } = { variant: candidates[0], ...align(given, candidates[0]) };
  for (const variant of candidates.slice(1)) {
    const result = align(given, variant);
    if (result.distance < best.distance) {
      best = { variant, ...result };
    }
  }

  let capitalizationHint = false;
  const givenSegments: SpellingDiffSegment[] = [];
  const expectedSegments: SpellingDiffSegment[] = [];
  const givenChars = [...given];
  const variantChars = [...best.variant];
  for (const step of best.steps) {
    switch (step.op) {
      case "match": {
        capitalizationHint ||= givenChars[step.a] !== variantChars[step.b];
        pushSegment(givenSegments, givenChars[step.a], false);
        pushSegment(expectedSegments, variantChars[step.b], false);
        break;
      }
      case "substitute": {
        pushSegment(givenSegments, givenChars[step.a], true);
        pushSegment(expectedSegments, variantChars[step.b], true);
        break;
      }
      case "delete": {
        pushSegment(givenSegments, givenChars[step.a], true);
        break;
      }
      case "insert": {
        pushSegment(expectedSegments, variantChars[step.b], true);
        break;
      }
      case "transpose": {
        pushSegment(givenSegments, givenChars[step.a] + givenChars[step.a + 1], true);
        pushSegment(expectedSegments, variantChars[step.b] + variantChars[step.b + 1], true);
        break;
      }
    }
  }
  return {
    variant: best.variant,
    distance: best.distance,
    withinThreshold: best.distance <= threshold,
    capitalizationHint,
    given: givenSegments,
    expected: expectedSegments,
  };
}
