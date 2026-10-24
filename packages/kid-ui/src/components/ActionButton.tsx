import { UnstyledButton, type UnstyledButtonProps } from "@mantine/core";
import type { ElementProps } from "@mantine/core";
import type { ReactElement, Ref } from "react";
import classes from "./answer-controls.module.css";

export interface ActionButtonProps extends Omit<UnstyledButtonProps, "variant">, ElementProps<"button", keyof UnstyledButtonProps> {
  priority?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  radius?: number | string;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function ActionButton({
  priority = "primary",
  type = "button",
  size = "lg",
  radius = 18,
  fullWidth = true,
  ref,
  className,
  ...props
}: ActionButtonProps): ReactElement {
  return (
    <UnstyledButton
      {...props}
      ref={ref}
      type={type}
      data-size={size}
      data-priority={priority}
      data-full-width={fullWidth}
      style={{ borderRadius: radius, ...props.style }}
      className={[classes.action, className].filter(Boolean).join(" ")}
    />
  );
}
