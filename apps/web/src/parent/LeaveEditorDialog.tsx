"use client";

import { Button, Group, Modal, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { messages } from "@learning/contracts";

/** Pytanie o niezapisane zmiany edytora; Esc i kliknięcie obok znaczą „zostań”. */
export default function LeaveEditorDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const compact = useMediaQuery("(max-width: 37.49em)") ?? false;
  return (
    <Modal
      opened={open}
      onClose={onStay}
      title={messages.decks.leaveTitle}
      centered
      fullScreen={false}
      radius="lg"
      size={compact ? "100%" : "md"}
      attributes={{ content: { "data-testid": "leave-editor-dialog" } }}
    >
      <Text>{messages.decks.leaveDescription}</Text>
      <Group justify="flex-end" mt="lg" gap="sm">
        <Button variant="default" size="md" data-autofocus data-testid="leave-editor-stay" onClick={onStay}>
          {messages.decks.leaveStay}
        </Button>
        <Button color="red" size="md" data-testid="leave-editor-leave" onClick={onLeave}>
          {messages.decks.leaveWithoutSaving}
        </Button>
      </Group>
    </Modal>
  );
}
