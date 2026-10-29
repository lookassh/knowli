/**
 * Potwierdzenie w oknie (`modals.openConfirmModal`) wykonuje polecenie raz:
 * Mantine woła `onConfirm` przed zamknięciem okna, więc szybkie podwójne
 * kliknięcie w trakcie animacji wysłałoby polecenie dwa razy.
 */
export function runOnce(action: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    action();
  };
}
