import { UnstyledButton, type UnstyledButtonProps } from "@mantine/core";
import type { ElementProps } from "@mantine/core";
import type { ReactElement, Ref } from "react";
import classes from "./answer-controls.module.css";

export type ActionButtonVariant = "filled" | "tonal" | "outlined" | "text";

export interface ActionButtonProps extends Omit<UnstyledButtonProps, "variant">, ElementProps<"button", keyof UnstyledButtonProps> {
  /** Material 3 button style. Takes precedence over the legacy priority. */
  variant?: ActionButtonVariant;
  /** @deprecated Use variant: "primary" maps to filled, "secondary" to tonal. */
  priority?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  radius?: number | string;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function ActionButton({
  variant,
  priority,
  type = "button",
  size = "lg",
  radius = "var(--kid-shape-xl)",
  fullWidth = true,
  ref,
  className,
  ...props
}: ActionButtonProps): ReactElement {
  const resolvedVariant: ActionButtonVariant = variant ?? (priority === "secondary" ? "tonal" : "filled");
  return (
    <UnstyledButton
      {...props}
      ref={ref}
      type={type}
      data-size={size}
      data-variant={resolvedVariant}
      data-priority={priority ?? (resolvedVariant === "filled" ? "primary" : "secondary")}
      data-full-width={fullWidth}
      style={{ borderRadius: radius, ...props.style }}
      className={[classes.action, className].filter(Boolean).join(" ")}
    />
  );
}
