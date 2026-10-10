import { messages, type MockTestOutcome, type MockTestSummaryDto, type TestGoal } from "@learning/contracts";

export type MockTestWordStatus = "correct" | "incorrect" | "notAssessed";

export const MOCK_TEST_SOLUTION_ICONS: Record<MockTestWordStatus, string> = { correct: "✓", incorrect: "✗", notAssessed: "–" };

export interface MockTestScore {
  correct: number;
  total: number;
  percent: number;
  /** 0–6: gwiazdka za każde 1/6 drogi (100%/6 ≈ 16,7%). */
  stars: number;
}

type Results = MockTestSummaryDto["solutions"][number]["results"];

/** Pojedynczy wynik per umiejętność — kształt współdzielony przez omówienie
 * dziecka i raport rodzica (wiersze raportu mają te same pola). */
export type MockTestResultView = { skill: TestGoal; outcome: MockTestOutcome };

/** Słowo jest zaliczone, gdy wszystkie sprawdzone umiejętności są poprawne;
 * pominięte i niesprawdzone wyniki nie są błędem wiedzy. */
export function mockTestWordStatus(results: Results): MockTestWordStatus {
  const assessed = results.filter(r => r.outcome === "correct" || r.outcome === "incorrect");
  if (assessed.length === 0) return "notAssessed";
  return assessed.every(r => r.outcome === "correct") ? "correct" : "incorrect";
}

export function computeMockTestScore(solutions: ReadonlyArray<{ results: Results }>): MockTestScore {
  const total = solutions.length;
  const correct = solutions.filter(s => mockTestWordStatus(s.results) === "correct").length;
  return {
    correct,
    total,
    percent: total === 0 ? 0 : Math.round((correct * 100) / total),
    // liczymy z całkowitego ułamka, nie z zaokrąglonego procentu: 5/6 słów
    // osiąga próg piątej gwiazdki dokładnie, a float po zaokrągleniu gubiłby tę granicę
    stars: total === 0 ? 0 : Math.min(6, Math.floor((correct * 6) / total)),
  };
}

/** Decyzja o drugiej linii wiersza słowa (pastylki): jednolity wynik oceniony
 * mówi o sobie kolorem i ikoną wiersza; szczegół pokazujemy tylko przy wynikach
 * mieszanych albo gdy słowa nie sprawdzono. */
export type MockTestSolutionDetail =
  | { type: "none" }
  | { type: "label"; label: "skipped" | "notTested" }
  | { type: "perSkill" };

export function mockTestSolutionDetail(results: Results): MockTestSolutionDetail {
  if (results.length === 0) return { type: "none" };
  const first = results[0]!.outcome;
  if (!results.every(r => r.outcome === first)) return { type: "perSkill" };
  if (first === "correct" || first === "incorrect") return { type: "none" };
  return { type: "label", label: first === "skipped" ? "skipped" : "notTested" };
}

export function mockTestResultBadgeLabel(result: MockTestResultView): string {
  const skill = messages.kid.mockTestSkill[result.skill];
  if (result.outcome === "correct") return `${skill} ✓`;
  if (result.outcome === "incorrect") return `${skill} ✗`;
  return `${skill}: ${result.outcome === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}`;
}

export function mockTestResultBadgeClass(result: MockTestResultView): string {
  if (result.outcome === "correct") return "kid-mock-badge kid-mock-badge--correct";
  if (result.outcome === "incorrect") return "kid-mock-badge kid-mock-badge--incorrect";
  return "kid-mock-badge";
}
