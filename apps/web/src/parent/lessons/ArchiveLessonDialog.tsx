"use client";

import { Alert, Button, Group, Modal, Text } from "@mantine/core";
import { messages } from "@learning/contracts";

/**
 * Potwierdzenie usunięcia lekcji z listy. Fokus po zamknięciu oddaje
 * wywołujący (`onClosed`) — wiersz z koszem może już nie istnieć.
 */
export default function ArchiveLessonDialog({ lesson, busy, error, onCancel, onConfirm, onClosed }: {
  lesson: { title: string } | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onClosed: () => void;
}) {
  return (
    <Modal
      opened={lesson !== null}
      onClose={() => { if (!busy) onCancel(); }}
      title={messages.lessons.archiveTitle}
      centered
      radius="lg"
      withCloseButton={false}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      returnFocus={false}
      onExitTransitionEnd={onClosed}
      attributes={{ content: { "aria-busy": busy ? "true" : "false" } }}
    >
      <Text id="archive-lesson-description" style={{ overflowWrap: "anywhere" }}>
        {messages.lessons.archiveDescription.replace("{title}", lesson?.title ?? "")}
      </Text>
      {error && <Alert color="red" variant="light" role="alert" mt="md">{error}</Alert>}
      <Group justify="flex-end" gap="sm" mt="lg">
        <Button variant="default" size="md" data-autofocus onClick={onCancel} disabled={busy}>
          {messages.lessons.archiveCancel}
        </Button>
        <Button color="red" size="md" onClick={onConfirm} disabled={busy}>
          {busy ? messages.lessons.archiving : messages.lessons.archive}
        </Button>
      </Group>
    </Modal>
  );
}
