"use client";

import { useMemo, useState } from "react";
import {
  messages,
  type ChildDto,
  type DeckSummaryDto,
  type ProgressDto,
  type ReportSkill,
} from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import ProgressItems from "./ProgressItems";
import MockTestReportPanel from "./MockTestReportPanel";

/**
 * Panel postępów (SPEC §25): filtrowanie dziecko × zestaw, liczby per
 * umiejętność, słowa do ćwiczeń, kierunkowe pomyłki i ostatnie odpowiedzi.
 * Wyniki wymowy pokazujemy z nazwą usługi — bez uśredniania skal.
 */

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

const DUE_STATUSES: ReadonlySet<string> = new Set(["practicing", "needs_reconfirmation"]);

export default function ProgressPanel({
  childrenList,
  decks,
}: {
  childrenList: ChildDto[];
  decks: DeckSummaryDto[];
}) {
  const published = useMemo(() => decks.filter((deck) => deck.publishedVersionId !== null), [decks]);
  const [childId, setChildId] = useState(childrenList[0]?.id ?? "");
  const [deckId, setDeckId] = useState(published[0]?.deckId ?? "");
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [reportVersion, setReportVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!childId || !deckId) {
      return;
    }
    setError(null);
    try {
      setProgress(
        await apiFetch<ProgressDto>("GET", `/api/v1/parent/progress?childId=${childId}&deckId=${deckId}`),
      );
      setReportVersion(value => value + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  if (childrenList.length === 0 || published.length === 0) {
    return (
      <section>
        <h2>{messages.progress.title}</h2>
        <p className="info">{messages.progress.empty}</p>
      </section>
    );
  }

  const dueForPractice = (progress?.items ?? []).flatMap((item) =>
    (Object.entries(item.skills) as [ReportSkill, string][])
      .filter(([, status]) => DUE_STATUSES.has(status))
      .map(([skill]) => `${messages.progress.skills[skill].toLowerCase()} ${item.target}`),
  );

  /** Znane = opanowane lub z kompletną serią; element po zmianie znaczenia nie liczy się. */
  const knownCount = (skill: ReportSkill): number =>
    (progress?.items ?? []).filter(
      (item) =>
        item.skills[skill] === "mastered" ||
        (item.skills[skill] === "needs_confirmation" && !item.meaningChanged),
    ).length;

  /** Minuty zaokrąglone w górę do pełnej, ale zero zostaje zerem (brak nauki). */
  const activityMinutes = progress
    ? progress.activity.activeSeconds > 0
      ? Math.max(1, Math.round(progress.activity.activeSeconds / 60))
      : 0
    : 0;

  return (
    <section>
      <h2>{messages.progress.title}</h2>
      <div className="grid-2">
        <label>
          {messages.progress.childLabel}
          <select data-testid="progress-child" value={childId} onChange={(e) => setChildId(e.target.value)}>
            {childrenList.map((child) => (
              <option key={child.id} value={child.id}>
                {child.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {messages.progress.deckLabel}
          <select data-testid="progress-deck" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {published.map((deck) => (
              <option key={deck.deckId} value={deck.deckId}>
                {deck.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button type="button" data-testid="progress-load" onClick={load}>
          {messages.progress.load}
        </button>
      </div>
      {error && (
        <p className="error" data-testid="api-error" role="alert">
          {error}
        </p>
      )}

      {progress && (
        <MockTestReportPanel key={reportVersion} childId={progress.childId} deckId={progress.deckId} currentDeckVersionId={published.find(d => d.deckId === progress.deckId)?.publishedVersionId} />
      )}
      {progress && (
        <section className="card" data-testid="progress-activity">
          <h3>{fill(messages.progress.activityTitle, { days: progress.activity.days })}</h3>
          {progress.activity.sessions > 0 ? (
            <ul className="plain">
              <li data-testid="progress-activity-time">
                {fill(messages.progress.activityTime, { minutes: activityMinutes })}
              </li>
              <li>{fill(messages.progress.activityDays, { days: progress.activity.activeDays })}</li>
              <li>{fill(messages.progress.activitySessions, { n: progress.activity.sessions })}</li>
              {progress.activity.decks.map((deck) => (
                <li key={deck.deckId}>
                  {fill(messages.progress.activityDeckRow, { title: deck.deckTitle, n: deck.sessions })}
                </li>
              ))}
              <li>{fill(messages.progress.activityAnswers, { n: progress.activity.answers })}</li>
              <li>{fill(messages.progress.activityInteractions, { n: progress.activity.interactions })}</li>
            </ul>
          ) : (
            <p>{messages.progress.activityEmpty}</p>
          )}
        </section>
      )}
      {progress && (
        <>
          <h3 data-testid="progress-heading">
            {progress.deckTitle} — {progress.childName}
          </h3>
          <p data-testid="progress-test-date">
            {messages.progress.testDate}:{" "}
            {progress.testDate ?? messages.progress.noTestDate}
          </p>

          <ul className="plain" data-testid="progress-skills">
            {progress.skills.map((summary) => {
              return (
                <li key={summary.skill} data-testid={`progress-skill-${summary.skill}`}>
                  {messages.progress.skills[summary.skill]}:{" "}
                  <strong>{fill(messages.progress.knownCount, { n: knownCount(summary.skill), total: summary.totalItems })}</strong>{" "}
                  ({fill(messages.progress.confirmed, { n: summary.mastered })}
                  {summary.needsConfirmation > 0 && ` ${fill(messages.progress.awaiting, { n: summary.needsConfirmation })}`}
                  {summary.practicing > 0 && ` ${fill(messages.progress.practicing, { n: summary.practicing })}`}
                  {summary.notAssessed > 0 && ` ${fill(messages.progress.notAssessed, { n: summary.notAssessed })}`})
                </li>
              );
            })}
          </ul>

          <ProgressItems items={progress.items} />

          <div className="card" data-testid="progress-pronunciation">
            {progress.pronunciation.assessed ? (
              <ul className="plain">
                {progress.pronunciation.latestScores.map((score) => (
                  <li key={score.target}>
                    {score.target}: {score.score}{" "}
                    {score.band && `(${score.band})`} — {score.provider}
                  </li>
                ))}
                <li className="info">{fill(messages.progress.pronunciationNote, { provider: progress.pronunciation.latestScores[0]?.provider ?? "" })}</li>
              </ul>
            ) : (
              <p>{messages.progress.pronunciationNotAssessed}</p>
            )}
          </div>

          <section className="card" data-testid="progress-due">
            <h3>{messages.progress.dueForPractice}</h3>
            {dueForPractice.length > 0 ? (
              <ul className="plain">
                {dueForPractice.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : (
              <p>{messages.progress.dueEmpty}</p>
            )}
          </section>

          <section className="card" data-testid="progress-confusions">
            <h3>{messages.progress.confusions}</h3>
            {progress.confusions.length > 0 ? (
              <ul className="plain">
                {progress.confusions.map((confusion) => (
                  <li key={`${confusion.expected}-${confusion.answered}`}>
                    {fill(messages.progress.confusionPair, confusion)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{messages.progress.confusionsEmpty}</p>
            )}
          </section>

          <section className="card" data-testid="progress-history">
            <h3>{messages.progress.history}</h3>
            {progress.history.length > 0 ? (
              <ul className="plain">
                {progress.history.slice(0, 10).map((entry, index) => (
                  <li key={`${entry.receivedAt}-${index}`}>
                    {fill(messages.progress.historyEntry, {
                      source: entry.source,
                      target: entry.target,
                      outcome: messages.progress.historyOutcome[entry.outcome] ?? entry.outcome,
                    })}{" "}
                    {entry.independent ? "" : messages.progress.historyUnsupported}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{messages.progress.historyEmpty}</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
