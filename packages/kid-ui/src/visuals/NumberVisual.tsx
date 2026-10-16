import type { ReactElement } from "react";

export function NumberVisual({ count, label }: { count: number; label: string; display?: "apples" | "digit" }): ReactElement {
  return (
    <svg className="kid-visual kid-visual-number kid-visual-number--digit" viewBox="0 0 160 120" role="img" aria-label={label}>
      <text x="80" y="84" textAnchor="middle" fontSize="88" fontWeight="800" fill="currentColor">
        {count}
      </text>
    </svg>
  );
}
