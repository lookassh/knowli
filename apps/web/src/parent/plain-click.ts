import type { MouseEvent } from "react";

/**
 * Linki panelu mają prawdziwy adres: zwykłe kliknięcie zostaje w panelu
 * (nawigacja przez leave guard), a Ctrl/⌘/Shift/środkowy przycisk otwiera
 * adres jak zwykły link.
 */
export function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
