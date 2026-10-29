"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { messages, type DeckDto } from "@learning/contracts";
import { compareEditorForms, createEditorSnapshot, type EditorSnapshot } from "./deck-editor-state";
import { ParentIcon } from "./ParentIcon";

export interface EditorConflict {
  local: EditorSnapshot;
  remote: DeckDto | null;
  loadError: string | null;
}

/**
 * Porównanie lokalnych poprawek z aktualną wersją po konflikcie zapisu.
 * Na desktopie wersje obok siebie (wiersz = ta sama karta), na telefonie
 * jedna pod drugą z podpisem wersji przy każdej wartości.
 */
export default function DeckConflictPanel({
  conflict,
  busy,
  onRetry,
  onLoadRemote,
  onDismissComparison,
}: {
  conflict: EditorConflict;
  busy: boolean;
  onRetry: () => void;
  onLoadRemote: (deck: DeckDto) => void;
  onDismissComparison: (deck: DeckDto) => void;
}) {
  const [confirmation, setConfirmation] = useState<"load" | "dismiss" | null>(null);
  const remote = conflict.remote;
  const remoteDraft = remote?.draft ?? remote?.published ?? null;
  const comparison = remoteDraft
    ? compareEditorForms(conflict.local.form, createEditorSnapshot(remoteDraft, () => "unused").form)
    : null;
  const loadLabel = remote?.draft
    ? messages.decks.conflictLoad
    : messages.decks.conflictCreateDraft;
  const pair = (value: { source: string; target: string } | null | undefined) =>
    value ? `${value.source} → ${value.target}` : messages.decks.conflictRemoved;

  return (
    <Paper withBorder radius="lg" p="md" className="pp-editor-conflict" data-testid="deck-conflict-panel" aria-labelledby="deck-conflict-title" component="section">
      <Stack gap="sm">
        <Title order={2} fz="md" id="deck-conflict-title" className="pp-editor-conflict-title">
          <ParentIcon name="alert-triangle" />
          {messages.decks.conflictTitle}
        </Title>
        <Text size="sm">{messages.decks.conflictDescription}</Text>
        {conflict.loadError && <Alert color="red" variant="light" data-testid="conflict-load-error" role="alert">{conflict.loadError}</Alert>}
        {!remote && (
          <Group>
            <Button size="md" variant="light" data-testid="conflict-retry" disabled={busy} onClick={onRetry}>
              {messages.decks.conflictRetry}
            </Button>
          </Group>
        )}
        {remote && (
          <>
            <Text size="sm" data-testid="conflict-remote-title">
              <strong>{messages.decks.conflictRemote}:</strong> {remoteDraft?.title ?? messages.decks.conflictNotFound}
            </Text>
            {comparison && (
              <div className="pp-editor-compare">
                <Text size="sm"><strong>{messages.decks.conflictLocal}:</strong> {comparison.title.local}</Text>
                <div className="pp-editor-compare-head" aria-hidden="true">
                  <span>{messages.decks.conflictLocal}</span>
                  <span>{messages.decks.conflictRemote}</span>
                </div>
                {comparison.rows.map((row) => {
                  const local = pair(row.local);
                  const current = pair(row.remote);
                  return (
                    <div className="pp-editor-compare-row" data-differs={local !== current} data-testid={`conflict-row-${row.key}`} key={row.key}>
                      <span><small>{messages.decks.conflictLocal}</small>{local}</span>
                      <span><small>{messages.decks.conflictRemote}</small>{current}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <Group gap="xs">
              {(remote.draft || remote.published) && (
                <Button size="md" variant="light" data-testid="conflict-load-remote" disabled={busy} onClick={() => setConfirmation("load")}>
                  {loadLabel}
                </Button>
              )}
              <Button size="md" variant="default" data-testid="conflict-finish" disabled={busy} onClick={() => setConfirmation("dismiss")}>
                {messages.decks.conflictFinish}
              </Button>
            </Group>
            {confirmation && (
              <Alert color="blue" variant="light" role="group" aria-label={confirmation === "load" ? messages.decks.conflictLoad : messages.decks.conflictFinish}>
                <Stack gap="xs">
                  <Text size="sm">{confirmation === "load" ? messages.decks.conflictConfirmLoad : messages.decks.conflictConfirmDiscard}</Text>
                  <Group gap="xs">
                    <Button
                      size="md"
                      data-testid="conflict-confirm"
                      disabled={busy}
                      onClick={() => {
                        setConfirmation(null);
                        if (confirmation === "load") onLoadRemote(remote);
                        else onDismissComparison(remote);
                      }}
                    >
                      {messages.decks.conflictConfirm}
                    </Button>
                    <Button size="md" variant="default" data-testid="conflict-cancel" disabled={busy} onClick={() => setConfirmation(null)}>
                      {messages.decks.conflictCancel}
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
