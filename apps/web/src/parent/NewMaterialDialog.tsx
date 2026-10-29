"use client";

import { useEffect, useRef } from "react";
import { Alert, Box, Button, Group, Modal, NativeSelect, Stack, Text, TextInput, Textarea, ThemeIcon, UnstyledButton } from "@mantine/core";
import { messages } from "@learning/contracts";
import { ParentIcon, type ParentIconName } from "./ParentIcon";

export type NewMaterialStep = "menu" | "generate" | "empty";

function Option({
  testId,
  icon,
  color,
  title,
  description,
  disabled,
  onClick,
}: {
  testId: string;
  icon: ParentIconName;
  color: string;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton className="pp-material-option" data-testid={testId} disabled={disabled} onClick={onClick}>
      <ThemeIcon size={44} radius="md" variant="light" color={color} aria-hidden="true">
        <ParentIcon name={icon} className="pp-material-option-icon" />
      </ThemeIcon>
      <Box>
        <Text fw={600}>{title}</Text>
        <Text size="sm" className="pp-decks-muted">{description}</Text>
      </Box>
    </UnstyledButton>
  );
}

/**
 * Modal tworzenia materiału: menu trzech ścieżek lub formularz generowania /
 * pustego zestawu. Stan niepewnego polecenia (pending) przeżywa zamknięcie —
 * ponowne otwarcie wraca do kroku z przyciskiem ponowienia.
 */
