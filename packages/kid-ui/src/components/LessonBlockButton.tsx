import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";
import { m } from "motion/react";
import { kidSpringSnappy, kidTapScale } from "../motion/kid-motion";

export interface LessonBlockButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"> {
  ref?: Ref<HTMLButtonElement>;
}

/** Movable word block in lesson ordering exercises (pool and sentence). */
export function LessonBlockButton({ type = "button", ref, disabled, ...props }: LessonBlockButtonProps): ReactElement {
  return <m.button {...props} ref={ref} type={type} disabled={disabled} whileTap={disabled ? undefined : { scale: kidTapScale }} transition={kidSpringSnappy} />;
}
