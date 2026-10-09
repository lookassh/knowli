"use client";

import { useState } from "react";
import { messages, type DeckDto } from "@learning/contracts";
import { compareEditorForms, createEditorSnapshot, type EditorSnapshot } from "./deck-editor-state";

export interface EditorConflict {
  local: EditorSnapshot;
  remote: DeckDto | null;
  loadError: string | null;
}

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

  return (
    <section className="card deck-conflict-panel" data-testid="deck-conflict-panel" aria-labelledby="deck-conflict-title">
      <h3 id="deck-conflict-title">{messages.decks.conflictTitle}</h3>
      <p>{messages.decks.conflictDescription}</p>
      {conflict.loadError && <p className="error" data-testid="conflict-load-error" role="alert">{conflict.loadError}</p>}
      {!remote && (
        <button type="button" data-testid="conflict-retry" disabled={busy} onClick={onRetry}>
          {messages.decks.conflictRetry}
        </button>
      )}
      {remote && (
        <>
          <p data-testid="conflict-remote-title">
            {messages.decks.conflictRemote}: {remoteDraft?.title ?? messages.decks.conflictNotFound}
          </p>
          {comparison && (
            <div className="conflict-comparison">
              <p><strong>{messages.decks.conflictLocal}:</strong> {comparison.title.local}</p>
              <div className="conflict-columns">
                <strong>{messages.decks.conflictLocal}</strong>
                <strong>{messages.decks.conflictRemote}</strong>
                {comparison.rows.map((row) => (
                  <div className="conflict-row" data-testid={`conflict-row-${row.key}`} key={row.key}>
                    <span>{row.local ? `${row.local.source} → ${row.local.target}` : messages.decks.conflictRemoved}</span>
                    <span>{row.remote ? `${row.remote.source} → ${row.remote.target}` : messages.decks.conflictRemoved}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {remote.draft || remote.published ? (
            <button type="button" data-testid="conflict-load-remote" disabled={busy} onClick={() => setConfirmation("load")}>
              {loadLabel}
            </button>
          ) : null}
          <button type="button" data-testid="conflict-finish" disabled={busy} onClick={() => setConfirmation("dismiss")}>
            {messages.decks.conflictFinish}
          </button>
          {confirmation && (
            <div className="info" role="group" aria-label={confirmation === "load" ? messages.decks.conflictLoad : messages.decks.conflictFinish}>
              <p>{confirmation === "load" ? messages.decks.conflictConfirmLoad : messages.decks.conflictConfirmDiscard}</p>
              <button
                type="button"
                data-testid="conflict-confirm"
                disabled={busy}
                onClick={() => {
                  setConfirmation(null);
                  if (confirmation === "load") onLoadRemote(remote);
                  else onDismissComparison(remote);
                }}
              >
                {messages.decks.conflictConfirm}
              </button>
              <button type="button" data-testid="conflict-cancel" disabled={busy} onClick={() => setConfirmation(null)}>
                {messages.decks.conflictCancel}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
