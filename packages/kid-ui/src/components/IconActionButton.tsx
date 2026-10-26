import type { ReactElement } from "react";
import { ActionButton, type ActionButtonProps } from "./ActionButton";

export interface IconActionButtonProps extends Omit<ActionButtonProps, "size" | "fullWidth"> {
  /** Icon-only controls must always expose a text name to assistive tech. */
  "aria-label": string;
}

/** Square 48x48 icon action built on ActionButton; use instead of raw icon buttons. */
export function IconActionButton({ variant, priority = "secondary", radius = "var(--kid-shape-l)", style, ...props }: IconActionButtonProps): ReactElement {
  return (
    <ActionButton
      {...props}
      variant={variant}
      priority={variant === undefined ? priority : undefined}
      size="sm"
      fullWidth={false}
      radius={radius}
      style={{ width: 48, height: 48, minWidth: 48, minHeight: 48, padding: 0, flex: "none", ...style }}
    />
  );
}
