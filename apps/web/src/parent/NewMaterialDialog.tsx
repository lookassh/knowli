"use client";

import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";
import { ParentIcon } from "./ParentIcon";

export type NewMaterialStep = "menu" | "generate" | "empty";

/**
 * Modal tworzenia materiału: menu trzech ścieżek lub formularz generowania /
 * pustego zestawu. Stan niepewnego polecenia (pending) przeżywa zamknięcie —
 * ponowne otwarcie wraca do kroku z przyciskiem ponowienia.
 */
export default function NewMaterialDialog({
  open,
  step,
  onStepChange,
  onRequestClose,
  title,
  onTitleChange,
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
  step: NewMaterialStep;
  onStepChange: (step: NewMaterialStep) => void;
  onRequestClose: () => void;
  title: string;
  onTitleChange: (value: string) => void;
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
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const generateSubmit = useRef<HTMLButtonElement>(null);
  const emptySubmit = useRef<HTMLButtonElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Powrót z formularza do menu jest blokowany, gdy wisi niepotwierdzone
  // polecenie — przycisk ponowienia nie może zostać ukryty.
  const backDisabled =
    (step === "generate" && (generating || pendingGeneration)) ||
    (step === "empty" && creatingEmpty);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      returnFocus.current?.focus();
      return;
    } else if (!open) {
      return;
    }
    // fokus prowadzi za zmieniającym się krokiem (menu ↔ formularz);
    // zablokowany przycisk jest no-op, więc wtedy łapie go nagłówek
    const target = step === "generate" ? generateSubmit.current : step === "empty" ? emptySubmit.current : firstOption.current;
    if (target && !target.disabled) {
      target.focus();
    } else {
      titleRef.current?.focus();
    }
  }, [open, step]);

  const fieldDisabled = generating || pendingGeneration || creatingEmpty;

  return (
    <dialog
      ref={dialog}
      className="pp-dialog"
      data-testid="new-material-dialog"
      aria-labelledby="new-material-title"
      onCancel={(event) => {
        event.preventDefault();
        onRequestClose();
      }}
    >
      <div className="pp-dialog-head">
        <h2 id="new-material-title" ref={titleRef} tabIndex={-1} style={{ outline: "none" }}>{messages.decks.newMaterial}</h2>
        <button
          type="button"
          className="pp-btn pp-btn-ghost pp-btn-icon"
          data-testid="new-material-close"
          aria-label={messages.decks.newMaterialClose}
          onClick={onRequestClose}
        >
          <ParentIcon name="x" />
        </button>
      </div>

      {step === "menu" && (
        <div>
          <p className="pp-dialog-sub">{messages.decks.newMaterialSubtitle}</p>
          <button type="button" className="pp-option" data-testid="new-material-generate" onClick={() => onStepChange("generate")}>
            <span className="pp-option-ico pp-option-ico-brand">
              <ParentIcon name="sparkles" />
            </span>
            <span>
              <span className="pp-option-t">{messages.decks.newGenerate}</span>
              <span className="pp-option-d">{messages.decks.newGenerateDescription}</span>
            </span>
          </button>
          <button
            type="button"
            className="pp-option"
            data-testid="new-material-empty"
            disabled={generating || creatingEmpty || pendingGeneration}
            onClick={() => onStepChange("empty")}
          >
            <span className="pp-option-ico pp-option-ico-blue">
              <ParentIcon name="file-plus" />
            </span>
            <span>
              <span className="pp-option-t">{messages.decks.newEmpty}</span>
              <span className="pp-option-d">{messages.decks.newEmptyDescription}</span>
            </span>
          </button>
          <button
            ref={firstOption}
            type="button"
            className="pp-option"
            data-testid="new-lesson-submit"
            disabled={generating || creatingEmpty || pendingGeneration}
            onClick={onLesson}
          >
            <span className="pp-option-ico pp-option-ico-purple">
              <ParentIcon name="graduation-cap" />
            </span>
            <span>
              <span className="pp-option-t">{messages.lessons.newLesson}</span>
              <span className="pp-option-d">{messages.lessons.newLessonDescription}</span>
            </span>
          </button>
        </div>
      )}

      {step === "generate" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onGenerate();
          }}
        >
          <p className="pp-dialog-sub">{messages.decks.newGenerateDescription}</p>
          <label className="pp-dialog-label" htmlFor="new-material-deck-title">
            {messages.decks.titleLabel}
            <input
              id="new-material-deck-title"
              data-testid="deck-title"
              value={title}
              disabled={fieldDisabled}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          </label>
          <label className="pp-dialog-label" htmlFor="new-material-deck-prompt">
            {messages.decks.promptLabel}
            <textarea
              id="new-material-deck-prompt"
              data-testid="deck-prompt"
              rows={3}
              placeholder={messages.decks.promptPlaceholder}
              value={prompt}
              disabled={fieldDisabled}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </label>
          {error && (
            <p className="pp-error" data-testid="api-error" role="alert">
              {error}
            </p>
          )}
          <div className="pp-dialog-actions">
            <button
              type="button"
              className="pp-btn pp-btn-quiet"
              data-testid="new-material-back"
              disabled={backDisabled}
              onClick={() => onStepChange("menu")}
            >
              {messages.decks.back}
            </button>
            <button ref={generateSubmit} type="submit" className="pp-btn pp-btn-primary" data-testid="generate-submit" disabled={createDisabled}>
              {generating
                ? messages.decks.generating
                : pendingGeneration
                  ? messages.decks.retryGenerationRequest
                  : messages.decks.generate}
            </button>
          </div>
        </form>
      )}

      {step === "empty" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onCreateEmpty();
          }}
        >
          <p className="pp-dialog-sub">{messages.decks.newEmptyStepDescription}</p>
          <label className="pp-dialog-label" htmlFor="new-material-empty-title">
            {messages.decks.titleLabel}
            <input
              id="new-material-empty-title"
              data-testid="deck-title"
              value={title}
              disabled={fieldDisabled}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          </label>
          {error && (
            <p className="pp-error" data-testid="api-error" role="alert">
              {error}
            </p>
          )}
          <div className="pp-dialog-actions">
            <button
              type="button"
              className="pp-btn pp-btn-quiet"
              data-testid="new-material-back"
              disabled={backDisabled}
              onClick={() => onStepChange("menu")}
            >
              {messages.decks.back}
            </button>
            <button ref={emptySubmit} type="submit" className="pp-btn pp-btn-primary" data-testid="create-empty-submit" disabled={createDisabled}>
              {creatingEmpty || pendingEmpty ? messages.decks.creatingEmpty : messages.decks.createEmpty}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
