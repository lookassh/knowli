"use client";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { messages } from "@learning/contracts";
import { ParentIcon } from "./ParentIcon";

/**
 * Obraz okładkowy zestawu: zapis od razu, poza szkicem wersji. Pole pliku
 * zostaje natywne (ukryte za przyciskiem) — wybór pliku na telefonie i testy.
 */
export function DeckCoverSettings({ coverAssetId, busy, generating, generatedPreview, error, onUpload, onRemove, onGenerate, onAcceptGenerated, onRejectGenerated }: {
  coverAssetId: string | null;
  busy: boolean;
  generating: boolean;
  generatedPreview: string | null;
  error?: string | null;
  onUpload: (file: File | undefined) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onAcceptGenerated: () => void;
  onRejectGenerated: () => void;
}) {
  return (
    <Stack gap="sm" aria-label={messages.decks.coverLabel} data-testid="deck-cover-settings" component="section">
      <div>
        <Text fw={600}>{messages.decks.coverLabel}</Text>
        <Text size="sm" className="pp-editor-muted">{messages.decks.coverHelp}</Text>
      </div>
      <Group align="flex-start" gap="md">
        {coverAssetId
          ? <img className="pp-editor-cover" src={`/api/v1/media/${coverAssetId}`} alt={messages.decks.coverLabel} data-testid="deck-cover-preview" />
          : <Text size="sm" className="pp-editor-muted" data-testid="deck-cover-empty">{messages.decks.coverEmpty}</Text>}
        {generatedPreview && (
          <Stack gap="xs" data-testid="generated-cover-preview">
            <img className="pp-editor-cover" src={generatedPreview} alt={messages.decks.coverLabel} />
            <Group gap="xs">
              <Button size="md" data-testid="deck-cover-accept" disabled={busy} onClick={onAcceptGenerated}>{messages.decks.coverAccept}</Button>
              <Button size="md" variant="default" data-testid="deck-cover-reject" disabled={busy} onClick={onRejectGenerated}>{messages.decks.coverReject}</Button>
            </Group>
          </Stack>
        )}
      </Group>
      <Group gap="xs">
        {!generatedPreview && (
          <Button size="md" variant="light" data-testid="deck-cover-generate" disabled={busy} onClick={onGenerate}
            leftSection={<ParentIcon name="sparkles" />}>
            {messages.decks.coverGenerate}
          </Button>
        )}
        <Button size="md" variant="default" component="label" data-disabled={busy || undefined} className="pp-editor-file">
          {messages.decks.coverChoose}
          <input data-testid="deck-cover-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
            onChange={(event) => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </Button>
        {coverAssetId && (
          <Button size="md" variant="subtle" color="red" data-testid="deck-cover-remove" disabled={busy} onClick={onRemove}>
            {messages.decks.coverRemove}
          </Button>
        )}
      </Group>
      {busy && <Text size="sm" role="status" data-testid="deck-cover-busy">{generating ? messages.decks.coverGenerating : messages.decks.coverBusy}</Text>}
      {error && <Alert color="red" variant="light" role="alert" data-testid="deck-cover-error">{error}</Alert>}
    </Stack>
  );
}
