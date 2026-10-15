import React from "react";
import { messages } from "@learning/contracts";

export function DeckCoverSettings({ coverAssetId, busy, onUpload, onRemove }: {
  coverAssetId: string | null;
  busy: boolean;
  onUpload: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <section style={{ border: "1px solid #d7dce5", borderRadius: "0.75rem", padding: "1rem", marginBlock: "1rem" }} aria-label={messages.decks.coverLabel} data-testid="deck-cover-settings">
      <h3>{messages.decks.coverLabel}</h3>
      <p>{messages.decks.coverHelp}</p>
      {coverAssetId
        ? <img style={{ display: "block", width: "9rem", height: "9rem", borderRadius: "0.75rem", objectFit: "cover" }} src={`/api/v1/media/${coverAssetId}`} alt={messages.decks.coverLabel} data-testid="deck-cover-preview" />
        : <p data-testid="deck-cover-empty">{messages.decks.coverEmpty}</p>}
      <label>
        {messages.decks.coverChoose}
        <input data-testid="deck-cover-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={(event) => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </label>
      {coverAssetId && <button type="button" data-testid="deck-cover-remove" disabled={busy} onClick={onRemove}>{messages.decks.coverRemove}</button>}
      {busy && <p role="status" data-testid="deck-cover-busy">{messages.decks.coverBusy}</p>}
    </section>
  );
}
