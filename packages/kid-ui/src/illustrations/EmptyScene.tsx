import type { ReactElement } from "react";

/** Spokojna zatoka na pusty stan: słońce, żaglówka i fale. Dekoracja, bez treści dla czytników. */
export function EmptyScene({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 200 120"
      width="200"
      height="120"
    >
      <circle cx="154" cy="30" r="13" fill="#F2B544" />
      <rect x="99" y="38" width="2.4" height="40" rx="1.2" fill="#FFF3E6" />
      <path d="M103.5 40 L103.5 74 L128 74 Z" fill="#FFF3E6" />
      <path d="M96.5 48 L96.5 74 L78 74 Z" fill="#F4B6C2" />
      <path d="M70 76 L130 76 L120 92 L80 92 Z" fill="#E8783A" />
      <path d="M0 90 Q25 80 50 90 T100 90 T150 90 T200 90 V120 H0 Z" fill="#4FA3C7" />
      <path d="M0 102 Q25 94 50 102 T100 102 T150 102 T200 102 V120 H0 Z" fill="#2F7F9F" />
    </svg>
  );
}
