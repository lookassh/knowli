"use client";

import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";

export default function ArchiveLessonDialog({ lesson, busy, error, onCancel, onConfirm, onFocusFallback }: {
  lesson: { title: string } | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onFocusFallback: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = lesson !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      cancelButton.current?.focus();
    } else if (!open && element.open) {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else onFocusFallback();
    }
  }, [open, onFocusFallback]);

  useEffect(() => {
    const element = dialog.current;
    return () => { if (element?.open) element.close(); };
  }, []);

  return (
    <dialog ref={dialog} className="leave-editor-dialog" aria-labelledby="archive-lesson-title"
      aria-describedby="archive-lesson-description" aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="archive-lesson-title">{messages.lessons.archiveTitle}</h2>
      <p id="archive-lesson-description" style={{ overflowWrap: "anywhere" }}>
        {messages.lessons.archiveDescription.replace("{title}", lesson?.title ?? "")}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button ref={cancelButton} type="button" onClick={onCancel} disabled={busy}>
          {messages.lessons.archiveCancel}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}>
          {busy ? messages.lessons.archiving : messages.lessons.archive}
        </button>
      </div>
    </dialog>
  );
}
