import type { InputHTMLAttributes, ReactElement, Ref } from "react";

export interface LetterFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  ref?: Ref<HTMLInputElement>;
}

/** Single-letter gap input used by letter-completion exercises. */
export function LetterField({ type = "text", ref, ...props }: LetterFieldProps): ReactElement {
  return <input {...props} ref={ref} type={type} />;
}
