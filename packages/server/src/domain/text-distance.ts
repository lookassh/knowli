/**
 * Odległość edycyjna na punktach kodowych (wydzielona ze `spelling-diff.ts`,
 * bez zmiany zachowania). Restricted Damerau–Levenshtein: podstawienie,
 * wstawienie, usunięcie i przestawienie pary SĄSIEDNICH jednostek liczą się po
 * 1. Porównanie jest na punktach kodowych (`[...text]`, nie jednostkach UTF-16)
 * i bez rozróżniania wielkości liter (`toLowerCase`), tak jak w pisowni.
 *
 * Reużywana przez `spelling-diff.ts` (diagnoza liter) i `lessons/evaluate.ts`
 * (tolerancja drobnej literówki). Odpowiedzi i warianty to krótkie słowa, więc
 * pełna macierz O(n·m) jest wystarczająca.
 */

/** Jeden krok alignmentu; indeksy `a`/`b` liczone w punktach kodowych. */
export type AlignStep =
  | { op: "match"; a: number; b: number }
  | { op: "substitute"; a: number; b: number }
  | { op: "delete"; a: number }
  | { op: "insert"; b: number }
  | { op: "transpose"; a: number; b: number };

/** Wynik wyrównania: odległość i odczytana ścieżka kroków od lewej do prawej. */
export interface Alignment {
  distance: number;
  steps: AlignStep[];
}

/**
 * Wyrównuje `a` do `b` (restricted Damerau–Levenshtein) i zwraca odległość oraz
 * ścieżkę kroków. Porównanie na punktach kodowych, wielkość liter ignorowana.
 */
export function alignCodePoints(a: string, b: string): Alignment {
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
  const steps: AlignStep[] = [];
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

/** Sama odległość edycyjna (bez alignmentu), gdy ścieżka kroków nie jest potrzebna. */
export function editDistance(a: string, b: string): number {
  return alignCodePoints(a, b).distance;
}
