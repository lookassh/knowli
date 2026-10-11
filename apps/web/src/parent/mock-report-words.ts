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

/** Wiersz należy do porcji, gdy umiejętność sprawdzono albo slot zaplanowano
 * w porcji (niezależnie, czy zdążyło powstać zadanie). `outside_portion`,
 * `not_known`, `missing_audio` i `insufficient_options` to słowa, których
 * dziecko w tej próbie nie widziało. */
function rowInPortion(row: MockTestReportRow): boolean {
  return row.outcome !== "not_tested" || row.reason === "interrupted";
}

/** Priorytet przyczyny braku dla słowa poza porcją: przyczyny inherentne
 * (materiał niepoznany, brak nagrania, brak opcji) ważniejsze niż wyczerpany
 * budżet porcji. */
const GAP_REASON_PRIORITY = ["not_known", "missing_audio", "insufficient_options", "outside_portion"] as const;

export interface MockReportGap { reason: string; count: number }

/** Grupuje wiersze raportu (cały scope × umiejętności) w słowa z porcji —
 * zaplanowanej przez serwer, więc po próbie przerwanej obejmuje też słowa,
 * których omówienie dziecka nie pokazało (zadania powstają na żądanie).
 * Zdanie słowa i wynik liczone tym samym przepisem co u dziecka, więc dla
 * ukończonej próby nagłówki obu widoków są równe; `gaps` agreguje przyczyny
 * braków słów poza porcją (per słowo, nie per wiersz umiejętności). */
export function groupMockReportWords(rows: MockTestReportRow[]): { words: MockReportWord[]; score: MockTestScore; gaps: MockReportGap[] } {
  const words: MockReportWord[] = [];
  const byItem = new Map<string, MockReportWord>();
  const gapRows = new Map<string, string[]>();
  for (const row of rows) {
    if (!rowInPortion(row)) {
      const reasons = gapRows.get(row.itemId) ?? [];
      if (row.reason) reasons.push(row.reason);
      gapRows.set(row.itemId, reasons);
      continue;
    }
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
    // samodzielność pokazujemy przy ocenionych odpowiedziach; gdy brakuje jej
    // kilku wierszom, decyduje poprawna odpowiedź — to ona może mylić rodzica
    const flagged = word.rows.find(r => r.outcome === "correct" && !r.independent)
      ?? word.rows.find(r => r.outcome === "incorrect" && !r.independent);
    if (flagged) word.notIndependent = { reason: flagged.independenceReason };
    const withReason = word.rows.filter(r => r.reason !== null && r.reason !== "skipped");
    const uniformReason = withReason.length === word.rows.length && new Set(withReason.map(r => r.reason)).size === 1;
    word.reasons = uniformReason
      ? [{ skill: null, reason: withReason[0]!.reason! }]
      : withReason.map(r => ({ skill: r.skill, reason: r.reason! }));
  }
  const gapCounts = new Map<string, number>();
  for (const reasons of gapRows.values()) {
    const primary = GAP_REASON_PRIORITY.find(priority => reasons.includes(priority));
    if (primary) gapCounts.set(primary, (gapCounts.get(primary) ?? 0) + 1);
  }
  const gaps = GAP_REASON_PRIORITY
    .map(reason => ({ reason, count: gapCounts.get(reason) ?? 0 }))
    .filter(gap => gap.count > 0);
  return { words, score: computeMockTestScore(words.map(w => ({ results: w.results }))), gaps };
}
