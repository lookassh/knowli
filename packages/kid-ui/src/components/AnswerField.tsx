import type { InputHTMLAttributes, ReactElement, Ref } from "react";
import classes from "./answer-controls.module.css";

export interface AnswerFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Extra class on the input element itself; className styles the wrapper. */
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function AnswerField({ ref, className, inputClassName, type = "text", ...props }: AnswerFieldProps): ReactElement {
  return (
    <div className={[classes.field, className].filter(Boolean).join(" ")}>
      <input
        {...props}
        ref={ref}
        type={type}
        className={[classes.input, inputClassName].filter(Boolean).join(" ")}
      />
    </div>
  );
}
