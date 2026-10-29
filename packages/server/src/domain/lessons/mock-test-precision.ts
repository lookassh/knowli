/**
 * Raport kartkówki przedmiotu szkolnego z wymiarem precyzji (design §8).
 * Czyste reguły nad szczegółami ocen (`assessments.details`) — bez bazy.
 */

/** Szczegóły oceny odpowiedzi otwartej szkoły czytane przez raport. */
export interface MockAnswerDetails {
  readonly knowledge?: unknown;
  readonly precision?: unknown;
  readonly formOk?: unknown;
  readonly missingElementTexts?: unknown;
  readonly missingElementIds?: unknown;
  /** Pary pomylonych pojęć (werdykt v3, design §9.4). */
  readonly confusedConcepts?: unknown;
}

export interface SchoolMockAggregate {
  knowledge: { correct: number; partial: number; incorrect: number };
  precision: { concise: number; verbose: number; unfocused: number };
  formViolations: number;
  missingElements: { text: string; count: number }[];
  /** Pomylone pojęcia; pole tylko przy co najmniej jednej parze (raporty sprzed Etapu 6 go nie mają). */
  confusions?: ConfusionCount[];
}

export interface ConfusionCount {
  said: string;
  meant: string;
  count: number;
}

/**
 * Zlicza pary pomylonych pojęć z ocen (bez wielkości liter; zapis z pierwszego
 * wystąpienia), malejąco po liczbie, potem alfabetycznie; najwyżej `limit`.
 */
export function countConfusions(answers: readonly MockAnswerDetails[], limit: number): ConfusionCount[] {
  const counts = new Map<string, ConfusionCount>();
  for (const details of answers) {
    if (!Array.isArray(details.confusedConcepts)) continue;
    for (const raw of details.confusedConcepts as unknown[]) {
      const pair = raw as { said?: unknown; meant?: unknown } | null;
      if (typeof pair?.said !== "string" || typeof pair.meant !== "string") continue;
      const key = `${pair.said.toLocaleLowerCase("pl-PL")}|${pair.meant.toLocaleLowerCase("pl-PL")}`;
      const entry = counts.get(key) ?? { said: pair.said, meant: pair.meant, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.said.localeCompare(b.said, "pl") || a.meant.localeCompare(b.meant, "pl"))
    .slice(0, limit);
}

const MAX_MOCK_CONFUSIONS = 3;

const KNOWLEDGE = ["correct", "partial", "incorrect"] as const;
const PRECISION = ["concise", "verbose", "unfocused"] as const;
const MAX_MISSING = 5;

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * Agregat szkolny zagadnienia z ocen jego odpowiedzi otwartych. Ocena bez
 * wymiaru wiedzy (zamknięte typy, „nieocenione”) się nie liczy; brak takich
 * ocen → `null` (pole raportu pominięte).
 */
export function schoolMockAggregate(answers: readonly MockAnswerDetails[]): SchoolMockAggregate | null {
  const graded = answers.filter((details) => isOneOf(details.knowledge, KNOWLEDGE));
  if (graded.length === 0) return null;
  const aggregate: SchoolMockAggregate = {
    knowledge: { correct: 0, partial: 0, incorrect: 0 },
    precision: { concise: 0, verbose: 0, unfocused: 0 },
    formViolations: 0,
    missingElements: [],
  };
  const missing = new Map<string, number>();
  for (const details of graded) {
    aggregate.knowledge[details.knowledge as (typeof KNOWLEDGE)[number]] += 1;
    if (isOneOf(details.precision, PRECISION)) aggregate.precision[details.precision] += 1;
    if (details.formOk === false) aggregate.formViolations += 1;
    if (Array.isArray(details.missingElementTexts)) {
      for (const text of details.missingElementTexts) {
        if (typeof text === "string" && text.trim() !== "") missing.set(text, (missing.get(text) ?? 0) + 1);
      }
    }
  }
  aggregate.missingElements = [...missing]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "pl"))
    .slice(0, MAX_MISSING);
  const confusions = countConfusions(graded, MAX_MOCK_CONFUSIONS);
  if (confusions.length > 0) aggregate.confusions = confusions;
  return aggregate;
}

/** Rodzaj wskazówki precyzji w omówieniu dziecka (tekst dobiera katalog komunikatów). */
export type MockPrecisionHint = "shorter" | "focus" | "missing";

/**
 * Jedna wskazówka do rozwiązania (design §8.2): niepełna wiedza z brakującym
 * elementem → brak informacji; poprawna, ale nie na temat → trzymaj się
 * pytania; poprawna, ale rozwlekła albo w więcej niż jednym zdaniu → krócej.
 * Częściowa ocena bez braków (komplet elementów plus błędne stwierdzenie) nie
 * dostaje wskazówki o brakach — byłaby nieprawdziwa. Inaczej brak.
 */
export function mockPrecisionHint(details: MockAnswerDetails): MockPrecisionHint | null {
  if (details.knowledge === "partial") {
    const missing = Array.isArray(details.missingElementIds) && details.missingElementIds.length > 0;
    return missing ? "missing" : null;
  }
  if (details.knowledge !== "correct") return null;
  if (details.precision === "unfocused") return "focus";
  if (details.precision === "verbose" || details.formOk === false) return "shorter";
  return null;
}

/** Wynik rozwiązania w omówieniu wraz z oceną, z której liczymy „Warto powtórzyć”. */
export interface MockSolutionOutcome {
  readonly objectiveId: string;
  readonly outcome: "correct" | "incorrect" | "skipped" | "unassessed";
  readonly knowledge?: unknown;
}

const MAX_REVIEW_OBJECTIVES = 8;

/**
 * „Warto powtórzyć” (design §8.3): zagadnienia z co najmniej jedną odpowiedzią
 * błędną, niepełną albo pominiętą, w kolejności tematu. „Nieocenione” (np.
 * awaria gradera) nie jest powodem do powtórki.
 */
export function objectivesWorthReviewing(
  solutions: readonly MockSolutionOutcome[],
  objectiveOrder: readonly string[],
): string[] {
  const flagged = new Set(solutions
    .filter((solution) => solution.outcome === "incorrect" || solution.outcome === "skipped" || solution.knowledge === "partial")
    .map((solution) => solution.objectiveId));
  const ordered = objectiveOrder.filter((id) => flagged.has(id));
  const rest = [...flagged].filter((id) => !objectiveOrder.includes(id));
  return [...ordered, ...rest].slice(0, MAX_REVIEW_OBJECTIVES);
}
