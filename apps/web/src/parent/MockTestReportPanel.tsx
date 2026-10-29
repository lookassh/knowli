"use client";

import { useState } from "react";
import { Alert, Group, NativeSelect, Paper, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { messages, MockTestReportDtoSchema } from "@learning/contracts";
import { mockTestResultBadgeLabel, mockTestScoreTone } from "@learning/kid-ui";
import { errorMessage } from "./api";
import { groupMockReportWords, type MockReportWord } from "./mock-report-words";
import { ParentIcon } from "./ParentIcon";
import { orpc } from "./query-client";

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

const OUTCOME_TONE = { correct: "success", incorrect: "danger" } as const;

/** Stała funkcja `select`: walidacja Zod nie powtarza się przy każdym renderze. */
const parseReports = (result: { body: unknown }) => MockTestReportDtoSchema.array().parse(result.body);

/**
 * Próbne kartkówki dziecka w zestawie. Komponent dostaje `key` z parą
 * dziecko × zestaw, więc wybór próby wraca do najnowszej po zmianie filtra.
 */
export default function MockTestReportPanel({ childId, deckId, currentDeckVersionId }: {
  childId: string;
  deckId: string;
  currentDeckVersionId?: string | null;
}) {
  const query = useQuery({
    ...orpc.mockTests.list.queryOptions({ input: { childId, deckId } }),
    select: parseReports,
  });
  const reports = query.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen ?? reports[0]?.sessionId ?? "";
  const report = reports.find(r => r.sessionId === selected);
  const grouped = report ? groupMockReportWords(report.rows) : null;
  const tone = grouped ? mockTestScoreTone(grouped.score) : "low";

  return (
    <Paper component="section" withBorder radius="lg" p="md" aria-label={messages.progress.mockTestsTitle}>
      <Group justify="space-between" align="flex-end" gap="sm" mb="sm">
        <Title order={2} fz="md" className="pp-prog-cardtitle">
          <ParentIcon name="clipboard-check" />
          {messages.progress.mockTestsTitle}
        </Title>
        {reports.length > 0 && (
          <NativeSelect
            size="md"
            className="pp-prog-mockselect"
            data-testid="mock-report-select"
            aria-label={messages.progress.mockTestsRecent}
            value={selected}
            onChange={e => setChosen(e.currentTarget.value)}
            data={reports.map(r => ({ value: r.sessionId, label: `${new Date(r.startedAt).toLocaleString("pl-PL")} — ${r.deckTitle}` }))}
          />
        )}
      </Group>
      {query.isError && <Alert color="red" variant="light" role="alert">{errorMessage(query.error)}</Alert>}
      {query.isSuccess && reports.length === 0 && <Text>{messages.progress.mockTestsEmpty}</Text>}
      {report && grouped && <Stack gap="sm" data-testid="mock-parent-report">
        {grouped.score.total > 0 && <div className="pp-prog-mockscore" data-testid="mock-report-score" data-tone={tone}>
          <span className="pp-prog-mockscore-big">{fill(messages.kid.mockTestScore, { correct: grouped.score.correct, total: grouped.score.total, percent: grouped.score.percent })}</span>
          <span className="pp-prog-mockscore-stars" role="img" aria-label={fill(messages.kid.mockTestStarsLabel, { n: grouped.score.stars })}>{"★".repeat(grouped.score.stars)}{"☆".repeat(6 - grouped.score.stars)}</span>
        </div>}
        <Text size="sm" className="pp-prog-muted">
          {fill(messages.progress.mockTestVersion, { n: report.deckVersionNumber })}
          {" · "}{fill(messages.progress.mockTestPortion, { actual: report.taskBudget, requested: report.requestedTaskCount })}
          {" · "}{report.complete ? messages.progress.mockTestComplete : messages.progress.mockTestPartial}
        </Text>
        {currentDeckVersionId && report.deckVersionId !== currentDeckVersionId && (
          <Text size="sm" className="pp-prog-warning">{messages.progress.mockTestOldVersion}</Text>
        )}
        <ul className="pp-prog-rows">{grouped.words.map(word => {
          const line = parentLine(word);
          const outcome = word.status === "correct" || word.status === "incorrect" ? word.status : "neutral";
          return <li key={word.itemId} data-testid="mock-report-word" data-status={word.status}>
            <span className="pp-prog-outcome" data-outcome={outcome} aria-hidden="true">
              <ParentIcon name={outcome === "correct" ? "check" : outcome === "incorrect" ? "x" : "minus"} />
            </span>
            <span className="pp-prog-grow pp-prog-mockbody">
              <span>{word.source} → <strong>{word.target}</strong></span>
              {word.detail.type === "label" && <span className="pp-prog-badges">
                <span className="pp-status-badge" data-tone="neutral">{word.detail.label === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</span>
              </span>}
              {word.detail.type === "perSkill" && <span className="pp-prog-badges">
                {word.results.map(result => (
                  <span className="pp-status-badge" key={result.skill}
                    data-tone={result.outcome === "correct" || result.outcome === "incorrect" ? OUTCOME_TONE[result.outcome] : "neutral"}>
                    {mockTestResultBadgeLabel(result)}
                  </span>
                ))}
              </span>}
              {line && <Text component="span" size="sm" className="pp-prog-muted">{line}</Text>}
            </span>
          </li>;
        })}</ul>
        <ul className="pp-prog-plain">{report.skills.map(skill => <li key={skill.skill} data-testid={`mock-report-${skill.skill}`}>
          <strong>{messages.progress.skills[skill.skill]}</strong>: {fill(messages.progress.mockTestCounts, { correct: skill.independentCorrect, total: skill.totalItems, practice: skill.practiceNeeded, missing: skill.notTested })}
          {skill.correctNotIndependent > 0 && <Text size="sm">{fill(messages.progress.mockTestSupported, { n: skill.correctNotIndependent })}</Text>}
          <Text size="sm" className="pp-prog-muted">{fill(messages.progress.mockTestSkipped, { n: skill.skipped, unassessed: skill.unassessed })}</Text>
        </li>)}</ul>
        {grouped.gaps.length > 0 && <Text size="sm" className="pp-prog-muted" data-testid="mock-report-gaps">{fill(messages.progress.mockTestGaps, {
          reasons: grouped.gaps.map(gap => `${messages.progress.mockTestReason[gap.reason] ?? gap.reason}: ${gap.count}`).join(", "),
        })}</Text>}
        <Text size="sm" className="pp-prog-note"><ParentIcon name="info" />{messages.progress.mockTestNote}</Text>
      </Stack>}
    </Paper>
  );
}
