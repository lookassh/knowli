"use client";
import { useEffect, useState } from "react";
import { messages, MockTestReportDtoSchema, type MockTestReportDto } from "@learning/contracts";
import { MOCK_TEST_SOLUTION_ICONS, mockTestResultBadgeClass, mockTestResultBadgeLabel, mockTestScoreTone } from "@learning/kid-ui";
import "@learning/kid-ui/styles.css";
import { apiFetch, errorMessage } from "./api";
import { groupMockReportWords, type MockReportWord } from "./mock-report-words";

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** Szara linia pod słowem: informacje, które rodzic powinien widzieć,
 * a dziecko nie — opanowanie, samodzielność ocenionych odpowiedzi, powód wyniku. */
function parentLine(word: MockReportWord): string {
  const parts: string[] = [];
  // jednolite „Nie sprawdzono" dublowałoby etykietę wiersza — status
  // opanowania ma sens tylko dla słów, które ta próba oceniła
  if (word.masteryUniform && word.masteryUniform !== "not_assessed") {
    parts.push(fill(messages.progress.mockTestMasteryLine, { status: messages.progress.itemStatus[word.masteryUniform] }));
  } else if (word.masteryMixed) {
    const statuses = word.masteryMixed.map(m => `${messages.kid.mockTestSkill[m.skill]} — ${messages.progress.itemStatus[m.status]}`).join(", ");
    parts.push(fill(messages.progress.mockTestMasteryLine, { status: statuses }));
  }
  if (word.notIndependent) {
    const reason = word.notIndependent.reason ? messages.progress.mockTestReason[word.notIndependent.reason] : undefined;
    parts.push(reason ? `${messages.progress.mockTestNotIndependent} (${reason})` : messages.progress.mockTestNotIndependent);
  }
  parts.push(...word.reasons.map(r => {
    const label = messages.progress.mockTestReason[r.reason] ?? r.reason;
    return r.skill ? `${messages.kid.mockTestSkill[r.skill]}: ${label}` : label;
  }));
  return parts.join(" · ");
}

export default function MockTestReportPanel({ childId, deckId, currentDeckVersionId }: { childId: string; deckId: string; currentDeckVersionId?: string | null }) {
  const [reports, setReports] = useState<MockTestReportDto[]>([]), [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReports([]); setSelected(""); setError(null);
    if (!childId || !deckId) return;
    void apiFetch<unknown>("GET", `/api/v1/parent/mock-tests?childId=${childId}&deckId=${deckId}`)
      .then(raw => { const data = MockTestReportDtoSchema.array().parse(raw); if (!cancelled) { setReports(data); setSelected(data[0]?.sessionId ?? ""); } })
      .catch(cause => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [childId, deckId]);
  const report = reports.find(r => r.sessionId === selected);
  const grouped = report ? groupMockReportWords(report.rows) : null;
  const tone = grouped ? mockTestScoreTone(grouped.score) : "low";
  return <section className="card" aria-label={messages.progress.mockTestsTitle}>
    <h3>{messages.progress.mockTestsTitle}</h3>
    {error && <p role="alert" className="error">{error}</p>}
    {!reports.length && !error && <p>{messages.progress.mockTestsEmpty}</p>}
    {!!reports.length && <label>{messages.progress.mockTestsRecent}
      <select data-testid="mock-report-select" value={selected} onChange={e => setSelected(e.target.value)}>{reports.map(r => <option key={r.sessionId} value={r.sessionId}>{new Date(r.startedAt).toLocaleString("pl-PL")} — {r.deckTitle}</option>)}</select>
    </label>}
    {report && grouped && <div data-testid="mock-parent-report">
      <p>{fill(messages.progress.mockTestVersion, { n: report.deckVersionNumber })}</p>
      {currentDeckVersionId && report.deckVersionId !== currentDeckVersionId && <p>{messages.progress.mockTestOldVersion}</p>}
      <p>{report.testDate ? `${messages.progress.testDate}: ${report.testDate}` : messages.progress.noTestDate}</p>
      <p>{fill(messages.progress.mockTestPortion, { actual: report.taskBudget, requested: report.requestedTaskCount })}</p>
      <p>{report.complete ? messages.progress.mockTestComplete : messages.progress.mockTestPartial}</p>
      {grouped.score.total > 0 && <div className="kid-mock-score" data-testid="mock-report-score" data-tone={tone}>
        <p className="kid-mock-score__value">{fill(messages.kid.mockTestScore, { correct: grouped.score.correct, total: grouped.score.total, percent: grouped.score.percent })}</p>
        <p className="kid-mock-score__stars" role="img" aria-label={fill(messages.kid.mockTestStarsLabel, { n: grouped.score.stars })}>{"★".repeat(grouped.score.stars)}{"☆".repeat(6 - grouped.score.stars)}</p>
      </div>}
      <ul className="kid-mock-list">{grouped.words.map(word => {
        const line = parentLine(word);
        return <li className={`kid-mock-row kid-mock-row--${word.status}`} key={word.itemId} data-testid="mock-report-word" data-status={word.status}>
          <span className="kid-mock-row__icon" aria-hidden="true">{MOCK_TEST_SOLUTION_ICONS[word.status]}</span>
          <div className="kid-mock-row__body">
            <p className="kid-mock-row__words">{word.source} → <strong>{word.target}</strong></p>
            {word.detail.type === "label" && <p className="kid-mock-row__detail">
              <span className="kid-mock-badge">{word.detail.label === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</span>
            </p>}
            {word.detail.type === "perSkill" && <p className="kid-mock-row__detail">
              {word.results.map(result => <span className={mockTestResultBadgeClass(result)} key={result.skill}>{mockTestResultBadgeLabel(result)}</span>)}
            </p>}
            {line && <p className="muted">{line}</p>}
          </div>
        </li>;
      })}</ul>
      <ul className="plain">{report.skills.map(skill => <li key={skill.skill} data-testid={`mock-report-${skill.skill}`}>
        <strong>{messages.progress.skills[skill.skill]}</strong>: {fill(messages.progress.mockTestCounts, { correct: skill.independentCorrect, total: skill.totalItems, practice: skill.practiceNeeded, missing: skill.notTested })}
        {skill.correctNotIndependent > 0 && <p>{fill(messages.progress.mockTestSupported, { n: skill.correctNotIndependent })}</p>}
        <p className="muted">{fill(messages.progress.mockTestSkipped, { n: skill.skipped, unassessed: skill.unassessed })}</p>
      </li>)}</ul>
      {grouped.gaps.length > 0 && <p className="muted" data-testid="mock-report-gaps">{fill(messages.progress.mockTestGaps, {
        reasons: grouped.gaps.map(gap => `${messages.progress.mockTestReason[gap.reason] ?? gap.reason} ${gap.count}`).join(", "),
      })}</p>}
      <p className="muted">{messages.progress.mockTestNote}</p>
    </div>}
  </section>;
}
