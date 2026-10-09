import { useEffect, useRef, type ReactNode } from "react";

/** Wynik jest zawsze w widocznym ekranie, niezależnie od długości ćwiczenia. */
export function FeedbackDialog({ children, className }: { children: ReactNode; className: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    // Fokus poza polem odpowiedzi zwalnia klawiaturę ekranową telefonu.
    dialog.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={className}
      data-testid="kid-feedback"
      aria-labelledby="kid-feedback-title"
      onCancel={(event) => event.preventDefault()}
    >
      {children}
    </dialog>
  );
}
