import type { ReactElement } from "react";

export type KidIconName =
  | "volume" | "microphone" | "microphone-off" | "book" | "ear" | "pencil"
  | "letters" | "check" | "close" | "calendar" | "chevron-left" | "chevron-right"
  | "arrow-right" | "lock" | "sparkles" | "retry" | "question"
  | "almost" | "info";

const paths: Record<KidIconName, ReactElement> = {
  volume: <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></>,
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
  question: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.1 1-1.9 1.3-1.9 3.1m0 3h.01"/></>,
  almost: <path d="M4 13c2.5-3 5-3 8 0s5.5 3 8 0"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
};

export function KidIcon({ name, className }: { name: KidIconName; className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={["kid-icon", className].filter(Boolean).join(" ")}
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
