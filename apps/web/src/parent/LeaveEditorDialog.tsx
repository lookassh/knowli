"use client";

import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";

export default function LeaveEditorDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      stayButton.current?.focus();
    } else if (!open && element.open) {
      element.close();
      returnFocus.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="leave-editor-dialog"
      data-testid="leave-editor-dialog"
      aria-labelledby="leave-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onStay();
      }}
    >
      <h2 id="leave-editor-title">{messages.decks.leaveTitle}</h2>
      <p>{messages.decks.leaveDescription}</p>
      <div className="row">
        <button ref={stayButton} type="button" data-testid="leave-editor-stay" onClick={onStay}>
          {messages.decks.leaveStay}
        </button>
        <button type="button" data-testid="leave-editor-leave" onClick={onLeave}>
          {messages.decks.leaveWithoutSaving}
        </button>
      </div>
    </dialog>
  );
}
