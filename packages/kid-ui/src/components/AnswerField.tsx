import { TextInput, type TextInputProps } from "@mantine/core";
import type { ElementProps } from "@mantine/core";
import type { ReactElement, Ref } from "react";
import classes from "./answer-controls.module.css";

export interface AnswerFieldProps extends TextInputProps, ElementProps<"input", keyof TextInputProps> {
  ref?: Ref<HTMLInputElement>;
}

export function AnswerField({ ref, className, classNames, ...props }: AnswerFieldProps): ReactElement {
  return (
    <TextInput
      {...props}
      ref={ref}
      radius={16}
      size="lg"
      className={[classes.field, className].filter(Boolean).join(" ")}
      classNames={(theme, inputProps, ctx) => {
        const userClassNames = typeof classNames === "function"
          ? classNames(theme, inputProps, ctx)
          : classNames;
        return {
          ...userClassNames,
          input: [userClassNames?.input, classes.input].filter(Boolean).join(" "),
        };
      }}
    />
  );
}
