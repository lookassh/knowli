"use client";

import { Stack, Text, TextInput, Textarea } from "@mantine/core";
import { messages } from "@learning/contracts";
import { SOURCE_BODY_MAX, SOURCE_TITLE_MAX, sourceCounter, type SourceFormValues } from "./sources-state";

/**
 * Pola źródła wspólne dla nowego źródła i edycji: tytuł oraz tekst rozdziału
 * z podpowiedzią i licznikiem znaków (limit 16 000).
 */
export default function SourceFields({
  values,
  onChange,
  disabled,
  autoFocusTitle = false,
}: {
  values: SourceFormValues;
  onChange: (values: SourceFormValues) => void;
  disabled: boolean;
  /** Fokus na tytule po otwarciu okna (Mantine `data-autofocus`). */
  autoFocusTitle?: boolean;
}) {
  return (
    <Stack gap="md">
      <TextInput
        data-autofocus={autoFocusTitle || undefined}
        size="md"
        id="source-title"
        label={messages.sources.titleLabel}
        data-testid="source-title"
        maxLength={SOURCE_TITLE_MAX}
        disabled={disabled}
        value={values.title}
        onChange={(event) => onChange({ ...values, title: event.currentTarget.value })}
      />
      <div>
        <Textarea
          size="md"
          id="source-body"
          label={messages.sources.bodyLabel}
          data-testid="source-body"
          autosize
          minRows={8}
          maxRows={16}
          maxLength={SOURCE_BODY_MAX}
          disabled={disabled}
          aria-describedby="source-body-hint source-body-counter"
          value={values.body}
          onChange={(event) => onChange({ ...values, body: event.currentTarget.value })}
        />
        <Text size="sm" mt={6} className="pp-editor-muted" id="source-body-hint" data-testid="source-body-hint">
          {messages.sources.bodyHint}
        </Text>
        <Text size="sm" mt={2} ta="right" className="pp-editor-muted" id="source-body-counter" data-testid="source-body-counter">
          {sourceCounter(values.body.length)}
        </Text>
      </div>
    </Stack>
  );
}
