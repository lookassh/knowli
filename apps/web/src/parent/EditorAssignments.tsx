"use client";

import type { ReactNode } from "react";
import { Alert, Button, Group, Paper, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { messages, AssignmentPutSchema, type ChildDto } from "@learning/contracts";
import AssignmentTestGoalFields, { type AssignmentTestSettings } from "./AssignmentTestGoalFields";
import { avatarEmoji } from "./avatars";
import { formatFamilyDate } from "./family-date";
import { ParentIcon } from "./ParentIcon";

interface AssignmentView {
  childId: string;
  testDate: string | null;
}

/**
 * Przypisania materiału jako karty per dziecko — wspólne dla edytora zestawu
 * i lekcji (fazy 5b/6b): termin w odznace, pole daty, cel próbnej kartkówki,
 * błąd przy karcie dziecka, usunięcie przypisania potwierdzane w oknie
 * (`onUnassign` otwiera potwierdzenie).
 */
export function EditorAssignments({
  kind,
  childrenList,
  assignments,
  dates,
  errors,
  unassigningChildId,
  settings,
  warning,
  onDateChange,
  onSettingsChange,
  onAssign,
  onUnassign,
}: {
  kind: "vocabulary" | "lesson";
  childrenList: ChildDto[];
  assignments: readonly AssignmentView[];
  dates: Record<string, string>;
  errors: Record<string, string>;
  unassigningChildId: string | null;
  settings: (childId: string) => AssignmentTestSettings;
  /** Ostrzeżenie przy dziecku (np. nieczytające dziecko) albo `null`. */
  warning: (child: ChildDto, index: number) => ReactNode;
  onDateChange: (childId: string, value: string) => void;
  onSettingsChange: (childId: string, value: AssignmentTestSettings) => void;
  onAssign: (childId: string) => void;
  onUnassign: (childId: string) => void;
}) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      {childrenList.map((child, index) => {
        const assignment = assignments.find((a) => a.childId === child.id);
        const childSettings = settings(child.id);
        return (
          <Paper withBorder radius="lg" p="md" key={child.id} data-testid={`assign-row-${index}`}>
            <Stack gap="sm">
              <Group gap="sm" wrap="nowrap" data-testid={assignment ? `assignment-row-${index}` : undefined}>
                <span className="pp-editor-avatar" aria-hidden="true">{avatarEmoji(child.avatarKey)}</span>
                <Text fw={600} className="pp-editor-grow" data-child-id={child.id}>{child.displayName}</Text>
                {assignment && (
                  <span className="pp-status-badge" data-tone="success">
                    {assignment.testDate
                      ? messages.decks.assignedBadge.replace("{date}", formatFamilyDate(assignment.testDate))
                      : messages.decks.assignedNoDate}
                  </span>
                )}
              </Group>
              {warning(child, index)}
              <TextInput
                size="md"
                type="date"
                label={messages.decks.assignDate}
                data-testid={`assign-date-${index}`}
                aria-label={`${messages.decks.assignDate} ${child.displayName}`}
                maw={260}
                value={dates[child.id] ?? assignment?.testDate ?? ""}
                onChange={(event) => onDateChange(child.id, event.currentTarget.value)}
              />
              <AssignmentTestGoalFields {...(kind === "lesson" ? { kind } : {})} {...childSettings}
                onChange={(value) => onSettingsChange(child.id, value)} />
              {errors[child.id] && (
                <Alert color="red" variant="light" role="alert" data-testid={`assign-error-${index}`}>{errors[child.id]}</Alert>
              )}
              <Group gap="xs">
                <Button size="md" variant="light" data-testid={`assign-submit-${index}`}
                  disabled={!AssignmentPutSchema.safeParse({ testDate: null, ...childSettings }).success}
                  onClick={() => onAssign(child.id)}>
                  {messages.decks.assign}
                </Button>
                {assignment && (
                  <Button size="md" variant="subtle" color="red" data-testid={`unassign-submit-${index}`}
                    disabled={unassigningChildId === child.id} onClick={() => onUnassign(child.id)}>
                    {messages.decks.unassign}
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

/**
 * Przypięty pasek akcji edytora (szkic 5b): wiersz stanu (błąd, powód blokady
 * publikacji) i „Zapisz zmiany / Publikuj” albo „Utwórz nową wersję”.
 */
export function EditorActionBar({
  error,
  blockedReason,
  editable,
  isDirty,
  busy,
  testIds,
  saveDisabled,
  publishDisabled,
  onSave,
  onPublish,
  onNewVersion,
}: {
  error: string | null;
  blockedReason: string | null;
  editable: boolean;
  isDirty: boolean;
  busy: boolean;
  testIds: { save: string; publish: string };
  saveDisabled: boolean;
  publishDisabled: boolean;
  onSave: () => void;
  onPublish: () => void;
  onNewVersion: () => void;
}) {
  return (
    <div className="pp-editor-bar" data-testid="editor-action-bar">
      <div className="pp-editor-bar-in">
        <div className="pp-editor-bar-status">
          {error && <EditorErrorText error={error} />}
          {blockedReason && (
            <Text size="sm" className="pp-editor-bar-note" data-testid="publish-blocked-reason">{blockedReason}</Text>
          )}
        </div>
        {editable ? (
          <div className="pp-editor-bar-actions">
            <Button size="md" variant={isDirty ? "filled" : "default"} data-testid={testIds.save} onClick={onSave} disabled={saveDisabled}>
              {messages.decks.save}
            </Button>
            <Button size="md" variant={isDirty ? "default" : "filled"} data-testid={testIds.publish} onClick={onPublish} disabled={publishDisabled}>
              {messages.decks.publish}
            </Button>
          </div>
        ) : (
          <div className="pp-editor-bar-actions pp-editor-bar-single">
            <Button size="md" data-testid="new-version" onClick={onNewVersion} disabled={busy}>
              {messages.decks.newVersion}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Błąd polecenia edytora (`api-error`): w pasku akcji albo nad treścią, gdy paska nie ma. */
export function EditorErrorText({ error }: { error: string }) {
  return (
    <Text size="sm" role="alert" data-testid="api-error" className="pp-editor-bar-error">
      <ParentIcon name="alert-triangle" />
      {error}
    </Text>
  );
}
