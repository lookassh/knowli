import type { AnswerKey } from "./types";
import { type AlignStep, alignCodePoints } from "./text-distance";

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
  // toLowerCase potrafi zmienić liczbę punktów kodowych (np. „İ” → „i̇”), co rozjechałoby
  // indeksy alignmentu z oryginalnymi znakami — taka odpowiedź/wariant nie dostaje diagnozy
  const casefoldStable = (text: string): boolean => [...text.toLowerCase()].length === [...text].length;
  if (!casefoldStable(given) || candidates.some((candidate) => !casefoldStable(candidate))) {
    return null;
  }
  const threshold = Math.min(...candidates.map((candidate) => [...candidate].length)) <= 4 ? 1 : 2;
  let best: { variant: string; distance: number; steps: AlignStep[] } = { variant: candidates[0], ...alignCodePoints(given, candidates[0]) };
  for (const variant of candidates.slice(1)) {
    const result = alignCodePoints(given, variant);
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

  // „Prawie! Uzupełnij brakujące litery” — wpisany zapis nie zawiera żadnej
  // błędnej litery, a brakuje co najwyżej jednej dziury (urwany początek/koniec
  // albo litera w środku) bądź obu końców naraz (wpisany środek słowa).
  // Braki rozproszone (dwie i więcej dziur w środku) pozostają poza diagnozą.
  const missingChunks = expectedSegments.filter((segment) => segment.state === "pill").length;
  const missingBothEnds =
    missingChunks === 2 &&
    expectedSegments[0].state === "pill" &&
    expectedSegments[expectedSegments.length - 1].state === "pill";

  const isLetterOmissionOnly =
    givenSegments.length > 0 &&
    givenSegments.every((segment) => segment.state === "plain") &&
    (missingChunks === 1 || missingBothEnds) &&
    givenChars.length >= 2 &&
    (givenChars.length >= 3 || givenChars.length >= Math.ceil(variantChars.length * 0.5));

  const withinThreshold = best.distance <= threshold || isLetterOmissionOnly;

  return {
    variant: best.variant,
    distance: best.distance,
    withinThreshold,
    capitalizationHint,
    given: givenSegments,
    expected: expectedSegments,
  };
}
