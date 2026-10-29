"use client";

import React, { useEffect, useState } from "react";
import { Accordion, Alert, Group, Loader, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { messages, type ChildDto, type ParentWorkCardDto } from "@learning/contracts";
import { errorMessage } from "./api";
import { ChildPicker } from "./ChildPicker";
import { orpc } from "./query-client";
import "./progress-panel.css";

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

type Session = ParentWorkCardDto["sessions"][number];

/** Stała funkcja `select` — TanStack nie przelicza jej przy każdym renderze. */
const selectBody = (response: { body: ParentWorkCardDto }): ParentWorkCardDto => response.body;

/** Wynik oceny aktywności jednej sesji: czasy, punkty i wyjaśnienie. */
function SessionActivityCard({ activity }: { activity: Session["activity"] }) {
  const excluded = activity.excludedTasks ?? [];
  return (
    <div className="pp-work-activity" data-testid="work-card-activity" data-status={activity.status}>
      {activity.status === "evaluated" ? (
        <div className="pp-work-times">
          <Text size="sm">{messages.workCard.activityDuration.replace("{time}", duration(activity.durationSeconds))}</Text>
          <Text size="sm">{messages.workCard.activityActive.replace("{time}", duration(activity.activeSeconds))}</Text>
          <Text size="sm">{messages.workCard.activityApproved.replace("{time}", duration(activity.approvedSeconds))}</Text>
          <Text size="sm" fw={600}>{messages.workCard.activityPoints.replace("{n}", String(activity.pointsAwarded))}</Text>
        </div>
      ) : activity.status === "error" ? (
        <Text size="sm">{messages.workCard.activityError}</Text>
      ) : (
        <Text size="sm">{messages.workCard.activityNotDelivered}</Text>
      )}
      {activity.status === "evaluated" && activity.reason && (
        <Text size="sm" mt="xs">{messages.workCard.activityReasonLabel}: {activity.reason}</Text>
      )}
      {(excluded.length > 0 || activity.details) && (
        <Accordion multiple variant="separated" radius="md" mt="sm" className="pp-work-accordion">
          {excluded.length > 0 && (
            <Accordion.Item value="excluded">
              <Accordion.Control>{messages.workCard.activityExcludedTitle}</Accordion.Control>
              <Accordion.Panel>
                <ul className="pp-prog-plain">{excluded.map((task, index) => (
                  <li key={index}>
                    {messages.workCard.activityExcludedTask.replace("{n}", String(task.taskOrdinal + 1)).replace("{reason}", task.reason)}
                  </li>
                ))}</ul>
              </Accordion.Panel>
            </Accordion.Item>
          )}
          {activity.details && (
            <Accordion.Item value="details">
              <Accordion.Control>{messages.workCard.activityTaskDetails}</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">{activity.details.modelReason}</Text>
                <ol className="pp-work-tasks">{activity.details.tasks.map((task) => (
                  <li key={task.taskOrdinal}>
                    <strong>{task.instruction}</strong>
                    {task.stimulus && <p>{task.stimulus}</p>}
                    {task.options.length > 0 && <p>{messages.workCard.activityOptions}: {task.options.join(" · ")}</p>}
                    {task.acceptedAnswers.length > 0 && <p>{messages.workCard.activityExpectedAnswers}: {task.acceptedAnswers.join(" / ")}</p>}
                    {task.submittedAnswers.length > 0 && <p>{messages.workCard.activityAnswers}: {task.submittedAnswers.join(" / ")}</p>}
                    <p className="pp-prog-muted">
                      {messages.workCard.activityMeasured}: {duration(Math.floor(task.activeMilliseconds / 1000))}; {messages.workCard.activityEdits}: {task.editCount}; {messages.workCard.activityPlaybacks}: {task.playbackCount}
                    </p>
                    {task.modelNote && <p>Uwaga oceny: {task.modelNote}</p>}
                  </li>
                ))}</ol>
              </Accordion.Panel>
            </Accordion.Item>
          )}
        </Accordion>
      )}
      {activity.status === "evaluated" && activity.excludedTasks === null && (
        <Text size="sm" mt="xs" className="pp-prog-muted">{messages.workCard.activityDetailsExpired}</Text>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  return (
    <Paper component="article" withBorder radius="lg" p="md">
      <Title order={3} fz="md" className="pp-prog-heading">{session.deckTitle}</Title>
      <Text size="sm" className="pp-prog-muted" mb="sm">
        {sessionLabel(session.mode)} · v{session.deckVersionNumber} · {stateLabel(session.state)}
      </Text>
      <SessionActivityCard activity={session.activity} />
      <Text size="sm" mt="sm">{messages.workCard.steps}: {session.steps.length} · {messages.workCard.remaining}: {session.remainingSteps}</Text>
      {session.steps.length > 0 && <ol className="pp-work-steps">{session.steps.map(step => <li key={step.taskId}>
        <span className="pp-work-step-title">{stepTypeLabel(step.exerciseType)} · {messages.workCard.stepState[step.state]}</span>
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
    </Paper>
  );
}

/**
 * Karta pracy dziecka na wybrany dzień. Pusta data oznacza „dziś” w strefie
 * rodziny — dzień podaje API i pokazujemy go w polu daty. Wygasłą sesję
 * (401) obsługuje globalny handler zapytań.
 */
export default function WorkCardPanel({ childrenList }: { childrenList: ChildDto[] }) {
  const [childId, setChildId] = useState(childrenList[0]?.id ?? "");
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!childrenList.some(child => child.id === childId)) setChildId(childrenList[0]?.id ?? "");
  }, [childrenList, childId]);

  // datę wysyłamy tylko niepustą — pusty string nie przeszedłby walidacji
  // granicy (DaySchema), a semantycznie znaczy „dzień dzisiejszy”
  const queryClient = useQueryClient();
  const options = orpc.workCard.get.queryOptions({ input: { childId, ...(date ? { date } : {}) } });
  const query = useQuery({ ...options, enabled: childId !== "", select: selectBody });
  const report = query.data;

  // Po pierwszym wczytaniu „dziś” staje się konkretnym dniem z API: zmiana
  // dziecka (także po północy) pyta o ten sam dzień, który rodzic ogląda.
  // Odpowiedź kopiujemy pod klucz z datą, więc raport nie znika na czas
  // odświeżenia pod nowym kluczem.
  useEffect(() => {
    if (date || !report) return;
    const raw = queryClient.getQueryData(options.queryKey);
    if (raw) {
      queryClient.setQueryData(orpc.workCard.get.queryKey({ input: { childId, date: report.date } }), raw);
    }
    setDate(report.date);
  }, [date, report, queryClient, options.queryKey, childId]);

  if (childrenList.length === 0) {
    return (
      <Stack gap="md">
        <Title order={1} fz={26}>{messages.workCard.title}</Title>
        <Text>{messages.workCard.emptyChildren}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" data-testid="work-card">
      <Title order={1} fz={26}>{messages.workCard.title}</Title>
      <Group gap="sm" align="flex-end" justify="space-between" className="pp-work-filters">
        <ChildPicker childrenList={childrenList} value={childId} onChange={setChildId} label={messages.workCard.childLabel} />
        <TextInput
          size="md"
          type="date"
          label={messages.workCard.dateLabel}
          className="pp-work-date"
          value={date}
          onChange={event => setDate(event.currentTarget.value)}
        />
      </Group>
      {query.isFetching && (
        <Group gap="xs" role="status" data-testid="work-card-loading">
          <Loader size="xs" />
          <Text size="sm">{messages.workCard.loading}</Text>
        </Group>
      )}
      {query.isError && <Alert color="red" variant="light" role="alert" data-testid="work-card-error">{errorMessage(query.error)}</Alert>}
      {report && (
        <>
          <Paper component="section" withBorder radius="lg" p="md" aria-label={messages.workCard.creditedTime}>
            <Title order={2} fz="md">{messages.workCard.creditedTime}</Title>
            <Text fz="xl" fw={700} data-testid="work-card-credited">{duration(report.creditedSeconds)}</Text>
            <Text size="sm" className="pp-prog-muted" data-testid="work-card-review-service">
              {report.reviewService ? messages.workCard.activityService.replace("{service}", report.reviewService) : messages.workCard.activityServiceUnavailable}
            </Text>
            {report.unevaluatedSessions > 0 && (
              <Text size="sm" className="pp-prog-muted">{messages.workCard.unevaluatedSessions.replace("{n}", String(report.unevaluatedSessions))}</Text>
            )}
          </Paper>
          <Title order={2} fz="lg">{messages.workCard.sessions}</Title>
          {report.sessions.length === 0
            ? <Text>{messages.workCard.emptyDay}</Text>
            : <Stack gap="sm">{report.sessions.map(session => <SessionCard key={session.sessionId} session={session} />)}</Stack>}
        </>
      )}
    </Stack>
  );
}