export default function NewMaterialDialog({
  open,
  fullScreen,
  step,
  onStepChange,
  onRequestClose,
  title,
  onTitleChange,
  vocabularyFormat,
  onVocabularyFormatChange,
  prompt,
  onPromptChange,
  generating,
  pendingGeneration,
  createDisabled,
  onGenerate,
  creatingEmpty,
  pendingEmpty,
  onCreateEmpty,
  onLesson,
  error,
}: {
  open: boolean;
  fullScreen: boolean;
  step: NewMaterialStep;
  onStepChange: (step: NewMaterialStep) => void;
  onRequestClose: () => void;
  title: string;
  onTitleChange: (value: string) => void;
  vocabularyFormat: "standard" | "picture";
  onVocabularyFormatChange: (value: "standard" | "picture") => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  generating: boolean;
  pendingGeneration: boolean;
  createDisabled: boolean;
  onGenerate: () => void;
  creatingEmpty: boolean;
  pendingEmpty: boolean;
  onCreateEmpty: () => void;
  onLesson: () => void;
  error: string | null;
}) {
  const generateSubmit = useRef<HTMLButtonElement>(null);
  const emptySubmit = useRef<HTMLButtonElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);

  // Powrót z formularza do menu jest blokowany, gdy wisi niepotwierdzone
  // polecenie — przycisk ponowienia nie może zostać ukryty.
  const backDisabled =
    (step === "generate" && (generating || pendingGeneration)) ||
    (step === "empty" && creatingEmpty);
  const fieldDisabled = generating || pendingGeneration || creatingEmpty;
  const optionsDisabled = generating || creatingEmpty || pendingGeneration;

  // fokus prowadzi za zmieniającym się krokiem (menu ↔ formularz)
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const target = step === "generate" ? generateSubmit.current : step === "empty" ? emptySubmit.current : firstOption.current;
      if (target && !target.disabled) target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  const backButton = (
    <Button variant="default" size="md" data-testid="new-material-back" disabled={backDisabled} onClick={() => onStepChange("menu")}>
      {messages.decks.back}
    </Button>
  );
  const errorAlert = error && (
    <Alert color="red" variant="light" data-testid="api-error" role="alert">
      {error}
    </Alert>
  );

  return (
    <Modal
      opened={open}
      onClose={onRequestClose}
      title={messages.decks.newMaterial}
      fullScreen={fullScreen}
      centered
      radius={fullScreen ? 0 : "lg"}
      size="lg"
      closeButtonProps={{ "aria-label": messages.decks.newMaterialClose, "data-testid": "new-material-close" } as Record<string, string>}
      attributes={{ content: { "data-testid": "new-material-dialog" } }}
    >
      {step === "menu" && (
        <Stack gap="sm">
          <Text className="pp-decks-muted">{messages.decks.newMaterialSubtitle}</Text>
          <Option
            testId="new-material-generate"
            icon="sparkles"
            color="brand"
            title={messages.decks.newGenerate}
            description={messages.decks.newGenerateDescription}
            onClick={() => onStepChange("generate")}
          />
          <Option
            testId="new-material-empty"
            icon="file-plus"
            color="blue"
            title={messages.decks.newEmpty}
            description={messages.decks.newEmptyDescription}
            disabled={optionsDisabled}
            onClick={() => onStepChange("empty")}
          />
          <UnstyledButton
            ref={firstOption}
            className="pp-material-option"
            data-testid="new-lesson-submit"
            disabled={optionsDisabled}
            onClick={onLesson}
          >
            <ThemeIcon size={44} radius="md" variant="light" color="violet" aria-hidden="true">
              <ParentIcon name="graduation-cap" className="pp-material-option-icon" />
            </ThemeIcon>
            <Box>
              <Text fw={600}>{messages.lessons.newLesson}</Text>
              <Text size="sm" className="pp-decks-muted">{messages.lessons.newLessonDescription}</Text>
            </Box>
          </UnstyledButton>
        </Stack>
      )}

      {step === "generate" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onGenerate();
          }}
        >
          <Stack gap="md">
            <Text className="pp-decks-muted">{messages.decks.newGenerateDescription}</Text>
            <TextInput
              id="new-material-deck-title"
              size="md"
              label={messages.decks.titleLabel}
              data-testid="deck-title"
              value={title}
              disabled={fieldDisabled}
              onChange={(event) => onTitleChange(event.currentTarget.value)}
            />
            <NativeSelect
              id="new-material-vocabulary-format"
              size="md"
              label={messages.decks.vocabularyFormatLabel}
              data-testid="deck-vocabulary-format"
              value={vocabularyFormat}
              disabled={fieldDisabled}
              onChange={(event) => onVocabularyFormatChange(event.currentTarget.value as "standard" | "picture")}
              data={[
                { value: "standard", label: messages.decks.standardVocabulary },
                { value: "picture", label: messages.decks.pictureVocabulary },
              ]}
            />
            <Textarea
              id="new-material-deck-prompt"
              size="md"
              label={messages.decks.promptLabel}
              data-testid="deck-prompt"
              autosize
              minRows={3}
              placeholder={messages.decks.promptPlaceholder}
              value={prompt}
              disabled={fieldDisabled}
              onChange={(event) => onPromptChange(event.currentTarget.value)}
            />
            {errorAlert}
            <Group justify="flex-end" gap="sm">
              {backButton}
              <Button ref={generateSubmit} type="submit" size="md" data-testid="generate-submit" disabled={createDisabled}>
                {generating
                  ? messages.decks.generating
                  : pendingGeneration
                    ? messages.decks.retryGenerationRequest
                    : messages.decks.generate}
              </Button>
            </Group>
          </Stack>
        </form>
      )}

      {step === "empty" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onCreateEmpty();
          }}
        >
          <Stack gap="md">
            <Text className="pp-decks-muted">{messages.decks.newEmptyStepDescription}</Text>
            <TextInput
              id="new-material-empty-title"
              size="md"
              label={messages.decks.titleLabel}
              data-testid="deck-title"
              value={title}
              disabled={fieldDisabled}
              onChange={(event) => onTitleChange(event.currentTarget.value)}
            />
            {errorAlert}
            <Group justify="flex-end" gap="sm">
              {backButton}
              <Button ref={emptySubmit} type="submit" size="md" data-testid="create-empty-submit" disabled={createDisabled}>
                {creatingEmpty || pendingEmpty ? messages.decks.creatingEmpty : messages.decks.createEmpty}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
