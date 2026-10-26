import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";
import { m } from "motion/react";
import { kidSpringSnappy, kidTapScale } from "../motion/kid-motion";

export interface ProfileChoiceButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"> {
  ref?: Ref<HTMLButtonElement>;
}

/** Child profile tile on the profile picker. */
export function ProfileChoiceButton({ type = "button", ref, disabled, ...props }: ProfileChoiceButtonProps): ReactElement {
  return <m.button {...props} ref={ref} type={type} disabled={disabled} whileTap={disabled ? undefined : { scale: kidTapScale }} transition={kidSpringSnappy} />;
}
