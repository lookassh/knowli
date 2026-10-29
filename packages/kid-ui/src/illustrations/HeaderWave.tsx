import type { ReactElement } from "react";

/** Falista dolna krawędź paska nagłówka; kolor pochodzi z CSS rodzica (`color`). */
export function HeaderWave({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      preserveAspectRatio="none"
      viewBox="0 0 390 40"
    >
      <path d="M0 0 H390 V18 Q341 36 292.5 18 Q244 0 195 18 Q146 36 97.5 18 Q49 0 0 18 Z" fill="currentColor" />
    </svg>
  );
}
