"use client";
import { useEffect, useState } from "react";
import { messages, MockTestReportDtoSchema, type MockTestReportDto } from "@learning/contracts";
import { mockTestResultBadgeClass, mockTestResultBadgeLabel, mockTestScoreTone } from "@learning/kid-ui";
import { callParent, errorMessage, parentClient } from "./api";
import { groupMockReportWords, type MockReportWord } from "./mock-report-words";
import { ParentIcon } from "./ParentIcon";

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
    void callParent(() => parentClient.mockTests.list({ childId, deckId }))
      .then(result => { const data = MockTestReportDtoSchema.array().parse(result.body); if (!cancelled) { setReports(data); setSelected(data[0]?.sessionId ?? ""); } })
      .catch(cause => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [childId, deckId]);
  const report = reports.find(r => r.sessionId === selected);
  const grouped = report ? groupMockReportWords(report.rows) : null;
  const tone = grouped ? mockTestScoreTone(grouped.score) : "low";
  return <section className="pp-card" aria-label={messages.progress.mockTestsTitle}>
    <h3 className="pp-card-title">
      <ParentIcon name="clipboard-check" />
      {messages.progress.mockTestsTitle}
      {!!reports.length && <span className="pp-mock-select"><select data-testid="mock-report-select" aria-label={messages.progress.mockTestsRecent} value={selected} onChange={e => setSelected(e.target.value)}>{reports.map(r => <option key={r.sessionId} value={r.sessionId}>{new Date(r.startedAt).toLocaleString("pl-PL")} — {r.deckTitle}</option>)}</select></span>}
    </h3>
    {error && <p role="alert" className="pp-error">{error}</p>}
    {!reports.length && !error && <p>{messages.progress.mockTestsEmpty}</p>}
    {report && grouped && <div data-testid="mock-parent-report">
      <div className="pp-mock-head">
        {grouped.score.total > 0 && <div className="pp-mock-score" data-testid="mock-report-score" data-tone={tone}>
          <span className="pp-mock-big">{fill(messages.kid.mockTestScore, { correct: grouped.score.correct, total: grouped.score.total, percent: grouped.score.percent })}</span>
          <span className="pp-mock-stars" role="img" aria-label={fill(messages.kid.mockTestStarsLabel, { n: grouped.score.stars })}>{"★".repeat(grouped.score.stars)}{"☆".repeat(6 - grouped.score.stars)}</span>
        </div>}
      </div>
      <p className="pp-mock-meta">
        {fill(messages.progress.mockTestVersion, { n: report.deckVersionNumber })}
        {" · "}{fill(messages.progress.mockTestPortion, { actual: report.taskBudget, requested: report.requestedTaskCount })}
        {" · "}{report.complete ? messages.progress.mockTestComplete : messages.progress.mockTestPartial}
      </p>
      {currentDeckVersionId && report.deckVersionId !== currentDeckVersionId && <p className="pp-mock-meta pp-mock-old">{messages.progress.mockTestOldVersion}</p>}
      <ul className="pp-plain pp-mock-words">{grouped.words.map(word => {
        const line = parentLine(word);
        return <li className={`pp-mock-word pp-mock-word--${word.status}`} key={word.itemId} data-testid="mock-report-word" data-status={word.status}>
          <span className={`pp-mock-ico ${word.status === "correct" ? "pp-mock-ico-ok" : word.status === "incorrect" ? "pp-mock-ico-bad" : "pp-mock-ico-neutral"}`} aria-hidden="true">
            <ParentIcon name={word.status === "correct" ? "check" : word.status === "incorrect" ? "x" : "minus"} />
          </span>
          <span className="pp-mock-body">
            <span className="pp-mock-pair">{word.source} → <strong>{word.target}</strong></span>
            {word.detail.type === "label" && <span className="pp-mock-detail">
              <span className="pp-chip pp-chip-gray">{word.detail.label === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</span>
            </span>}
            {word.detail.type === "perSkill" && <span className="pp-mock-detail">
              {word.results.map(result => <span className={mockTestResultBadgeClass(result)} key={result.skill}>{mockTestResultBadgeLabel(result)}</span>)}
            </span>}
            {line && <span className="pp-hist-meta">{line}</span>}
          </span>
        </li>;
      })}</ul>
      <ul className="plain">{report.skills.map(skill => <li key={skill.skill} data-testid={`mock-report-${skill.skill}`}>
        <strong>{messages.progress.skills[skill.skill]}</strong>: {fill(messages.progress.mockTestCounts, { correct: skill.independentCorrect, total: skill.totalItems, practice: skill.practiceNeeded, missing: skill.notTested })}
        {skill.correctNotIndependent > 0 && <p>{fill(messages.progress.mockTestSupported, { n: skill.correctNotIndependent })}</p>}
        <p className="muted">{fill(messages.progress.mockTestSkipped, { n: skill.skipped, unassessed: skill.unassessed })}</p>
      </li>)}</ul>
      {grouped.gaps.length > 0 && <p className="muted" data-testid="mock-report-gaps">{fill(messages.progress.mockTestGaps, {
        reasons: grouped.gaps.map(gap => `${messages.progress.mockTestReason[gap.reason] ?? gap.reason}: ${gap.count}`).join(", "),
      })}</p>}
      <p className="pp-note"><ParentIcon name="info" />{messages.progress.mockTestNote}</p>
    </div>}
  </section>;
}
