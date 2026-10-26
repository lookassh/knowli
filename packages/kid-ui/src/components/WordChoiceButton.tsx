import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";
import { m } from "motion/react";
import { kidSpringSnappy, kidTapScale } from "../motion/kid-motion";

export interface WordChoiceButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"> {
  ref?: Ref<HTMLButtonElement>;
}

/** Inline word in a sentence that the child taps as an answer. */
export function WordChoiceButton({ type = "button", ref, disabled, ...props }: WordChoiceButtonProps): ReactElement {
  return <m.button {...props} ref={ref} type={type} disabled={disabled} whileTap={disabled ? undefined : { scale: kidTapScale }} transition={kidSpringSnappy} />;
}
