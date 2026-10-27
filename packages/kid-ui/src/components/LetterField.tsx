import type { InputHTMLAttributes, ReactElement, Ref } from "react";
import { m } from "motion/react";
import { kidLetterPop, kidLetterPopTransition } from "../motion/kid-motion";

export interface LetterFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"> {
  ref?: Ref<HTMLInputElement>;
}

/** Single-letter gap input used by letter-completion exercises.
 * A filled letter pops once; clearing it stays quiet. */
export function LetterField({ type = "text", ref, ...props }: LetterFieldProps): ReactElement {
  const filled = typeof props.value === "string" && props.value.length > 0;
  return (
    <m.input
      {...props}
      ref={ref}
      type={type}
      animate={filled ? kidLetterPop : { scale: 1 }}
      transition={kidLetterPopTransition}
    />
  );
}
