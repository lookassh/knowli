"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { messages, type ChildDto, type ParentWorkCardDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import { avatarEmoji } from "./avatars";

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} min ${rest} s` : `${rest} s`;
}

function sessionLabel(mode: ParentWorkCardDto["sessions"][number]["mode"]): string {
  return mode === "mock_test" ? messages.workCard.sessionMockTest
    : mode === "daily_round" ? messages.workCard.sessionDailyRound : messages.workCard.sessionTraining;
}

function stateLabel(state: ParentWorkCardDto["sessions"][number]["state"]): string {
  return state === "active" ? messages.workCard.stateActive
    : state === "completed" ? messages.workCard.stateCompleted : messages.workCard.stateEnded;
}

function feedbackLabel(kind: string | null): string | null {
  if (!kind) return null;
  const labels: Record<string, string> = {
    great: "Świetnie", capitalization_hint: "Wielka litera", almost: "Prawie", incorrect: "Spróbuj ponownie",
    content_matched: "Treść rozpoznana", not_assessed: "Nie udało się ocenić", spelling_hint: "Popraw zapis",
    lesson_hint: "Wskazówka", lesson_almost: "Prawie",
  };
  const label = labels[kind];
  return label ? `${messages.workCard.feedback}: ${label}` : null;
}

function stepTypeLabel(type: string): string {
  return messages.workCard.stepType[type as keyof typeof messages.workCard.stepType] ?? "Ćwiczenie";
}

/** Karta wyniku oceny aktywności jednej sesji: czasy, punkty i wyjaśnienie. */
function SessionActivityCard({ activity }: { activity: ParentWorkCardDto["sessions"][number]["activity"] }) {
  return (
    <div className="pp-work-activity" data-testid="work-card-activity" data-status={activity.status}>
      {activity.status === "evaluated" ? (
        <>
          <p>{messages.workCard.activityDuration.replace("{time}", duration(activity.durationSeconds))}</p>
          <p>{messages.workCard.activityActive.replace("{time}", duration(activity.activeSeconds))}</p>
          <p>{messages.workCard.activityApproved.replace("{time}", duration(activity.approvedSeconds))}</p>
          <p>{messages.workCard.activityPoints.replace("{n}", String(activity.pointsAwarded))}</p>
        </>
      ) : activity.status === "error" ? (
        <p>{messages.workCard.activityError}</p>
      ) : (
        <p>{messages.workCard.activityNotDelivered}</p>
      )}
      {activity.status === "evaluated" && activity.reason && (
        <p>{messages.workCard.activityReasonLabel}: {activity.reason}</p>
      )}
      {activity.excludedTasks !== null && activity.excludedTasks.length > 0 && (
        <details>
          <summary>{messages.workCard.activityExcludedTitle}</summary>
          <ul>{activity.excludedTasks.map((excluded, index) => (
            <li key={index}>{messages.workCard.activityExcludedTask.replace("{n}", String(excluded.taskOrdinal + 1)).replace("{reason}", excluded.reason)}</li>
          ))}</ul>
        </details>
      )}
      {activity.status === "evaluated" && activity.excludedTasks === null && (
        <p className="info">{messages.workCard.activityDetailsExpired}</p>
      )}
    </div>
  );
}

export default function WorkCardPanel({ childrenList, onAuthExpired }: { childrenList: ChildDto[]; onAuthExpired: () => void }) {
  const [childId, setChildId] = useState(childrenList[0]?.id ?? "");
  // Empty on first load: the API supplies today's date in the family timezone.
  const [date, setDate] = useState("");
  const [report, setReport] = useState<ParentWorkCardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);
  const selection = useRef({ childId, date });
  selection.current = { childId, date };

  useEffect(() => {
    if (!childrenList.some(child => child.id === childId)) setChildId(childrenList[0]?.id ?? "");
  }, [childrenList, childId]);

  const load = useCallback(async () => {
    if (!childId) { setReport(null); setError(null); setLoading(false); requestSeq.current++; return; }
    const seq = ++requestSeq.current;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ childId });
      if (date) query.set("date", date);
      const result = await apiFetch<ParentWorkCardDto>("GET", `/api/v1/parent/work-card?${query}`);
      if (seq === requestSeq.current) {
        setReport(result);
        if (!date) {
          selection.current = { childId, date: result.date };
          setDate(result.date);
        }
      }
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      if ((cause as { status?: number }).status === 401) { onAuthExpired(); return; }
      setReport(null); setError(errorMessage(cause));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [childId, date, onAuthExpired]);

  useEffect(() => { void load(); return () => { requestSeq.current++; }; }, [load]);

  const selectChild = (nextChildId: string) => {
    if (nextChildId === childId) return;
    selection.current = { ...selection.current, childId: nextChildId };
    requestSeq.current++;
    setChildId(nextChildId);
  };
  const selectDate = (nextDate: string) => {
    selection.current = { ...selection.current, date: nextDate };
    requestSeq.current++;
    setDate(nextDate);
  };

  if (childrenList.length === 0) return <section><h2>{messages.workCard.title}</h2><p className="info">{messages.workCard.emptyChildren}</p></section>;

  return (
    <section className="pp-work-card" data-testid="work-card">
      <h2>{messages.workCard.title}</h2>
      <div className="pp-work-filters">
        <div className="pp-childpick" role="group" aria-label={messages.workCard.childLabel}>
          {childrenList.map(child => <button key={child.id} type="button" aria-pressed={child.id === childId}
            className={child.id === childId ? "is-on" : undefined} onClick={() => selectChild(child.id)}>
            <span className="pp-childpick-emoji" aria-hidden="true">{avatarEmoji(child.avatarKey)}</span>{child.displayName}
          </button>)}
        </div>
        <label className="pp-selectwrap">{messages.workCard.dateLabel}
          <input aria-label={messages.workCard.dateLabel} type="date" value={date} onChange={event => selectDate(event.target.value)} />
        </label>
      </div>
      {loading && <p className="pp-loading" role="status">{messages.workCard.loading}</p>}
      {error && <p className="pp-error" role="alert">{error}</p>}
      {report && !loading && (
        <>
          <section className="pp-work-summary card" aria-label={messages.workCard.creditedTime}>
            <h3>{messages.workCard.creditedTime}</h3>
            <p data-testid="work-card-credited">{duration(report.creditedSeconds)}</p>
            {report.unevaluatedSessions > 0 && (
              <p className="info">{messages.workCard.unevaluatedSessions.replace("{n}", String(report.unevaluatedSessions))}</p>
            )}
          </section>
          <h3>{messages.workCard.sessions}</h3>
          {report.sessions.length === 0 ? <p className="info">{messages.workCard.emptyDay}</p> : <div className="pp-work-sessions">
            {report.sessions.map(session => <article className="card pp-work-session" key={session.sessionId}>
              <header><div><h4>{session.deckTitle}</h4><p>{sessionLabel(session.mode)} · v{session.deckVersionNumber} · {stateLabel(session.state)}</p></div></header>
              <SessionActivityCard activity={session.activity} />
              <p>{messages.workCard.steps}: {session.steps.length} · {messages.workCard.remaining}: {session.remainingSteps}</p>
              {session.steps.length > 0 && <ol>{session.steps.map(step => <li key={step.taskId}>
                <span>{stepTypeLabel(step.exerciseType)} · {messages.workCard.stepState[step.state]}</span>
                {step.responses.map((response, index) => <React.Fragment key={`${response.modality}-${index}`}>
                  {response.answerExample && <span>{messages.workCard.response}: „{response.answerExample}”</span>}
                  {feedbackLabel(response.feedbackKind) && <span>{feedbackLabel(response.feedbackKind)}</span>}
                  {response.modality === "skip" && <span>{messages.workCard.skipped}</span>}
                  {response.modality === "dont_remember" && <span>{messages.workCard.dontRemember}</span>}
                  {response.assessment === "assessed" && <span>{messages.workCard.assessed}</span>}
                  {response.assessment === "unassessed" && <span>{messages.workCard.unassessed}</span>}
                  {response.assessment === "mixed" && <span>{messages.workCard.mixedAssessment}</span>}
                  {response.assessment === "none" && <span>{messages.workCard.noAssessment}</span>}
                  <span>{messages.workCard.answeredAfter.replace("{seconds}", String(response.responseSeconds))}</span>
                </React.Fragment>)}
              </li>)}</ol>}
            </article>)}
          </div>}
        </>
      )}
    </section>
  );
}
