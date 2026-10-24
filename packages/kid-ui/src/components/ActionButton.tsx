import { Button, type ButtonProps } from "@mantine/core";
import type { ElementProps } from "@mantine/core";
import type { ReactElement, Ref } from "react";
import classes from "./answer-controls.module.css";

export interface ActionButtonProps extends Omit<ButtonProps, "variant">, ElementProps<"button", keyof ButtonProps> {
  priority?: "primary" | "secondary";
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
    <Button
      {...props}
      ref={ref}
      type={type}
      size={size}
      radius={radius}
      fullWidth={fullWidth}
      variant={priority === "primary" ? "filled" : "outline"}
      className={[classes.action, className].filter(Boolean).join(" ")}
    />
  );
}
