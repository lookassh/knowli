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
      <path d="M0 18 Q49 0 97.5 18 T195 18 T292.5 18 T390 18 V40 H0 Z" fill="currentColor" />
    </svg>
  );
}
