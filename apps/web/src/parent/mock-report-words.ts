import type { MockTestReportRow, SkillStatus, TestGoal } from "@learning/contracts";
import {
  computeMockTestScore,
  mockTestSolutionDetail,
  mockTestWordStatus,
  type MockTestResultView,
  type MockTestScore,
  type MockTestSolutionDetail,
  type MockTestWordStatus,
} from "@learning/kid-ui";

/** Jedno słowo omówienia w raporcie rodzica: wiersze z porcji tej próby
 * plus informacje, które rodzic powinien widzieć, a dziecko nie. */
export interface MockReportWord {
  itemId: string;
  source: string;
  target: string;
  rows: MockTestReportRow[];
  results: MockTestResultView[];
  status: MockTestWordStatus;
  detail: MockTestSolutionDetail;
  masteryUniform: SkillStatus | null;
  masteryMixed: { skill: TestGoal; status: SkillStatus }[] | null;
  notIndependent: { reason: MockTestReportRow["independenceReason"] } | null;
  reasons: { skill: TestGoal | null; reason: string }[];
}

/** Wiersz należy do porcji, gdy umiejętność sprawdzono albo zadanie wydano
 * i przerwano; `outside_portion`, `not_known` i `missing_audio` to słowa,
 * których dziecko w tej próbie nie widziało. */
function rowInPortion(row: MockTestReportRow): boolean {
  return row.outcome !== "not_tested" || row.reason === "interrupted";
}

/** Grupuje wiersze raportu (cały scope × umiejętności) w słowa z porcji.
 * Wynik liczony jest tym samym przepisem co w omówieniu dziecka, więc
 * nagłówki obu widoków są zgodne dla tej samej próby. */
export function groupMockReportWords(rows: MockTestReportRow[]): { words: MockReportWord[]; score: MockTestScore } {
  const words: MockReportWord[] = [];
  const byItem = new Map<string, MockReportWord>();
  for (const row of rows) {
    if (!rowInPortion(row)) continue;
    let word = byItem.get(row.itemId);
    if (!word) {
      word = {
        itemId: row.itemId,
        source: row.source,
        target: row.target,
        rows: [],
        results: [],
        status: "notAssessed",
        detail: { type: "none" },
        masteryUniform: null,
        masteryMixed: null,
        notIndependent: null,
        reasons: [],
      };
      byItem.set(row.itemId, word);
      words.push(word);
    }
    word.rows.push(row);
    word.results.push({ skill: row.skill, outcome: row.outcome });
  }
  for (const word of words) {
    word.status = mockTestWordStatus(word.results);
    word.detail = mockTestSolutionDetail(word.results);
    const statuses = word.rows.map(r => r.masteryStatus);
    if (statuses.every(s => s === statuses[0])) word.masteryUniform = statuses[0]!;
    else word.masteryMixed = word.rows.map(r => ({ skill: r.skill, status: r.masteryStatus }));
    // bez potwierdzonej samodzielności sygnalizujemy tylko przy poprawnej
    // odpowiedzi — pomyłka jest pomyłką niezależnie od wsparcia
    const misleading = word.rows.find(r => r.outcome === "correct" && !r.independent);
    if (misleading) word.notIndependent = { reason: misleading.independenceReason };
    const withReason = word.rows.filter(r => r.reason !== null && r.reason !== "skipped");
    const uniformReason = withReason.length === word.rows.length && new Set(withReason.map(r => r.reason)).size === 1;
    word.reasons = uniformReason
      ? [{ skill: null, reason: withReason[0]!.reason! }]
      : withReason.map(r => ({ skill: r.skill, reason: r.reason! }));
  }
  return { words, score: computeMockTestScore(words.map(w => ({ results: w.results }))) };
}
