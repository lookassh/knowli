import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";

export interface WordChoiceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
}

/** Inline word in a sentence that the child taps as an answer. */
export function WordChoiceButton({ type = "button", ref, ...props }: WordChoiceButtonProps): ReactElement {
  return <button {...props} ref={ref} type={type} />;
}
