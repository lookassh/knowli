import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";
import { m, useReducedMotion } from "motion/react";
import { kidIdleBreath, kidIdleBreathTransition, kidSpringSnappy, kidTapScale } from "../motion/kid-motion";
import classes from "./answer-controls.module.css";

export type ActionButtonVariant = "filled" | "tonal" | "outlined" | "text";

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"> {
  /** Material 3 button style. Takes precedence over the legacy priority. */
  variant?: ActionButtonVariant;
  /** @deprecated Use variant: "primary" maps to filled, "secondary" to tonal. */
  priority?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  radius?: number | string;
  fullWidth?: boolean;
  /** Main next step: after a pause the button "breathes" to invite a tap. */
  idleNudge?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function ActionButton({
  variant,
  priority,
  type = "button",
  size = "lg",
  radius = "var(--kid-shape-l)",
  fullWidth = true,
  idleNudge = false,
  ref,
  className,
  style,
  ...props
}: ActionButtonProps): ReactElement {
  const resolvedVariant: ActionButtonVariant = variant ?? (priority === "secondary" ? "tonal" : "filled");
  const reduceMotion = useReducedMotion();
  const breathe = idleNudge && !props.disabled && reduceMotion !== true;
  return (
    <m.button
      {...props}
      ref={ref}
      type={type}
      data-size={size}
      data-variant={resolvedVariant}
      data-priority={priority ?? (resolvedVariant === "filled" ? "primary" : "secondary")}
      data-full-width={fullWidth}
      style={{ borderRadius: radius, ...style }}
      className={["kid-action", classes.action, className].filter(Boolean).join(" ")}
      data-idle-nudge={breathe || undefined}
      animate={breathe ? { ...kidIdleBreath, transition: kidIdleBreathTransition() } : { scale: 1 }}
      whileTap={props.disabled ? undefined : { scale: kidTapScale }}
      transition={kidSpringSnappy}
    />
  );
}
