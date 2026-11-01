import type { ReactElement } from "react";

export type KidIconName =
  | "volume" | "microphone" | "microphone-off" | "book" | "ear" | "pencil"
  | "letters" | "check" | "close" | "calendar" | "chevron-left" | "chevron-right"
  | "arrow-right" | "lock" | "sparkles" | "retry" | "question"
  | "almost" | "info" | "turtle";

const paths: Record<KidIconName, ReactElement> = {
  // Pełny korpus głośnika z zaokrąglonymi rogami i dwie fale: czytelny także w 48 px.
  volume: <><path d="M3 9.75C3 8.78 3.78 8 4.75 8H7.5l4.1-3.6c.65-.57 1.65-.11 1.65.75v13.7c0 .86-1 1.32-1.65.75L7.5 16H4.75C3.78 16 3 15.22 3 14.25z" fill="currentColor"/><path d="M16.5 9a4 4 0 0 1 0 6M19.2 6.3a8 8 0 0 1 0 11.4" strokeWidth="2"/></>,
  microphone: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
  "microphone-off": <><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9V5a3 3 0 0 0-5.8-1M5 10v2a7 7 0 0 0 11.2 5.6M19 10v2a7 7 0 0 1-.7 3.05M12 19v3m-4 0h8M3 3l18 18"/></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8m-8 4h8"/></>,
  ear: <><path d="M6 9a6 6 0 1 1 12 0c0 3-2 4-3 5.5-1 1.5-1 3.5-3 3.5a2 2 0 0 1-2-2"/><path d="M10 9a2 2 0 1 1 4 0c0 1.5-2 2-2 4"/></>,
  pencil: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15z"/><path d="M4 20h16"/></>,
  letters: <><path d="M4 19 9 5l5 14M6 14h7M14 19l3-9 3 9m-5-3h4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 4h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
  "chevron-left": <path d="m15 18-6-6 6-6"/>,
  "chevron-right": <path d="m9 18 6-6-6-6"/>,
  "arrow-right": <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></>,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l1 2.5 2.5 1-2.5 1L19 23l-1-2.5-2.5-1 2.5-1z"/></>,
  retry: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
  // Sam znak zapytania bez koła: przycisk pomocy ma już własny obrys.
  question: <><path d="M8 8a4 4 0 1 1 6.1 3.4c-1.25.75-2.1 1.6-2.1 3.1v.5" strokeWidth="2.4"/><circle cx="12" cy="19.5" r="1.5" fill="currentColor" stroke="none"/></>,
  almost: <path d="M4 13c2.5-3 5-3 8 0s5.5 3 8 0"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  // Żółw z profilu („Posłuchaj wolniej”): wysoka skorupa (y 5→16) z wypełnionym
  // pasem przy brzegu zamiast deseniu, który w 24 px czytał się jak litera; dwie
  // nóżki do y 20 i pełna głowa r 2,5. Wypełnienia w currentColor dają wagę
  // pełnego głośnika obok, grubość 2 jak jego fale.
  turtle: <><path d="M1.5 16C1.5 10 5.1 5 9.5 5S17.5 10 17.5 16z" strokeWidth="2"/><path d="M2.4 11h14.2l.9 5H1.5z" fill="currentColor" strokeWidth="2"/><path d="M5.5 16v4m8-4v4" strokeWidth="2"/><circle cx="20.5" cy="13" r="2.5" fill="currentColor" strokeWidth="2"/></>,
};

export function KidIcon({ name, className }: { name: KidIconName; className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={["kid-icon", className].filter(Boolean).join(" ")}
      data-icon={name}
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
