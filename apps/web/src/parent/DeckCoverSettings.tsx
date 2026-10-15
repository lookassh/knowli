import React from "react";
import { messages } from "@learning/contracts";

export function DeckCoverSettings({ coverAssetId, busy, generating, generatedPreview, onUpload, onRemove, onGenerate, onAcceptGenerated, onRejectGenerated }: {
  coverAssetId: string | null;
  busy: boolean;
  generating: boolean;
  generatedPreview: string | null;
  onUpload: (file: File | undefined) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onAcceptGenerated: () => void;
  onRejectGenerated: () => void;
}) {
  return (
    <section style={{ border: "1px solid #d7dce5", borderRadius: "0.75rem", padding: "1rem", marginBlock: "1rem" }} aria-label={messages.decks.coverLabel} data-testid="deck-cover-settings">
      <h3>{messages.decks.coverLabel}</h3>
      <p>{messages.decks.coverHelp}</p>
      {coverAssetId
        ? <img style={{ display: "block", width: "9rem", height: "9rem", borderRadius: "0.75rem", objectFit: "cover" }} src={`/api/v1/media/${coverAssetId}`} alt={messages.decks.coverLabel} data-testid="deck-cover-preview" />
        : <p data-testid="deck-cover-empty">{messages.decks.coverEmpty}</p>}
      {generatedPreview
        ? <div data-testid="generated-cover-preview"><img style={{ display: "block", width: "9rem", height: "9rem", borderRadius: "0.75rem", objectFit: "cover" }} src={generatedPreview} alt={messages.decks.coverLabel} /><button type="button" disabled={busy} onClick={onAcceptGenerated}>{messages.decks.coverAccept}</button><button type="button" disabled={busy} onClick={onRejectGenerated}>{messages.decks.coverReject}</button></div>
        : <button type="button" data-testid="deck-cover-generate" disabled={busy} onClick={onGenerate}>{messages.decks.coverGenerate}</button>}
      <label>
        {messages.decks.coverChoose}
        <input data-testid="deck-cover-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={(event) => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      </label>
      {coverAssetId && <button type="button" data-testid="deck-cover-remove" disabled={busy} onClick={onRemove}>{messages.decks.coverRemove}</button>}
      {busy && <p role="status" data-testid="deck-cover-busy">{generating ? messages.decks.coverGenerating : messages.decks.coverBusy}</p>}
    </section>
  );
}
