"use client";
import { useEffect, useState } from "react";
import { messages, MockTestReportDtoSchema, type MockTestReportDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
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
  return <section className="card" aria-label={messages.progress.mockTestsTitle}>
    <h3>{messages.progress.mockTestsTitle}</h3>
    {error && <p role="alert" className="error">{error}</p>}
    {!reports.length && !error && <p>{messages.progress.mockTestsEmpty}</p>}
    {!!reports.length && <label>{messages.progress.mockTestsRecent}
      <select data-testid="mock-report-select" value={selected} onChange={e => setSelected(e.target.value)}>{reports.map(r => <option key={r.sessionId} value={r.sessionId}>{new Date(r.startedAt).toLocaleString("pl-PL")} — {r.deckTitle}</option>)}</select>
    </label>}
    {report && <div data-testid="mock-parent-report">
      <p>{fill(messages.progress.mockTestVersion, { n: report.deckVersionNumber })}</p>
      {currentDeckVersionId && report.deckVersionId !== currentDeckVersionId && <p>{messages.progress.mockTestOldVersion}</p>}
      <p>{report.testDate ? `${messages.progress.testDate}: ${report.testDate}` : messages.progress.noTestDate}</p>
      <p>{fill(messages.progress.mockTestPortion, { actual: report.taskBudget, requested: report.requestedTaskCount })}</p>
      <p>{report.complete ? messages.progress.mockTestComplete : messages.progress.mockTestPartial}</p>
      <ul className="plain">{report.skills.map(skill => <li key={skill.skill} data-testid={`mock-report-${skill.skill}`}>
        <strong>{messages.progress.skills[skill.skill]}</strong>: {fill(messages.progress.mockTestCounts, { correct: skill.independentCorrect, total: skill.totalItems, practice: skill.practiceNeeded, missing: skill.notTested })}
        {skill.correctNotIndependent > 0 && <p>{fill(messages.progress.mockTestSupported, { n: skill.correctNotIndependent })}</p>}
        <p className="muted">{fill(messages.progress.mockTestSkipped, { n: skill.skipped, unassessed: skill.unassessed })}</p>
      </li>)}</ul>
      <p className="muted">{messages.progress.mockTestNote}</p>
      <ul className="plain">{report.rows.map(row => <li key={`${row.itemId}:${row.skill}`} className="card">
        <strong>{row.target}</strong> ({row.source}) — {messages.progress.skills[row.skill]}
        <p>{messages.progress.mockTestEvidence}: {messages.progress.mockTestOutcome[row.outcome]}{row.reason ? ` — ${messages.progress.mockTestReason[row.reason] ?? messages.progress.mockTestOutcome[row.outcome]}` : ""}</p>
        <p>{messages.progress.mockTestEvidenceQuality}: {row.outcome === "correct" || row.outcome === "incorrect"
          ? row.independent ? messages.progress.mockTestIndependent : messages.progress.mockTestNotIndependent
          : messages.progress.mockTestNoEvidence}
          {row.independenceReason && ` — ${messages.progress.mockTestReason[row.independenceReason]}`}
        </p>
        <p>{messages.progress.mockTestMastery}: {messages.progress.itemStatus[row.masteryStatus]}</p>
      </li>)}</ul>
    </div>}
  </section>;
}
