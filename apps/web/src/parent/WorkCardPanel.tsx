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

export default function WorkCardPanel({ childrenList, onAuthExpired }: { childrenList: ChildDto[]; onAuthExpired: () => void }) {
  const [childId, setChildId] = useState(childrenList[0]?.id ?? "");
  // Empty on first load: the API supplies today's date in the family timezone.
  const [date, setDate] = useState("");
  const [report, setReport] = useState<ParentWorkCardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [decisionSaving, setDecisionSaving] = useState<"fulfilled" | "rejected" | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
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

  useEffect(() => { setDecisionError(null); }, [childId, date]);

  const decide = async (requestId: string, decision: "fulfilled" | "rejected") => {
    const selectedChildId = childId;
    const selectedDate = date;
    const sequenceAtStart = requestSeq.current;
    const selectionIsCurrent = () => selection.current.childId === selectedChildId
      && selection.current.date === selectedDate && requestSeq.current === sequenceAtStart;
    setDecisionBusy(requestId);
    setDecisionSaving(decision);
    setDecisionError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/xbox-requests/${requestId}/decision`, { decision });
      if (selectionIsCurrent()) await load();
    } catch (cause) {
      if ((cause as { status?: number }).status === 401) { onAuthExpired(); return; }
      if (selectionIsCurrent()) setDecisionError(errorMessage(cause) || messages.workCard.xboxDecisionFailed);
    } finally {
      setDecisionBusy(null);
      setDecisionSaving(null);
    }
  };

  const selectChild = (nextChildId: string) => {
    if (nextChildId === childId) return;
    selection.current = { ...selection.current, childId: nextChildId };
    requestSeq.current++;
    setDecisionError(null);
    setChildId(nextChildId);
  };
  const selectDate = (nextDate: string) => {
    selection.current = { ...selection.current, date: nextDate };
    requestSeq.current++;
    setDecisionError(null);
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
      {decisionError && <p className="pp-error" role="alert">{decisionError}</p>}
      {report && !loading && (
        <>
          <section className="card" aria-label={messages.workCard.xboxPendingTitle}>
            <h3>{messages.workCard.xboxPendingTitle}</h3>
            {report.xboxRequests.filter(request => request.status === "pending").length === 0
              ? <p>{messages.workCard.xboxPendingEmpty}</p>
              : <ul>{report.xboxRequests.filter(request => request.status === "pending").map(request => (
                <li key={request.requestId}>
                  <button type="button" onClick={() => selectDate(request.localDate)}
                    aria-label={messages.workCard.xboxOpenOnDate.replace("{date}", request.localDate)}>
                    {messages.workCard.xboxRequestBlock.replace("{date}", request.localDate).replace("{block}", String(request.blockNumber))}
                  </button>
                </li>
              ))}</ul>}
          </section>
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
          {report.xboxRequests.filter(request => request.localDate === report.date).map(request => (
            <section className="card" aria-label={messages.workCard.xboxRequestTitle} key={request.requestId}>
              <h3>{messages.workCard.xboxRequestTitle}</h3>
              <p>{messages.workCard.xboxRequestBlock.replace("{date}", request.localDate).replace("{block}", String(request.blockNumber))}</p>
              <p>{messages.workCard.xboxRequestStatus[request.status]}</p>
              <p>{request.pointsCost} pkt · {request.xboxMinutes} min</p>
              {request.status === "pending" && <>
                <p>{messages.workCard.xboxManualSteps}</p>
                <p>{messages.workCard.xboxUncertain}</p>
                <div className="pp-work-xbox-actions">
                  <button type="button" disabled={decisionBusy !== null}
                    onClick={() => void decide(request.requestId, "fulfilled")}>
                    {decisionBusy === request.requestId && decisionSaving === "fulfilled" ? messages.workCard.xboxSavingFulfilled : messages.workCard.xboxConfirm}
                  </button>
                  <button type="button" disabled={decisionBusy !== null}
                    onClick={() => void decide(request.requestId, "rejected")}>
                    {decisionBusy === request.requestId && decisionSaving === "rejected" ? messages.workCard.xboxSavingRejected : messages.workCard.xboxReject}
                  </button>
                </div>
              </>}
            </section>
          ))}
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
