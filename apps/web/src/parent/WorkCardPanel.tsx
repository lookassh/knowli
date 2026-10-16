"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { messages, type ChildDto, type ParentWorkCardDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import { avatarEmoji } from "./avatars";

function todayLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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

export default function WorkCardPanel({ childrenList, onAuthExpired }: { childrenList: ChildDto[]; onAuthExpired: () => void }) {
  const [childId, setChildId] = useState(childrenList[0]?.id ?? "");
  const [date, setDate] = useState(todayLocal);
  const [report, setReport] = useState<ParentWorkCardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!childrenList.some(child => child.id === childId)) setChildId(childrenList[0]?.id ?? "");
  }, [childrenList, childId]);

  const load = useCallback(async () => {
    if (!childId || !date) { setReport(null); setError(null); setLoading(false); requestSeq.current++; return; }
    const seq = ++requestSeq.current;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ childId, date });
      const result = await apiFetch<ParentWorkCardDto>("GET", `/api/v1/parent/work-card?${query}`);
      if (seq === requestSeq.current) setReport(result);
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      if ((cause as { status?: number }).status === 401) { onAuthExpired(); return; }
      setReport(null); setError(errorMessage(cause));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [childId, date, onAuthExpired]);

  useEffect(() => { void load(); return () => { requestSeq.current++; }; }, [load]);

  if (childrenList.length === 0) return <section><h2>{messages.workCard.title}</h2><p className="info">{messages.workCard.emptyChildren}</p></section>;

  return (
    <section className="pp-work-card" data-testid="work-card">
      <h2>{messages.workCard.title}</h2>
      <div className="pp-work-filters">
        <div className="pp-childpick" role="group" aria-label={messages.workCard.childLabel}>
          {childrenList.map(child => <button key={child.id} type="button" aria-pressed={child.id === childId}
            className={child.id === childId ? "is-on" : undefined} onClick={() => setChildId(child.id)}>
            <span className="pp-childpick-emoji" aria-hidden="true">{avatarEmoji(child.avatarKey)}</span>{child.displayName}
          </button>)}
        </div>
        <label className="pp-selectwrap">{messages.workCard.dateLabel}
          <input aria-label={messages.workCard.dateLabel} type="date" value={date} onChange={event => setDate(event.target.value)} />
        </label>
      </div>
      {loading && <p className="pp-loading" role="status">{messages.workCard.loading}</p>}
      {error && <p className="pp-error" role="alert">{error}</p>}
      {report && !loading && (
        <>
          <section className="pp-work-summary card" aria-label={messages.workCard.creditedTime}>
            <h3>{messages.workCard.creditedTime}</h3><p>{duration(report.creditedSeconds)}</p>
          </section>
          <section className="pp-work-round card" aria-label={messages.workCard.roundTitle}>
            <h3>{messages.workCard.roundTitle}</h3>
            {!report.dailyRound.sessionId ? <p>{messages.workCard.roundMissing}</p> : <>
              <p>{messages.workCard[`round${report.dailyRound.state === "active" ? "Active" : report.dailyRound.state === "completed" ? "Completed" : "Ended"}`]}</p>
              {report.dailyRound.deckTitle && <p>{report.dailyRound.deckTitle}</p>}
              <p>{messages.workCard.roundProgress.replace("{steps}", String(report.dailyRound.steps)).replace("{answered}", String(report.dailyRound.answered))}</p>
            </>}
          </section>
          <h3>{messages.workCard.sessions}</h3>
          {report.sessions.length === 0 ? <p className="info">{messages.workCard.emptyDay}</p> : <div className="pp-work-sessions">
            {report.sessions.map(session => <article className="card pp-work-session" key={session.sessionId}>
              <header><div><h4>{session.deckTitle}</h4><p>{sessionLabel(session.mode)} · v{session.deckVersionNumber} · {stateLabel(session.state)}</p></div>
                <p>{duration(session.creditedSeconds)}</p></header>
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
