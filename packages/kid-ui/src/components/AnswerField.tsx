import type { InputHTMLAttributes, KeyboardEvent, ReactElement, Ref, TextareaHTMLAttributes } from "react";
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

export interface AnswerTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Extra class on the textarea element itself; className styles the wrapper. */
  inputClassName?: string;
  /**
   * Enter submits the owning form (Shift+Enter keeps a new line): a child's
   * answer is one paragraph, so the key behaves like in a single-line field.
   */
  submitOnEnter?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * Multi-line variant of `AnswerField` for long answers the child edits in
 * place (e.g. shortening an own answer). It grows with its content up to a
 * cap and then scrolls, so the text is never clipped.
 */
export function AnswerTextArea({ ref, className, inputClassName, submitOnEnter = false, onKeyDown, rows = 3, ...props }: AnswerTextAreaProps): ReactElement {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !submitOnEnter) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  return (
    <div className={[classes.field, className].filter(Boolean).join(" ")}>
      <textarea
        {...props}
        ref={ref}
        rows={rows}
        onKeyDown={handleKeyDown}
        className={[classes.input, classes.textarea, inputClassName].filter(Boolean).join(" ")}
      />
    </div>
  );
}
